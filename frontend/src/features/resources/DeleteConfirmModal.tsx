/**
 * Delete-confirm modal for customer_dataset rows.
 *
 * Fetches the delete-impact (active user count on the customer) so the
 * agent sees the real downstream effect before committing. The customer
 * won't be deleted, but users on that dataset will lose its row in the
 * user_details views on the next view refresh.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchDeleteImpact } from '@/api/resources'
import { ModalShell } from './ModalShell'

interface DeleteConfirmModalProps {
  slug: string
  recId: number
  rowDescription: string
  onClose: () => void
  onConfirm: () => void
  isDeleting: boolean
}

export function DeleteConfirmModal({
  slug,
  recId,
  rowDescription,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteConfirmModalProps) {
  const impact = useQuery({
    queryKey: ['delete-impact', slug, recId],
    queryFn: () => fetchDeleteImpact(slug, recId),
    staleTime: 0,
  })

  return (
    <ModalShell
      onClose={isDeleting ? () => {} : onClose}
      locked={isDeleting}
      width="max-w-md"
    >
      <div>
        <h2 className="text-lg font-semibold text-error-600">
          Delete dataset permanently?
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          You're about to delete{' '}
          <span className="font-medium">{rowDescription}</span>. This is a hard
          delete — the row is removed from{' '}
          <span className="font-mono text-xs">secure.customer_dataset</span>{' '}
          and can't be undone.
        </p>

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
