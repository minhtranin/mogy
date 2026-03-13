interface KeymapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const sections = [
  {
    title: "Global",
    keys: [
      ["Ctrl+Enter", "Run query"],
      ["Ctrl+K", "Focus editor"],
      ["Ctrl+J", "Focus results"],
      ["Ctrl+N / Ctrl+P", "Next / prev page"],
      ["Ctrl+Shift+N", "Last page"],
      ["Ctrl+Shift+P", "First page"],
      ["?", "Show this help"],
    ],
  },
  {
    title: "Leader (Ctrl+Space, then...)",
    keys: [
      ["a", "Connections"],
      ["d", "Databases"],
      ["o", "Collections"],
      ["m", "Toggle maximize"],
      ["l", "Load query file"],
    ],
  },
  {
    title: "Results Panel",
    keys: [
      ["Shift+H", "Table view"],
      ["Shift+L", "JSON view"],
      ["j / k", "Navigate rows"],
      ["h / l", "Scroll horizontal"],
      ["g / G", "First / last row"],
      ["Enter", "Expand row detail"],
    ],
  },
  {
    title: "Editor",
    keys: [
      ["jk", "Exit insert mode"],
      [":w", "Save query file"],
    ],
  },
  {
    title: "Detail View (Vim editor)",
    keys: [
      [":w", "Save document"],
      [":q", "Back to list"],
      ["Esc", "Back to list"],
    ],
  },
  {
    title: "Modals",
    keys: [
      ["j / k", "Navigate items"],
      ["Enter", "Select item"],
      ["Esc / Ctrl+[", "Close modal"],
      ["Ctrl+N / Ctrl+P", "Navigate items"],
    ],
  },
  {
    title: "Config",
    keys: [
      ["~/.config/mogy/settings.json", "Override keybindings"],
    ],
  },
];

export default function KeymapModal({ isOpen, onClose }: KeymapModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      onKeyDown={(e) => {
        if (
          e.key === "Escape" ||
          (e.ctrlKey && e.key === "[") ||
          e.key === "?"
        ) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg w-[550px] max-h-[80vh] shadow-2xl overflow-auto"
        onClick={(e) => e.stopPropagation()}
        tabIndex={0}
        ref={(el) => el?.focus()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--accent)] font-medium">
            Keybindings
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            ? or Esc to close
          </span>
        </div>

        <div className="p-4 space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="text-xs text-[var(--warning)] uppercase tracking-wider mb-1.5">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.keys.map(([key, desc]) => (
                  <div key={key} className="flex items-center text-sm py-0.5">
                    <span className="w-[140px] shrink-0 text-[var(--accent)] font-mono text-xs">
                      {key}
                    </span>
                    <span className="text-[var(--text-secondary)]">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
