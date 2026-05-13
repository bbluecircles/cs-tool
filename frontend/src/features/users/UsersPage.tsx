import { useEffect, useMemo, useState } from 'react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { listUsers, UserListParams, type UserRow } from '@/api/users'
import {
  listEditableColumns,
  type ApplyResponse,
  type EditableColumnDescriptor,
} from '@/api/edits'
import type { CreateUserResponse } from '@/api/create_user'
import { SORTABLE_COLUMNS } from './columns'
import { UsersToolbar, type UsersFilterState } from './UsersToolbar'
import { UsersTable } from './UsersTable'
import { PaginationFooter } from './PaginationFooter'
import {
  ConfirmChangesModal,
  SyncResultToast,
} from './ConfirmChangesModal'
import {
  CreateUserModal,
  CreateResultToast,
} from './createModal/CreateUserModal'
import { rowKey, useDirtyRows } from './useDirtyRows'
import { setHasUnsaved } from '@/lib/unsavedSignal'

export function UsersPage() {
  const qc = useQueryClient()

  const [filters, setFilters] = useState<UsersFilterState>({ search: '' })
  const [sorting, setSorting] = useState<SortingState>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [createOpen, setCreateOpen] = useState(false)

  const dirty = useDirtyRows()

  // Publish dirty state to the shared signal so the topbar's sign-out
  // button can warn the agent before logging out.
  useEffect(() => {
    setHasUnsaved(dirty.dirtyCount > 0)
    return () => setHasUnsaved(false)
  }, [dirty.dirtyCount])

  // Guard against accidental tab close / navigation while there are
  // unsaved edits. Browsers show a generic confirmation dialog;
  // the exact message isn't user-controllable any more (security).
  useEffect(() => {
    if (dirty.dirtyCount === 0) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty.dirtyCount])

  // Row currently showing the confirm modal / being applied.
  const [confirming, setConfirming] = useState<UserRow | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<ApplyResponse | null>(null)
  const [lastCreateResult, setLastCreateResult] =
    useState<CreateUserResponse | null>(null)

  // --- Queries -------------------------------------------------------------

  const editCols = useQuery({
    queryKey: ['edit-columns'],
    queryFn: () => listEditableColumns(),
    staleTime: 60 * 60_000,   // changes rarely; cache for an hour
  })

  const descriptors = useMemo<Record<string, EditableColumnDescriptor>>(() => {
    const out: Record<string, EditableColumnDescriptor> = {}
    for (const d of editCols.data ?? []) out[d.name] = d
    return out
  }, [editCols.data])

  const params: UserListParams = useMemo(() => {
    const sort = sorting[0]
    const sortKey =
      sort && SORTABLE_COLUMNS.has(sort.id) ? sort.id : undefined
    return {
      page,
      page_size: pageSize,
      search: filters.search || undefined,
      customer_code: filters.customer_code,
      database_name: filters.database_name,
      disable: filters.disable,
      sort_by: sortKey,
      sort_dir: sort?.desc ? 'desc' : 'asc',
    }
  }, [filters, sorting, page, pageSize])

  const listQuery = useQuery({
    queryKey: ['users', params],
    queryFn: ({ signal }) => listUsers(params, signal),
    placeholderData: keepPreviousData,
  })

  // --- Handlers ------------------------------------------------------------

  function onFiltersChange(next: UsersFilterState) {
    // Guard: if there are dirty edits in progress, ask before dropping them.
    if (dirty.dirtyCount > 0) {
      const ok = window.confirm(
        'You have unsaved edits. Changing filters will discard them. Continue?',
      )
      if (!ok) return
    }
    setFilters(next)
    setPage(1)
  }

  function onSortingChange(next: SortingState) {
    setSorting(next)
    setPage(1)
  }

  function onSaveRow(row: UserRow) {
    setConfirming(row)
  }

  function onDiscardRow(row: UserRow) {
    dirty.clearRow(rowKey(row))
  }

  function onConfirmClose() {
    if (savingKey) return  // don't let Escape close while applying
    setConfirming(null)
  }

  function onApplied(result: ApplyResponse) {
    if (!confirming) return
    const key = rowKey(confirming)
    dirty.clearRow(key)
    setSavingKey(null)
    setConfirming(null)
    setLastResult(result)
    // Refetch the list so the new values are visible.
    qc.invalidateQueries({ queryKey: ['users'] })
    qc.invalidateQueries({ queryKey: ['customers-brief'] })
    qc.invalidateQueries({ queryKey: ['databases-brief'] })
  }

  return (
    <div className="space-y-4">
      <UsersToolbar
        value={filters}
        onChange={onFiltersChange}
        onCreateClick={() => setCreateOpen(true)}
        isFetching={listQuery.isFetching}
      />

      {dirty.dirtyCount > 0 && (
        <div className="rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm text-gray-900">
          {dirty.dirtyCount} unsaved change{dirty.dirtyCount === 1 ? '' : 's'}{' '}
          across {Object.keys(dirty.dirty).length}{' '}
          row{Object.keys(dirty.dirty).length === 1 ? '' : 's'}. Use the
          Save button on a row to review and apply.
        </div>
      )}

      <UsersTable
        rows={listQuery.data?.rows ?? []}
        sorting={sorting}
        onSortingChange={onSortingChange}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorMessage={
          listQuery.error instanceof Error
            ? listQuery.error.message
            : undefined
        }
        dirty={dirty}
        descriptors={descriptors}
        onSaveRow={onSaveRow}
        onDiscardRow={onDiscardRow}
        savingRowKey={savingKey}
      />

      <PaginationFooter
        page={page}
        pageSize={pageSize}
        total={listQuery.data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n)
          setPage(1)
        }}
      />

      {confirming && (
        <ConfirmChangesModal
          userId={confirming.user_id}
          databaseName={confirming.database_name}
          customerCode={confirming.customer_code}
          changes={dirty.getDirty(rowKey(confirming))}
          onClose={onConfirmClose}
          onApplied={onApplied}
        />
      )}

      {lastResult && (
        <SyncResultToast
          result={lastResult}
          onDismiss={() => setLastResult(null)}
        />
      )}

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={(result) => {
            setCreateOpen(false)
            setLastCreateResult(result)
          }}
        />
      )}

      {lastCreateResult && (
        <CreateResultToast
          result={lastCreateResult}
          onDismiss={() => setLastCreateResult(null)}
        />
      )}
    </div>
  )
}
