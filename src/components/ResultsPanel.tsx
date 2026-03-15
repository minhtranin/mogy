import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
} from "react";

const ResultTable = lazy(() => import("./ResultTable"));
const ResultJson = lazy(() => import("./ResultJson"));
import VimJsonEditor, { type VimJsonEditorHandle } from "./VimJsonEditor";
import type { QueryResult } from "../lib/tauri-commands";
import { updateDocument, parseCollectionFromQuery } from "../lib/tauri-commands";
import type { ThemeName } from "../lib/themes";

type ViewState =
  | { mode: "table" }
  | { mode: "json" }
  | { mode: "detail"; document: unknown; index: number };

interface ResultsPanelProps {
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  focused: boolean;
  onFocus: () => void;
  onPageChange: (page: number) => void;
  db: string | null;
  lastQueryText: string;
  onQueryRefresh: () => void;
  theme?: ThemeName;
}

export interface ResultsPanelHandle {
  setViewMode: (mode: "table" | "json") => void;
  getViewMode: () => string;
  container: HTMLDivElement | null;
}

export default forwardRef<ResultsPanelHandle, ResultsPanelProps>(
  function ResultsPanel(
    {
      result,
      loading,
      error,
      focused,
      onFocus,
      onPageChange,
      db,
      lastQueryText,
      onQueryRefresh,
      theme,
    },
    ref
  ) {
    const [view, setView] = useState<ViewState>({ mode: "table" });
    const [confirmSave, setConfirmSave] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const detailEditorRef = useRef<VimJsonEditorHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      setViewMode(mode: "table" | "json") {
        if (view.mode !== "detail") {
          setView({ mode });
        }
      },
      getViewMode() {
        return view.mode;
      },
      get container() {
        return containerRef.current;
      },
    }));

    const effectiveMode = view.mode;

    useEffect(() => {
      if (view.mode === "detail" && focused) {
        setTimeout(() => detailEditorRef.current?.focus(), 50);
      }
    }, [view.mode, focused]);

    const handleExpandRow = useCallback((doc: unknown, index: number) => {
      setView({ mode: "detail", document: doc, index });
    }, []);

    const handleDetailBack = useCallback(() => {
      setView({ mode: "table" });
    }, []);

    const handleDetailSave = useCallback((text: string) => {
      if (result?.query_type === "Aggregate") {
        setSaveError("Cannot save for aggregated results");
        setTimeout(() => setSaveError(null), 3000);
        return;
      }
      try {
        JSON.parse(text);
      } catch {
        setSaveError("Invalid JSON");
        return;
      }
      setConfirmSave(text);
    }, [result]);

    const handleConfirmSave = useCallback(async () => {
      if (!confirmSave || !db) return;

      const collection = parseCollectionFromQuery(lastQueryText);
      if (!collection) {
        setSaveError("Could not determine collection from query");
        setConfirmSave(null);
        return;
      }

      try {
        await updateDocument(db, collection, confirmSave);
        setSaveSuccess(true);
        setConfirmSave(null);
        setTimeout(() => setSaveSuccess(false), 2000);
        onQueryRefresh();
        setTimeout(() => detailEditorRef.current?.focus(), 100);
      } catch (e) {
        setSaveError(String(e));
        setConfirmSave(null);
        setTimeout(() => detailEditorRef.current?.focus(), 100);
      }
    }, [confirmSave, db, lastQueryText, onQueryRefresh]);

    const handleCancelSave = useCallback(() => {
      setConfirmSave(null);
      setTimeout(() => detailEditorRef.current?.focus(), 50);
    }, []);

    const focusedRef = useRef(focused);
    focusedRef.current = focused;
    const viewRef = useRef(view);
    viewRef.current = view;
    const confirmSaveRef = useRef(confirmSave);
    confirmSaveRef.current = confirmSave;

    // Escape / Ctrl+[ from detail mode
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (!focusedRef.current) return;
        const isEscLike =
          e.key === "Escape" || (e.ctrlKey && e.key === "[");

        if (isEscLike && confirmSaveRef.current) {
          e.preventDefault();
          handleCancelSave();
          return;
        }
        if (isEscLike && viewRef.current.mode === "detail") {
          e.preventDefault();
          handleDetailBack();
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [handleDetailBack, handleCancelSave]);

    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        className={`flex flex-col h-full border outline-none ${
          focused ? "border-[var(--accent)]" : "border-transparent"
        }`}
        onClick={onFocus}
      >
        {/* Results header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              {effectiveMode === "detail" ? "Document Detail" : "Results"}
            </span>
            {result && effectiveMode !== "detail" && (
              <span className="text-xs text-[var(--text-secondary)]">
                {result.query_type === "Find" || result.query_type === "Aggregate"
                  ? `${result.documents.length} docs | p${result.page}${result.has_more ? "+" : ""}`
                  : `${result.documents.length} docs`}
              </span>
            )}
            {effectiveMode === "detail" && (
              <span className="text-xs text-[var(--text-muted)]">
                Esc back | :w save | :q back
              </span>
            )}
            {saveSuccess && (
              <span className="text-xs text-[var(--success)]">Saved!</span>
            )}
            {saveError && (
              <span className="text-xs text-[var(--error)]">{saveError}</span>
            )}
          </div>
          {effectiveMode !== "detail" && (
            <div className="flex gap-1 text-xs text-[var(--text-muted)]">
              <button
                onClick={() => setView({ mode: "table" })}
                className={`px-2 py-0.5 rounded ${
                  effectiveMode === "table"
                    ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                    : "hover:text-[var(--text-primary)]"
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setView({ mode: "json" })}
                className={`px-2 py-0.5 rounded ${
                  effectiveMode === "json"
                    ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                    : "hover:text-[var(--text-primary)]"
                }`}
              >
                JSON
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full text-[var(--accent)] gap-3">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span>Running query...</span>
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
              {effectiveMode === "detail" && view.mode === "detail" && (
                <VimJsonEditor
                  ref={detailEditorRef}
                  value={JSON.stringify(view.document, null, 2)}
                  onSave={handleDetailSave}
                  onQuit={handleDetailBack}
                  lightweight
                  theme={theme}
                />
              )}
              <Suspense fallback={null}>
                {effectiveMode === "table" && (
                  <ResultTable
                    data={result.documents}
                    page={result.page}
                    pageSize={result.page_size}
                    hasMore={result.has_more}
                    onPageChange={onPageChange}
                    onExpandRow={handleExpandRow}
                    focused={focused}
                  />
                )}
                {effectiveMode === "json" && (
                  <ResultJson data={result.documents} focused={focused} theme={theme} />
                )}
              </Suspense>
            </>
          )}
        </div>

        {/* Save confirmation modal */}
        {confirmSave && (
          <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[400px] p-4 shadow-2xl"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmSave();
                if (e.key === "Escape" || (e.ctrlKey && e.key === "["))
                  handleCancelSave();
              }}
              tabIndex={0}
              ref={(el) => el?.focus()}
            >
              <div className="text-sm mb-3">
                Save changes to this document?
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelSave}
                  className="px-3 py-1.5 text-xs bg-[var(--bg-surface)] rounded hover:bg-[var(--border)]"
                >
                  Cancel (Esc)
                </button>
                <button
                  onClick={handleConfirmSave}
                  className="px-3 py-1.5 text-xs bg-[var(--accent)] text-[var(--bg-primary)] rounded hover:bg-[var(--accent-hover)]"
                >
                  Save (Enter)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);
