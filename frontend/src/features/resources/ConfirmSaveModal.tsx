/**
 * Save-confirm modal. Only rendered when the ENABLE_EDIT_CONFIRMATION
 * flag is on — otherwise saves go through immediately on click.
 *
 * Shows a diff of old → new values for each dirty field on the row so the
 * agent can sanity-check before PATCH.
 */
import type { ColumnDef } from './resourceConfigs'
import { ModalShell } from './ModalShell'

interface ConfirmSaveModalProps {
  rowSummary: string
  changes: Record<string, unknown>
  originalRow: Record<string, unknown>
  columns: ColumnDef[]
  onCancel: () => void
  onConfirm: () => void
  isSaving: boolean
}

export function ConfirmSaveModal({
  rowSummary,
  changes,
  originalRow,
  columns,
  onCancel,
  onConfirm,
  isSaving,
}: ConfirmSaveModalProps) {
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const entries = Object.entries(changes)

  return (
    <ModalShell onClose={isSaving ? () => {} : onCancel} locked={isSaving}>
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Confirm changes</h2>
        <p className="mt-1 text-xs text-gray-500">{rowSummary}</p>

        <div className="mt-4 border border-divider rounded-md divide-y divide-divider">
          {entries.map(([col, newVal]) => {
            const def = byKey.get(col)
            return (
              <div key={col} className="p-3 text-sm">
                <div className="text-xs text-gray-500">
                  {def?.label ?? col}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-gray-500 line-through font-mono text-xs">
                    {fmt(originalRow[col])}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-900 font-medium font-mono text-xs">
                    {fmt(newVal)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Confirm and save'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}
