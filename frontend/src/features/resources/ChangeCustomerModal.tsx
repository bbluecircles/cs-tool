/**
 * Move a user to a different customer.
 *
 * customer_code is half the composite PK of secure.customer_users, so this
 * isn't an inline edit or a PATCH — it posts to a dedicated endpoint that
 * checks the target customer exists and guards the PK. See backend
 * app/api/customer_users.py.
 *
 * The move always drops the user's MariaDB account — the only way this
 * system clears privileges, since there is no partial revoke. This was
 * briefly an opt-out checkbox; it isn't any more. Keeping the account
 * would leave the user holding live SELECT on the previous customer's
 * databases (reachable from ODBC, BIRT, any SQL client) while the tool's
 * UI showed no such access, because the lookup rows are purged either
 * way. Concealed access is the one outcome worse than granting or
 * removing it outright.
 *
 * The follow-up is one step: Run grants for the new customer.
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
  // Admin code awaiting confirmation — non-null while the nested confirm
  // is up. Separate from `acknowledgedAdmin` so declining can distinguish
  // "asked and refused" from "never asked".
  const [pendingAdmin, setPendingAdmin] = useState<number | null>(null)
  const [acknowledgedAdmin, setAcknowledgedAdmin] = useState<number | null>(
    null,
  )

  const adminCodes = (clientConfig.data?.admin_customer_codes ?? '')
    .split(',')
    .map((c) => Number(c.trim()))
    .filter((c) => Number.isFinite(c))

  /**
   * Picking an admin customer makes this user a CS-tool admin, so it asks
   * before accepting the selection rather than noting it further down the
   * form where it's easy to skim past. Re-prompts when the agent switches
   * to a DIFFERENT admin code; staying on one they already confirmed
   * doesn't nag.
   */
  function handleTargetChange(v: number | null) {
    setTarget(v)
    if (v !== null && adminCodes.includes(v) && v !== acknowledgedAdmin) {
      setPendingAdmin(v)
    }
  }

  function confirmAdmin() {
    setAcknowledgedAdmin(pendingAdmin)
    setPendingAdmin(null)
  }

  /** Declining clears the picker so no admin code is left staged. */
  function declineAdmin() {
    setTarget(null)
    setAcknowledgedAdmin(null)
    setPendingAdmin(null)
  }

  const m = useMutation({
    mutationFn: (newCode: number) =>
      changeUserCustomer(userId, currentCustomerCode, newCode),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['customer-users'] })
      // The move committed even if the post-commit revoke failed. Hold the
      // modal open in that case so the agent sees they need to clear the
      // old privileges by hand; otherwise close as usual.
      if (!res.revoke_ok) return
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
    target !== null &&
    !sameAsCurrent &&
    !m.isPending &&
    !moved &&
    pendingAdmin === null
  // Moving onto an admin code is legitimate — it's how a CS agent gets
  // onboarded — so it's confirmed, not blocked.
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
      // Locked while the admin confirm is up so a single Escape or
      // backdrop click resolves that dialog only. Both shells register a
      // window keydown listener, so without this Escape would decline the
      // confirm AND close this modal in one press.
      locked={m.isPending || pendingAdmin !== null}
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
          onChange={handleTargetChange}
          disabled={m.isPending || moved}
          invalid={sameAsCurrent}
          markCancelled
        />
        {sameAsCurrent && (
          <div className="text-[11px] text-error-600">
            That’s the customer they’re already assigned to.
          </div>
        )}
        {targetIsAdmin && acknowledgedAdmin === target && (
          <div className="text-[11px] text-warning-600">
            Admin customer — confirmed. This user becomes a CS-tool admin.
          </div>
        )}
      </div>

      <div className="mt-4 rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-xs text-gray-700">
        <div className="text-sm font-medium text-gray-900">
          What this changes
        </div>
        <ul className="mt-1 space-y-1">
          <li>
            Their existing database access is revoked — the MariaDB account
            is dropped, so no privileges carry over from{' '}
            {currentCustomerName ?? 'the old customer'}.
          </li>
          <li>
            The user picks up the new customer’s discharge and claim
            databases. Those rows belong to the customer, so nothing moves
            with the user.
          </li>
          <li>
            They can’t get in until you run{' '}
            <span className="font-medium">Admin → Run grants</span> for the
            new customer, which recreates the account with the same
            password and rebuilds their lookup rows.
          </li>
        </ul>
      </div>

      {submitError && (
        <div className="mt-4 rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
          {submitError}
        </div>
      )}

      {m.data && !m.data.revoke_ok && (
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

      {pendingAdmin !== null && (
        <AdminCustomerConfirm
          userId={userId}
          code={pendingAdmin}
          onConfirm={confirmAdmin}
          onDecline={declineAdmin}
        />
      )}
    </ModalShell>
  )
}

/**
 * Nested confirm for picking an admin customer. Kept in this file rather
 * than factored out — it's meaningless outside this flow, and it reads
 * from the same admin-code semantics the parent already owns.
 *
 * Rendered INSIDE the parent ModalShell so it sits above it in DOM order
 * (both shells use the same z-index). The parent is passed locked while
 * this is open, so Escape and backdrop clicks land here only.
 */
function AdminCustomerConfirm({
  userId,
  code,
  onConfirm,
  onDecline,
}: {
  userId: string
  code: number
  onConfirm: () => void
  onDecline: () => void
}) {
  return (
    <ModalShell onClose={onDecline} width="max-w-sm">
      <h2 className="text-base font-semibold text-gray-900">
        Grant admin access?
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Code <span className="font-mono text-gray-900">{code}</span> is an
        admin customer. Moving{' '}
        <span className="font-mono text-gray-900">{userId}</span> there makes
        them a <span className="font-medium">CS-tool admin</span> — full
        access to this tool, including grants and the audit log — once
        grants are re-run.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDecline}>
          No, pick another
        </button>
        <button type="button" className="btn-primary" onClick={onConfirm}>
          Yes, make them an admin
        </button>
      </div>
    </ModalShell>
  )
}
