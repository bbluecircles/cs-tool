import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  listAudit,
  retryGrants,
  retryRevokes,
  type RetryResponse,
} from '@/api/admin'
import { CustomerSearchSelect } from '@/features/resources/CustomerSearchSelect'

export function AdminPage() {
  return (
    <div className="space-y-6">
      <SyncCard />
      <AuditCard />
    </div>
  )
}

function SyncCard() {
  const [customerCode, setCustomerCode] = useState<number | null>(null)
  const [lastResult, setLastResult] = useState<{
    label: string
    result: RetryResponse
  } | null>(null)
  // Two-step confirm for Remove grants. Clicking once arms the button;
  // clicking again within the same render commits. Resets on customer
  // change or after the mutation completes.
  const [revokeArmed, setRevokeArmed] = useState(false)

  const grants = useMutation({
    mutationFn: (code: number) => retryGrants(code),
    onSuccess: (r) => setLastResult({ label: 'Grants', result: r }),
  })
  const revokes = useMutation({
    mutationFn: (code: number) => retryRevokes(code),
    onSuccess: (r) => {
      setLastResult({ label: 'Revokes', result: r })
      setRevokeArmed(false)
    },
    onError: () => setRevokeArmed(false),
  })

  const canAct = customerCode !== null
  // Disarm revoke if the agent switches customers — the confirmation
  // should only apply to the customer that was visible when armed.
  function handleCustomerChange(v: number | null) {
    setCustomerCode(v)
    setRevokeArmed(false)
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Sync actions</h2>
      </div>

      {/* Shared customer picker — both action cards below operate on
          whichever customer is selected here. */}
      <div className="space-y-1">
        <label className="label">Customer</label>
        <CustomerSearchSelect
          value={customerCode}
          onChange={handleCustomerChange}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Grants card — the primary admin action. */}
        <div className="rounded-md border border-secondary-500/30 bg-secondary-100/30 p-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-secondary-500" />
            <div className="text-sm font-medium text-gray-900">
              Run grants for a customer
            </div>
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Refreshes the user_details views and then re-executes CREATE
            USER / ALTER USER / GRANT statements for every active user of
            the chosen customer. Run this after creating a user, changing
            a password, or editing the database_name of a dataset.
          </div>
          <HoverHint
            show={!canAct}
            message="Select a customer above to run grants."
            className="mt-3"
          >
            <button
              type="button"
              className={clsx(
                'btn-primary w-full',
                // Disabled-for-no-customer: pointer-events-none so hover
                // reaches the wrapper and the tooltip shows.
                !canAct && 'pointer-events-none',
              )}
              onClick={() =>
                customerCode !== null && grants.mutate(customerCode)
              }
              disabled={!canAct || grants.isPending || revokes.isPending}
            >
              {grants.isPending ? 'Running…' : 'Run grants'}
            </button>
          </HoverHint>
        </div>

        {/* Remove grants card — REVOKEs privileges AND drops the MariaDB
            accounts (DROP USER) for the customer's DISABLED users
            (disable = 1), then purges their lookup rows. Active users are
            untouched. Two-click confirm to prevent fat-fingers. */}
        <div className="rounded-md border border-error-600/30 bg-error-100/30 p-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-error-600" />
            <div className="text-sm font-medium text-gray-900">
              Remove grants for a customer
            </div>
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Strips privileges (REVOKE) and drops the MariaDB user accounts
            (DROP USER) for the chosen customer's disabled users
            (Disabled = Yes). Active users are untouched. Disable a user in
            the Users tab first, then run this.
          </div>
          <HoverHint
            show={!canAct}
            message="Select a customer above to remove grants."
            className="mt-3"
          >
            <button
              type="button"
              className={clsx(
                'w-full rounded-md px-3 py-1.5 text-sm font-medium',
                // Disabled-for-no-customer: pointer-events-none so hover
                // reaches the wrapper and the tooltip shows.
                !canAct && 'pointer-events-none',
                revokeArmed
                  ? 'bg-error-600 text-white hover:bg-error-600/90'
                  : 'border border-error-600/40 text-error-600 hover:bg-error-100',
              )}
              onClick={() => {
                if (customerCode === null) return
                if (!revokeArmed) {
                  setRevokeArmed(true)
                  return
                }
                revokes.mutate(customerCode)
              }}
              disabled={!canAct || revokes.isPending || grants.isPending}
            >
              {revokes.isPending
                ? 'Running…'
                : revokeArmed
                  ? 'Click again to confirm'
                  : 'Remove grants'}
            </button>
          </HoverHint>
        </div>
      </div>

      {lastResult && (
        <div
          className={clsx(
            'rounded-md border px-3 py-2 text-sm',
            lastResult.result.disabled
              ? 'border-gray-300 bg-gray-100 text-gray-700'
              : lastResult.result.ok
                ? 'border-success-600/30 bg-success-100 text-success-600'
                : 'border-error-600/30 bg-error-100 text-error-600',
          )}
        >
          <div className="font-medium">
            {lastResult.label}:{' '}
            {lastResult.result.disabled
              ? 'disabled by config'
              : lastResult.result.ok
                ? 'succeeded'
                : 'failed'}
          </div>
          {lastResult.result.refresh_status && (
            <div className="text-[11px] text-gray-900">
              Refresh:{' '}
              {lastResult.result.refresh_status === 'succeeded'
                ? 'rebuilt user_details views'
                : lastResult.result.refresh_status === 'skipped_disabled'
                  ? 'skipped (owned by external process)'
                  : `failed — ${lastResult.result.refresh_error ?? 'unknown error'}`}
            </div>
          )}
          {lastResult.result.statement_count !== undefined && (
            <div className="text-[11px] text-gray-900">
              {lastResult.result.statement_count} statements applied.
            </div>
          )}
          {lastResult.result.error && (
            <div className="text-[11px] text-gray-900">
              {lastResult.result.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AuditCard() {
  const [prefix, setPrefix] = useState('')
  const [limit, setLimit] = useState(100)

  const q = useQuery({
    queryKey: ['audit', { prefix, limit }],
    queryFn: () =>
      listAudit({
        limit,
        action_prefix: prefix.trim() || undefined,
      }),
    refetchInterval: 15_000,
  })

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Audit log</h2>
          <p className="mt-1 text-xs text-gray-500">
            Latest entries from secure.cs_audit_log. Refreshes every 15
            seconds.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label">Action prefix</label>
            <input
              type="text"
              className="input w-48"
              placeholder="user.edit."
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              maxLength={48}
            />
          </div>
          <div>
            <label className="label">Rows</label>
            <select
              className="input"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-auto max-h-[60vh] border border-border rounded-md">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-table-header">
            <tr>
              <Th>When</Th>
              <Th>Agent</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Key</Th>
              <Th>Notes</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {q.isError && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-error-600">
                  {(q.error as Error)?.message ?? 'Failed to load audit log.'}
                </td>
              </tr>
            )}
            {q.data?.entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">
                  No entries.
                </td>
              </tr>
            )}
            {q.data?.entries.map((e, idx) => (
              <tr
                key={e.id}
                className={clsx(
                  idx % 2 === 1 && 'bg-table-row-alt',
                  'hover:bg-row-hover',
                )}
              >
                <Td mono>{e.created_at.replace('T', ' ').slice(0, 19)}</Td>
                <Td>{e.user_id ?? '—'}</Td>
                <Td mono>{e.action}</Td>
                <Td mono>{e.entity_type}</Td>
                <Td mono>{e.entity_key ?? '—'}</Td>
                <Td>{e.notes ?? '—'}</Td>
                <Td mono>{e.ip ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HoverHint({
  show,
  message,
  className,
  children,
}: {
  show: boolean
  message: string
  className?: string
  children: React.ReactNode
}) {
  // Wrapper that shows a styled tooltip on hover when `show` is true. The
  // wrapped (disabled) button must carry pointer-events-none so the hover
  // lands on this group element instead of being swallowed by the button.
  return (
    <div className={clsx('relative', show && 'group', className)}>
      {children}
      {show && (
        <div
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute bottom-full left-1/2 z-20 mb-2',
            '-translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900',
            'px-2.5 py-1.5 text-xs font-medium text-white shadow-lg',
            'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
          )}
        >
          {message}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="text-left text-xs font-semibold text-gray-700 px-3 py-2 border-b border-border whitespace-nowrap"
    >
      {children}
    </th>
  )
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className={clsx(
        'px-3 py-1.5 border-b border-divider whitespace-nowrap',
        mono && 'font-mono text-xs',
      )}
    >
      {children}
    </td>
  )
}