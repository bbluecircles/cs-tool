/**
 * Per-column filter input rendered under the table header.
 *
 * Each column's filter kind dictates which control renders:
 *   text          → debounced text input → emits one `like` filter
 *   int           → number input → emits one `eq` filter
 *   flag          → tri-state All/Yes/No select → emits 0 or 1 `eq` filter
 *   enum          → select with column.options → emits 0 or 1 `eq` filter
 *   date          → two date pickers (from + to) → emits 0–2 filters
 *   customer_code → CustomerPicker → emits 0 or 1 `eq` filter
 *
 * The component reports its current filters via onChange as a list, NOT
 * a single filter — date ranges produce two clauses (gte + lte) on the
 * same column, and the parent's filter state is a flat list.
 *
 * State is fully derived from the `value` prop. The parent owns the
 * canonical filter list; this component is presentational and tells the
 * parent when to update.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef, FilterKind } from './resourceConfigs'
import { effectiveFilterKind } from './resourceConfigs'
import type { ResourceFilter } from '@/api/resources'
import { CustomerPicker } from './CustomerPicker'
import { DatabasePicker } from './DatabasePicker'

interface ColumnFilterInputProps {
  column: ColumnDef
  /** The filters currently applied to this column. Usually 0 or 1
   *  entries; date columns may have up to 2 (one gte, one lte). */
  value: ResourceFilter[]
  /** Replace this column's filter clauses with the given list. The
   *  parent diffs this against its overall filter state and re-renders
   *  the table. */
  onChange: (next: ResourceFilter[]) => void
}

export function ColumnFilterInput({
  column,
  value,
  onChange,
}: ColumnFilterInputProps) {
  const kind = effectiveFilterKind(column)
  if (kind === null) {
    // Non-filterable columns get an empty cell — header still aligned.
    return <div className="h-7" />
  }

  switch (kind) {
    case 'text':
      return <TextFilter column={column} value={value} onChange={onChange} />
    case 'int':
      return <IntFilter column={column} value={value} onChange={onChange} />
    case 'flag':
      return <FlagFilter column={column} value={value} onChange={onChange} />
    case 'enum':
      return <EnumFilter column={column} value={value} onChange={onChange} />
    case 'date':
      return <DateRangeFilter column={column} value={value} onChange={onChange} />
    case 'customer_code':
      return <CustomerCodeFilter column={column} value={value} onChange={onChange} />
    case 'database_picker':
      return <DatabasePickerFilter column={column} value={value} onChange={onChange} />
  }
  // Exhaustive check.
  return assertNever(kind)
}

function assertNever(_x: never): never {
  throw new Error('unreachable')
}

// ---------------------------------------------------------------------------
// Text — debounced LIKE
// ---------------------------------------------------------------------------

