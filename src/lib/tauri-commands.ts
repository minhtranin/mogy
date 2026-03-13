import { invoke } from "@tauri-apps/api/core";

export interface ConnectionConfig {
  name: string;
  uri: string;
}

export type QueryType = "Find" | "Aggregate";

export interface QueryRequest {
  db: string;
  collection: string;
  query_type: QueryType;
  filter?: unknown;
  pipeline?: unknown[];
  page?: number;
  page_size?: number;
  sort?: unknown;
  projection?: unknown;
}

export interface QueryResult {
  documents: unknown[];
  total_count: number;
  query_type: QueryType;
  page: number;
  page_size: number;
}

// Connection commands
export const listConnections = () =>
  invoke<ConnectionConfig[]>("list_connections");

export const saveConnection = (name: string, uri: string) =>
  invoke<void>("save_connection", { name, uri });

export const deleteConnection = (name: string) =>
  invoke<void>("delete_connection", { name });

export const connectToServer = (name: string) =>
  invoke<string>("connect", { name });

export const disconnectFromServer = () => invoke<void>("disconnect");

export const getActiveConnection = () =>
  invoke<string | null>("get_active_connection");

// Metadata commands
export const listDatabases = () => invoke<string[]>("list_databases");

export const listCollections = (db: string) =>
  invoke<string[]>("list_collections", { db });

// Query commands
export const executeQuery = (request: QueryRequest) =>
  invoke<QueryResult>("execute_query", { request });

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
