interface StatusBarProps {
  activeConnection: string | null;
  selectedDb: string | null;
  selectedCollection: string | null;
  loading: boolean;
}

export default function StatusBar({
  activeConnection,
  selectedDb,
  selectedCollection,
  loading,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-xs">
      <div className="flex items-center gap-3">
        <span className="text-[var(--accent)] font-bold">MOGY</span>
        <span className="text-[var(--border)]">|</span>
        {activeConnection ? (
          <>
            <span className="text-[var(--success)]">{activeConnection}</span>
            {selectedDb && (
              <>
                <span className="text-[var(--text-muted)]">/</span>
                <span className="text-[var(--warning)]">{selectedDb}</span>
              </>
            )}
            {selectedCollection && (
              <>
                <span className="text-[var(--text-muted)]">/</span>
                <span className="text-[var(--text-primary)]">
                  {selectedCollection}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="text-[var(--text-muted)]">
            No connection (Space+c to connect)
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {loading && (
          <span className="text-[var(--warning)]">Running...</span>
        )}
        <span className="text-[var(--text-muted)]">
          ^K editor | ^J results | Space+c connect | Space+d db | Space+l
          collections
        </span>
      </div>
    </div>
  );
}
