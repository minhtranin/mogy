import { useMemo, useState, useEffect, useRef, useCallback, memo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";

const coreRowModel = getCoreRowModel();
const filteredRowModel = getFilteredRowModel();

interface ResultTableProps {
  data: unknown[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
  onExpandRow: (doc: unknown, index: number) => void;
  focused: boolean;
}

interface TableRowProps {
  row: Row<Record<string, unknown>>;
  idx: number;
  isHighlighted: boolean;
  rowRefCallback: (idx: number, el: HTMLTableRowElement | null) => void;
}

const TableRow = memo(function TableRow({
  row,
  idx,
  isHighlighted,
  rowRefCallback,
}: TableRowProps) {
  return (
    <tr
      ref={(el) => rowRefCallback(idx, el)}
      data-idx={idx}
      className={`border-b border-[var(--border)] cursor-pointer ${
        isHighlighted
          ? "bg-[var(--bg-surface)] ring-1 ring-[var(--accent)]"
          : "hover:bg-[var(--bg-surface)]"
      }`}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          className="px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate"
        >
          {flexRender(
            cell.column.columnDef.cell,
            cell.getContext()
          )}
        </td>
      ))}
    </tr>
  );
});

export default function ResultTable({
  data,
  page,
  pageSize,
  hasMore,
  onPageChange,
  onExpandRow,
  focused,
}: ResultTableProps) {
  const [selectedRow, setSelectedRow] = useState(0);
  const [globalFilter, setGlobalFilter] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // Stable refs to avoid re-creating handler
  const dataRef = useRef(data);
  dataRef.current = data;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const selectedRowRef = useRef(selectedRow);
  selectedRowRef.current = selectedRow;
  const onExpandRowRef = useRef(onExpandRow);
  onExpandRowRef.current = onExpandRow;
  const searchActiveRef = useRef(searchActive);
  searchActiveRef.current = searchActive;

  // Reset selection when data changes
  useEffect(() => {
    setSelectedRow(0);
  }, [data]);

  // Scroll selected row into view
  useEffect(() => {
    const el = rowRefs.current.get(selectedRow);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedRow]);

  // Stable keyboard handler — never re-created
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!focusedRef.current) return;

      // Skip vim nav keys when search input is focused
      if (searchActiveRef.current) return;

      const len = dataRef.current.length;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setSelectedRow((r) => Math.min(r + 1, len - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setSelectedRow((r) => Math.max(r - 1, 0));
          break;
        case "h":
        case "ArrowLeft":
          e.preventDefault();
          if (tableRef.current) tableRef.current.scrollLeft -= 100;
          break;
        case "l":
        case "ArrowRight":
          e.preventDefault();
          if (tableRef.current) tableRef.current.scrollLeft += 100;
          break;
        case "g":
          e.preventDefault();
          setSelectedRow(0);
          break;
        case "G":
          e.preventDefault();
          setSelectedRow(len - 1);
          break;
        case "Enter":
          e.preventDefault();
          {
            const row = selectedRowRef.current;
            const doc = dataRef.current[row];
            if (doc) onExpandRowRef.current(doc, row);
          }
          break;
        case "/":
          e.preventDefault();
          setSearchActive(true);
          setTimeout(() => searchRef.current?.focus(), 0);
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (data.length === 0) return [];

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
        if (val === null || val === undefined)
          return <span className="text-[var(--text-muted)]">null</span>;
        if (typeof val === "object") {
          if (val && "$date" in val)
            return (
              <span className="text-[var(--warning)]">
                {String((val as Record<string, unknown>).$date)}
              </span>
            );
          return (
            <span className="text-[var(--warning)]">
              {JSON.stringify(val)}
            </span>
          );
        }
        if (typeof val === "boolean")
          return (
            <span className="text-[var(--accent)]">{String(val)}</span>
          );
        if (typeof val === "number")
          return (
            <span className="text-[var(--success)]">{String(val)}</span>
          );
        return <span>{String(val)}</span>;
      },
    }));
  }, [data]);

  const globalFilterFn = useCallback(
    (row: Row<Record<string, unknown>>, _columnId: string, filterValue: string) => {
      const search = filterValue.toLowerCase();
      return Object.values(row.original).some((val) =>
        String(val ?? "").toLowerCase().includes(search)
      );
    },
    []
  );

  const table = useReactTable({
    data: data as Record<string, unknown>[],
    columns,
    getCoreRowModel: coreRowModel,
    getFilteredRowModel: filteredRowModel,
    globalFilterFn,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    manualPagination: true,
    pageCount: hasMore ? page + 1 : page,
  });

  // Event delegation: single handler on tbody for click/dblclick
  const handleTbodyClick = useCallback((e: React.MouseEvent<HTMLTableSectionElement>) => {
    const row = (e.target as HTMLElement).closest("tr[data-idx]");
    if (!row) return;
    const idx = Number(row.getAttribute("data-idx"));
    setSelectedRow(idx);
  }, []);

  const handleTbodyDoubleClick = useCallback((e: React.MouseEvent<HTMLTableSectionElement>) => {
    const row = (e.target as HTMLElement).closest("tr[data-idx]");
    if (!row) return;
    const idx = Number(row.getAttribute("data-idx"));
    const doc = dataRef.current[idx];
    if (doc) onExpandRowRef.current(doc, idx);
  }, []);

  const rowRefCallback = useCallback((idx: number, el: HTMLTableRowElement | null) => {
    if (el) {
      rowRefs.current.set(idx, el);
    } else {
      rowRefs.current.delete(idx);
    }
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        No results
      </div>
    );
  }

  const filteredRows = table.getRowModel().rows;

  return (
    <div className="flex flex-col h-full">
      {searchActive && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <span className="text-[var(--accent)] text-sm">/</span>
          <input
            ref={searchRef}
            value={globalFilter}
            onChange={(e) => {
              setGlobalFilter(e.target.value);
              setSelectedRow(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
                e.preventDefault();
                e.stopPropagation();
                setSearchActive(false);
                setGlobalFilter("");
              } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                setSearchActive(false);
                searchRef.current?.blur();
              }
            }}
            className="flex-1 bg-transparent text-sm outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)]"
            placeholder="Search rows..."
            autoFocus
          />
          <span className="text-xs text-[var(--text-muted)]">
            {filteredRows.length}/{data.length}
          </span>
        </div>
      )}
      <div ref={tableRef} className="flex-1 overflow-auto">
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
          <tbody onClick={handleTbodyClick} onDoubleClick={handleTbodyDoubleClick}>
            {filteredRows.map((row, idx) => (
              <TableRow
                key={row.id}
                row={row}
                idx={idx}
                isHighlighted={idx === selectedRow && focused}
                rowRefCallback={rowRefCallback}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-sm">
          <span className="text-[var(--text-muted)]">
            Page {page}{hasMore ? "+" : ""} | Row {selectedRow + 1}/{filteredRows.length}{globalFilter ? ` (${data.length} total)` : ""}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-2 py-1 bg-[var(--bg-surface)] rounded disabled:opacity-30 hover:bg-[var(--border)]"
            >
              Prev
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={!hasMore}
              className="px-2 py-1 bg-[var(--bg-surface)] rounded disabled:opacity-30 hover:bg-[var(--border)]"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
