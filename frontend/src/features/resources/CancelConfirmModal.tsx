/**
 * Confirm setting a customer's cancelled date to today. Used by the Cancel
 * row action on the Customers tab.
 */
import { ModalShell } from './ModalShell'

interface CancelConfirmModalProps {
  rowDescription: string
  today: string
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}

export function CancelConfirmModal({
  rowDescription,
  today,
  onConfirm,
  onClose,
  isPending,
}: CancelConfirmModalProps) {
  return (
    <ModalShell onClose={onClose} width="max-w-md" locked={isPending}>
      <h2 className="text-base font-semibold text-gray-900">Cancel customer?</h2>
      <p className="mt-2 text-sm text-gray-600">
        This sets the cancelled date for{' '}
        <span className="font-medium text-gray-900">{rowDescription}</span> to{' '}
        <span className="font-medium text-gray-900">{today}</span>. It doesn’t
        delete anything — you can clear or change the Cancelled field later by
        editing the row.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={isPending}
        >
          Keep as is
        </button>
        <button
          type="button"
          className="rounded-md bg-warning-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-warning-600/90 disabled:opacity-50"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? 'Setting…' : 'Set cancelled date'}
        </button>
      </div>
    </ModalShell>
  )
}
