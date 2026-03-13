import { useState, useCallback, useEffect } from "react";
import {
  type ConnectionConfig,
  listConnections,
  saveConnection,
  deleteConnection,
  connectToServer,
  disconnectFromServer,
  getActiveConnection,
  listDatabases,
  listCollections,
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
      setError(String(e));
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

  const connect = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      await connectToServer(name);
      setActiveConnection(name);
      const dbs = await listDatabases();
      setDatabases(dbs);
      setSelectedDb(null);
      setSelectedCollection(null);
      setCollections([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectFromServer();
      setActiveConnection(null);
      setDatabases([]);
      setCollections([]);
      setSelectedDb(null);
      setSelectedCollection(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const selectDatabase = useCallback(async (db: string) => {
    setSelectedDb(db);
    setSelectedCollection(null);
    try {
      const colls = await listCollections(db);
      setCollections(colls);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const selectCollection = useCallback((collection: string) => {
    setSelectedCollection(collection);
  }, []);

  // Load initial state
  useEffect(() => {
    refreshConnections();
    getActiveConnection().then((name) => {
      if (name) {
        setActiveConnection(name);
        listDatabases()
          .then(setDatabases)
          .catch(() => {});
      }
    });
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
    addConnection,
    removeConnection,
    connect,
    disconnect,
    selectDatabase,
    selectCollection,
    setError,
  };
}
