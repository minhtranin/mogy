import { useState } from "react";
import ResultTable from "./ResultTable";
import ResultJson from "./ResultJson";
import type { QueryResult } from "../lib/tauri-commands";

interface ResultsPanelProps {
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  focused: boolean;
  onFocus: () => void;
  onPageChange: (page: number) => void;
}

export default function ResultsPanel({
  result,
  loading,
  error,
  focused,
  onFocus,
  onPageChange,
}: ResultsPanelProps) {
  const [viewMode, setViewMode] = useState<"table" | "json">("table");

  // Auto-switch to JSON for aggregate results
  const effectiveMode =
    result?.query_type === "Aggregate" ? "json" : viewMode;

  return (
    <div
      className={`flex flex-col h-full border ${
        focused ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
      onClick={onFocus}
    >
      {/* Results header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
            Results
          </span>
          {result && (
            <span className="text-xs text-[var(--text-secondary)]">
              {result.query_type === "Find"
                ? `${result.total_count} docs`
                : `${result.documents.length} docs (aggregate)`}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode("table")}
            className={`px-2 py-0.5 text-xs rounded ${
              effectiveMode === "table"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode("json")}
            className={`px-2 py-0.5 text-xs rounded ${
              effectiveMode === "json"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            JSON
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full text-[var(--accent)]">
            Running query...
          </div>
        )}
        {error && (
          <div className="p-3 text-[var(--error)] text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}
        {!loading && !error && !result && (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            Run a query to see results (Ctrl+Enter)
          </div>
        )}
        {!loading && !error && result && (
          <>
            {effectiveMode === "table" ? (
              <ResultTable
                data={result.documents}
                page={result.page}
                pageSize={result.page_size}
                totalCount={result.total_count}
                onPageChange={onPageChange}
              />
            ) : (
              <ResultJson data={result.documents} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
