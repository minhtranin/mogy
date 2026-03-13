import { useState, useRef, useEffect, useCallback } from "react";
import type { ConnectionConfig } from "../lib/tauri-commands";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connections: ConnectionConfig[];
  activeConnection: string | null;
  onConnect: (name: string) => void;
  onAdd: (name: string, uri: string) => void;
  onDelete: (name: string) => void;
}

export default function ConnectionModal({
  isOpen,
  onClose,
  connections,
  activeConnection,
  onConnect,
  onAdd,
  onDelete,
}: ConnectionModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"list" | "add">("list");
  const [newName, setNewName] = useState("");
  const [newUri, setNewUri] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setMode("list");
      // Focus the container for keyboard nav in list mode
      setTimeout(() => containerRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (mode === "add") {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    } else if (isOpen) {
      containerRef.current?.focus();
    }
  }, [mode, isOpen]);

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // In add mode, only handle close and submit from the form inputs
      if (mode === "add") return;

      // Close on Escape or Ctrl+[ or q
      if (
        e.key === "Escape" ||
        (e.ctrlKey && e.key === "[") ||
        (!e.ctrlKey && e.key === "q")
      ) {
        onClose();
        e.preventDefault();
        return;
      }

      // Next item - j, ArrowDown, n, Ctrl+N
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "n" || (e.ctrlKey && e.key === "n")) {
        setSelectedIndex((i) => Math.min(i + 1, connections.length - 1));
        e.preventDefault();
        return;
      }

      // Prev item - k, ArrowUp, p, Ctrl+P
      if (e.key === "k" || e.key === "ArrowUp" || e.key === "p" || (e.ctrlKey && e.key === "p")) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
        e.preventDefault();
        return;
      }

      // Enter to connect
      if (e.key === "Enter") {
        if (connections[selectedIndex]) {
          onConnect(connections[selectedIndex].name);
          onClose();
        }
        e.preventDefault();
        return;
      }

      // 'a' to add new connection
      if (e.key === "a") {
        setNewName("");
        setNewUri("");
        setMode("add");
        e.preventDefault();
        return;
      }

      // 'd' to delete connection
      if (e.key === "d") {
        if (connections[selectedIndex]) {
          onDelete(connections[selectedIndex].name);
        }
        e.preventDefault();
        return;
      }
    },
    [connections, selectedIndex, mode, onConnect, onDelete, onClose]
  );

  const handleAddFormKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        setMode("list");
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Enter" && newName && newUri) {
        onAdd(newName, newUri);
        setNewName("");
        setNewUri("");
        setMode("list");
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Stop all other keys from bubbling to the outer handler
      e.stopPropagation();
    },
    [newName, newUri, onAdd]
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[500px] max-h-[400px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleListKeyDown}
        tabIndex={0}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--accent)] font-medium">
            Connections
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            j/k | Enter connect | a add | d del | Esc close
          </span>
        </div>

        {mode === "list" ? (
          <div className="overflow-auto max-h-[340px]">
            {connections.length === 0 ? (
              <div className="p-4 text-center text-[var(--text-muted)]">
                No connections. Press 'a' to add one.
              </div>
            ) : (
              connections.map((conn, i) => (
                <div
                  key={conn.name}
                  className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${
                    i === selectedIndex
                      ? "bg-[var(--accent-dim)] border-l-2 border-[var(--accent)]"
                      : "border-l-2 border-transparent hover:bg-[var(--bg-surface)]"
                  }`}
                  onClick={() => {
                    onConnect(conn.name);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-2">
                    {conn.name === activeConnection && (
                      <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                    )}
                    <span className="text-sm">{conn.name}</span>
                  </div>
                  <span className="text-xs text-[var(--text-muted)] truncate max-w-[250px]">
                    {conn.uri}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="p-4 space-y-3" onKeyDown={handleAddFormKeyDown}>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">
                Name
              </label>
              <input
                ref={nameInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                placeholder="my-connection"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">
                URI
              </label>
              <input
                value={newUri}
                onChange={(e) => setNewUri(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                placeholder="mongodb://localhost:27017"
              />
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Enter to save | Esc to cancel
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
