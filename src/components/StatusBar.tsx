import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PanelLayout } from "../hooks/usePanelFocus";

interface StatusBarProps {
  activeConnection: string | null;
  selectedDb: string | null;
  loading: boolean;
  layout: PanelLayout;
  currentFile: string | null;
  isDirty: boolean;
  onClose: () => void;
}

export default function StatusBar({
  activeConnection,
  selectedDb,
  loading,
  layout,
  currentFile,
  isDirty,
  onClose,
}: StatusBarProps) {
  const appWindow = getCurrentWindow();

  return (
    <div
      className="flex items-center justify-between px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-xs select-none"
      style={{ minHeight: "40px" }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== "BUTTON") {
          appWindow.startDragging();
        }
      }}
    >
      {/* Left: connection info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-[var(--accent)] font-bold shrink-0">MOGY</span>
        <span className="text-[var(--border)] shrink-0">|</span>
        {activeConnection ? (
          <>
            <span className="text-[var(--success)] shrink-0">{activeConnection}</span>
            {selectedDb && (
              <>
                <span className="text-[var(--text-muted)] shrink-0">/</span>
                <span className="text-[var(--warning)] shrink-0">{selectedDb}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-[var(--text-muted)] shrink-0">
            No connection (^Space a)
          </span>
        )}
        {layout !== "split" && (
          <>
            <span className="text-[var(--border)] shrink-0">|</span>
            <span className="text-[var(--warning)] shrink-0">
              {layout === "editor-max" ? "EDITOR MAX" : "RESULTS MAX"}
            </span>
          </>
        )}
      </div>

      {/* Center: filename */}
      <div className="flex items-center gap-1 shrink-0">
        {currentFile ? (
          <>
            <span className="text-[var(--text-secondary)]">{currentFile}</span>
            {isDirty && (
              <span className="text-[var(--warning)] text-base leading-none">&middot;</span>
            )}
          </>
        ) : (
          <span className="text-[var(--text-muted)]">[untitled]</span>
        )}
      </div>

      {/* Right: hints + window controls */}
      <div className="flex items-center gap-3 min-w-0 flex-1 justify-end">
        {loading && (
          <span className="text-[var(--warning)] shrink-0">Running...</span>
        )}
        <span className="text-[var(--text-muted)] shrink-0">
          ^Enter run | ^K/^J nav | ? help
        </span>
        <div className="flex items-center shrink-0">
          <button
            onClick={() => appWindow.minimize()}
            className="w-8 h-6 flex items-center justify-center hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            &#x2013;
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            className="w-8 h-6 flex items-center justify-center hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            &#x25A1;
          </button>
          <button
            onClick={onClose}
            className="w-8 h-6 flex items-center justify-center hover:bg-[var(--error)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            &#x2715;
          </button>
        </div>
      </div>
    </div>
  );
}
