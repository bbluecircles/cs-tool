/**
 * Confirm Changes modal.
 *
 * Opened when a CS agent clicks Save on a row with dirty fields. We call
 * /preview first to get impact counts per change, then show a diff with
 * scope warnings. Confirm → /apply; close → keep dirty state so they can
 * keep editing.
 */
import { useEffect, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  applyChanges,
  ApplyResponse,
  ChangeImpact,
  EditScope,
  previewChanges,
} from '@/api/edits'
import { ApiError } from '@/api/client'

interface ConfirmChangesModalProps {
  userId: string
  databaseName: string
  customerCode: number
  changes: Record<string, unknown>
  onClose: () => void
  /** Called with the apply response on success. */
  onApplied: (result: ApplyResponse) => void
}

export function ConfirmChangesModal({
  userId,
  databaseName,
  customerCode,
  changes,
  onClose,
  onApplied,
}: ConfirmChangesModalProps) {
  const preview = useQuery({
    queryKey: [
      'edit-preview',
      userId,
      databaseName,
      customerCode,
      // Stable key: sorted entries so identical change sets share a cache entry
      JSON.stringify(sortEntries(changes)),
    ],
    queryFn: () =>
      previewChanges(userId, databaseName, customerCode, changes),
    retry: false,
  })

  const apply = useMutation({
    mutationFn: () =>
      applyChanges(userId, databaseName, customerCode, changes),
    onSuccess: (res) => onApplied(res),
  })

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !apply.isPending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, apply.isPending])

  const previewError =
    preview.error instanceof ApiError
      ? preview.error.message
      : preview.error instanceof Error
        ? preview.error.message
        : null

  const applyError =
    apply.error instanceof ApiError
      ? apply.error.message
      : apply.error instanceof Error
        ? apply.error.message
        : null

  const impacts = preview.data?.impacts ?? []
  const hasScopeWarning = useMemo(
    () => impacts.some((i) => i.scope !== 'user' || i.affected_row_count > 1),
    [impacts],
  )

  return (
    <ModalShell onClose={apply.isPending ? () => {} : onClose}>
      <h2 className="text-lg font-semibold text-gray-900">Confirm changes</h2>
      <p className="mt-1 text-sm text-gray-500">
        Review each change and the rows it affects before applying.
      </p>

      <div className="mt-4 space-y-2">
        {preview.isLoading && (
          <div className="text-sm text-gray-500">Calculating impact…</div>
        )}
        {previewError && (
          <div className="rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
            {previewError}
          </div>
        )}
        {impacts.map((impact) => (
          <ChangeRow key={impact.column} impact={impact} />
        ))}
      </div>

      {hasScopeWarning && !previewError && (
        <div className="mt-4 rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm text-gray-900">
          Some of these changes affect multiple users or datasets. Double-check
          the row counts before confirming.
        </div>
      )}

      {applyError && (
        <div className="mt-4 rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
          {applyError}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={onClose}
          disabled={apply.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => apply.mutate()}
          disabled={
            preview.isLoading || !!previewError || apply.isPending
          }
        >
          {apply.isPending ? 'Applying…' : 'Confirm & apply'}
        </button>
      </div>
    </ModalShell>
  )
}

function ChangeRow({ impact }: { impact: ChangeImpact }) {
  return (
    <div className="rounded-md border border-border bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-xs text-gray-700">{impact.column}</div>
        <ScopeBadge scope={impact.scope} count={impact.affected_row_count} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <ValueChip>{formatValue(impact.old_value)}</ValueChip>
        <span className="text-gray-400">→</span>
        <ValueChip highlight>{formatValue(impact.new_value)}</ValueChip>
      </div>
    </div>
  )
}

function ScopeBadge({
  scope,
  count,
}: {
  scope: EditScope
  count: number
}) {
  const label =
    scope === 'user'
      ? count > 1
        ? `affects ${count} rows for this user`
        : 'user only'
      : scope === 'customer'
        ? `affects ${count} rows across this customer`
        : `affects ${count} rows on this dataset`
  const tone =
    scope === 'user' && count <= 1
      ? 'bg-info-100 text-info-600'
      : 'bg-warning-100 text-warning-600'
  return (
    <span
      className={clsx(
        'rounded px-2 py-0.5 text-[11px] font-medium',
        tone,
      )}
    >
      {label}
    </span>
  )
}

function ValueChip({
  children,
  highlight,
}: {
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <span
      className={clsx(
        'font-mono rounded px-1.5 py-0.5 text-[11px]',
        highlight
          ? 'bg-secondary-100 text-secondary-700'
          : 'bg-white text-gray-700 border border-border',
      )}
    >
      {children}
    </span>
  )
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '(null)'
  if (v === '') return '(empty)'
  return String(v)
}

function sortEntries(obj: Record<string, unknown>) {
  return Object.keys(obj)
    .sort()
    .map((k) => [k, obj[k]])
}

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-xl p-6 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/** Sync-result banner for after the save completes. */
export function SyncResultToast({
  result,
  onDismiss,
}: {
  result: ApplyResponse
  onDismiss: () => void
}) {
  const both = result.refresh_ok && result.grants_ok
  const tone = both ? 'bg-success-100 text-success-600' : 'bg-warning-100 text-warning-600'
  return (
    <div
      className={clsx(
        'fixed bottom-4 right-4 z-40 rounded-md border px-4 py-3 shadow-card max-w-sm',
        both ? 'border-success-600/30' : 'border-warning-600/30',
        tone,
      )}
    >
      <div className="font-medium">
        {both ? 'Saved and synced.' : 'Saved, sync incomplete'}
      </div>
      {!both && (
        <div className="mt-1 text-xs text-gray-900">
          {!result.refresh_ok && (
            <div>Refresh failed: {result.refresh_error}</div>
          )}
          {!result.grants_ok && (
            <div>Grants failed: {result.grants_error}</div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs underline"
      >
        Dismiss
      </button>
    </div>
  )
}
