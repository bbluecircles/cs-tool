import { useMemo } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import clsx from 'clsx'
import type { UserRow } from '@/api/users'
import type { EditableColumnDescriptor } from '@/api/edits'
import { USER_COLUMNS } from './columns'
import { PasswordCell } from './PasswordCell'
import { EditableCell } from './EditableCell'
import { rowKey, UseDirtyRows } from './useDirtyRows'

interface UsersTableProps {
  rows: UserRow[]
  sorting: SortingState
  onSortingChange: (next: SortingState) => void
  isLoading: boolean
  isError: boolean
  errorMessage?: string
  /** Shared dirty-row tracker from UsersPage. */
  dirty: UseDirtyRows
  /** Editable-column descriptors keyed by name — drives input types. */
  descriptors: Record<string, EditableColumnDescriptor>
  /** Called when the user clicks Save on a row. */
  onSaveRow: (row: UserRow) => void
  /** Called when the user clicks Discard on a row. */
  onDiscardRow: (row: UserRow) => void
  /** If set, inline edits for this row are disabled (save in flight). */
  savingRowKey: string | null
}

/**
 * Users table with inline edit support.
 *
 * Edit discipline:
 *   - Read-only columns (scope === 'readonly') render their value as-is.
 *   - Editable columns render an EditableCell that commits into the dirty
 *     store. The backend `descriptors` dict tells us input type / bounds;
 *     if a column is listed as editable in our UI but the backend doesn't
 *     expose a descriptor for it, we fall back to read-only (defensive).
 *   - Each row gets a trailing "Actions" column with Save/Discard buttons
 *     that light up when any field on that row is dirty.
 */
export function UsersTable({
  rows,
  sorting,
  onSortingChange,
  isLoading,
  isError,
  errorMessage,
  dirty,
  descriptors,
  onSaveRow,
  onDiscardRow,
  savingRowKey,
}: UsersTableProps) {
  const columns = useMemo<ColumnDef<UserRow>[]>(() => {
    // Wrap each base column: if it's editable AND the backend says so,
    // swap in an EditableCell. Otherwise render the original cell function.
    const wrapped: ColumnDef<UserRow>[] = USER_COLUMNS.map((base) => {
      const id = base.id as string
      const scope = base.meta?.scope
      const descriptor = descriptors[id]
      if (scope === 'readonly' || !descriptor) return base

      // Remember the original cell renderer so we can reuse its formatting
      // when a cell is not being edited.
      const originalCell = base.cell

      return {
        ...base,
        cell: (ctx) => {
          const row = ctx.row.original
          const key = rowKey(row)
          const isSaving = savingRowKey === key
          const pending = dirty.getDirty(key)[id]
          const isDirty = dirty.isDirty(key, id)
          return (
            <EditableCell
              originalValue={(row as unknown as Record<string, unknown>)[id]}
              pendingValue={pending}
              dirty={isDirty}
              descriptor={descriptor}
              disabled={isSaving}
              onCommit={(v) => dirty.setField(row, id, v)}
              // Reuse the column's original formatter for display.
              format={(v) => {
                if (!originalCell || typeof originalCell !== 'function') {
                  return v === null || v === undefined || v === '' ? '—' : String(v)
                }
                // Synthesize a context that returns the value we want to format
                const synthetic = {
                  ...ctx,
                  getValue: () => v,
                } as typeof ctx
                const rendered = originalCell(synthetic)
                return typeof rendered === 'string' ? rendered : String(rendered ?? '')
              }}
            />
          )
        },
      }
    })

    const password: ColumnDef<UserRow> = {
      id: 'password',
      header: 'Password',
      enableSorting: false,
      cell: ({ row }) => (
        <PasswordCell
          userId={row.original.user_id}
          databaseName={row.original.database_name}
        />
      ),
      meta: { scope: 'user', group: 'identity' },
    }

    const actions: ColumnDef<UserRow> = {
      id: '__actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => {
        const key = rowKey(row.original)
        const has = dirty.hasDirty(key)
        const isSaving = savingRowKey === key
        return (
          <div className="flex items-center gap-1 min-w-[110px]">
            <button
              type="button"
              disabled={!has || isSaving}
              onClick={() => onSaveRow(row.original)}
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
              onClick={() => onDiscardRow(row.original)}
              className={clsx(
                'text-xs px-2 py-0.5 rounded',
                has && !isSaving
                  ? 'text-gray-700 hover:bg-gray-100'
                  : 'text-gray-400 cursor-not-allowed',
              )}
            >
              Discard
            </button>
          </div>
        )
      },
      meta: { scope: 'readonly' },
    }

    return [password, ...wrapped, actions]
  }, [dirty, descriptors, onDiscardRow, onSaveRow, savingRowKey])

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
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="card overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
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
                        'text-gray-700 px-3 py-2 border-b border-border',
                        'whitespace-nowrap',
                        canSort && 'cursor-pointer select-none hover:bg-primary-100',
                      )}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
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
          </thead>
          <tbody>
            {isLoading && rows.length === 0 && (
              <LoadingRow columnCount={columns.length} />
            )}
            {isError && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-error-600"
                >
                  {errorMessage ?? 'Failed to load users.'}
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-gray-500"
                >
                  No users match the current filters.
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row, idx) => {
              const key = rowKey(row.original)
              const rowHasDirty = dirty.hasDirty(key)
              return (
                <tr
                  key={row.id}
                  className={clsx(
                    'hover:bg-row-hover transition-colors',
                    idx % 2 === 1 && 'bg-table-row-alt',
                    row.original.disable !== 0 && 'text-gray-500',
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
  return (
    <span className="inline-block w-3 text-center text-[10px] text-gray-500">
      {sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : ''}
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
