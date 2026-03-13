import { useState, useCallback, useEffect } from "react";
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
    (conn: string | null, db: string | null, coll: string | null, editorContent?: string | null) => {
      saveSession(conn, db, coll, editorContent).catch(() => {});
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

        const dbs = await listDatabases();
        setDatabases(dbs);

        // Auto-select database from URI if available
        if (result.default_database) {
          setSelectedDb(result.default_database);
          setSelectedCollection(null);
          try {
            const colls = await listCollections(result.default_database);
            setCollections(colls);
          } catch {
            setCollections([]);
          }
          persistSession(result.name, result.default_database, null);
        } else {
          setSelectedDb(null);
          setSelectedCollection(null);
          setCollections([]);
          persistSession(result.name, null, null);
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
        const colls = await listCollections(db);
        setCollections(colls);
      } catch (e) {
        setError(String(e));
      }
      persistSession(activeConnection, db, null);
    },
    [activeConnection, persistSession]
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
    } catch (e) {
      setError(String(e));
    }
  }, [selectedDb]);

  // Restore session on mount
  useEffect(() => {
    const restore = async () => {
      await refreshConnections();
      try {
        const session = await loadSession();
        if (session.connection) {
          setLoading(true);
          try {
            const result = await connectToServer(session.connection);
            setActiveConnection(result.name);
            const dbs = await listDatabases();
            setDatabases(dbs);

            const db = session.database || result.default_database;
            if (db) {
              setSelectedDb(db);
              try {
                const colls = await listCollections(db);
                setCollections(colls);
              } catch {
                setCollections([]);
              }
            }
            if (session.collection) {
              setSelectedCollection(session.collection);
            }
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
  }, [refreshConnections]);

  return {
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
  };
}
