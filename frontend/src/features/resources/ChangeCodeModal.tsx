/**
 * Change a customer's code.
 *
 * customer_code is the primary key AND the business key every other table
 * carries, so this can't be an inline edit or a PATCH like other columns —
 * it goes to a dedicated endpoint that guards uniqueness and renumbers
 * secure.customer_users / customer_dataset / ppi_dataset in one
 * transaction. See backend app/api/customers.py.
 *
 * The impact query shows how many rows move with the customer before the
 * agent commits. The "already in use" guard lives on the server (409); the
 * checks here are only about not sending an obviously bad request.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { changeCustomerCode, fetchChangeCodeImpact } from '@/api/resources'

import { ModalShell } from './ModalShell'

interface ChangeCodeModalProps {
  customerCode: number
  customerName: string | null
  onClose: () => void
  onChanged: (newCode: number) => void
}

/** Child-table labels the backend reports counts under. */
const IMPACT_LABELS: Record<string, string> = {
  customer_users: 'user',
  customer_datasets: 'discharge database row',
  ppi_datasets: 'claim database row',
}

export function ChangeCodeModal({
  customerCode,
  customerName,
  onClose,
  onChanged,
}: ChangeCodeModalProps) {
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')

  const impact = useQuery({
    queryKey: ['change-code-impact', customerCode],
    queryFn: () => fetchChangeCodeImpact(customerCode),
    staleTime: 0,
  })

  const m = useMutation({
    mutationFn: (newCode: number) => changeCustomerCode(customerCode, newCode),
    onSuccess: (res) => {
      // Every tab displays customer_code and the child tabs join on it, so
      // a renumber invalidates all of them — not just Customers.
      for (const slug of [
        'customers',
        'customer-users',
        'customer-datasets',
        'ppi-datasets',
      ]) {
        qc.invalidateQueries({ queryKey: [slug] })
      }
      qc.invalidateQueries({ queryKey: ['customer-picker'] })
      qc.invalidateQueries({ queryKey: ['customers-brief'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      // Claim create form's "states this customer already has" lookup is
      // keyed by customer_code, so it goes stale on a renumber too.
      qc.invalidateQueries({ queryKey: ['multi-picker-exclude'] })
      onChanged(res.customer_code)
    },
  })

  // Client-side checks: shape only. Uniqueness is the server's call.
  const parsed = raw.trim() === '' ? null : Number(raw)
  const localError =
    parsed === null
      ? null
      : !Number.isInteger(parsed) || parsed < 1
        ? 'Enter a positive whole number.'
        : parsed === customerCode
          ? 'That is already this customer’s code.'
          : null
  const canSubmit = parsed !== null && localError === null && !m.isPending

  function submit() {
    if (parsed === null || localError !== null || m.isPending) return
    m.mutate(parsed)
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
      <h2 className="text-base font-semibold text-gray-900">
        Change customer code
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Moving{' '}
        <span className="font-medium text-gray-900">
          {customerName ?? 'this customer'}
        </span>{' '}
        off code <span className="font-mono">{customerCode}</span>. Everything
        attached to the customer is renumbered with it, in one transaction.
      </p>

      <div className="mt-4 space-y-1">
        <label className="label" htmlFor="new-customer-code">
          New code
        </label>
        <input
          id="new-customer-code"
          type="number"
          min={1}
          autoFocus
          className={`input ${localError ? 'input-error' : ''}`}
          value={raw}
          disabled={m.isPending}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        {localError && (
          <div className="text-[11px] text-error-600">{localError}</div>
        )}
      </div>

      <div className="mt-4 rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm">
        <div className="font-medium text-gray-900">Moves with the customer</div>
        <div className="mt-1 text-xs text-gray-700">
          {impact.isLoading && 'Counting rows…'}
          {impact.isError &&
            'Could not count the attached rows. They are still renumbered — the change cascades server-side.'}
          {impact.data && <ImpactList counts={impact.data.counts} />}
        </div>
      </div>

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
          {m.isPending ? 'Changing…' : 'Change code'}
        </button>
      </div>
    </ModalShell>
  )
}

/**
 * Renders the per-table counts. Keys come from the server so a future
 * child table shows up here without a frontend change — an unmapped key
 * falls back to its raw label.
 */
function ImpactList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts)
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  if (total === 0) {
    return <>Nothing else references this code — only the customer row moves.</>
  }
  return (
    <ul className="space-y-0.5">
      {entries
        .filter(([, n]) => n > 0)
        .map(([key, n]) => {
          const label = IMPACT_LABELS[key] ?? key
          return (
            <li key={key}>
              <span className="font-medium">{n}</span> {label}
              {n === 1 ? '' : 's'}
            </li>
          )
        })}
    </ul>
  )
}
