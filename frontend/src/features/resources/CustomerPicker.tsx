import { useQuery } from '@tanstack/react-query'
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

interface CustomerRow {
  customer_code: number
  customer_name: string | null
  entity_code: string | null
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
    queryKey: ['customer-picker'],
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
