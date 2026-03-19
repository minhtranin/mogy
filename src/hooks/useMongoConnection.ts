import { useState, useCallback, useEffect, useMemo } from "react";
import {
  type ConnectionConfig,
  listConnections,
  saveConnection,
  deleteConnection,
  connectToServer,
  disconnectFromServer,
  listDatabases,
  listCollections,
  loadSession,
  saveSession,
  refreshAllCollectionFields,
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
        await refreshConnections();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshConnections]
  );

  const persistSession = useCallback(
    (
      conn: string | null,
      db: string | null,
      coll: string | null,
      editorContent?: string | null,
      currentFile?: string | null,
      cachedDbs?: string[] | null,
      cachedColls?: string[] | null
    ) => {
      saveSession(
        conn,
        db,
        coll,
        editorContent,
        currentFile,
        undefined,
        undefined,
        undefined,
        cachedDbs,
        cachedColls
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
            // Warm field cache in background
            refreshAllCollectionFields(result.default_database).catch(() => {});
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
        // Warm field cache in background
        refreshAllCollectionFields(db).catch(() => {});
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

  // Restore session on mount - optimistic restore with parallel fetch
  useEffect(() => {
    const restore = async () => {
      await refreshConnections();
      try {
        const session = await loadSession();
        if (session.connection) {
          // Optimistic restore: immediately show cached databases/collections
          if (session.cached_databases) {
            setDatabases(session.cached_databases);
          }
          if (session.database && session.cached_collections) {
            setSelectedDb(session.database);
            setCollections(session.cached_collections);
          }
          if (session.collection) {
            setSelectedCollection(session.collection);
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
              // Warm field cache in background
              refreshAllCollectionFields(db).catch(() => {});
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
        }
      } catch {
        // No session, that's fine
      }
    };
    restore();
  }, [refreshConnections, persistSession]);

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
    ]
  );
}
