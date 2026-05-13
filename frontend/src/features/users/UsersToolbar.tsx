import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CustomerBrief,
  listCustomersBrief,
  listDatabasesBrief,
} from '@/api/users'

export interface UsersFilterState {
  search: string
  customer_code?: number
  database_name?: string
  disable?: 0 | 1
}

interface UsersToolbarProps {
  value: UsersFilterState
  onChange: (next: UsersFilterState) => void
  onCreateClick: () => void
  isFetching: boolean
}

export function UsersToolbar({
  value,
  onChange,
  onCreateClick,
  isFetching,
}: UsersToolbarProps) {
  // Local echo of the search input so typing is snappy; debounce to the
  // parent every 300ms. Prevents a round-trip per keystroke.
  const [searchInput, setSearchInput] = useState(value.search)
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== value.search) {
        onChange({ ...value, search: searchInput })
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  // Keep local state in sync if the parent resets (e.g. from a clear button).
  useEffect(() => {
    setSearchInput(value.search)
  }, [value.search])

  const customers = useQuery({
    queryKey: ['customers-brief'],
    queryFn: () => listCustomersBrief(),
    staleTime: 5 * 60_000,
  })

  const databases = useQuery({
    queryKey: ['databases-brief'],
    queryFn: () => listDatabasesBrief(),
    staleTime: 5 * 60_000,
  })

  const hasFilters =
    !!value.search ||
    value.customer_code !== undefined ||
    !!value.database_name ||
    value.disable !== undefined

  return (
    <div className="card p-4 flex flex-wrap items-end gap-3">
      <div className="grow min-w-[240px] max-w-md">
        <label className="label">Search</label>
        <input
          type="search"
          className="input"
          placeholder="ID, name, email, customer…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <div className="min-w-[200px]">
        <label className="label">Customer</label>
        <select
          className="input"
          value={value.customer_code ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              customer_code: e.target.value
                ? Number(e.target.value)
                : undefined,
            })
          }
        >
          <option value="">All</option>
          {(customers.data ?? []).map((c: CustomerBrief) => (
            <option key={c.customer_code} value={c.customer_code}>
              {c.customer_name ?? '(unnamed)'} — {c.customer_code}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[160px]">
        <label className="label">Database</label>
        <select
          className="input"
          value={value.database_name ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              database_name: e.target.value || undefined,
            })
          }
        >
          <option value="">All</option>
          {(databases.data ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[120px]">
        <label className="label">Status</label>
        <select
          className="input"
          value={value.disable ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              disable:
                e.target.value === ''
                  ? undefined
                  : (Number(e.target.value) as 0 | 1),
            })
          }
        >
          <option value="">All</option>
          <option value="0">Active</option>
          <option value="1">Disabled</option>
        </select>
      </div>

      {hasFilters && (
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            onChange({
              search: '',
              customer_code: undefined,
              database_name: undefined,
              disable: undefined,
            })
          }
        >
          Clear
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        {isFetching && (
          <span className="text-xs text-gray-500">Loading…</span>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={onCreateClick}
        >
          Create user
        </button>
      </div>
    </div>
  )
}
