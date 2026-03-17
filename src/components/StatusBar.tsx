import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PanelLayout } from "../hooks/usePanelFocus";
import type { UpdateState } from "../hooks/useUpdater";

const appWindow = getCurrentWindow();

interface StatusBarProps {
  activeConnection: string | null;
  selectedDb: string | null;
  loading: boolean;
  layout: PanelLayout;
  currentFile: string | null;
  isDirty: boolean;
  leaderVisible?: boolean;
  onClose: () => void;
  onCommandPalette: () => void;
  updater?: UpdateState;
}

export default function StatusBar({
  activeConnection,
  selectedDb,
  loading,
  layout,
  currentFile,
  isDirty,
  leaderVisible,
  onClose,
  onCommandPalette,
  updater,
}: StatusBarProps) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-xs select-none"
      style={{ minHeight: "40px" }}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button")) {
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
        {updater?.available && !updater.downloading && (
          <button
            onClick={updater.install}
            className="shrink-0 px-2 py-0.5 text-[var(--bg-primary)] bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] transition-colors"
          >
            Update {updater.version}
          </button>
        )}
        {updater?.downloading && (
          <span className="text-[var(--accent)] shrink-0">
            Updating... {updater.progress}%
          </span>
        )}
        {leaderVisible && (
          <span className="text-[var(--accent)] shrink-0 animate-pulse">^Space...</span>
        )}
        {loading && (
          <span className="text-[var(--warning)] shrink-0 animate-pulse">Running...</span>
        )}
        <button
          onClick={onCommandPalette}
          className="w-6 h-6 flex items-center justify-center hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors rounded"
          title="Command Palette (^Space p)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="14" height="14" rx="2" />
            <path d="M5 5l3 3-3 3" />
            <path d="M9 11h3" />
          </svg>
        </button>
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
