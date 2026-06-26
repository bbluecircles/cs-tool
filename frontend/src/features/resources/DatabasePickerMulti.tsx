/**
 * Multi-select variant of DatabasePicker.
 *
 * Used by the Create Claim modal so the agent can pick N states at
 * once and have CreateRowModal loop one POST per state. Renders a
 * "Gmail recipients"-style box: chips for the currently selected
 * states plus a text input that filters a dropdown of remaining
 * options.
 *
 * Excludes states the customer already has rows for when configured.
 * The current customer_code is read from the containing form via
 * the excludeForCustomerCode prop.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { fetchDbDatabases, listResource } from '@/api/resources'
import type { DbDatabaseRow } from '@/api/resources'
import { hasNoDischargeFeature, hasAnyDischargeFeature } from './DatabasePicker'

interface DatabasePickerMultiProps {
  /** Selected database_name values. */
  values: string[]
  onChange: (next: string[]) => void
  /** Filter the candidate list to claims-only databases. */
  requireNoDischargeFeatures?: boolean
  /** Filter the candidate list to databases that have at least one
   *  discharge feature. */
  requireDischargeFeatures?: boolean
  /** When set, fetch existing rows from this resource slug filtered
   *  to the given customer_code, and exclude any database_name (or
   *  ppi_state value) those rows reference. Used by the Claim create
   *  flow to hide states the customer already has. */
  excludeFromResourceSlug?: string
  /** The column name in the excluded-resource list that maps to a
   *  database_name. For Claim that's "ppi_state". */
  excludeColumnKey?: string
  /** customer_code to filter the exclude-resource query. When null,
   *  no exclusion happens (the agent hasn't picked a customer yet). */
  excludeForCustomerCode?: number | null
  disabled?: boolean
  required?: boolean
  className?: string
}

