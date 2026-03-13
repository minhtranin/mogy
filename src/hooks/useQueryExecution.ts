import { useState, useCallback } from "react";
import { executeRawQuery, type QueryResult } from "../lib/tauri-commands";

export function useQueryExecution() {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);

  const runQuery = useCallback(
    async (db: string, queryText: string, page?: number) => {
      setLoading(true);
      setError(null);
      const p = page ?? 1;
      setCurrentPage(p);
      try {
        const res = await executeRawQuery(db, queryText, p, pageSize);
        setResult(res);
      } catch (e) {
        setError(String(e));
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  const goToPage = useCallback(
    async (db: string, queryText: string, page: number) => {
      await runQuery(db, queryText, page);
    },
    [runQuery]
  );

  return {
    result,
    loading,
    error,
    currentPage,
    pageSize,
    runQuery,
    goToPage,
    setError,
  };
}
