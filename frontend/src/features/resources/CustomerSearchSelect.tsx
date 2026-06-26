/**
 * Customer picker as a single search box. Type a name OR a code; the styled
 * (portaled) dropdown shows every match as "Name … code N". Pick one and the
 * box shows "Name — code N" with an ✕ to clear and search again.
 *
 * One obvious input, search by either field, the selection is always spelled
 * out — the least-surprising pattern for non-technical users.
 *
 * Data comes from the shared /api/customers cache (CUSTOMER_PICKER_QUERY_KEY).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { listResource } from '@/api/resources'
import { CUSTOMER_PICKER_QUERY_KEY, type CustomerRow } from './CustomerPicker'

interface CustomerSearchSelectProps {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  /** Error border (used by the create form on a missing value). */
  invalid?: boolean
  className?: string
}

function label(r: CustomerRow): string {
  return `${r.customer_name ?? '(unnamed)'} — code ${r.customer_code}`
}

export function CustomerSearchSelect({
  value,
  onChange,
  disabled,
  invalid,
  className,
}: CustomerSearchSelectProps) {
  const q = useQuery({
    queryKey: CUSTOMER_PICKER_QUERY_KEY,
    queryFn: () =>
      listResource<CustomerRow>('customers', {
        page: 1,
        page_size: 5000,
        sort_by: 'customer_name',
        sort_dir: 'asc',
      }),
    staleTime: 60_000,
  })
  const rows = q.data?.rows ?? []
  const byCode = useMemo(() => {
    const m = new Map<number, CustomerRow>()
    for (const r of rows) m.set(r.customer_code, r)
    return m
  }, [rows])
  const selected = value != null ? byCode.get(value) ?? null : null

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [menuRect, setMenuRect] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const options = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return rows
    const matched = rows.filter(
      (r) =>
        (r.customer_name ?? '').toLowerCase().includes(term) ||
        String(r.customer_code).includes(term),
    )
    // Exact (code or name) first, then prefix, then match-anywhere. Stable
    // within a rank, so typing "1" puts code 1 at the very top.
    const rank = (r: CustomerRow) => {
      const name = (r.customer_name ?? '').toLowerCase()
      const code = String(r.customer_code)
      if (code === term || name === term) return 0
      if (code.startsWith(term) || name.startsWith(term)) return 1
      return 2
    }
    return [...matched].sort((a, b) => rank(a) - rank(b))
  }, [rows, query])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    function recompute() {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    recompute()
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (
        (containerRef.current && containerRef.current.contains(t)) ||
        (listRef.current && listRef.current.contains(t))
      ) {
        return
      }
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open, menuRect])

  function commit(row: CustomerRow | undefined) {
    if (!row) return
    onChange(row.customer_code)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function clear() {
    onChange(null)
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlight((h) => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open) commit(options[highlight])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    }
  }

  const showClear = value != null && !open && !disabled
  const display = open ? query : selected ? label(selected) : value != null ? `code ${value}` : ''

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={clsx('input w-full', showClear && 'pr-8', invalid && 'input-error')}
        placeholder={
          q.isLoading ? 'Loading customers…' : 'Search customer by name or code…'
        }
        disabled={disabled || q.isLoading}
        value={display}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) setOpen(true)
        }}
        onFocus={(e) => {
          setOpen(true)
          setQuery('')
          e.target.select()
        }}
        onKeyDown={onKeyDown}
      />
      {showClear && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Clear customer"
          tabIndex={-1}
        >
          ✕
        </button>
      )}
      {open &&
        menuRect &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
            }}
            className="z-50 max-h-72 overflow-auto rounded-md border border-border bg-white py-1 shadow-lg"
          >
            {options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No matches.</li>
            ) : (
              options.map((r, i) => {
                const isHighlighted = i === highlight
                const isSelected = r.customer_code === value
                return (
                  <li
                    key={r.customer_code}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commit(r)
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={clsx(
                      'flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm',
                      isHighlighted
                        ? 'bg-secondary-100 text-gray-900'
                        : 'text-gray-700',
                    )}
                  >
                    <span className={clsx('flex-1 truncate', isSelected && 'font-semibold')}>
                      {r.customer_name ?? '(unnamed)'}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      code {r.customer_code}
                    </span>
                  </li>
                )
              })
            )}
          </ul>,
          document.body,
        )}
    </div>
  )
}
