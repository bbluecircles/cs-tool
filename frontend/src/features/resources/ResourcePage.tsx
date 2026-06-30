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
import clsx from 'clsx'

import { ApiError } from '@/api/client'
import { useConfig } from '@/api/config'
import {
  deleteResource,
  listResource,
  updateResource,
  type ResourceFilter,
} from '@/api/resources'
import { setHasUnsaved } from '@/lib/unsavedSignal'

import { CancelConfirmModal } from './CancelConfirmModal'
import { ConfirmSaveModal } from './ConfirmSaveModal'
import { CreateRowModal } from './CreateRowModal'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { EditRowModal } from './EditRowModal'
import { PaginationFooter } from './PaginationFooter'
import { ResourceTable } from './ResourceTable'
import { ResourceToolbar } from './ResourceToolbar'
import type { ResourceConfig } from './resourceConfigs'
import { useDirtyRows } from './useDirtyRows'

type Row = Record<string, unknown>

/** Local-timezone YYYY-MM-DD, for stamping cancelled_date. */
function localToday(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

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
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null)
  const [saveTarget, setSaveTarget] = useState<Row | null>(null)
  const dirty = useDirtyRows()

  // --- row selection ---
  // selectedKeys: rows the agent has explicitly checked. Held as a Set
  // so add/remove are O(1) and rendering selected-state checks are
  // cheap. Keys are config.rowKey(row) — stable across re-renders.
  // lastSelectedKey: anchor for shift-click range selection. Set on
  // every regular click; consulted on shift-click.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null)

  // editTarget: row currently shown in the per-row EditRowModal. The
  // modal reuses the ResourceConfig field definitions to render
  // editable fields generically (same shape as create, minus the
  // primary-key columns).
  const [editTarget, setEditTarget] = useState<Row | null>(null)

  // Selection is page-scoped. When the agent moves to a different
  // page, selected rows on the old page are no longer in the visible
  // `rows` array, so showing a selection toolbar would be misleading.
  // Simplest fix: clear on page change. (Filter/sort changes are
  // already handled below — they reset paging which cascades here.)
  useEffect(() => {
    setSelectedKeys(new Set())
    setLastSelectedKey(null)
  }, [page])

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

  // Clear the post-bulk-save summary the moment the agent edits again —
  // an "11 saved / 1 failed" banner from 30 seconds ago is misleading
  // once the dirty count starts changing.
  useEffect(() => {
    if (saveAllResult !== null && dirty.dirtyCount > 0) {
      setSaveAllResult(null)
    }
    // Intentionally only depending on dirtyCount: we want this to fire
    // when the count moves, not when the result itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // --- bulk save state ----
  // saveAll runs sequentially, surfacing progress inline. Set when the
  // agent clicks Save all; null when idle. saveAllResult holds the
  // post-run summary until the agent makes more changes (then it
  // clears, since the counts would be misleading).
  const [saveAllProgress, setSaveAllProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [saveAllResult, setSaveAllResult] = useState<{
    saved: number
    failed: number
    failedKeys: string[]
  } | null>(null)

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

  /**
   * Save one row. Returns { ok: true } on success or { ok: false, error }
   * on failure. Internally mutates dirty (clears the row on success) and
   * sets savingRowKey for spinner feedback.
   */
  async function saveOneRow(row: Row): Promise<{
    ok: boolean
    error?: string
  }> {
    const key = config.rowKey(row)
    const changes = dirty.getDirty(key)
    if (Object.keys(changes).length === 0) return { ok: true }

    setSavingRowKey(key)
    try {
      await updateM.mutateAsync({ idPath: config.buildId(row), changes })
      dirty.clearRow(key)
      return { ok: true }
    } catch (e) {
      console.error('save failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      setSavingRowKey(null)
    }
  }

  async function doSaveRow(row: Row) {
    await saveOneRow(row)
  }

  /**
   * Save every dirty row, sequentially. Continues past failures so we
   * always finish the batch — partial success is better than aborting
   * halfway and leaving the agent unsure of state. Progress updates
   * happen between rows; the final result lingers until the next edit.
   */
  async function doSaveAll() {
    const dirtyKeys = Object.keys(dirty.dirty)
    if (dirtyKeys.length === 0) return

    // The dirty map is keyed by config.rowKey(row), but to call the
    // update endpoint we need actual row objects (for config.buildId
    // and config.rowKey). Resolve from the current page's rows.
    const keyToRow = new Map<string, Row>()
    for (const r of rows) keyToRow.set(config.rowKey(r), r)
    const targets: Row[] = []
    const orphanedKeys: string[] = []
    for (const k of dirtyKeys) {
      const r = keyToRow.get(k)
      if (r) targets.push(r)
      else orphanedKeys.push(k)
    }
    // Orphaned dirty keys (changed on a previous page that's no longer
    // loaded) are counted as failures so they're visible — the agent
    // can paginate back and save them individually.
    setSaveAllProgress({ current: 0, total: targets.length })
    setSaveAllResult(null)

    let saved = 0
    const failedKeys: string[] = [...orphanedKeys]

    for (let i = 0; i < targets.length; i++) {
      // Pull the row into a local so TS narrows it from Row|undefined
      // (under noUncheckedIndexedAccess) to Row. The bound check above
      // guarantees it's defined.
      const target = targets[i]!
      setSaveAllProgress({ current: i + 1, total: targets.length })
      const result = await saveOneRow(target)
      if (result.ok) saved += 1
      else failedKeys.push(config.rowKey(target))
    }

    setSaveAllProgress(null)
    setSaveAllResult({
      saved,
      failed: failedKeys.length,
      failedKeys,
    })
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

  // --- cancel (customers): stamp cancelled_date with today ---
  const cancelM = useMutation({
    mutationFn: (row: Row) =>
      updateResource(config.slug, config.buildId(row), {
        cancelled_date: localToday(),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [config.slug] })
    },
  })

  async function confirmCancel() {
    if (!cancelTarget) return
    try {
      await cancelM.mutateAsync(cancelTarget)
      setCancelTarget(null)
    } catch (e) {
      console.error('cancel failed', e)
    }
  }

  // --- selection handlers ---
  /**
   * Toggle one row's selection state. Clears any in-progress shift
   * range — agents who click without shift should get a single-pick
   * behavior, with the click also setting the new anchor.
   */
  /**
   * Replace the entire selection with a specific set of keys. Used by
   * the header select-all checkbox; bypasses the per-row replace
   * semantics in onToggleSelect, which is meant for direct row clicks.
   */
  function onSetSelection(keys: string[]) {
    setSelectedKeys(new Set(keys))
    setLastSelectedKey(keys.length > 0 ? (keys[keys.length - 1] ?? null) : null)
  }

  /**
   * Plain click on a row's checkbox.
   *
   * Replace semantics: clicking always sets the selection to exactly
   * this row, regardless of what was selected before. The exception is
   * clicking a row that's ALREADY the lone selection — that deselects
   * it (so the agent has a way to "unselect everything" with a click).
   *
   * To accumulate selection across rows, use shift+click for a range.
   * Use the header checkbox to select/deselect everything on the page.
   */
  function onToggleSelect(row: Row) {
    const key = config.rowKey(row)
    setSelectedKeys((prev) => {
      // Lone selection of this same row → toggle off.
      if (prev.size === 1 && prev.has(key)) return new Set()
      // Otherwise: replace with just this row.
      return new Set([key])
    })
    setLastSelectedKey(key)
  }

  /**
   * Shift-click selects every row between the anchor and the clicked
   * row, inclusive. The range is computed against the currently
   * visible rows[] (post-sort, post-filter), so it matches what the
   * agent sees. If there's no anchor yet, falls back to a normal
   * toggle.
   */
  function onShiftSelect(row: Row) {
    const key = config.rowKey(row)
    if (!lastSelectedKey || lastSelectedKey === key) {
      onToggleSelect(row)
      return
    }
    const keys = rows.map((r) => config.rowKey(r))
    const start = keys.indexOf(lastSelectedKey)
    const end = keys.indexOf(key)
    if (start < 0 || end < 0) {
      // Anchor isn't on the current page. Degrade to a plain toggle.
      onToggleSelect(row)
      return
    }
    const [lo, hi] = start < end ? [start, end] : [end, start]
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (let i = lo; i <= hi; i++) next.add(keys[i]!)
      return next
    })
    setLastSelectedKey(key)
  }

  function onClearSelection() {
    setSelectedKeys(new Set())
    setLastSelectedKey(null)
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

  // When the table is filtered by a single customer Code, seed the create
  // modal's customer with it (only when that filter actually returned rows).
  const filteredCustomerCode = useMemo(() => {
    const f = filters.find(
      (x) =>
        x.column === 'customer_code' &&
        x.operator === 'eq' &&
        typeof x.value === 'number',
    )
    return f && typeof f.value === 'number' ? f.value : null
  }, [filters])

  return (
    // Flex column filling the tab area. Header / toolbar / banners /
    // pagination are fixed-height; the ResourceTable flexes to fill and is
    // the only scrolling region.
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <header className="shrink-0">
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

      {/* Unsaved-changes / save-all banner. Shows in three flavors:
            1. Idle with dirty rows  → counts + "Save all changes" button
            2. Mid-batch save        → "Saving 3 of 12..."
            3. Post-batch summary    → "11 saved, 1 failed" (until next edit)
          We keep this all in one slot so the layout doesn't jump. */}
      {saveAllProgress !== null ? (
        <div className="rounded-md border border-secondary-500/40 bg-secondary-100/40 px-3 py-2 text-sm text-gray-900">
          Saving {saveAllProgress.current} of {saveAllProgress.total}…
        </div>
      ) : saveAllResult !== null ? (
        <div
          className={clsx(
            'rounded-md border px-3 py-2 text-sm text-gray-900',
            saveAllResult.failed === 0
              ? 'border-secondary-500/40 bg-secondary-100/40'
              : 'border-error-600/40 bg-error-100/40',
          )}
        >
          {saveAllResult.failed === 0
            ? `Saved ${saveAllResult.saved} row${saveAllResult.saved === 1 ? '' : 's'}.`
            : `${saveAllResult.saved} saved, ${saveAllResult.failed} failed. The failed rows are still marked dirty — try saving them individually for the error detail.`}
        </div>
      ) : dirty.dirtyCount > 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm text-gray-900">
          <span className="flex-1">
            {dirty.dirtyCount} unsaved change
            {dirty.dirtyCount === 1 ? '' : 's'} across{' '}
            {Object.keys(dirty.dirty).length} row
            {Object.keys(dirty.dirty).length === 1 ? '' : 's'}.
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => dirty.clearAll()}
          >
            Discard all
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void doSaveAll()}
          >
            Save all changes
          </button>
        </div>
      ) : null}

      {/* Selection toolbar: appears whenever ≥1 row is selected. Bulk
          delete was removed — selection is kept for visibility only. */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-secondary-500/40 bg-secondary-100/40 px-3 py-2 text-sm text-gray-900">
          <span className="flex-1">
            {selectedKeys.size} row{selectedKeys.size === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClearSelection}
          >
            Clear
          </button>
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
        onCancelRow={
          config.allowCancel ? (row) => setCancelTarget(row) : undefined
        }
        savingRowKey={savingRowKey}
        selectedKeys={selectedKeys}
        onToggleSelect={onToggleSelect}
        onSetSelection={onSetSelection}
        onShiftSelect={onShiftSelect}
        onOpenEditModal={(row) => setEditTarget(row)}
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
          initialCustomerCode={
            filteredCustomerCode != null && rows.length > 0
              ? filteredCustomerCode
              : null
          }
          onClose={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}

      {deleteTarget && config.allowDelete && (
        <DeleteConfirmModal
          slug={config.slug}
          recId={Number(deleteTarget.rec_id)}
          entityLabel={config.deleteEntityLabel ?? 'this row'}
          tableName={config.deleteTableName ?? config.slug}
          impactKind={config.deleteImpactKind ?? 'none'}
          rowDescription={
            `${deleteTarget.database_name ?? 'dataset'} ` +
            `(customer ${deleteTarget.customer_code})`
          }
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          isDeleting={deleteM.isPending}
        />
      )}

      {cancelTarget && config.allowCancel && (
        <CancelConfirmModal
          rowDescription={`${cancelTarget.customer_name ?? 'customer'} (code ${cancelTarget.customer_code})`}
          today={localToday()}
          onClose={() => setCancelTarget(null)}
          onConfirm={confirmCancel}
          isPending={cancelM.isPending}
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

      {editTarget && (
        <EditRowModal
          config={config}
          row={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}