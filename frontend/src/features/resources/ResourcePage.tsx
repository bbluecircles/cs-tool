/**
 * One tab's worth of state and layout.
 *
 * Owns: filters + sort + pagination + dirty-row state. Renders toolbar,
 * table, pagination, and modals. Each tab is a fresh ResourcePage
 * instance keyed on slug, so switching tabs always starts clean.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'

import { ApiError } from '@/api/client'
import { useConfig } from '@/api/config'
import {
  deleteResource,
  listResource,
  updateResource,
  type ResourceFilter,
} from '@/api/resources'
import { setHasUnsaved } from '@/lib/unsavedSignal'

import { ConfirmSaveModal } from './ConfirmSaveModal'
import { CreateRowModal } from './CreateRowModal'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { PaginationFooter } from './PaginationFooter'
import { ResourceTable } from './ResourceTable'
import { ResourceToolbar } from './ResourceToolbar'
import type { ResourceConfig } from './resourceConfigs'
import { useDirtyRows } from './useDirtyRows'

type Row = Record<string, unknown>

interface ResourcePageProps {
  config: ResourceConfig
}

export function ResourcePage({ config }: ResourcePageProps) {
  const qc = useQueryClient()
  const clientConfig = useConfig()
  const confirmationRequired =
    clientConfig.data?.enable_edit_confirmation ?? false

  // --- local state ----
  const [filters, setFilters] = useState<ResourceFilter[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sorting, setSorting] = useState<SortingState>([])
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)
  const [saveTarget, setSaveTarget] = useState<Row | null>(null)
  const dirty = useDirtyRows()

  // Reset paging when filters change so we don't sit on page 7 of a
  // freshly-narrowed list.
  useEffect(() => setPage(1), [filters])

  // Reset everything when the resource (tab) changes.
  useEffect(() => {
    dirty.clearAll()
    setFilters([])
    setSorting([])
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.slug])

  // Publish unsaved-state to the global signal for logout / beforeunload
  // guards.
  useEffect(() => {
    setHasUnsaved(dirty.dirtyCount > 0)
    return () => setHasUnsaved(false)
  }, [dirty.dirtyCount])

  useEffect(() => {
    if (dirty.dirtyCount === 0) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty.dirtyCount])

  // --- list query ----
  const sort_by = sorting[0]?.id
  const sort_dir: 'asc' | 'desc' = sorting[0]?.desc ? 'desc' : 'asc'

  const listParams = {
    page,
    page_size: pageSize,
    sort_by,
    sort_dir,
    filters,
  }

  const q = useQuery({
    queryKey: [config.slug, listParams],
    queryFn: ({ signal }) => listResource<Row>(config.slug, listParams, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })

  const rows = q.data?.rows ?? []
  const total = q.data?.total ?? 0

  // --- save mutation ----
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null)

  const updateM = useMutation({
    mutationFn: async ({
      idPath,
      changes,
    }: {
      idPath: string
      changes: Record<string, unknown>
    }) => updateResource(config.slug, idPath, changes),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [config.slug] })
    },
  })

  async function doSaveRow(row: Row) {
    const key = config.rowKey(row)
    const changes = dirty.getDirty(key)
    if (Object.keys(changes).length === 0) return

    setSavingRowKey(key)
    try {
      await updateM.mutateAsync({ idPath: config.buildId(row), changes })
      dirty.clearRow(key)
    } catch (e) {
      console.error('save failed', e)
    } finally {
      setSavingRowKey(null)
    }
  }

  function onSaveRow(row: Row) {
    if (confirmationRequired) {
      setSaveTarget(row)
    } else {
      void doSaveRow(row)
    }
  }

  // --- delete mutation ----
  const deleteM = useMutation({
    mutationFn: (row: Row) =>
      deleteResource(config.slug, config.buildId(row)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [config.slug] })
    },
  })

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteM.mutateAsync(deleteTarget)
      dirty.clearRow(config.rowKey(deleteTarget))
      setDeleteTarget(null)
    } catch (e) {
      console.error('delete failed', e)
    }
  }

  // --- render ----
  const listError =
    q.error instanceof ApiError
      ? q.error.message
      : q.error instanceof Error
        ? q.error.message
        : null

  const saveTargetSummary = useMemo(() => {
    if (!saveTarget) return ''
    return config.primaryKeyColumns
      .map((c) => `${c}=${saveTarget[c]}`)
      .join(' · ')
  }, [saveTarget, config.primaryKeyColumns])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">{config.label}</h1>
        <p className="text-sm text-gray-500">{config.description}</p>
      </header>

      <ResourceToolbar
        config={config}
        filters={filters}
        onFiltersChange={setFilters}
        onCreateClick={() => setCreating(true)}
        isFetching={q.isFetching}
      />

      {dirty.dirtyCount > 0 && (
        <div className="rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm text-gray-900">
          {dirty.dirtyCount} unsaved change{dirty.dirtyCount === 1 ? '' : 's'}{' '}
          across {Object.keys(dirty.dirty).length} row
          {Object.keys(dirty.dirty).length === 1 ? '' : 's'}. Use the{' '}
          <span className="font-medium">Save</span> button on each row to
          apply.
        </div>
      )}

      <ResourceTable
        config={config}
        rows={rows}
        sorting={sorting}
        onSortingChange={setSorting}
        filters={filters}
        onFiltersChange={setFilters}
        isLoading={q.isLoading}
        isError={q.isError}
        errorMessage={listError ?? undefined}
        dirty={dirty}
        onSaveRow={onSaveRow}
        onDiscardRow={(row) => dirty.clearRow(config.rowKey(row))}
        onDeleteRow={
          config.allowDelete ? (row) => setDeleteTarget(row) : undefined
        }
        savingRowKey={savingRowKey}
      />

      <PaginationFooter
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n)
          setPage(1)
        }}
      />

      {creating && (
        <CreateRowModal
          config={config}
          onClose={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}

      {deleteTarget && config.allowDelete && (
        <DeleteConfirmModal
          slug={config.slug}
          recId={Number(deleteTarget.rec_id)}
          entityLabel={deleteEntityLabel(config.slug)}
          rowDescription={deleteRowDescription(config.slug, deleteTarget)}
          tableName={deleteTableName(config.slug)}
          impactKind={config.deleteImpactKind ?? 'none'}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          isDeleting={deleteM.isPending}
        />
      )}

      {saveTarget && (
        <ConfirmSaveModal
          rowSummary={saveTargetSummary}
          changes={dirty.getDirty(config.rowKey(saveTarget))}
          originalRow={saveTarget}
          columns={config.columns}
          onCancel={() => setSaveTarget(null)}
          onConfirm={async () => {
            await doSaveRow(saveTarget)
            setSaveTarget(null)
          }}
          isSaving={updateM.isPending}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-resource delete copy.
//
// These exist because the row description is the one piece of delete UX
// that can't be generic — it needs to surface the row's identifying fields
// in human language. Keeping them inline here (rather than on the config)
// because they touch row-shape, which is closer to the page than the
// config registry.
// ---------------------------------------------------------------------------

function deleteEntityLabel(slug: string): string {
  switch (slug) {
    case 'customer-datasets': return 'this dataset'
    case 'ppi-datasets':      return 'this PPI row'
    default:                  return 'this row'
  }
}

function deleteTableName(slug: string): string {
  switch (slug) {
    case 'customer-datasets': return 'secure.customer_dataset'
    case 'ppi-datasets':      return 'secure.ppi_dataset'
    default:                  return ''
  }
}

function deleteRowDescription(slug: string, row: Row): string {
  switch (slug) {
    case 'customer-datasets':
      return `${row.database_name ?? 'dataset'} (customer ${row.customer_code})`
    case 'ppi-datasets':
      return `${row.ppi_state ?? 'PPI row'} (customer ${row.customer_code})`
    default:
      return `row ${row.rec_id ?? ''}`
  }
}