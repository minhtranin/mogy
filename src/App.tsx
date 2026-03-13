import { useState, useCallback, useEffect, useRef } from "react";
import Editor from "./components/Editor";
import ResultsPanel from "./components/ResultsPanel";
import StatusBar from "./components/StatusBar";
import ConnectionModal from "./components/ConnectionModal";
import ListModal from "./components/ListModal";
import { useMongoConnection } from "./hooks/useMongoConnection";
import { useQueryExecution } from "./hooks/useQueryExecution";
import { usePanelFocus } from "./hooks/usePanelFocus";

export default function App() {
  const mongo = useMongoConnection();
  const query = useQueryExecution();
  const { activePanel, focusEditor, focusResults } = usePanelFocus();

  const [showConnections, setShowConnections] = useState(false);
  const [showDatabases, setShowDatabases] = useState(false);
  const [showCollections, setShowCollections] = useState(false);

  // Track leader key (Space) state
  const leaderActive = useRef(false);
  const leaderTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Store last query text for pagination
  const lastQueryText = useRef("");

  const handleRunQuery = useCallback(
    (text: string) => {
      if (!mongo.selectedDb) {
        query.setError("No database selected. Press Space+d to select one.");
        return;
      }
      lastQueryText.current = text;
      query.runQuery(mongo.selectedDb, text);
    },
    [mongo.selectedDb, query]
  );

  const handlePageChange = useCallback(
    (page: number) => {
      if (mongo.selectedDb && lastQueryText.current) {
        query.goToPage(mongo.selectedDb, lastQueryText.current, page);
      }
    },
    [mongo.selectedDb, query]
  );

  // Global keyboard handler for leader key sequences and panel navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in input fields
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }

      // Panel navigation: Ctrl+K = editor, Ctrl+J = results
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        focusEditor();
        return;
      }
      if (e.ctrlKey && e.key === "j") {
        e.preventDefault();
        focusResults();
        return;
      }

      // Leader key handling (Space)
      // Only activate leader when NOT in CodeMirror insert mode
      if (e.key === " " && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Check if we're in a CodeMirror editor
        const cmEditor = target.closest(".cm-editor");
        if (cmEditor) return; // Let CodeMirror handle space

        e.preventDefault();
        leaderActive.current = true;
        clearTimeout(leaderTimeout.current);
        leaderTimeout.current = setTimeout(() => {
          leaderActive.current = false;
        }, 1000);
        return;
      }

      if (leaderActive.current) {
        leaderActive.current = false;
        clearTimeout(leaderTimeout.current);

        switch (e.key) {
          case "c":
            e.preventDefault();
            setShowConnections(true);
            break;
          case "d":
            e.preventDefault();
            setShowDatabases(true);
            break;
          case "l":
            e.preventDefault();
            setShowCollections(true);
            break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusEditor, focusResults]);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <StatusBar
        activeConnection={mongo.activeConnection}
        selectedDb={mongo.selectedDb}
        selectedCollection={mongo.selectedCollection}
        loading={query.loading}
      />

      {/* Main content: Editor (top) + Results (bottom) */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Editor */}
        <div className="flex-1 min-h-0">
          <Editor
            focused={activePanel === "editor"}
            onRunQuery={handleRunQuery}
            onFocus={focusEditor}
          />
        </div>

        {/* Resize handle */}
        <div className="h-1 bg-[var(--border)] cursor-row-resize hover:bg-[var(--accent)] transition-colors" />

        {/* Results */}
        <div className="flex-1 min-h-0">
          <ResultsPanel
            result={query.result}
            loading={query.loading}
            error={query.error}
            focused={activePanel === "results"}
            onFocus={focusResults}
            onPageChange={handlePageChange}
          />
        </div>
      </div>

      {/* Modals */}
      <ConnectionModal
        isOpen={showConnections}
        onClose={() => setShowConnections(false)}
        connections={mongo.connections}
        activeConnection={mongo.activeConnection}
        onConnect={mongo.connect}
        onAdd={mongo.addConnection}
        onDelete={mongo.removeConnection}
      />

      <ListModal
        isOpen={showDatabases}
        onClose={() => setShowDatabases(false)}
        title="Databases"
        items={mongo.databases}
        onSelect={mongo.selectDatabase}
        selectedItem={mongo.selectedDb}
      />

      <ListModal
        isOpen={showCollections}
        onClose={() => setShowCollections(false)}
        title="Collections"
        items={mongo.collections}
        onSelect={mongo.selectCollection}
        selectedItem={mongo.selectedCollection}
      />
    </div>
  );
}