function TextFilter({
  column,
  value,
  onChange,
}: {
  column: ColumnDef
  value: ResourceFilter[]
  onChange: (next: ResourceFilter[]) => void
}) {
  const initial = useMemo(() => {
    const f = value.find((v) => v.operator === 'like')
    if (!f) return ''
    // Strip the surrounding %s if the parent is showing us its own state
    // (it shouldn't, but defensive).
    const s = String(f.value)
    return s.startsWith('%') && s.endsWith('%') ? s.slice(1, -1) : s
  }, [value])

  const [draft, setDraft] = useState(initial)

  // Sync down: if the parent clears filters externally, reflect that.
  useEffect(() => {
    setDraft(initial)
  }, [initial])

  // Sync up: 300ms debounce to avoid hammering the API on every keystroke.
  useEffect(() => {
    if (draft === initial) return
    const t = setTimeout(() => {
      if (draft === '') {
        onChange([])
      } else {
        onChange([{ column: column.key, operator: 'like', value: draft }])
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  return (
    <input
      type="search"
      className="input py-0.5 px-1 text-xs w-full"
      placeholder="contains…"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  )
}

// ---------------------------------------------------------------------------
// Int — exact match
// ---------------------------------------------------------------------------

function IntFilter({
  column,
  value,
  onChange,
}: {
  column: ColumnDef
  value: ResourceFilter[]
  onChange: (next: ResourceFilter[]) => void
}) {
  const initial = useMemo(() => {
    const f = value.find((v) => v.operator === 'eq')
    return f ? String(f.value) : ''
  }, [value])

  const [draft, setDraft] = useState(initial)

  useEffect(() => {
    setDraft(initial)
  }, [initial])

  useEffect(() => {
    if (draft === initial) return
    const t = setTimeout(() => {
      if (draft === '') {
        onChange([])
      } else {
        const n = Number(draft)
        if (Number.isFinite(n)) {
          onChange([{ column: column.key, operator: 'eq', value: n }])
        }
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  return (
    <input
      type="number"
      className="input py-0.5 px-1 text-xs w-full"
      placeholder="="
      value={draft}
      min={column.min}
      max={column.max}
      onChange={(e) => setDraft(e.target.value)}
    />
  )
}

// ---------------------------------------------------------------------------
// Flag — tri-state select
// ---------------------------------------------------------------------------

function FlagFilter({
  column,
  value,
  onChange,
}: {
  column: ColumnDef
  value: ResourceFilter[]
  onChange: (next: ResourceFilter[]) => void
}) {
  const current = useMemo(() => {
    const f = value.find((v) => v.operator === 'eq')
    return f ? String(f.value) : ''
  }, [value])

  return (
    <select
      className="input py-0.5 px-1 text-xs w-full"
      value={current}
      onChange={(e) => {
        const v = e.target.value
        if (v === '') onChange([])
        else onChange([{ column: column.key, operator: 'eq', value: Number(v) }])
      }}
    >
      <option value="">All</option>
      <option value="0">No</option>
      <option value="1">Yes</option>
    </select>
  )
}

// ---------------------------------------------------------------------------
// Enum — select from column.options
// ---------------------------------------------------------------------------

function EnumFilter({
  column,
  value,
  onChange,
}: {
  column: ColumnDef
  value: ResourceFilter[]
  onChange: (next: ResourceFilter[]) => void
}) {
  const current = useMemo(() => {
    const f = value.find((v) => v.operator === 'eq')
    return f ? String(f.value) : ''
  }, [value])

  return (
    <select
      className="input py-0.5 px-1 text-xs w-full"
      value={current}
      onChange={(e) => {
        const v = e.target.value
        if (v === '') {
          onChange([])
          return
        }
        // Convert to number if column.kind is int/flag, else keep string.
        const out: ResourceFilter[] =
          column.kind === 'flag' || column.kind === 'int'
            ? [{ column: column.key, operator: 'eq', value: Number(v) }]
            : [{ column: column.key, operator: 'eq', value: v }]
        onChange(out)
      }}
    >
      <option value="">All</option>
      {(column.options ?? []).map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Date range — two pickers, emits up to two filters
// ---------------------------------------------------------------------------

function DateRangeFilter({
  column,
  value,
  onChange,
}: {
  column: ColumnDef
  value: ResourceFilter[]
  onChange: (next: ResourceFilter[]) => void
}) {
  const fromValue = useMemo(() => {
    const f = value.find((v) => v.operator === 'gte')
    return f ? String(f.value) : ''
  }, [value])
  const toValue = useMemo(() => {
    const f = value.find((v) => v.operator === 'lte')
    return f ? String(f.value) : ''
  }, [value])

  function emit(from: string, to: string) {
    const next: ResourceFilter[] = []
    if (from) next.push({ column: column.key, operator: 'gte', value: from })
    // Add a day's worth of slack on the upper bound so "to=2026-05-06"
    // matches everything created during that day, not only the moment
    // 00:00:00. Cheaper than parsing dates client-side; backend treats
    // the string as a datetime literal.
    if (to) {
      next.push({
        column: column.key,
        operator: 'lte',
        value: `${to} 23:59:59`,
      })
    }
    onChange(next)
  }

  // Native date inputs are UNCONTROLLED here, same as the inline editor:
  // a controlled value re-applied mid-edit freezes a half-typed year
  // (the first year digit zero-pads to a valid date like 0002-02-04).
  // We read the DOM values and emit on blur / Enter. The wrapper is keyed
  // on the committed range so an external change (e.g. clearing filters)
  // remounts the inputs with fresh defaultValues, while typing — which
  // doesn't move the committed value until blur — leaves them mounted so
  // the full year can be typed.
  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)

  function commit() {
    emit(fromRef.current?.value ?? '', (toRef.current?.value ?? '').slice(0, 10))
  }

  return (
    <div className="flex items-center gap-1" key={`${fromValue}|${toValue}`}>
      <input
        ref={fromRef}
        type="date"
        className="input py-0.5 px-1 text-xs w-full"
        defaultValue={fromValue}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        title="From"
      />
      <span className="text-[10px] text-gray-400">–</span>
      <input
        ref={toRef}
        type="date"
        className="input py-0.5 px-1 text-xs w-full"
        // The displayed `to` value is the date portion of the stored
        // "YYYY-MM-DD 23:59:59" string.
        defaultValue={toValue.slice(0, 10)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        title="To"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Customer-code — picker dropdown
// ---------------------------------------------------------------------------

function CustomerCodeFilter({
  column,
  value,
  onChange,
}: {
  column: ColumnDef
  value: ResourceFilter[]
  onChange: (next: ResourceFilter[]) => void
}) {
  const current = useMemo(() => {
    const f = value.find((v) => v.operator === 'eq')
    return f && typeof f.value === 'number' ? f.value : null
  }, [value])

  return (
    <CustomerPicker
      value={current}
      allowAll
      className="input py-0.5 px-1 text-xs w-full"
      onChange={(v) => {
        if (v === null) onChange([])
        else onChange([{ column: column.key, operator: 'eq', value: v }])
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Database picker — dropdown sourced from myuser.db_database
//
// Honors the column's pickerRequire* flags so each tab's filter shows the
// same options as the cell/create picker (discharge tab: discharge-capable
// databases; claim tab: claims-only databases).
//
// Emits an `eq` filter on the column's stored value (database_name string).
// ---------------------------------------------------------------------------

function DatabasePickerFilter({
  column,
  value,
  onChange,
}: {
  column: ColumnDef
  value: ResourceFilter[]
  onChange: (next: ResourceFilter[]) => void
}) {
  const current = useMemo(() => {
    const f = value.find((v) => v.operator === 'eq')
    return f && typeof f.value === 'string' ? f.value : null
  }, [value])

  return (
    <DatabasePicker
      value={current}
      className="input py-0.5 px-1 text-xs w-full"
      allowAll
      // The cell picker uses preserveUnknownValue so legacy values stay
      // visible; the filter doesn't need that — if someone applies a
      // filter for a value that no longer exists in db_database, leaving
      // the empty placeholder selected after clearing is fine.
      requireDischargeFeatures={column.pickerRequireDischargeFeatures}
      requireNoDischargeFeatures={column.pickerRequireNoDischargeFeatures}
      onChange={(v) => {
        if (v === null || v === '') onChange([])
        else onChange([{ column: column.key, operator: 'eq', value: v }])
      }}
    />
  )
}