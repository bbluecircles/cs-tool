/**
 * Move a user to a different customer.
 *
 * customer_code is half the composite PK of secure.customer_users, so this
 * isn't an inline edit or a PATCH — it posts to a dedicated endpoint that
 * checks the target customer exists and guards the PK. See backend
 * app/api/customer_users.py.
 *
 * Two things the agent needs to know before confirming, both surfaced
 * below rather than handled automatically:
 *   - the user inherits the NEW customer's databases, and their lookup
 *     rows are dropped until grants are re-run for that customer;
 *   - MariaDB privileges for the OLD customer's databases are not revoked
 *     by this action (nothing in the tool revokes a single database from
 *     an active user).
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { useConfig } from '@/api/config'
import { changeUserCustomer } from '@/api/resources'

import { CustomerSearchSelect } from './CustomerSearchSelect'
import { ModalShell } from './ModalShell'

interface ChangeCustomerModalProps {
  userId: string
  currentCustomerCode: number
  currentCustomerName: string | null
  onClose: () => void
  onChanged: () => void
}

export function ChangeCustomerModal({
  userId,
  currentCustomerCode,
  currentCustomerName,
  onClose,
  onChanged,
}: ChangeCustomerModalProps) {
  const qc = useQueryClient()
  const clientConfig = useConfig()
  const [target, setTarget] = useState<number | null>(null)

  const adminCodes = (clientConfig.data?.admin_customer_codes ?? '')
    .split(',')
    .map((c) => Number(c.trim()))
    .filter((c) => Number.isFinite(c))

  const m = useMutation({
    mutationFn: (newCode: number) =>
      changeUserCustomer(userId, currentCustomerCode, newCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-users'] })
      onChanged()
    },
  })

  const sameAsCurrent = target !== null && target === currentCustomerCode
  const canSubmit = target !== null && !sameAsCurrent && !m.isPending
  // Moving onto an admin code is legitimate (it's how a CS agent is
  // onboarded), so this warns rather than blocks.
  const targetIsAdmin = target !== null && adminCodes.includes(target)

  function submit() {
    if (target === null || sameAsCurrent || m.isPending) return
    m.mutate(target)
  }

  const submitError =
    m.error instanceof ApiError
      ? m.error.message
      : m.error instanceof Error
        ? m.error.message
        : null

  return (
    <ModalShell
      onClose={m.isPending ? () => {} : onClose}
      locked={m.isPending}
      width="max-w-md"
    >
      <h2 className="text-base font-semibold text-gray-900">Change customer</h2>
      <p className="mt-2 text-sm text-gray-600">
        Moving <span className="font-mono text-gray-900">{userId}</span> off{' '}
        <span className="font-medium text-gray-900">
          {currentCustomerName ?? `customer ${currentCustomerCode}`}
        </span>{' '}
        <span className="text-gray-500">(code {currentCustomerCode})</span>.
      </p>

      <div className="mt-4 space-y-1">
        <label className="label">New customer</label>
        <CustomerSearchSelect
          value={target}
          onChange={setTarget}
          disabled={m.isPending}
          invalid={sameAsCurrent}
          markCancelled
        />
        {sameAsCurrent && (
          <div className="text-[11px] text-error-600">
            That’s the customer they’re already assigned to.
          </div>
        )}
      </div>

      <div className="mt-4 rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-xs text-gray-700">
        <div className="text-sm font-medium text-gray-900">
          What this changes
        </div>
        <ul className="mt-1 space-y-1">
          <li>
            The user picks up the new customer’s discharge and claim
            databases. Those rows belong to the customer, so nothing moves
            with the user.
          </li>
          <li>
            Their lookup rows are removed until you{' '}
            <span className="font-medium">Run grants</span> for the new
            customer, which rebuilds them. Until then the user can’t get in.
          </li>
          <li>
            Database privileges already granted for the{' '}
            <span className="font-medium">old</span> customer are{' '}
            <span className="font-medium">not</span> revoked here — that
            needs a DBA, or disabling the user and running Remove grants.
          </li>
        </ul>
      </div>

      {targetIsAdmin && (
        <div className="mt-3 rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-xs text-gray-800">
          Heads up: code {target} is an admin customer code, so this user
          becomes a CS-tool admin once grants are re-run.
        </div>
      )}

      {submitError && (
        <div className="mt-4 rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
          {submitError}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={m.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={submit}
          disabled={!canSubmit}
        >
          {m.isPending ? 'Moving…' : 'Move user'}
        </button>
      </div>
    </ModalShell>
  )
}
