import { useState, useEffect, useCallback } from "react";

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

  const filteredItems = items.filter((item) =>
    item.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setFilter("");
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "j":
          if (!filter) {
            setSelectedIndex((i) =>
              Math.min(i + 1, filteredItems.length - 1)
            );
            e.preventDefault();
          }
          break;
        case "ArrowUp":
        case "k":
          if (!filter) {
            setSelectedIndex((i) => Math.max(i - 1, 0));
            e.preventDefault();
          }
          break;
        case "Enter":
          if (filteredItems[selectedIndex]) {
            onSelect(filteredItems[selectedIndex]);
            onClose();
          }
          e.preventDefault();
          break;
        case "Escape":
          onClose();
          e.preventDefault();
          break;
      }
    },
    [filteredItems, selectedIndex, filter, onSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg w-[400px] max-h-[400px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        ref={(el) => el?.focus()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--accent)]">{title}</span>
          <span className="text-xs text-[var(--text-muted)]">
            j/k | Enter select | Esc close
          </span>
        </div>

        {/* Filter input */}
        <div className="px-4 py-2 border-b border-[var(--border)]">
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-1 text-sm outline-none focus:border-[var(--accent)]"
            placeholder="Filter..."
            autoFocus
          />
        </div>

        <div className="overflow-auto max-h-[300px]">
          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-muted)] text-sm">
              {items.length === 0 ? "No items" : "No matches"}
            </div>
          ) : (
            filteredItems.map((item, i) => (
              <div
                key={item}
                className={`px-4 py-1.5 cursor-pointer text-sm flex items-center gap-2 ${
                  i === selectedIndex
                    ? "bg-[var(--bg-surface)]"
                    : "hover:bg-[var(--bg-surface)]"
                }`}
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                {item === selectedItem && (
                  <span className="text-[var(--success)]">*</span>
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
