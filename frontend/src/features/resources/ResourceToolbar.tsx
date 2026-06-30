/**
 * Toolbar above the table. Holds the high-level shortcuts that don't fit
 * naturally into the per-column filter row:
 *   - Customer picker (only on resources whose rows belong to a customer)
 *   - Clear-all-filters button (visible whenever any filter is active)
 *   - Loading indicator
 *   - Create button
 *
 * The customer picker here writes to the SAME filter list that the
 * per-column inputs do — they're two views of the same state. If the
 * agent picks "Sierra Vista" here, the per-column customer_code filter
 * shows "Sierra Vista". If they clear it from either place, both update.
 */
import type { ResourceFilter } from '@/api/resources'
import type { ResourceConfig } from './resourceConfigs'
import { CustomerPicker } from './CustomerPicker'

interface ResourceToolbarProps {
  config: ResourceConfig
  filters: ResourceFilter[]
  onFiltersChange: (next: ResourceFilter[]) => void
  onCreateClick: () => void
  isFetching: boolean
}

export function ResourceToolbar({
  config,
  filters,
  onFiltersChange,
  onCreateClick,
  isFetching,
}: ResourceToolbarProps) {
  const customerCode = pickCustomerCode(filters)
  const hasFilters = filters.length > 0

  function setCustomerCode(v: number | null) {
    // Replace only the customer_code clauses; leave everything else alone.
    const others = filters.filter((f) => f.column !== 'customer_code')
    if (v === null) {
      onFiltersChange(others)
    } else {
      onFiltersChange([
        ...others,
        { column: 'customer_code', operator: 'eq', value: v },
      ])
    }
  }

  return (
    <div className="card p-4 flex flex-wrap items-end gap-3">
      {config.filterByCustomerCode && (
        <div className="min-w-[260px]">
          <label className="label">Customer</label>
          <CustomerPicker
            value={customerCode}
            onChange={setCustomerCode}
            allowAll
          />
        </div>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => onFiltersChange([])}
          title="Remove all active column filters"
          className="inline-flex items-center gap-1.5 rounded-md border border-secondary-500 bg-secondary-100/60 px-3 py-2 text-sm font-medium text-secondary-700 shadow-sm hover:bg-secondary-100 focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          <span aria-hidden className="text-base leading-none">✕</span>
          Clear all filters ({filters.length})
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        {isFetching && <span className="text-xs text-gray-500">Loading…</span>}
        <button
          type="button"
          className="btn-primary"
          onClick={onCreateClick}
        >
          Create {config.shortLabel.replace(/s$/, '').toLowerCase()}
        </button>
      </div>
    </div>
  )
}

function pickCustomerCode(filters: ResourceFilter[]): number | null {
  const f = filters.find(
    (x) => x.column === 'customer_code' && x.operator === 'eq',
  )
  return f && typeof f.value === 'number' ? f.value : null
}