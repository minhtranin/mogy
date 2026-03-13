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

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setMode("list");
    }
  }, [isOpen]);

  useEffect(() => {
    if (mode === "add" && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [mode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode === "add") {
        if (e.key === "Escape") {
          setMode("list");
          e.preventDefault();
        }
        if (e.key === "Enter" && newName && newUri) {
          onAdd(newName, newUri);
          setNewName("");
          setNewUri("");
          setMode("list");
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          setSelectedIndex((i) => Math.min(i + 1, connections.length - 1));
          e.preventDefault();
          break;
        case "k":
        case "ArrowUp":
          setSelectedIndex((i) => Math.max(i - 1, 0));
          e.preventDefault();
          break;
        case "Enter":
          if (connections[selectedIndex]) {
            onConnect(connections[selectedIndex].name);
            onClose();
          }
          e.preventDefault();
          break;
        case "a":
          setMode("add");
          e.preventDefault();
          break;
        case "d":
          if (connections[selectedIndex]) {
            onDelete(connections[selectedIndex].name);
          }
          e.preventDefault();
          break;
        case "Escape":
        case "q":
          onClose();
          e.preventDefault();
          break;
      }
    },
    [connections, selectedIndex, mode, newName, newUri, onConnect, onAdd, onDelete, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg w-[500px] max-h-[400px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        ref={(el) => el?.focus()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--accent)]">Connections</span>
          <span className="text-xs text-[var(--text-muted)]">
            j/k navigate | Enter connect | a add | d delete | q close
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
                  className={`flex items-center justify-between px-4 py-2 cursor-pointer ${
                    i === selectedIndex
                      ? "bg-[var(--bg-surface)]"
                      : "hover:bg-[var(--bg-surface)]"
                  }`}
                  onClick={() => {
                    onConnect(conn.name);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-2">
                    {conn.name === activeConnection && (
                      <span className="text-[var(--success)] text-xs">*</span>
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
          <div className="p-4 space-y-3">
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
              Enter to save | Escape to cancel
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
