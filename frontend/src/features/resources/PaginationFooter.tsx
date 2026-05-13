interface PaginationFooterProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (next: number) => void
  onPageSizeChange: (next: number) => void
}

const PAGE_SIZES = [25, 50, 100, 200]

export function PaginationFooter({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationFooterProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const clamped = Math.min(page, pageCount)
  const from = total === 0 ? 0 : (clamped - 1) * pageSize + 1
  const to = Math.min(clamped * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700">
      <div>
        Showing <span className="font-medium">{from.toLocaleString()}</span>–
        <span className="font-medium">{to.toLocaleString()}</span> of{' '}
        <span className="font-medium">{total.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-gray-500">
          Rows per page
          <select
            className="input py-1 px-2 text-xs w-auto"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost text-xs px-2 py-1"
            onClick={() => onPageChange(1)} disabled={clamped <= 1}>‹‹</button>
          <button type="button" className="btn-ghost text-xs px-2 py-1"
            onClick={() => onPageChange(clamped - 1)} disabled={clamped <= 1}>‹</button>
          <span className="px-2 text-xs text-gray-500">
            Page {clamped} / {pageCount}
          </span>
          <button type="button" className="btn-ghost text-xs px-2 py-1"
            onClick={() => onPageChange(clamped + 1)} disabled={clamped >= pageCount}>›</button>
          <button type="button" className="btn-ghost text-xs px-2 py-1"
            onClick={() => onPageChange(pageCount)} disabled={clamped >= pageCount}>››</button>
        </div>
      </div>
    </div>
  )
}
