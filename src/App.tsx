import { useState, useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Editor, { type EditorHandle } from "./components/Editor";
import ResultsPanel, {
  type ResultsPanelHandle,
} from "./components/ResultsPanel";
import StatusBar from "./components/StatusBar";
import ConnectionModal from "./components/ConnectionModal";
import ListModal from "./components/ListModal";
import KeymapModal from "./components/KeymapModal";
import { useMongoConnection } from "./hooks/useMongoConnection";
import { useQueryExecution } from "./hooks/useQueryExecution";
import { usePanelFocus } from "./hooks/usePanelFocus";
import {
  saveQueryFile,
  loadQueryFile,
  listQueryFiles,
  loadSession,
  saveSession,
  loadSettings,
} from "./lib/tauri-commands";
import {
  DEFAULT_BINDINGS,
  mergeBindings,
  matchesBinding,
  matchesLeaderKey,
  type KeyBindingMap,
} from "./lib/keybindings";

export default function App() {
  const mongo = useMongoConnection();
  const query = useQueryExecution();
  const {
    activePanel,
    layout,
    setLayout,
    focusEditor,
    focusResults,
    toggleMaximize,
  } = usePanelFocus();

  const [showConnections, setShowConnections] = useState(false);
  const [showDatabases, setShowDatabases] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showQueryFiles, setShowQueryFiles] = useState(false);
  const [showKeymap, setShowKeymap] = useState(false);
  const [showSaveFile, setShowSaveFile] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [queryFiles, setQueryFiles] = useState<string[]>([]);
  const [saveFileName, setSaveFileName] = useState("mogyquery.mongodb.js");
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [bindings, setBindings] = useState<KeyBindingMap>(DEFAULT_BINDINGS);

  const leaderActive = useRef(false);
  const leaderTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lastQueryText = useRef("");

  const editorRef = useRef<EditorHandle | null>(null);
  const resultsPanelRef = useRef<ResultsPanelHandle | null>(null);

  // Stable refs for capture handler
  const selectedDbRef = useRef(mongo.selectedDb);
  selectedDbRef.current = mongo.selectedDb;
  const queryRef = useRef(query);
  queryRef.current = query;
  const activePanelRef = useRef(activePanel);
  activePanelRef.current = activePanel;
  const currentFileRef = useRef(currentFile);
  currentFileRef.current = currentFile;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  // Load keybindings from settings on mount
  useEffect(() => {
    loadSettings()
      .then((raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.keybindings) {
            setBindings(mergeBindings(DEFAULT_BINDINGS, parsed.keybindings));
          }
        } catch {
          // Invalid settings, use defaults
        }
      })
      .catch(() => {});
  }, []);

  const saveCurrentSession = useCallback(() => {
    const content = editorRef.current?.getText() ?? "";
    saveSession(
      mongoRef.current.activeConnection,
      mongoRef.current.selectedDb,
      mongoRef.current.selectedCollection,
      content
    ).catch(() => {});
  }, []);

  const handleRunQuery = useCallback((text: string) => {
    if (!selectedDbRef.current) {
      queryRef.current.setError(
        "No database selected. Press Ctrl+Space d to select one."
      );
      return;
    }
    lastQueryText.current = text;
    queryRef.current.runQuery(selectedDbRef.current, text);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    if (selectedDbRef.current && lastQueryText.current) {
      queryRef.current.goToPage(
        selectedDbRef.current,
        lastQueryText.current,
        page
      );
    }
  }, []);

  const handleQueryRefresh = useCallback(() => {
    if (selectedDbRef.current && lastQueryText.current) {
      queryRef.current.runQuery(
        selectedDbRef.current,
        lastQueryText.current
      );
    }
  }, []);

  const doFocusEditor = useCallback(() => {
    if (layout === "results-max") setLayout("editor-max");
    focusEditor();
    editorRef.current?.focus();
  }, [focusEditor, layout, setLayout]);

  const doFocusResults = useCallback(() => {
    if (layout === "editor-max") setLayout("results-max");
    focusResults();
    editorRef.current?.blur();
    resultsPanelRef.current?.container?.focus();
  }, [focusResults, layout, setLayout]);

  const closeModalAndFocus = useCallback(
    (setter: (v: boolean) => void) => {
      setter(false);
      setTimeout(() => {
        if (activePanelRef.current === "results") {
          focusResults();
          resultsPanelRef.current?.container?.focus();
        } else {
          focusEditor();
          editorRef.current?.focus();
        }
      }, 50);
    },
    [focusEditor, focusResults]
  );

  // :w handler — save current file or open save popup
  const handleEditorSave = useCallback(() => {
    const content = editorRef.current?.getText() ?? "";
    const file = currentFileRef.current;
    if (file) {
      saveQueryFile(file, content)
        .then(() => {
          setIsDirty(false);
          saveCurrentSession();
        })
        .catch((e) => console.error("[mogy] save failed:", e));
    } else {
      setSaveFileName("mogyquery.mongodb.js");
      setShowSaveFile(true);
    }
  }, [saveCurrentSession]);

  const handleEditorChange = useCallback(() => {
    if (!isDirtyRef.current) {
      setIsDirty(true);
    }
  }, []);

  // Stable refs for capture handler
  const handleRunQueryRef = useRef(handleRunQuery);
  handleRunQueryRef.current = handleRunQuery;
  const handlePageChangeRef = useRef(handlePageChange);
  handlePageChangeRef.current = handlePageChange;
  const doFocusEditorRef = useRef(doFocusEditor);
  doFocusEditorRef.current = doFocusEditor;
  const doFocusResultsRef = useRef(doFocusResults);
  doFocusResultsRef.current = doFocusResults;
  const toggleMaximizeRef = useRef(toggleMaximize);
  toggleMaximizeRef.current = toggleMaximize;
  const mongoRef = useRef(mongo);
  mongoRef.current = mongo;

  // Global keyboard handler — CAPTURE phase
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      const kb = bindingsRef.current;

      // Run query
      if (matchesBinding(e, kb.runQuery)) {
        e.preventDefault();
        e.stopPropagation();
        const text = editorRef.current?.getQueryText() ?? "";
        if (text.trim()) handleRunQueryRef.current(text);
        return;
      }

      // Next page
      if (matchesBinding(e, kb.nextPage)) {
        const r = queryRef.current.result;
        if (r && r.query_type === "Find") {
          const totalPages = Math.ceil(r.total_count / r.page_size);
          if (r.page < totalPages) {
            e.preventDefault();
            e.stopPropagation();
            handlePageChangeRef.current(r.page + 1);
          }
        }
        return;
      }

      // Prev page
      if (matchesBinding(e, kb.prevPage)) {
        const r = queryRef.current.result;
        if (r && r.query_type === "Find" && r.page > 1) {
          e.preventDefault();
          e.stopPropagation();
          handlePageChangeRef.current(r.page - 1);
        }
        return;
      }

      // Last page
      if (matchesBinding(e, kb.lastPage)) {
        const r = queryRef.current.result;
        if (r && r.query_type === "Find") {
          const totalPages = Math.ceil(r.total_count / r.page_size);
          if (r.page < totalPages) {
            e.preventDefault();
            e.stopPropagation();
            handlePageChangeRef.current(totalPages);
          }
        }
        return;
      }

      // First page
      if (matchesBinding(e, kb.firstPage)) {
        const r = queryRef.current.result;
        if (r && r.query_type === "Find" && r.page > 1) {
          e.preventDefault();
          e.stopPropagation();
          handlePageChangeRef.current(1);
        }
        return;
      }

      // Table view (results focused)
      if (
        matchesBinding(e, kb.tableView) &&
        activePanelRef.current === "results"
      ) {
        e.preventDefault();
        e.stopPropagation();
        resultsPanelRef.current?.setViewMode("table");
        return;
      }

      // JSON view (results focused)
      if (
        matchesBinding(e, kb.jsonView) &&
        activePanelRef.current === "results"
      ) {
        e.preventDefault();
        e.stopPropagation();
        resultsPanelRef.current?.setViewMode("json");
        return;
      }

      // Focus editor
      if (matchesBinding(e, kb.focusEditor)) {
        e.preventDefault();
        e.stopPropagation();
        doFocusEditorRef.current();
        return;
      }

      // Focus results
      if (matchesBinding(e, kb.focusResults)) {
        e.preventDefault();
        e.stopPropagation();
        doFocusResultsRef.current();
        return;
      }

      // Show help
      if (matchesBinding(e, kb.showHelp)) {
        e.preventDefault();
        e.stopPropagation();
        setShowKeymap(true);
        return;
      }

      // Leader key
      if (matchesBinding(e, kb.leader)) {
        e.preventDefault();
        e.stopPropagation();
        leaderActive.current = true;
        clearTimeout(leaderTimeout.current);
        leaderTimeout.current = setTimeout(() => {
          leaderActive.current = false;
        }, 1000);
        return;
      }

      // Leader follow-up keys
      if (leaderActive.current) {
        leaderActive.current = false;
        clearTimeout(leaderTimeout.current);

        if (matchesLeaderKey(e, kb["leader.connections"])) {
          e.preventDefault();
          e.stopPropagation();
          mongoRef.current.refreshConnections();
          setShowConnections(true);
        } else if (matchesLeaderKey(e, kb["leader.databases"])) {
          e.preventDefault();
          e.stopPropagation();
          setShowDatabases(true);
        } else if (matchesLeaderKey(e, kb["leader.collections"])) {
          e.preventDefault();
          e.stopPropagation();
          mongoRef.current.refreshCollections();
          setShowCollections(true);
        } else if (matchesLeaderKey(e, kb["leader.maximize"])) {
          e.preventDefault();
          e.stopPropagation();
          toggleMaximizeRef.current();
        } else if (matchesLeaderKey(e, kb["leader.loadFile"])) {
          e.preventDefault();
          e.stopPropagation();
          listQueryFiles()
            .then(setQueryFiles)
            .catch(() => setQueryFiles([]));
          setShowQueryFiles(true);
        } else if (matchesLeaderKey(e, kb["leader.newFile"])) {
          e.preventDefault();
          e.stopPropagation();
          setNewFileName("");
          setShowNewFile(true);
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // Restore last editor content on mount
  useEffect(() => {
    loadSession()
      .then((session) => {
        if (session.last_editor_content) {
          editorRef.current?.setText(session.last_editor_content);
          setIsDirty(false);
        }
      })
      .catch(() => {});
  }, []);

  // Handle app close — save session then close window
  const handleAppClose = useCallback(() => {
    const content = editorRef.current?.getText() ?? "";
    const file = currentFileRef.current;

    // Save file if dirty and has a current file
    const fileSave =
      file && isDirtyRef.current
        ? saveQueryFile(file, content).catch(() => {})
        : Promise.resolve();

    // Save session
    const sessionSave = saveSession(
      mongoRef.current.activeConnection,
      mongoRef.current.selectedDb,
      mongoRef.current.selectedCollection,
      content
    ).catch(() => {});

    Promise.all([fileSave, sessionSave]).then(() => {
      getCurrentWindow().close();
    });
  }, []);

  // Save query file handler (from save popup)
  const handleSaveQueryFile = useCallback(async () => {
    if (!saveFileName.trim()) return;
    const content = editorRef.current?.getText() ?? "";
    try {
      await saveQueryFile(saveFileName, content);
      setCurrentFile(saveFileName);
      setIsDirty(false);
      closeModalAndFocus(setShowSaveFile);
      saveCurrentSession();
    } catch (e) {
      console.error("[mogy] save file failed:", e);
    }
  }, [saveFileName, closeModalAndFocus, saveCurrentSession]);

  // Create new query file handler
  const handleCreateNewFile = useCallback(async () => {
    if (!newFileName.trim()) return;
    const filename = newFileName.endsWith(".mongodb.js")
      ? newFileName
      : `${newFileName}.mongodb.js`;
    try {
      await saveQueryFile(filename, "");
      editorRef.current?.setText("");
      setCurrentFile(filename);
      setIsDirty(false);
      closeModalAndFocus(setShowNewFile);
    } catch (e) {
      console.error("[mogy] create file failed:", e);
    }
  }, [newFileName, closeModalAndFocus]);

  // Load query file handler
  const handleLoadQueryFile = useCallback(
    async (filename: string) => {
      try {
        const content = await loadQueryFile(filename);
        editorRef.current?.setText(content);
        setCurrentFile(filename);
        setIsDirty(false);
        closeModalAndFocus(setShowQueryFiles);
      } catch (e) {
        console.error("[mogy] load file failed:", e);
      }
    },
    [closeModalAndFocus]
  );

  // Layout classes
  const editorClass =
    layout === "results-max" ? "h-0 overflow-hidden" : "flex-1 min-h-0";
  const resultsClass =
    layout === "editor-max" ? "h-0 overflow-hidden" : "flex-1 min-h-0";
  const dividerClass =
    layout === "split"
      ? "h-1 bg-[var(--border)] cursor-row-resize hover:bg-[var(--accent)] transition-colors"
      : "hidden";

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <StatusBar
        activeConnection={mongo.activeConnection}
        selectedDb={mongo.selectedDb}
        loading={query.loading}
        layout={layout}
        currentFile={currentFile}
        isDirty={isDirty}
        onClose={handleAppClose}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <div className={editorClass}>
          <Editor
            ref={editorRef}
            focused={activePanel === "editor"}
            onFocus={focusEditor}
            onSave={handleEditorSave}
            onChange={handleEditorChange}
          />
        </div>

        <div className={dividerClass} />

        <div className={resultsClass}>
          <ResultsPanel
            ref={resultsPanelRef}
            result={query.result}
            loading={query.loading}
            error={query.error}
            focused={activePanel === "results"}
            onFocus={focusResults}
            onPageChange={handlePageChange}
            db={mongo.selectedDb}
            lastQueryText={lastQueryText.current}
            onQueryRefresh={handleQueryRefresh}
          />
        </div>
      </div>

      {/* Modals */}
      <ConnectionModal
        isOpen={showConnections}
        onClose={() => closeModalAndFocus(setShowConnections)}
        connections={mongo.connections}
        activeConnection={mongo.activeConnection}
        onConnect={mongo.connect}
        onAdd={mongo.addConnection}
        onDelete={mongo.removeConnection}
      />

      <ListModal
        isOpen={showDatabases}
        onClose={() => closeModalAndFocus(setShowDatabases)}
        title="Databases"
        items={mongo.databases}
        onSelect={(db) => {
          mongo.selectDatabase(db);
          closeModalAndFocus(setShowDatabases);
        }}
        selectedItem={mongo.selectedDb}
      />

      <ListModal
        isOpen={showCollections}
        onClose={() => closeModalAndFocus(setShowCollections)}
        title="Collections"
        items={mongo.collections}
        onSelect={(col) => {
          mongo.selectCollection(col);
          editorRef.current?.appendText(`db.${col}.find({})\n`);
          closeModalAndFocus(setShowCollections);
        }}
        selectedItem={mongo.selectedCollection}
      />

      <ListModal
        isOpen={showQueryFiles}
        onClose={() => closeModalAndFocus(setShowQueryFiles)}
        title="Query Files"
        items={queryFiles}
        onSelect={handleLoadQueryFile}
      />

      <KeymapModal
        isOpen={showKeymap}
        onClose={() => closeModalAndFocus(setShowKeymap)}
      />

      {/* Save file modal */}
      {showSaveFile && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => closeModalAndFocus(setShowSaveFile)}
        >
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[450px] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSaveQueryFile();
              }
              if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
                e.preventDefault();
                closeModalAndFocus(setShowSaveFile);
              }
            }}
          >
            <div className="text-sm text-[var(--accent)] font-medium mb-3">
              Save Query File
            </div>
            <input
              value={saveFileName}
              onChange={(e) => setSaveFileName(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] mb-3"
              placeholder="filename.mongodb.js"
              autoFocus
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-[var(--text-muted)]">
                Enter save | Esc cancel
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => closeModalAndFocus(setShowSaveFile)}
                  className="px-3 py-1.5 text-xs bg-[var(--bg-surface)] rounded hover:bg-[var(--border)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveQueryFile}
                  className="px-3 py-1.5 text-xs bg-[var(--accent)] text-[var(--bg-primary)] rounded hover:bg-[var(--accent-hover)]"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New file modal */}
      {showNewFile && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => closeModalAndFocus(setShowNewFile)}
        >
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[450px] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateNewFile();
              }
              if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
                e.preventDefault();
                closeModalAndFocus(setShowNewFile);
              }
            }}
          >
            <div className="text-sm text-[var(--accent)] font-medium mb-3">
              New Query File
            </div>
            <input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] mb-1"
              placeholder="filename"
              autoFocus
            />
            <div className="text-xs text-[var(--text-muted)] mb-3">
              .mongodb.js will be appended automatically
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-[var(--text-muted)]">
                Enter create | Esc cancel
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => closeModalAndFocus(setShowNewFile)}
                  className="px-3 py-1.5 text-xs bg-[var(--bg-surface)] rounded hover:bg-[var(--border)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateNewFile}
                  className="px-3 py-1.5 text-xs bg-[var(--accent)] text-[var(--bg-primary)] rounded hover:bg-[var(--accent-hover)]"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
