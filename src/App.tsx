import { lazy, Suspense, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Editor, { type EditorHandle } from "./components/Editor";
import ResultsPanel, {
  type ResultsPanelHandle,
} from "./components/ResultsPanel";
import StatusBar from "./components/StatusBar";
import type { CommandItem } from "./components/CommandPalette";

const ConnectionModal = lazy(() => import("./components/ConnectionModal"));
const ListModal = lazy(() => import("./components/ListModal"));
const KeymapModal = lazy(() => import("./components/KeymapModal"));
const CommandPalette = lazy(() => import("./components/CommandPalette"));
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
import { applyCssVariables, THEME_LIST, type ThemeName } from "./lib/themes";
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
    layoutDirection,
    setLayoutDirection,
    focusEditor,
    focusResults,
    toggleMaximize,
    toggleLayoutDirection,
  } = usePanelFocus();

  const [showConnections, setShowConnections] = useState(false);
  const [showDatabases, setShowDatabases] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showQueryFiles, setShowQueryFiles] = useState(false);
  const [showKeymap, setShowKeymap] = useState(false);
  const [showSaveFile, setShowSaveFile] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [queryFiles, setQueryFiles] = useState<string[]>([]);
  const [saveFileName, setSaveFileName] = useState("mogyquery.mongodb.js");
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [bindings, setBindings] = useState<KeyBindingMap>(DEFAULT_BINDINGS);
  const [currentTheme, setCurrentTheme] = useState<ThemeName>("mocha");
  const [showThemePicker, setShowThemePicker] = useState(false);

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
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const layoutDirectionRef = useRef(layoutDirection);
  layoutDirectionRef.current = layoutDirection;
  const currentThemeRef = useRef(currentTheme);
  currentThemeRef.current = currentTheme;
  const [leaderVisible, setLeaderVisible] = useState(false);

  // Remove splash once app is mounted and ready
  useEffect(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.style.opacity = "0";
      setTimeout(() => splash.remove(), 300);
    }
  }, []);

  // Load keybindings from settings on mount
  useEffect(() => {
    loadSettings()
      .then((raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.keybindings) {
            setBindings(mergeBindings(DEFAULT_BINDINGS, parsed.keybindings));
          }
          if (parsed.layoutDirection === "horizontal" || parsed.layoutDirection === "vertical") {
            setLayoutDirection(parsed.layoutDirection);
          }
          if (parsed.theme === "mocha" || parsed.theme === "latte") {
            setCurrentTheme(parsed.theme);
            applyCssVariables(parsed.theme);
            editorRef.current?.setTheme(parsed.theme);
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
      content,
      currentFileRef.current,
      layoutDirectionRef.current,
      currentThemeRef.current
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
    if (layoutRef.current === "results-max") setLayout("editor-max");
    focusEditor();
    editorRef.current?.focus();
  }, [focusEditor, setLayout]);

  const doFocusResults = useCallback(() => {
    if (layoutRef.current === "editor-max") setLayout("results-max");
    focusResults();
    editorRef.current?.blur();
    resultsPanelRef.current?.container?.focus();
  }, [focusResults, setLayout]);

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

  const openCommandPalette = useCallback(() => {
    setShowCommandPalette(true);
  }, []);

  // Stable modal close callbacks (Changeset 4)
  const closeConnections = useCallback(() => closeModalAndFocus(setShowConnections), [closeModalAndFocus]);
  const closeDatabases = useCallback(() => closeModalAndFocus(setShowDatabases), [closeModalAndFocus]);
  const closeCollections = useCallback(() => closeModalAndFocus(setShowCollections), [closeModalAndFocus]);
  const closeQueryFiles = useCallback(() => closeModalAndFocus(setShowQueryFiles), [closeModalAndFocus]);
  const closeKeymap = useCallback(() => closeModalAndFocus(setShowKeymap), [closeModalAndFocus]);
  const closeCommandPalette = useCallback(() => closeModalAndFocus(setShowCommandPalette), [closeModalAndFocus]);
  const closeThemePicker = useCallback(() => closeModalAndFocus(setShowThemePicker), [closeModalAndFocus]);

  const switchTheme = useCallback((theme: ThemeName) => {
    setCurrentTheme(theme);
    applyCssVariables(theme);
    editorRef.current?.setTheme(theme);
    closeModalAndFocus(setShowThemePicker);
  }, [closeModalAndFocus]);
  const closeSaveFile = useCallback(() => closeModalAndFocus(setShowSaveFile), [closeModalAndFocus]);
  const closeNewFile = useCallback(() => closeModalAndFocus(setShowNewFile), [closeModalAndFocus]);

  const handleSelectDatabase = useCallback((db: string) => {
    mongoRef.current.selectDatabase(db);
    closeModalAndFocus(setShowDatabases);
  }, [closeModalAndFocus]);

  const handleSelectCollection = useCallback((col: string) => {
    mongoRef.current.selectCollection(col);
    editorRef.current?.insertAtCursor(`db.${col}.find({}).sort({_id: -1})\n`);
    closeModalAndFocus(setShowCollections);
  }, [closeModalAndFocus]);

  const commandPaletteItems: CommandItem[] = useMemo(() => [
    {
      id: "add-connection",
      label: "Add Connection",
      hint: "^Space a",
      action: () => {
        setShowCommandPalette(false);
        mongoRef.current.refreshConnections();
        setShowConnections(true);
      },
    },
    {
      id: "list-databases",
      label: "List Databases",
      hint: "^Space d",
      action: () => {
        setShowCommandPalette(false);
        setShowDatabases(true);
      },
    },
    {
      id: "list-collections",
      label: "List Collections",
      hint: "^Space o",
      action: () => {
        setShowCommandPalette(false);
        mongoRef.current.refreshCollections();
        setShowCollections(true);
      },
    },
    {
      id: "load-query-file",
      label: "Load Query File",
      hint: "^Space l",
      action: () => {
        setShowCommandPalette(false);
        listQueryFiles()
          .then(setQueryFiles)
          .catch(() => setQueryFiles([]));
        setShowQueryFiles(true);
      },
    },
    {
      id: "new-query-file",
      label: "New Query File",
      hint: "^Space c",
      action: () => {
        setShowCommandPalette(false);
        setNewFileName("");
        setShowNewFile(true);
      },
    },
    {
      id: "run-query",
      label: "Run Query",
      hint: "^Enter",
      action: () => {
        setShowCommandPalette(false);
        const text = editorRef.current?.getQueryText() ?? "";
        if (text.trim()) handleRunQueryRef.current(text);
      },
    },
    {
      id: "toggle-maximize",
      label: "Toggle Maximize",
      hint: "^Space m",
      action: () => {
        setShowCommandPalette(false);
        toggleMaximizeRef.current();
      },
    },
    {
      id: "toggle-layout-direction",
      label: "Toggle Layout: Vertical / Horizontal",
      hint: "",
      action: () => {
        setShowCommandPalette(false);
        toggleLayoutDirectionRef.current();
        setTimeout(() => {
          doFocusEditorRef.current();
        }, 100);
      },
    },
    {
      id: "show-keybindings",
      label: "Show Keybindings",
      hint: "?",
      action: () => {
        setShowCommandPalette(false);
        setShowKeymap(true);
      },
    },
    {
      id: "switch-theme",
      label: "Switch Color Scheme",
      hint: "",
      action: () => {
        setShowCommandPalette(false);
        setShowThemePicker(true);
      },
    },
  ], []);

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
  const toggleLayoutDirectionRef = useRef(toggleLayoutDirection);
  toggleLayoutDirectionRef.current = toggleLayoutDirection;
  const closeModalAndFocusRef = useRef(closeModalAndFocus);
  closeModalAndFocusRef.current = closeModalAndFocus;
  const mongoRef = useRef(mongo);
  mongoRef.current = mongo;

  // Global keyboard handler — CAPTURE phase
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      // Prevent browser/system shortcuts that interfere with app
      if (e.ctrlKey && e.key === ";") {
        e.preventDefault();
        e.stopPropagation();
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
        if (r && (r.query_type === "Find" || r.query_type === "Aggregate") && r.has_more) {
          e.preventDefault();
          e.stopPropagation();
          handlePageChangeRef.current(r.page + 1);
        }
        return;
      }

      // Prev page
      if (matchesBinding(e, kb.prevPage)) {
        const r = queryRef.current.result;
        if (r && (r.query_type === "Find" || r.query_type === "Aggregate") && r.page > 1) {
          e.preventDefault();
          e.stopPropagation();
          handlePageChangeRef.current(r.page - 1);
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
      if (matchesBinding(e, kb.focusEditor) || matchesBinding(e, kb.focusEditorAlt)) {
        e.preventDefault();
        e.stopPropagation();
        doFocusEditorRef.current();
        return;
      }

      // Focus results
      if (matchesBinding(e, kb.focusResults) || matchesBinding(e, kb.focusResultsAlt)) {
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
        setLeaderVisible(true);
        clearTimeout(leaderTimeout.current);
        leaderTimeout.current = setTimeout(() => {
          leaderActive.current = false;
          setLeaderVisible(false);
        }, 1000);
        return;
      }

      // Leader follow-up keys
      if (leaderActive.current) {
        leaderActive.current = false;
        clearTimeout(leaderTimeout.current);
        setLeaderVisible(false);

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
        } else if (matchesLeaderKey(e, kb["leader.commandPalette"])) {
          e.preventDefault();
          e.stopPropagation();
          setShowCommandPalette(true);
        } else if (matchesLeaderKey(e, kb["leader.fullscreen"])) {
          e.preventDefault();
          e.stopPropagation();
          getCurrentWindow().toggleMaximize();
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // Restore last editor content and file on mount
  useEffect(() => {
    loadSession()
      .then((session) => {
        if (session.current_file) {
          // Load the last opened file
          loadQueryFile(session.current_file)
            .then((content) => {
              editorRef.current?.setText(content);
              setCurrentFile(session.current_file);
              setIsDirty(false);
            })
            .catch(() => {
              // File doesn't exist, fall back to untitled
              if (session.last_editor_content) {
                editorRef.current?.setText(session.last_editor_content);
                setIsDirty(false);
              }
            });
        } else if (session.last_editor_content) {
          // No last file but have content - use that
          editorRef.current?.setText(session.last_editor_content);
          setIsDirty(false);
        }
        if (session.layout_direction === "horizontal" || session.layout_direction === "vertical") {
          setLayoutDirection(session.layout_direction);
        }
        if (session.color_scheme && session.color_scheme !== currentTheme) {
          setCurrentTheme(session.color_scheme as ThemeName);
          applyCssVariables(session.color_scheme as ThemeName);
          editorRef.current?.setTheme(session.color_scheme as ThemeName);
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
      content,
      file,
      layoutDirectionRef.current,
      currentThemeRef.current
    ).catch(() => {});

    Promise.all([fileSave, sessionSave]).then(() => {
      getCurrentWindow().close();
    });
  }, []);

  // :wqa handler — save and quit
  const handleSaveAndQuit = useCallback(() => {
    handleEditorSave();
    handleAppClose();
  }, [handleEditorSave, handleAppClose]);

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
  const isHorizontal = layoutDirection === "horizontal";
  const editorClass =
    layout === "results-max"
      ? (isHorizontal ? "w-0 overflow-hidden" : "h-0 overflow-hidden")
      : "flex-1 min-h-0 min-w-0 overflow-hidden [contain:layout_paint]";
  const resultsClass =
    layout === "editor-max"
      ? (isHorizontal ? "w-0 overflow-hidden" : "h-0 overflow-hidden")
      : "flex-1 min-h-0 min-w-0 overflow-hidden [contain:layout_paint]";
  const dividerClass =
    layout === "split"
      ? isHorizontal
        ? "w-1 bg-[var(--border)] cursor-col-resize hover:bg-[var(--accent)] transition-colors"
        : "h-1 bg-[var(--border)] cursor-row-resize hover:bg-[var(--accent)] transition-colors"
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
        leaderVisible={leaderVisible}
        onClose={handleAppClose}
        onCommandPalette={openCommandPalette}
      />

      <div className={`flex-1 flex ${isHorizontal ? "flex-row" : "flex-col"} min-h-0`}>
        <div className={editorClass}>
          <Editor
            ref={editorRef}
            focused={activePanel === "editor"}
            onFocus={focusEditor}
            onSave={handleEditorSave}
            onSaveAndQuit={handleSaveAndQuit}
            onChange={handleEditorChange}
            collections={mongo.collections}
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
            theme={currentTheme}
          />
        </div>
      </div>

      {/* Modals */}
      <Suspense fallback={null}>
        <ConnectionModal
          isOpen={showConnections}
          onClose={closeConnections}
          connections={mongo.connections}
          activeConnection={mongo.activeConnection}
          onConnect={mongo.connect}
          onAdd={mongo.addConnection}
          onDelete={mongo.removeConnection}
        />

        <ListModal
          isOpen={showDatabases}
          onClose={closeDatabases}
          title="Databases"
          items={mongo.databases}
          onSelect={handleSelectDatabase}
          selectedItem={mongo.selectedDb}
        />

        <ListModal
          isOpen={showCollections}
          onClose={closeCollections}
          title="Collections"
          items={mongo.collections}
          onSelect={handleSelectCollection}
          selectedItem={mongo.selectedCollection}
        />

        <ListModal
          isOpen={showQueryFiles}
          onClose={closeQueryFiles}
          title="Query Files"
          items={queryFiles}
          onSelect={handleLoadQueryFile}
        />

        <KeymapModal
          isOpen={showKeymap}
          onClose={closeKeymap}
        />

        <CommandPalette
          isOpen={showCommandPalette}
          onClose={closeCommandPalette}
          commands={commandPaletteItems}
        />

        <ListModal
          isOpen={showThemePicker}
          onClose={closeThemePicker}
          title="Color Scheme"
          items={THEME_LIST.map((t) => t.label)}
          onSelect={(label) => {
            const t = THEME_LIST.find((x) => x.label === label);
            if (t) switchTheme(t.id);
          }}
          selectedItem={THEME_LIST.find((t) => t.id === currentTheme)?.label}
        />
      </Suspense>

      {/* Save file modal */}
      {showSaveFile && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
          onClick={closeSaveFile}
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
                closeSaveFile();
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
                  onClick={closeSaveFile}
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
          onClick={closeNewFile}
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
                closeNewFile();
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
                  onClick={closeNewFile}
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
