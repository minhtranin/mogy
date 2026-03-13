import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";

interface ResultTableProps {
  data: unknown[];
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

export default function ResultTable({
  data,
  page,
  pageSize,
  totalCount,
  onPageChange,
}: ResultTableProps) {
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (data.length === 0) return [];

    // Collect all unique keys from all documents
    const allKeys = new Set<string>();
    data.forEach((doc) => {
      if (doc && typeof doc === "object") {
        Object.keys(doc as object).forEach((key) => allKeys.add(key));
      }
    });

    return Array.from(allKeys).map((key) => ({
      accessorKey: key,
      header: key,
      cell: ({ getValue }) => {
        const val = getValue();
        if (val === null || val === undefined) return <span className="text-[var(--text-muted)]">null</span>;
        if (typeof val === "object") return <span className="text-[var(--warning)]">{JSON.stringify(val)}</span>;
        if (typeof val === "boolean") return <span className="text-[var(--accent)]">{String(val)}</span>;
        if (typeof val === "number") return <span className="text-[var(--success)]">{String(val)}</span>;
        return <span>{String(val)}</span>;
      },
    }));
  }, [data]);

  const table = useReactTable({
    data: data as Record<string, unknown>[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(totalCount / pageSize),
  });

  const totalPages = Math.ceil(totalCount / pageSize);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        No results
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-[var(--bg-secondary)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left px-3 py-2 border-b border-[var(--border)] text-[var(--accent)] font-medium whitespace-nowrap"
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-[var(--bg-surface)] border-b border-[var(--border)]"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-sm">
          <span className="text-[var(--text-muted)]">
            {totalCount} documents | Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
              className="px-2 py-1 bg-[var(--bg-surface)] rounded disabled:opacity-30 hover:bg-[var(--border)]"
            >
              First
            </button>
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-2 py-1 bg-[var(--bg-surface)] rounded disabled:opacity-30 hover:bg-[var(--border)]"
            >
              Prev
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-2 py-1 bg-[var(--bg-surface)] rounded disabled:opacity-30 hover:bg-[var(--border)]"
            >
              Next
            </button>
            <button
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
              className="px-2 py-1 bg-[var(--bg-surface)] rounded disabled:opacity-30 hover:bg-[var(--border)]"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
