'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type DesktopColumn<T> = {
  id: string;
  header: string;
  sortable?: boolean;
  className?: string;
  cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
};

type SortState = { id: string; dir: 'asc' | 'desc' } | null;

/**
 * Lightweight desktop data table: sort + optional multi-select for bulk actions.
 * Mobile consumers can keep card lists; use this inside `lg:` wrappers.
 */
export function DesktopDataTable<T extends { id: string }>({
  columns,
  rows,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  emptyLabel = 'No rows',
  onRowClick,
}: {
  columns: DesktopColumn<T>[];
  rows: T[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: (ids: string[]) => void;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const an = av == null ? '' : av;
      const bn = bv == null ? '' : bv;
      if (an < bn) return sort.dir === 'asc' ? -1 : 1;
      if (an > bn) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [columns, rows, sort]);

  const allSelected =
    selectedIds && rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  const toggleSort = (id: string) => {
    setSort((prev) => {
      if (!prev || prev.id !== id) return { id, dir: 'asc' };
      if (prev.dir === 'asc') return { id, dir: 'desc' };
      return null;
    });
  };

  return (
    <div className="desktop-data-table-wrap">
      <table className="desktop-data-table">
        <thead>
          <tr>
            {onToggleSelect ? (
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={Boolean(allSelected)}
                  onChange={() => onToggleSelectAll?.(rows.map((r) => r.id))}
                  aria-label="Select all"
                />
              </th>
            ) : null}
            {columns.map((col) => (
              <th key={col.id} className={col.className}>
                {col.sortable ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort(col.id)}
                  >
                    {col.header}
                    {sort?.id === col.id ? (
                      sort.dir === 'asc' ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="opacity-40" />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (onToggleSelect ? 1 : 0)}
                className="text-center text-benz-secondary py-8 text-sm"
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={row.id}
                className={onRowClick ? 'cursor-pointer hover:bg-benz-blue/5' : undefined}
                onClick={() => onRowClick?.(row)}
              >
                {onToggleSelect ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds?.has(row.id) ?? false}
                      onChange={() => onToggleSelect(row.id)}
                      aria-label={`Select ${row.id}`}
                    />
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td key={col.id} className={col.className}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
