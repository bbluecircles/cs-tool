import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { listResource } from '@/api/resources'

interface CustomerPickerProps {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  required?: boolean
  /** For the toolbar filter variant; includes an "All" option. */
  allowAll?: boolean
  className?: string
}

export interface CustomerRow {
  customer_code: number
  customer_name: string | null
  entity_code: string | null
}

/** react-query key shared by the picker, the filter dropdown, and the
 *  ResourceTable cell-name lookup. */
export const CUSTOMER_PICKER_QUERY_KEY = ['customer-picker'] as const

/**
 * Sync lookup of a customer's display name from the shared customer
 * cache. Used by ResourceTable cells to render the customer_name in
 * place of the bare customer_code integer on tabs where the cell is
 * read-only (Discharge / Claim).
 *
 * Returns null if:
 *   - the cache hasn't loaded yet (caller should fall back to the code)
 *   - the customer_code isn't present in the cache (rare; could happen
 *     if a row references a customer that no longer exists)
 */
export function lookupCustomerName(
  qc: QueryClient,
  customer_code: number | null | undefined,
): string | null {
  if (customer_code === null || customer_code === undefined) return null
  const data = qc.getQueryData<{ rows: CustomerRow[] }>(CUSTOMER_PICKER_QUERY_KEY)
  const row = data?.rows.find((r) => r.customer_code === customer_code)
  return row?.customer_name ?? null
}

/**
 * Dropdown of customers, sourced from /api/customers. Used in create
 * forms (as the FK picker) and in resource-table toolbars (as a filter).
 */
export function CustomerPicker({
  value,
  onChange,
  disabled,
  required,
  allowAll,
  className,
}: CustomerPickerProps) {
  // We fetch up to 500 customers — adequate for this deployment's scale.
  // Upgrade to a searchable combobox if the list outgrows that someday.
  const q = useQuery({
    queryKey: CUSTOMER_PICKER_QUERY_KEY,
    queryFn: () =>
      listResource<CustomerRow>('customers', {
        page: 1,
        page_size: 200,
        sort_by: 'customer_name',
        sort_dir: 'asc',
      }),
    staleTime: 60_000,
  })

  return (
    <select
      className={className ?? 'input'}
      value={value ?? ''}
      disabled={disabled || q.isLoading}
      required={required}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : Number(e.target.value))
      }
    >
      {allowAll && <option value="">All customers</option>}
      {!allowAll && <option value="" disabled>— choose —</option>}
      {(q.data?.rows ?? []).map((c) => (
        <option key={c.customer_code} value={c.customer_code}>
          {c.customer_name ?? '(unnamed)'} — code {c.customer_code}
        </option>
      ))}
    </select>
  )
}