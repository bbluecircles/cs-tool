/**
 * Dropdown of databases sourced from myuser.db_database via
 * GET /api/db-databases. Used in the customer-dataset create form and
 * inline-edit cell — database_name is constrained to values that exist
 * in that table.
 *
 * Modeled on CustomerPicker. Same staleTime convention so the list is
 * fetched once per session-ish and reused across modals/cells.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchDbDatabases } from '@/api/resources'

interface DatabasePickerProps {
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  required?: boolean
  className?: string
  /**
   * When true, the dropdown still renders any current value even if it
   * isn't in the list (so inline-editing a legacy row doesn't visually
   * drop its existing database_name). The agent still has to actively
   * pick a different value to change it.
   */
  preserveUnknownValue?: boolean
}

export function DatabasePicker({
  value,
  onChange,
  disabled,
  required,
  className,
  preserveUnknownValue,
}: DatabasePickerProps) {
  const q = useQuery({
    queryKey: ['db-database-picker'],
    queryFn: fetchDbDatabases,
    staleTime: 60_000,
  })

  const rows = q.data?.rows ?? []
  const knownNames = new Set(rows.map((r) => r.database_name))
  const showLegacyValue =
    preserveUnknownValue && value != null && value !== '' && !knownNames.has(value)

  return (
    <select
      className={className ?? 'input'}
      value={value ?? ''}
      disabled={disabled || q.isLoading}
      required={required}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : e.target.value)
      }
    >
      <option value="" disabled>
        {q.isLoading ? 'Loading…' : '— choose —'}
      </option>
      {showLegacyValue && (
        <option value={value as string}>
          {value} (not in db_database)
        </option>
      )}
      {rows.map((r) => (
        <option key={r.db_connection_id} value={r.database_name}>
          {r.database_name}
        </option>
      ))}
    </select>
  )
}