export function DatabasePickerMulti({
  values,
  onChange,
  requireNoDischargeFeatures,
  requireDischargeFeatures,
  excludeFromResourceSlug,
  excludeColumnKey,
  excludeForCustomerCode,
  disabled,
  required,
  className,
}: DatabasePickerMultiProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Source list — same query key as DatabasePicker so the cache is
  // shared. (Both components fetch the same data; whichever is first
  // populates the cache.)
  const dbsQ = useQuery({
    queryKey: ['db-database-picker'],
    queryFn: fetchDbDatabases,
    staleTime: 60_000,
  })

  // Exclude-list query. Only enabled when both the slug and customer
  // are configured; otherwise we skip the request entirely.
  const excludeQ = useQuery({
    queryKey: [
      'multi-picker-exclude',
      excludeFromResourceSlug,
      excludeForCustomerCode,
    ],
    queryFn: () =>
      listResource(excludeFromResourceSlug!, {
        page: 1,
        page_size: 5000,
        filters: [
          {
            column: 'customer_code',
            operator: 'eq',
            value: String(excludeForCustomerCode),
          },
        ],
      }),
    enabled:
      !!excludeFromResourceSlug &&
      !!excludeColumnKey &&
      excludeForCustomerCode != null &&
      Number.isFinite(excludeForCustomerCode),
    staleTime: 30_000,
  })

  const excludedSet = useMemo(() => {
    if (!excludeColumnKey) return new Set<string>()
    const out = new Set<string>()
    const rows = excludeQ.data?.rows ?? []
    for (const r of rows) {
      const v = (r as Record<string, unknown>)[excludeColumnKey]
      if (typeof v === 'string') out.add(v)
    }
    return out
  }, [excludeQ.data, excludeColumnKey])

  // Candidate list = source filtered by feature flag + exclusion +
  // already-selected (chips). Search filters by substring.
  const candidates = useMemo<DbDatabaseRow[]>(() => {
    const all = dbsQ.data?.rows ?? []
    const valueSet = new Set(values)
    const q = search.trim().toLowerCase()
    return all.filter((r) => {
      if (valueSet.has(r.database_name)) return false
      if (excludedSet.has(r.database_name)) return false
      if (requireNoDischargeFeatures && !hasNoDischargeFeature(r)) return false
      if (requireDischargeFeatures && !hasAnyDischargeFeature(r)) return false
      if (q && !r.database_name.toLowerCase().includes(q)) return false
      return true
    })
  }, [
    dbsQ.data,
    values,
    excludedSet,
    requireNoDischargeFeatures,
    requireDischargeFeatures,
    search,
  ])

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      // Check both the trigger root AND the portal-rendered menu —
      // the menu lives in document.body so it isn't a child of
      // rootRef, but clicks inside it must NOT close the dropdown.
      if (
        (rootRef.current && rootRef.current.contains(target)) ||
        (menuRef.current && menuRef.current.contains(target))
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function add(name: string) {
    if (values.includes(name)) return
    onChange([...values, name])
    setSearch('')
    // Refocus the input so the agent can keep typing without an extra
    // click — feels much faster when picking 5+ items.
    inputRef.current?.focus()
  }

  function remove(name: string) {
    onChange(values.filter((v) => v !== name))
  }

  // Position state for the portal-rendered dropdown. Recomputed when
  // the menu opens, the chip input resizes (e.g. adding a chip wraps
  // to a new line), or the viewport scrolls.
  const [menuRect, setMenuRect] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)

  function recomputeMenuRect() {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }

  useEffect(() => {
    if (!open) return
    recomputeMenuRect()
    function update() {
      recomputeMenuRect()
    }
    window.addEventListener('resize', update)
    // Listen on capture so we catch ancestor scrolls — the modal body
    // is the typical case but parent containers in general apply.
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, values.length])

  // While the exclude query is loading and we have a customer
  // selected, we should signal to the agent that the candidate list
  // is incomplete — otherwise they could pick a state that's about
  // to disappear from the list once the exclude finishes loading.
  const excludeIsLoading =
    !!excludeFromResourceSlug &&
    excludeForCustomerCode != null &&
    excludeQ.isLoading

  return (
    <div ref={rootRef} className="relative">
      {/* The chip container doubles as the dropdown trigger. Clicking
          anywhere inside focuses the search input and opens the menu. */}
      <div
        ref={triggerRef}
        className={clsx(
          className ?? 'input',
          'min-h-[34px] flex flex-wrap items-center gap-1 cursor-text',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
        onClick={() => {
          if (disabled) return
          setOpen(true)
          inputRef.current?.focus()
        }}
      >
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-secondary-100 text-secondary-700 px-1.5 py-0.5 text-xs uppercase"
          >
            {v}
            {!disabled && (
              <button
                type="button"
                className="text-secondary-700/70 hover:text-secondary-700 leading-none"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(v)
                }}
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 min-w-[80px] bg-transparent outline-none border-0 p-0 text-sm placeholder:text-gray-400"
          placeholder={
            values.length === 0
              ? (required ? 'Pick one or more states…' : 'Pick states…')
              : ''
          }
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && search === '' && values.length > 0) {
              // Quick-remove last chip with backspace on empty input
              // — matches Gmail/Slack recipient pickers.
              remove(values[values.length - 1]!)
            }
            if (e.key === 'Enter' && candidates.length > 0 && !excludeIsLoading) {
              e.preventDefault()
              add(candidates[0]!.database_name)
            }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
      </div>

      {open &&
        !disabled &&
        menuRect &&
        createPortal(
          <div
            ref={menuRef}
            // z-50 sits above the modal scrim (z-30). Positioned fixed
            // and anchored to the chip input's bounding rect so the
            // dropdown is never clipped by the modal's overflow-auto.
            style={{
              position: 'fixed',
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
            }}
            className="z-50 max-h-60 overflow-auto rounded-md border border-border bg-white shadow-lg"
          >
            {dbsQ.isLoading || excludeIsLoading ? (
              <div className="px-3 py-2 text-xs text-gray-500">
                Loading{excludeIsLoading ? ' customer\u2019s existing states' : ''}…
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500">
                {values.length > 0 || search
                  ? 'No matches.'
                  : 'No available states.'}
              </div>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.database_name}
                  type="button"
                  className="block w-full text-left px-3 py-1.5 text-sm uppercase hover:bg-secondary-100/50"
                  onMouseDown={(e) => {
                    // Use mousedown so the menu doesn't close from
                    // the input's onBlur before the click registers.
                    e.preventDefault()
                    add(c.database_name)
                  }}
                >
                  {c.database_name}
                </button>
              ))
            )}
            {excludeQ.data && excludedSet.size > 0 && (
              <div className="border-t border-border px-3 py-1.5 text-[11px] text-gray-500">
                {excludedSet.size} state{excludedSet.size === 1 ? '' : 's'} hidden
                (customer already has them).
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}