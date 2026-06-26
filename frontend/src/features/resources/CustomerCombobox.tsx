/**
 * Searchable customer picker. Replaces the native <select> on the admin
 * page and in the create modals: the agent types to filter by customer
 * NAME or CODE, and the first (top) match is highlighted — unlike a native
 * select, which scrolls the current value to the bottom.
 *
 * The dropdown is portaled to <body> and fixed-positioned so it is never
 * clipped by a modal's overflow-auto (the create modals) — same approach as
 * DatabasePickerMulti.
 *
 * Data comes from the same /api/customers query the rest of the app uses
 * (shared cache via CUSTOMER_PICKER_QUERY_KEY).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { listResource } from '@/api/resources'
import { CUSTOMER_PICKER_QUERY_KEY, type CustomerRow } from './CustomerPicker'

interface CustomerComboboxProps {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  /** Include an "All customers" entry (code = null). */
  allowAll?: boolean
  placeholder?: string
  className?: string
  /** Apply the error border (used by the create form on a missing value). */
  invalid?: boolean
}

interface Option {
  code: number | null // null = "All customers"
  label: string
}

function formatRow(r: CustomerRow): string {
  return `${r.customer_name ?? '(unnamed)'} — code ${r.customer_code}`
}

export function CustomerCombobox({
  value,
  onChange,
  disabled,
  allowAll = false,
  placeholder = 'Search by name or code…',
  className,
  invalid,
}: CustomerComboboxProps) {
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

  const selectedLabel = useMemo(() => {
    if (value === null || value === undefined) return ''
    const row = rows.find((r) => r.customer_code === value)
    return row ? formatRow(row) : `code ${value}`
  }, [value, rows])

  const options = useMemo<Option[]>(() => {
    const term = query.trim().toLowerCase()
    const matched: Option[] = rows
      .filter((r) => {
        if (!term) return true
        const name = (r.customer_name ?? '').toLowerCase()
        return name.includes(term) || String(r.customer_code).includes(term)
      })
      .map((r) => ({ code: r.customer_code, label: formatRow(r) }))
    if (allowAll && (!term || 'all customers'.includes(term))) {
      return [{ code: null, label: 'All customers' }, ...matched]
    }
    return matched
  }, [rows, query, allowAll])

  // First match highlighted (top) whenever the list changes or it opens.
  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  // Position the portaled menu under the input; keep it anchored on scroll
  // and resize.
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

  // Close when clicking outside the input AND the portaled menu; revert the
  // query so the input shows the committed selection again.
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

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open, menuRect])

  function commit(opt: Option | undefined) {
    if (!opt) return
    onChange(opt.code)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
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

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={clsx('input w-full', invalid && 'input-error')}
        placeholder={q.isLoading ? 'Loading customers…' : placeholder}
        disabled={disabled || q.isLoading}
        value={open ? query : selectedLabel}
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
              options.map((opt, i) => {
                const isHighlighted = i === highlight
                const isSelected = opt.code === value
                return (
                  <li
                    key={opt.code === null ? '__all' : opt.code}
                    role="option"
                    aria-selected={isSelected}
                    // onMouseDown fires before the input's blur, so the click
                    // lands before the outside-click handler can close it.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commit(opt)
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={clsx(
                      'cursor-pointer px-3 py-1.5 text-sm',
                      isHighlighted
                        ? 'bg-secondary-100 text-gray-900'
                        : 'text-gray-700',
                      isSelected && 'font-semibold',
                    )}
                  >
                    {opt.code === null ? (
                      opt.label
                    ) : (
                      <HighlightMatch label={opt.label} term={query} />
                    )}
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

/** Bold the matched substring within the option label. */
function HighlightMatch({ label, term }: { label: string; term: string }) {
  const t = term.trim()
  if (!t) return <>{label}</>
  const idx = label.toLowerCase().indexOf(t.toLowerCase())
  if (idx < 0) return <>{label}</>
  return (
    <>
      {label.slice(0, idx)}
      <span className="font-semibold text-secondary-700">
        {label.slice(idx, idx + t.length)}
      </span>
      {label.slice(idx + t.length)}
    </>
  )
}
