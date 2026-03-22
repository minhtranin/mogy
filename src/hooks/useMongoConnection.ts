import { useState, useCallback, useMemo, useRef } from "react";
import {
  type ConnectionConfig,
  type Session,
  listConnections,
  saveConnection,
  deleteConnection,
  connectToServer,
  disconnectFromServer,
  listDatabases,
  listCollections,
  saveSession,
  seedFieldCache,
  getFieldCache,
} from "../lib/tauri-commands";

export function useMongoConnection() {
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [activeConnection, setActiveConnection] = useState<string | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Per-connection cache maps — kept in refs to avoid stale closures
  const cachedDbsRef = useRef<Record<string, string[]>>({});
  const cachedCollsRef = useRef<Record<string, string[]>>({});

  const refreshConnections = useCallback(async () => {
    try {
      const conns = await listConnections();
      setConnections(conns);
    } catch (e) {
      console.error("[mogy] failed to load connections:", e);
    }
  }, []);

  const addConnection = useCallback(
    async (name: string, uri: string) => {
      try {
        await saveConnection(name, uri);
        await refreshConnections();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshConnections]
  );

  const removeConnection = useCallback(
    async (name: string) => {
      try {
        await deleteConnection(name);
        // Prune cached entries for the deleted connection
        const { [name]: _db, ...remainingDbs } = cachedDbsRef.current;
        cachedDbsRef.current = remainingDbs;
        const prefix = `${name}::`;
        cachedCollsRef.current = Object.fromEntries(
          Object.entries(cachedCollsRef.current).filter(([k]) => !k.startsWith(prefix))
        );
        await refreshConnections();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshConnections]
  );

  const persistSession = useCallback(
    async (
      conn: string | null,
      db: string | null,
      coll: string | null,
      editorContent?: string | null,
      currentFile?: string | null,
      newDbs?: string[] | null,
      newColls?: string[] | null,
    ) => {
      // Update per-connection maps
      if (conn && newDbs) {
        cachedDbsRef.current = { ...cachedDbsRef.current, [conn]: newDbs };
      }
      if (conn && db && newColls) {
        cachedCollsRef.current = { ...cachedCollsRef.current, [`${conn}::${db}`]: newColls };
      }

      let fields: Record<string, string[]> | null = null;
      try { fields = await getFieldCache(); } catch { /* ignore */ }

      saveSession(
        conn,
        db,
        coll,
        editorContent,
        currentFile,
        undefined,
        undefined,
        undefined,
        Object.keys(cachedDbsRef.current).length ? cachedDbsRef.current : null,
        Object.keys(cachedCollsRef.current).length ? cachedCollsRef.current : null,
        fields && Object.keys(fields).length ? fields : null,
      ).catch(() => {});
    },
    []
  );

  const connect = useCallback(
    async (name: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await connectToServer(name);
        setActiveConnection(result.name);

        // Parallel fetch for databases and collections
        const [dbs] = await Promise.all([listDatabases()]);
        setDatabases(dbs);

        // Auto-select database from URI if available
        if (result.default_database) {
          setSelectedDb(result.default_database);
          setSelectedCollection(null);
          try {
            const [colls] = await Promise.all([
              listCollections(result.default_database),
            ]);
            setCollections(colls);
            persistSession(result.name, result.default_database, null, null, null, dbs, colls);
          } catch {
            setCollections([]);
            persistSession(result.name, result.default_database, null, null, null, dbs, null);
          }
        } else {
          setSelectedDb(null);
          setSelectedCollection(null);
          setCollections([]);
          persistSession(result.name, null, null, null, null, dbs, null);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [persistSession]
  );

  const disconnect = useCallback(async () => {
    try {
      await disconnectFromServer();
      setActiveConnection(null);
      setDatabases([]);
      setCollections([]);
      setSelectedDb(null);
      setSelectedCollection(null);
      persistSession(null, null, null);
    } catch (e) {
      setError(String(e));
    }
  }, [persistSession]);

  const selectDatabase = useCallback(
    async (db: string) => {
      setSelectedDb(db);
      setSelectedCollection(null);
      try {
        const [colls] = await Promise.all([listCollections(db)]);
        setCollections(colls);
        persistSession(activeConnection, db, null, null, null, databases, colls);
      } catch (e) {
        setError(String(e));
      }
    },
    [activeConnection, databases, persistSession]
  );

  const selectCollection = useCallback(
    (collection: string) => {
      setSelectedCollection(collection);
      persistSession(activeConnection, selectedDb, collection);
    },
    [activeConnection, selectedDb, persistSession]
  );

  const refreshCollections = useCallback(async () => {
    if (!selectedDb) return;
    try {
      const colls = await listCollections(selectedDb);
      setCollections(colls);
      persistSession(activeConnection, selectedDb, null, null, null, databases, colls);
    } catch (e) {
      setError(String(e));
    }
  }, [selectedDb, activeConnection, databases, persistSession]);

  const restoreSession = useCallback(async (session: Session) => {
    if (!session.connection) return;

    // Optimistic restore: immediately show cached databases/collections
    if (session.cached_databases) {
      cachedDbsRef.current = session.cached_databases;
      const connDbs = session.cached_databases[session.connection];
      if (connDbs) setDatabases(connDbs);
    }
    if (session.database && session.cached_collections) {
      cachedCollsRef.current = session.cached_collections;
      const collKey = `${session.connection}::${session.database}`;
      const connColls = session.cached_collections[collKey];
      if (connColls) {
        setSelectedDb(session.database);
        setCollections(connColls);
      }
    }
    if (session.collection) {
      setSelectedCollection(session.collection);
    }
    // Pre-warm in-memory field cache from session
    if (session.cached_fields) {
      seedFieldCache(session.cached_fields).catch(() => {});
    }

    setLoading(true);
    try {
      const result = await connectToServer(session.connection);
      setActiveConnection(result.name);

      // Parallel fetch databases and collections
      const [dbs, colls] = await Promise.all([
        listDatabases(),
        session.database ? listCollections(session.database) : Promise.resolve([]),
      ]);

      setDatabases(dbs);
      const db = session.database || result.default_database;
      if (db) {
        setSelectedDb(db);
        setCollections(colls);
      }
      if (session.collection) {
        setSelectedCollection(session.collection);
      }

      // Persist with fresh caches
      persistSession(
        result.name,
        db || session.database,
        session.collection,
        null,
        null,
        dbs,
        db ? colls : null
      );
    } catch {
      // Session connection no longer valid, ignore
    } finally {
      setLoading(false);
    }
  }, [persistSession]);

  const getCachedMaps = useCallback(() => ({
    databases: cachedDbsRef.current,
    collections: cachedCollsRef.current,
  }), []);

  return useMemo(
    () => ({
      connections,
      activeConnection,
      databases,
      collections,
      selectedDb,
      selectedCollection,
      error,
      loading,
      refreshConnections,
      refreshCollections,
      addConnection,
      removeConnection,
      connect,
      disconnect,
      selectDatabase,
      selectCollection,
      setError,
      getCachedMaps,
      restoreSession,
    }),
    [
      connections,
      activeConnection,
      databases,
      collections,
      selectedDb,
      selectedCollection,
      error,
      loading,
      refreshConnections,
      refreshCollections,
      addConnection,
      removeConnection,
      connect,
      disconnect,
      selectDatabase,
      selectCollection,
      setError,
      getCachedMaps,
      restoreSession,
    ]
  );
}
