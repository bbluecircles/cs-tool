/**
 * Delete-confirm modal.
 *
 * Two flavors, driven by `impactKind`:
 *   - 'customer_dataset' : fetches /delete-impact and shows the active-
 *                          user count for the customer. The dataset row
 *                          is gone immediately, but its users' rows in
 *                          the user_details views drop out on the next
 *                          refresh — the agent needs to see that.
 *   - 'none'             : no fetch, plain confirm. Used for resources
 *                          with no per-row downstream fanout (PPI).
 *
 * The caller supplies the human-readable row description and the entity
 * label (e.g. "dataset", "PPI row"); copy elsewhere stays generic so a
 * future resource with delete doesn't need yet another component.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchDeleteImpact } from '@/api/resources'
import { ModalShell } from './ModalShell'

interface DeleteConfirmModalProps {
  slug: string
  recId: number
  /** Short human-readable label for what's being deleted, e.g. "this dataset" or "this PPI row". */
  entityLabel: string
  /** Specific row summary, e.g. "TX-Demo (customer 15)". */
  rowDescription: string
  /** Backing table for the row, shown in monospace to make the action concrete. */
  tableName: string
  /** Drives whether the impact section is rendered. */
  impactKind: 'customer_dataset' | 'none'
  onClose: () => void
  onConfirm: () => void
  isDeleting: boolean
}

export function DeleteConfirmModal({
  slug,
  recId,
  entityLabel,
  rowDescription,
  tableName,
  impactKind,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteConfirmModalProps) {
  return (
    <ModalShell
      onClose={isDeleting ? () => {} : onClose}
      locked={isDeleting}
      width="max-w-md"
    >
      <div>
        <h2 className="text-lg font-semibold text-error-600">
          Delete {entityLabel} permanently?
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          You're about to delete{' '}
          <span className="font-medium">{rowDescription}</span>. This is a hard
          delete — the row is removed from{' '}
          <span className="font-mono text-xs">{tableName}</span>{' '}
          and can't be undone.
        </p>

        {impactKind === 'customer_dataset' && (
          <CustomerDatasetImpact slug={slug} recId={recId} />
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

/**
 * Customer-dataset specific impact section. Kept inline rather than
 * factored out further — there's exactly one variant today, and a
 * second sub-component would cost more than it saves.
 */
function CustomerDatasetImpact({
  slug,
  recId,
}: {
  slug: string
  recId: number
}) {
  const impact = useQuery({
    queryKey: ['delete-impact', slug, recId],
    queryFn: () => fetchDeleteImpact(slug, recId),
    staleTime: 0,
  })

  return (
    <div className="mt-4 rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm">
      <div className="font-medium text-gray-900">Impact</div>
      <div className="mt-1 text-xs text-gray-700">
        {impact.isLoading && 'Checking impact…'}
        {impact.isError && 'Could not determine impact. Proceed with caution.'}
        {impact.data && (
          <>
            This dataset belongs to customer{' '}
            <span className="font-mono">
              {impact.data.customer_code}
            </span>
            , which currently has{' '}
            <span className="font-medium">
              {impact.data.active_user_count}
            </span>{' '}
            active user
            {impact.data.active_user_count === 1 ? '' : 's'}. Their
            rows for this dataset will drop out of the user_details views
            on the next refresh.
          </>
        )}
      </div>
    </div>
  )
}