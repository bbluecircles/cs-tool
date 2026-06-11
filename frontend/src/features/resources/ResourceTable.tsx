/**
 * Generic editable table driven by a ResourceConfig.
 *
 * Layout (top-to-bottom inside the scrolling region):
 *   - sticky header row     (column labels + sort indicators)
 *   - sticky filter row     (per-column ColumnFilterInput)
 *   - data rows             (zebra striped, dirty rows tinted)
 *
 * The header and filter rows are both sticky; the data area scrolls
 * vertically and the whole table scrolls horizontally on narrow viewports.
 *
 * The trailing actions column (Save / Discard / Delete) gets a header
 * cell and a blank filter cell so the columns align — without the spacer
 * the data column would shift left under the actions column.
 */
import { useMemo } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'

// DEPLOYMENT MARKER — if you see this log in DevTools console when the
// app loads, v20 (no sort removal) is running. Two-state cycle: clicking
// a header toggles asc <-> desc; the third "clear sort" step is disabled.
// eslint-disable-next-line no-console
console.log('[ResourceTable] v20 loaded — two-state sort (asc/desc only)')
import type { ResourceFilter } from '@/api/resources'
import { fetchDbDatabases, listResource } from '@/api/resources'
import type { ResourceConfig } from './resourceConfigs'
import { ColumnFilterInput } from './ColumnFilterInput'
import { EditableCell } from './EditableCell'
import { lookupDbFeatures } from './DatabasePicker'
import {
  CUSTOMER_PICKER_QUERY_KEY,
  lookupCustomerName,
  type CustomerRow,
} from './CustomerPicker'
import { PasswordCell } from './PasswordCell'
import type { UseDirtyRows } from './useDirtyRows'

type Row = Record<string, unknown>

interface ResourceTableProps {
  config: ResourceConfig
  rows: Row[]
  sorting: SortingState
  onSortingChange: (next: SortingState) => void
  /** Flat list of all currently-applied filters (across all columns). */
  filters: ResourceFilter[]
  /** Replace the ENTIRE filter list. The table receives one filter slice
   *  per column from ColumnFilterInput's onChange and merges them here. */
  onFiltersChange: (next: ResourceFilter[]) => void
  isLoading: boolean
  isError: boolean
  errorMessage?: string
  dirty: UseDirtyRows
  onSaveRow: (row: Row) => void
  onDiscardRow: (row: Row) => void
  onDeleteRow?: (row: Row) => void
  savingRowKey: string | null
}

