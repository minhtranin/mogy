import { invoke } from "@tauri-apps/api/core";

export interface ConnectionConfig {
  name: string;
  uri: string;
}

export type QueryType = "Find" | "Aggregate";

export interface QueryResult {
  documents: unknown[];
  total_count: number;
  query_type: QueryType;
  page: number;
  page_size: number;
}

export interface ConnectResult {
  name: string;
  default_database: string | null;
}

export interface Session {
  connection: string | null;
  database: string | null;
  collection: string | null;
  last_editor_content: string | null;
}

// Connection commands
export const listConnections = () =>
  invoke<ConnectionConfig[]>("list_connections");

export const saveConnection = (name: string, uri: string) =>
  invoke<void>("save_connection", { name, uri });

export const deleteConnection = (name: string) =>
  invoke<void>("delete_connection", { name });

export const connectToServer = (name: string) =>
  invoke<ConnectResult>("connect", { name });

export const disconnectFromServer = () => invoke<void>("disconnect");

export const getActiveConnection = () =>
  invoke<string | null>("get_active_connection");

// Session
export const loadSession = () => invoke<Session>("load_session_cmd");

export const saveSession = (
  connection: string | null,
  database: string | null,
  collection: string | null,
  lastEditorContent?: string | null
) => invoke<void>("save_session_cmd", { connection, database, collection, lastEditorContent });

// Metadata
export const listDatabases = () => invoke<string[]>("list_databases");

export const listCollections = (db: string) =>
  invoke<string[]>("list_collections", { db });

// Query
export const executeRawQuery = (
  db: string,
  queryText: string,
  page?: number,
  pageSize?: number
) =>
  invoke<QueryResult>("execute_raw_query", {
    db,
    queryText,
    page,
    pageSize,
  });

export const updateDocument = (
  db: string,
  collection: string,
  documentJson: string
) => invoke<void>("update_document", { db, collection, documentJson });

// Query files
export const saveQueryFile = (filename: string, content: string) =>
  invoke<void>("save_query_file", { filename, content });

export const loadQueryFile = (filename: string) =>
  invoke<string>("load_query_file", { filename });

export const listQueryFiles = () =>
  invoke<string[]>("list_query_files");

export const deleteQueryFile = (filename: string) =>
  invoke<void>("delete_query_file", { filename });

// Settings
export const loadSettings = () =>
  invoke<string>("load_settings_cmd");

// Helpers
export function parseCollectionFromQuery(query: string): string | null {
  const match = query.trim().match(/^db\.(\w+)\.(find|aggregate)/);
  return match ? match[1] ?? null : null;
}
