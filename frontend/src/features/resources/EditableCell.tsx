/**
 * Click-to-edit cell. Driven by the column's ColumnDef so the input type
 * (text / number / flag-select / enum-select) comes from the config.
 *
 * On commit (blur or Enter) we call onCommit with the new value. Escape
 * cancels. A dirty cell shows a warning-tinted background and a small dot.
 */
import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ColumnDef } from './resourceConfigs'

interface EditableCellProps {
  column: ColumnDef
  originalValue: unknown
  pendingValue: unknown
  dirty: boolean
  disabled?: boolean
  onCommit: (value: unknown) => void
}

export function EditableCell({
  column,
  originalValue,
  pendingValue,
  dirty,
  disabled,
  onCommit,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const current = dirty ? pendingValue : originalValue
  const displayed = formatForDisplay(column, current)

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className={clsx(
          'w-full text-left -mx-2 px-2 py-0.5 rounded',
          'hover:bg-row-selected',
          'focus:outline-none focus:ring-2 focus:ring-focus-ring',
          dirty && 'bg-warning-100 text-gray-900 font-medium',
          disabled && 'cursor-not-allowed opacity-60',
        )}
        title={
          dirty
            ? `Pending: ${displayed} (was ${formatForDisplay(column, originalValue)})`
            : 'Click to edit'
        }
      >
        {displayed}
        {dirty && <span className="ml-1 text-[10px] text-warning-600">●</span>}
      </button>
    )
  }

  return (
    <EditingInput
      column={column}
      initial={current}
      onCommit={(v) => {
        onCommit(v)
        setEditing(false)
      }}
      onCancel={() => setEditing(false)}
    />
  )
}

function EditingInput({
  column,
  initial,
  onCommit,
  onCancel,
}: {
  column: ColumnDef
  initial: unknown
  onCommit: (v: unknown) => void
  onCancel: () => void
}) {
  // Select-like inputs: either flag (0/1) or any column with options.
  if (column.options && column.options.length > 0) {
    return (
      <SelectInput
        options={column.options}
        initial={initial}
        kind={column.kind}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    )
  }
  return (
    <TextLikeInput
      column={column}
      initial={initial}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  )
}

function SelectInput({
  options,
  initial,
  kind,
  onCommit,
  onCancel,
}: {
  options: { value: string | number; label: string }[]
  initial: unknown
  kind: ColumnDef['kind']
  onCommit: (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => ref.current?.focus(), [])

  function commit(raw: string) {
    // Coerce back to the underlying type — int for flag/int kinds, string otherwise.
    if (kind === 'flag' || kind === 'int') {
      onCommit(raw === '' ? null : Number(raw))
    } else {
      onCommit(raw)
    }
  }

  return (
    <select
      ref={ref}
      defaultValue={initial === null || initial === undefined ? '' : String(initial)}
      className="input py-0.5 px-1 text-xs w-auto"
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function TextLikeInput({
  column,
  initial,
  onCommit,
  onCancel,
}: {
  column: ColumnDef
  initial: unknown
  onCommit: (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(
    initial === null || initial === undefined ? '' : String(initial),
  )
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const isNumeric = column.kind === 'int'

  function commit() {
    if (value === '') {
      onCommit(null)
      return
    }
    if (isNumeric) {
      const n = Number(value)
      if (Number.isFinite(n)) onCommit(n)
      else onCancel()
      return
    }
    onCommit(value)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <input
      ref={ref}
      type={isNumeric ? 'number' : column.isPassword ? 'password' : 'text'}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      maxLength={column.maxLength}
      min={column.min}
      max={column.max}
      className="input py-0.5 px-1 text-xs w-full min-w-[80px]"
    />
  )
}

function formatForDisplay(column: ColumnDef, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (column.kind === 'flag') return value === 1 || value === '1' ? 'Yes' : 'No'
  if (column.kind === 'datetime') {
    return String(value).replace('T', ' ').slice(0, 16)
  }
  if (column.options) {
    const opt = column.options.find(
      (o) => String(o.value) === String(value),
    )
    return opt ? opt.label : String(value)
  }
  return String(value)
}