export function ResourceTable({
  config,
  rows,
  sorting,
  onSortingChange,
  filters,
  onFiltersChange,
  isLoading,
  isError,
  errorMessage,
  dirty,
  onSaveRow,
  onDiscardRow,
  onDeleteRow,
  savingRowKey,
}: ResourceTableProps) {
  const visibleConfigCols = useMemo(
    () => config.columns.filter((c) => c.show !== false),
    [config],
  )

  // Prefetch the db_database list so the cache is warm before the agent
  // clicks into an IP/OP/ED/APR-DRG cell. We read from the cache via
  // lookupDbFeatures inside each cell's render callback, and include
  // the query result in the columns memo deps so the table re-renders
  // once the list resolves.
  const qc = useQueryClient()
  const hasFeatureGatedColumns = useMemo(
    () => visibleConfigCols.some((c) => c.computeDisabledOverride),
    [visibleConfigCols],
  )
  const dbFeaturesQuery = useQuery({
    queryKey: ['db-database-picker'],
    queryFn: fetchDbDatabases,
    staleTime: 60_000,
    enabled: hasFeatureGatedColumns,
  })

  // Same trick for the customer-picker cache: when a read-only customer_code
  // column is present, subscribe to the cache so the table re-renders once
  // the customer list resolves and we can substitute the name for the code.
  // The CustomerPicker in the filter row also subscribes — we share the
  // cache via the CUSTOMER_PICKER_QUERY_KEY constant.
  const hasReadonlyCustomerCode = useMemo(
    () => visibleConfigCols.some(
      (c) => c.kind === 'customer_code' && !c.editable,
    ),
    [visibleConfigCols],
  )
  const customerPickerQuery = useQuery({
    queryKey: CUSTOMER_PICKER_QUERY_KEY,
    queryFn: () =>
      listResource<CustomerRow>('customers', {
        page: 1,
        page_size: 200,
        sort_by: 'customer_name',
        sort_dir: 'asc',
      }),
    staleTime: 60_000,
    enabled: hasReadonlyCustomerCode,
  })

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const tableCols: ColumnDef<Row>[] = visibleConfigCols.map((col) => {
      // Sortable by default. The previous logic gated this on a frontend
      // allowlist (config.sortableColumns) that had to mirror the backend
      // repo's SORTABLE_COLUMNS — easy to drift out of sync. The backend
      // already silently falls back to a default order if asked to sort
      // by an unknown column, so giving every visible column a sort
      // affordance is safe.
      const enableSorting = true
      if (col.isPassword) {
        return {
          id: col.key,
          accessorKey: col.key,
          header: col.label,
          enableSorting,
          cell: ({ row }) => {
            const rowObj = row.original as Row
            const key = config.rowKey(rowObj)
            const pending = dirty.getDirty(key)[col.key]
            const isDirty = dirty.isDirty(key, col.key)
            const isSaving = savingRowKey === key
            const userId = String(rowObj.user_id ?? '')
            const customerCode = Number(rowObj.customer_code ?? 0)
            return (
              <div className="flex items-center gap-3">
                <PasswordCell
                  userId={userId}
                  customerCode={customerCode}
                />
                <span className="text-gray-300">|</span>
                <EditableCell
                  column={col}
                  originalValue={rowObj[col.key]}
                  pendingValue={pending}
                  dirty={isDirty}
                  disabled={isSaving}
                  onCommit={(v) =>
                    dirty.setField(key, col.key, v, rowObj[col.key])
                  }
                />
              </div>
            )
          },
        }
      }

      return {
        id: col.key,
        accessorKey: col.key,
        header: col.label,
        enableSorting,
        cell: ({ row }) => {
          const rowObj = row.original as Row
          const key = config.rowKey(rowObj)
          const pending = dirty.getDirty(key)[col.key]
          const isDirty = dirty.isDirty(key, col.key)
          const isSaving = savingRowKey === key

          if (!col.editable) {
            // customer_code cells: resolve the bare integer to the
            // customer_name via the shared CustomerPicker cache. Falls
            // back to the code itself if the cache hasn't loaded yet.
            if (col.kind === 'customer_code') {
              const code = rowObj[col.key]
              const codeNum = typeof code === 'number' ? code : Number(code)
              if (Number.isFinite(codeNum)) {
                const name = lookupCustomerName(qc, codeNum)
                return (
                  <span className="text-gray-700">
                    {name ?? String(codeNum)}
                  </span>
                )
              }
            }
            return (
              <span className="text-gray-700">
                {formatReadonly(col.kind, rowObj[col.key])}
              </span>
            )
          }

          // Cross-field override: if the column's computeDisabledOverride
          // says this row's database doesn't support the feature, render
          // a disabled cell forced to the override value. Same enforcement
          // path the create modal uses.
          let displayValue: unknown = rowObj[col.key]
          let cellDisabled = isSaving
          if (col.computeDisabledOverride) {
            const features = lookupDbFeatures(
              qc,
              typeof rowObj.database_name === 'string' ? rowObj.database_name : null,
            )
            const override = col.computeDisabledOverride(rowObj, features)
            if (override) {
              if (override.disabled) cellDisabled = true
              if (override.valueOverride !== undefined) {
                displayValue = override.valueOverride
              }
            }
          }

          return (
            <EditableCell
              column={col}
              originalValue={displayValue}
              pendingValue={pending}
              dirty={isDirty}
              disabled={cellDisabled}
              onCommit={(v) =>
                dirty.setField(key, col.key, v, rowObj[col.key])
              }
            />
          )
        },
      }
    })

    // Trailing actions column.
    tableCols.push({
      id: '__actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => {
        const rowObj = row.original as Row
        const key = config.rowKey(rowObj)
        const has = dirty.hasDirty(key)
        const isSaving = savingRowKey === key
        return (
          <div className="flex items-center gap-1 min-w-[140px]">
            <button
              type="button"
              disabled={!has || isSaving}
              onClick={() => onSaveRow(rowObj)}
              className={clsx(
                'text-xs px-2 py-0.5 rounded font-medium',
                has && !isSaving
                  ? 'bg-secondary-500 text-white hover:bg-secondary-700'
                  : 'bg-gray-100 text-gray-500 cursor-not-allowed',
              )}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={!has || isSaving}
              onClick={() => onDiscardRow(rowObj)}
              className={clsx(
                'text-xs px-2 py-0.5 rounded',
                has && !isSaving
                  ? 'text-gray-700 hover:bg-gray-100'
                  : 'text-gray-400 cursor-not-allowed',
              )}
            >
              Discard
            </button>
            {config.allowDelete && onDeleteRow && (
              <button
                type="button"
                onClick={() => onDeleteRow(rowObj)}
                disabled={isSaving}
                className="text-xs px-2 py-0.5 rounded text-error-600 hover:bg-error-100 disabled:opacity-50"
                title="Permanently delete this row"
              >
                Delete
              </button>
            )}
          </div>
        )
      },
    })

    return tableCols
  }, [
    visibleConfigCols, config, dirty, onDeleteRow, onDiscardRow, onSaveRow,
    savingRowKey, qc, dbFeaturesQuery.data, customerPickerQuery.data,
  ])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      onSortingChange(next)
    },
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    // Two-state cycle (asc <-> desc) per column instead of the default
    // three-state (asc -> desc -> idle). The "idle" step would clear
    // sort entirely and reorder rows back to the backend's default,
    // which agents read as "ascending again" — confusing.
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  })

  // Group filters by column so each ColumnFilterInput sees only its own
  // slice. Computed here (not in the input) because the parent owns the
  // canonical flat list and the per-column slices are derived.
  const filtersByColumn = useMemo(() => {
    const map = new Map<string, ResourceFilter[]>()
    for (const f of filters) {
      const arr = map.get(f.column) ?? []
      arr.push(f)
      map.set(f.column, arr)
    }
    return map
  }, [filters])

  /**
   * Replace one column's filter slice with a new one and emit the merged
   * flat list. This is what each ColumnFilterInput's onChange routes to.
   */
  function replaceColumnFilters(columnKey: string, next: ResourceFilter[]) {
    const others = filters.filter((f) => f.column !== columnKey)
    onFiltersChange([...others, ...next])
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-300px)]">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Row 1: column labels + sort indicators */}
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort()
                  const sort = h.column.getIsSorted()
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      className={clsx(
                        'bg-table-header text-left text-xs font-semibold',
                        'text-gray-700 px-3 py-2 border-b border-border whitespace-nowrap',
                        canSort && 'cursor-pointer select-none hover:bg-primary-100',
                      )}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                      title={
                        canSort
                          ? sort === 'asc'
                            ? 'Sorted ascending — click for descending'
                            : sort === 'desc'
                              ? 'Sorted descending — click for ascending'
                              : 'Click to sort ascending'
                          : undefined
                      }
                    >
                      <span
                        className="inline-flex items-center gap-1 pointer-events-none"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort && (
                          <SortIndicator sort={sort === false ? null : sort} />
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}

            {/* Row 2: per-column filter inputs */}
            <tr>
              {visibleConfigCols.map((col) => (
                <th
                  key={`flt-${col.key}`}
                  className="bg-primary-100/30 px-2 py-1 border-b border-border align-top"
                >
                  <ColumnFilterInput
                    column={col}
                    value={filtersByColumn.get(col.key) ?? []}
                    onChange={(next) => replaceColumnFilters(col.key, next)}
                  />
                </th>
              ))}
              {/* spacer for the actions column */}
              <th
                key="flt-__actions"
                className="bg-primary-100/30 px-2 py-1 border-b border-border"
              />
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 && (
              <LoadingRow columnCount={columns.length} />
            )}
            {isError && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-error-600">
                  {errorMessage ?? 'Failed to load.'}
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-gray-500">
                  No rows match the current filters.
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row, idx) => {
              const key = config.rowKey(row.original as Row)
              const rowHasDirty = dirty.hasDirty(key)
              const rowIsDisabled =
                (row.original as Row).disable === 1 ||
                (row.original as Row).disable === '1'
              return (
                <tr
                  key={row.id}
                  className={clsx(
                    'hover:bg-row-hover transition-colors',
                    idx % 2 === 1 && 'bg-table-row-alt',
                    rowIsDisabled && 'text-gray-500',
                    rowHasDirty && 'bg-warning-100/40 hover:bg-warning-100/60',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-3 py-1.5 border-b border-divider whitespace-nowrap"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortIndicator({ sort }: { sort: 'asc' | 'desc' | null }) {
  // Always render an indicator when the column is sortable. The idle
  // state (no active sort) shows a dim ↕ glyph so agents see the
  // column is sortable without having to hover.
  return (
    <span className="inline-block w-3 text-center text-[10px]">
      {sort === 'asc' ? (
        <span className="text-secondary-700">▲</span>
      ) : sort === 'desc' ? (
        <span className="text-secondary-700">▼</span>
      ) : (
        <span className="text-gray-300">↕</span>
      )}
    </span>
  )
}

function LoadingRow({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: columnCount }).map((_, j) => (
            <td key={j} className="px-3 py-2 border-b border-divider">
              <div className="h-3 w-full max-w-[120px] rounded bg-gray-100 animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function formatReadonly(kind: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (kind === 'datetime') return String(value).replace('T', ' ').slice(0, 16)
  if (kind === 'flag') return value === 1 || value === '1' ? 'Yes' : 'No'
  return String(value)
}