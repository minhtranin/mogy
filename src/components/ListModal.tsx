import { useState, useEffect, useCallback, useRef } from "react";

interface ListModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: string[];
  onSelect: (item: string) => void;
  selectedItem?: string | null;
}

export default function ListModal({
  isOpen,
  onClose,
  title,
  items,
  onSelect,
  selectedItem,
}: ListModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const filteredItems = items.filter((item) =>
    item.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setFilter("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Auto-scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Close on Escape or Ctrl+[
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        onClose();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Ctrl+N / ArrowDown — next item
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
        setSelectedIndex((i) =>
          Math.min(i + 1, filteredItems.length - 1)
        );
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Ctrl+P / ArrowUp — prev item
      if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === "Enter") {
        if (filteredItems[selectedIndex]) {
          onSelect(filteredItems[selectedIndex]);
        }
        e.preventDefault();
        return;
      }
    },
    [filteredItems, selectedIndex, onSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[400px] max-h-[400px] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--accent)] font-medium">
            {title}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            Enter select | Esc close
          </span>
        </div>

        <div className="px-4 py-2 border-b border-[var(--border)]">
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              // Let navigation keys bubble to parent handler
              if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
                return;
              }
              // Ctrl+N/P for navigation
              if (e.ctrlKey && (e.key === "n" || e.key === "p")) {
                return;
              }
              // Close keys
              if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
                return;
              }
              // Stop all other keys from bubbling (so typing works)
              e.stopPropagation();
            }}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-1 text-sm outline-none focus:border-[var(--accent)]"
            placeholder="Filter..."
          />
        </div>

        <div className="overflow-auto flex-1">
          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-muted)] text-sm">
              {items.length === 0 ? "No items" : "No matches"}
            </div>
          ) : (
            filteredItems.map((item, i) => (
              <div
                key={item}
                ref={(el) => {
                  if (el) itemRefs.current.set(i, el);
                }}
                className={`px-4 py-1.5 cursor-pointer text-sm flex items-center gap-2 transition-colors ${
                  i === selectedIndex
                    ? "bg-[var(--accent-dim)] border-l-2 border-[var(--accent)]"
                    : "border-l-2 border-transparent hover:bg-[var(--bg-surface)]"
                }`}
                onClick={() => {
                  onSelect(item);
                }}
              >
                {item === selectedItem && (
                  <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                )}
                <span>{item}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
