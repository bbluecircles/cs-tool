/**
 * Move a user to a different customer.
 *
 * customer_code is half the composite PK of secure.customer_users, so this
 * isn't an inline edit or a PATCH — it posts to a dedicated endpoint that
 * checks the target customer exists and guards the PK. See backend
 * app/api/customer_users.py.
 *
 * The "revoke existing access" checkbox drops the user's MariaDB account
 * as part of the move, which is the only way this system clears
 * privileges — there is no partial revoke. It defaults on because the
 * move costs the user access either way (their lookup rows are purged
 * regardless), so revoking adds no downtime and leaves a cleaner state.
 * Uncheck it when moving between related customers that should keep
 * sharing database access.
 *
 * Either way the follow-up is one step: Run grants for the new customer.
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
  const [revokeAccess, setRevokeAccess] = useState(true)

  const adminCodes = (clientConfig.data?.admin_customer_codes ?? '')
    .split(',')
    .map((c) => Number(c.trim()))
    .filter((c) => Number.isFinite(c))

  const m = useMutation({
    mutationFn: (newCode: number) =>
      changeUserCustomer(userId, currentCustomerCode, newCode, revokeAccess),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['customer-users'] })
      // The move committed even if the post-commit revoke failed. Hold the
      // modal open in that case so the agent sees they need to clear the
      // old privileges by hand; otherwise close as usual.
      if (res.revoke_attempted && !res.revoke_ok) return
      onChanged()
    },
  })

  // Set once the move has committed. The modal only stays open in that
  // state when the follow-up revoke failed, so the form must lock: the
  // user no longer exists under currentCustomerCode and re-submitting
  // would 404.
  const moved = m.isSuccess
  const sameAsCurrent = target !== null && target === currentCustomerCode
  const canSubmit =
    target !== null && !sameAsCurrent && !m.isPending && !moved
  // Moving onto an admin code is legitimate (it's how a CS agent is
  // onboarded), so this warns rather than blocks.
  const targetIsAdmin = target !== null && adminCodes.includes(target)

  function submit() {
    if (!canSubmit || target === null) return
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
          disabled={m.isPending || moved}
          invalid={sameAsCurrent}
          markCancelled
        />
        {sameAsCurrent && (
          <div className="text-[11px] text-error-600">
            That’s the customer they’re already assigned to.
          </div>
        )}
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={revokeAccess}
          disabled={m.isPending || moved}
          onChange={(e) => setRevokeAccess(e.target.checked)}
        />
        <span>
          Revoke their existing access
          <span className="block text-xs text-gray-500">
            Drops the account, clearing privileges for the old
            customer’s databases. Run grants recreates it with the same
            password. Uncheck to keep the old access.
          </span>
        </span>
      </label>

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
            They can’t get in until you run{' '}
            <span className="font-medium">Admin → Run grants</span> for the
            new customer, which rebuilds their lookup rows
            {revokeAccess ? ' and their account' : ''}.
          </li>
          {!revokeAccess && (
            <li>
              Privileges already granted for the{' '}
              <span className="font-medium">old</span> customer’s databases
              stay in place.
            </li>
          )}
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

      {m.data?.revoke_attempted && !m.data.revoke_ok && (
        <div className="mt-4 rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
          <span className="font-medium">
            The user was moved, but the revoke failed.
          </span>{' '}
          They still hold their old database privileges — clear the account
          by hand before running grants. {m.data.revoke_error}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {moved ? (
          // The move already committed (only the revoke failed), so there's
          // nothing left to confirm or cancel — just acknowledge and close
          // through onChanged so the parent clears the stale row state.
          <button type="button" className="btn-primary" onClick={onChanged}>
            Close
          </button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </ModalShell>
  )
}
