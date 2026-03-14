import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export interface CommandItem {
  id: string;
  label: string;
  hint: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export default function CommandPalette({
  isOpen,
  onClose,
  commands,
}: CommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const filteredCommands = useMemo(
    () => commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(filter.toLowerCase())
    ),
    [commands, filter]
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setFilter("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        onClose();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n") || (e.key === "j" && !filter)) {
        setSelectedIndex((i) =>
          Math.min(i + 1, filteredCommands.length - 1)
        );
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p") || (e.key === "k" && !filter)) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === "Enter") {
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        }
        e.preventDefault();
        return;
      }
    },
    [filteredCommands, selectedIndex, onClose, filter]
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[480px] max-h-[400px] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="px-4 py-2 border-b border-[var(--border)]">
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
                return;
              }
              if (e.ctrlKey && (e.key === "n" || e.key === "p")) {
                return;
              }
              if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
                return;
              }
              if ((e.key === "j" || e.key === "k") && !filter) {
                return;
              }
              e.stopPropagation();
            }}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
            placeholder="Type a command..."
          />
        </div>

        <div className="overflow-auto flex-1">
          {filteredCommands.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-muted)] text-sm">
              No matching commands
            </div>
          ) : (
            filteredCommands.map((cmd, i) => (
              <div
                key={cmd.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(i, el);
                }}
                className={`px-4 py-2 cursor-pointer text-sm flex items-center justify-between transition-colors ${
                  i === selectedIndex
                    ? "bg-[var(--accent-dim)] border-l-2 border-[var(--accent)]"
                    : "border-l-2 border-transparent hover:bg-[var(--bg-surface)]"
                }`}
                onClick={() => cmd.action()}
              >
                <span>{cmd.label}</span>
                <span className="text-xs text-[var(--text-muted)] ml-4 shrink-0">
                  {cmd.hint}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
