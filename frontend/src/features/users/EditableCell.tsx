/**
 * Editable cell.
 *
 * Resting state shows the current (or pending) value, styled subtly to
 * indicate editability. Clicking puts it in edit mode with a focused input;
 * Enter or blur commits the new value to the dirty store; Escape reverts.
 *
 * For 0/1 flag columns, we render a select dropdown instead of a text input
 * since there are only two valid values and a click-to-edit select is
 * faster than typing.
 */
import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { EditableColumnDescriptor } from '@/api/edits'

interface EditableCellProps {
  /** The current persisted value from the row. */
  originalValue: unknown
  /** The pending dirty value, if any; otherwise falls back to originalValue. */
  pendingValue: unknown
  /** True if the field is marked dirty (pending differs from original). */
  dirty: boolean
  /** Column metadata from /api/edit/columns — drives input type & bounds. */
  descriptor: EditableColumnDescriptor
  /** Called when the user commits a new value. */
  onCommit: (value: unknown) => void
  /** Disables editing (e.g. row save in progress). */
  disabled?: boolean
  /** How to render a read-only value (reuses the column's cell formatter). */
  format?: (v: unknown) => string
}

export function EditableCell({
  originalValue,
  pendingValue,
  dirty,
  descriptor,
  onCommit,
  disabled,
  format,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const currentValue = dirty ? pendingValue : originalValue
  const displayed = format ? format(currentValue) : formatDefault(currentValue)

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
            ? `Pending: ${displayed} (was ${formatDefault(originalValue)})`
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
      descriptor={descriptor}
      initial={currentValue}
      onCommit={(v) => {
        onCommit(v)
        setEditing(false)
      }}
      onCancel={() => setEditing(false)}
    />
  )
}

function EditingInput({
  descriptor,
  initial,
  onCommit,
  onCancel,
}: {
  descriptor: EditableColumnDescriptor
  initial: unknown
  onCommit: (v: unknown) => void
  onCancel: () => void
}) {
  // Render as a select if we have explicit allowed_values (e.g. 0/1 flags)
  const allowed = descriptor.allowed_values
  const isFlag =
    allowed && allowed.length === 2 && allowed.includes(0) && allowed.includes(1)

  if (isFlag) {
    return <FlagSelect initial={initial} onCommit={onCommit} onCancel={onCancel} />
  }
  if (allowed && allowed.length > 0) {
    return (
      <AllowedSelect
        allowed={allowed}
        initial={initial}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    )
  }
  return (
    <TextInput
      descriptor={descriptor}
      initial={initial}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  )
}

function FlagSelect({
  initial,
  onCommit,
  onCancel,
}: {
  initial: unknown
  onCommit: (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <select
      ref={ref}
      defaultValue={String(initial ?? 0)}
      className="input py-0.5 px-1 text-xs w-auto"
      onBlur={(e) => onCommit(Number(e.currentTarget.value))}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <option value="0">No</option>
      <option value="1">Yes</option>
    </select>
  )
}

function AllowedSelect({
  allowed,
  initial,
  onCommit,
  onCancel,
}: {
  allowed: unknown[]
  initial: unknown
  onCommit: (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <select
      ref={ref}
      defaultValue={String(initial ?? '')}
      className="input py-0.5 px-1 text-xs w-auto"
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      {allowed.map((v) => (
        <option key={String(v)} value={String(v)}>
          {String(v)}
        </option>
      ))}
    </select>
  )
}

function TextInput({
  descriptor,
  initial,
  onCommit,
  onCancel,
}: {
  descriptor: EditableColumnDescriptor
  initial: unknown
  onCommit: (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState<string>(
    initial === null || initial === undefined ? '' : String(initial),
  )
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const isNumeric = descriptor.kind === 'int' || descriptor.kind === 'bigint'

  function commit() {
    if (value === '' && descriptor.nullable) {
      onCommit(null)
      return
    }
    if (isNumeric) {
      const n = Number(value)
      if (Number.isFinite(n)) {
        onCommit(n)
      } else {
        onCancel()  // invalid input; just cancel
      }
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
      type={isNumeric ? 'number' : 'text'}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      maxLength={descriptor.max_length ?? undefined}
      min={descriptor.min_value ?? undefined}
      max={descriptor.max_value ?? undefined}
      className="input py-0.5 px-1 text-xs w-full min-w-[80px]"
    />
  )
}

function formatDefault(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}
