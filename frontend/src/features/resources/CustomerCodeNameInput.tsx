/**
 * Customer picker as two linked inputs in a 1:3 flex row — a narrow CODE
 * box and a wide NAME box — sharing one styled dropdown.
 *
 * Type in either box to filter the SAME list (matches name or code); click a
 * row (or Enter) to select. Both boxes then show the chosen customer. The
 * dropdown is a custom, portaled list (not a native <datalist>) so it's fully
 * styled, never clipped by a modal, and always shows every customer.
 *
 * Data comes from the shared /api/customers cache (CUSTOMER_PICKER_QUERY_KEY).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { listResource } from '@/api/resources'
import { CUSTOMER_PICKER_QUERY_KEY, type CustomerRow } from './CustomerPicker'

interface CustomerCodeNameInputProps {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  /** Error border (used by the create form on a missing value). */
  invalid?: boolean
  className?: string
}

export function CustomerCodeNameInput({
  value,
  onChange,
  disabled,
  invalid,
  className,
}: CustomerCodeNameInputProps) {
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
  const [activeField, setActiveField] = useState<'code' | 'name'>('name')
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [menuRect, setMenuRect] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  const rowRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // One filtered list, matched on name OR code, driven by whichever box the
  // agent is typing in. Empty draft → every customer (scrollable).
  const options = useMemo(() => {
    const term = draft.trim().toLowerCase()
    if (!term) return rows
    const matched = rows.filter(
      (r) =>
        (r.customer_name ?? '').toLowerCase().includes(term) ||
        String(r.customer_code).includes(term),
    )
    // Rank: exact (code or name) first, then prefix, then match-anywhere.
    // Equal ranks keep the incoming (name-sorted) order via a stable sort —
    // so typing "1" puts code 1 at the very top, above 10/11/100/etc.
    const rank = (r: CustomerRow) => {
      const name = (r.customer_name ?? '').toLowerCase()
      const code = String(r.customer_code)
      if (code === term || name === term) return 0
      if (code.startsWith(term) || name.startsWith(term)) return 1
      return 2
    }
    return [...matched].sort((a, b) => rank(a) - rank(b))
  }, [rows, draft])

  useEffect(() => {
    setHighlight(0)
  }, [draft, open])

  // Position the portaled menu under the whole row; keep it anchored on
  // scroll/resize.
  useEffect(() => {
    if (!open) return
    function recompute() {
      const r = rowRef.current?.getBoundingClientRect()
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

  // Close on outside click (checking the row AND the portaled menu).
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (
        (rowRef.current && rowRef.current.contains(t)) ||
        (listRef.current && listRef.current.contains(t))
      ) {
        return
      }
      setOpen(false)
      setDraft('')
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open, menuRect])

  function focusField(field: 'code' | 'name') {
    setActiveField(field)
    setDraft('')
    setOpen(true)
  }

  function commit(row: CustomerRow | undefined) {
    if (!row) return
    onChange(row.customer_code)
    setOpen(false)
    setDraft('')
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
      setDraft('')
      ;(e.target as HTMLInputElement).blur()
    }
  }

  const inputCls = clsx('input', invalid && 'input-error')
  const isDisabled = disabled || q.isLoading

  const codeValue =
    open && activeField === 'code' ? draft : value != null ? String(value) : ''
  const nameValue =
    open && activeField === 'name' ? draft : selected?.customer_name ?? ''

  return (
    <div ref={rowRef} className={clsx('flex gap-2', className)}>
      <input
        type="text"
        inputMode="numeric"
        className={clsx(inputCls, 'flex-1 min-w-0')}
        placeholder="Code"
        value={codeValue}
        disabled={isDisabled}
        onFocus={() => focusField('code')}
        onChange={(e) => {
          setActiveField('code')
          setDraft(e.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        aria-label="Customer code"
      />
      <input
        type="text"
        className={clsx(inputCls, 'flex-[3] min-w-0')}
        placeholder={q.isLoading ? 'Loading customers…' : 'Customer name'}
        value={nameValue}
        disabled={isDisabled}
        onFocus={() => focusField('name')}
        onChange={(e) => {
          setActiveField('name')
          setDraft(e.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        aria-label="Customer name"
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
              options.map((r, i) => {
                const isHighlighted = i === highlight
                const isSelected = r.customer_code === value
                return (
                  <li
                    key={r.customer_code}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      // mousedown fires before input blur, so the pick lands
                      // before the outside-click handler can close the list.
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
