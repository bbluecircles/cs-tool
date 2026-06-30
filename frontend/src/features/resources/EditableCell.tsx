/**
 * Click-to-edit cell. Driven by the column's ColumnDef so the input type
 * (text / number / flag-select / enum-select / database picker / date) comes
 * from the config.
 *
 * Edits are tracked LIVE: the value flows to onCommit (the dirty store) on
 * every change, so the "N unsaved changes" banner updates immediately —
 * without waiting for the agent to click out of the cell. Blur / Enter just
 * close the editor (the value is already tracked); Escape reverts (which
 * clears the dirty entry, since writing the original back is a no-op there).
 */
import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ColumnDef } from './resourceConfigs'
import { DatabasePicker } from './DatabasePicker'

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
          // State/database columns: bold + uppercase for visibility.
          column.emphasize && 'font-bold uppercase',
        )}
        title={
          dirty
            ? `Pending: ${displayed} (was ${formatForDisplay(column, originalValue)})`
            : 'Click to edit'
        }
      >
        {column.boldBeforeDash ? <BoldBeforeDash text={displayed} /> : displayed}
        {dirty && <span className="ml-1 text-[10px] text-warning-600">●</span>}
      </button>
    )
  }

  return (
    <EditingInput
      column={column}
      initial={current}
      onLiveChange={onCommit}
      onClose={() => setEditing(false)}
      onCancel={() => {
        // Revert: writing the original value back clears the dirty entry
        // (useDirtyRows.valueEquals), then close.
        onCommit(originalValue)
        setEditing(false)
      }}
    />
  )
}

interface EditingProps {
  column: ColumnDef
  initial: unknown
  /** Fires on every value change — updates the dirty store live. */
  onLiveChange: (v: unknown) => void
  /** Finalize/close the editor (blur, Enter, or a committed pick). */
  onClose: () => void
  /** Revert the live edit and close (Escape). */
  onCancel: () => void
}

function EditingInput({
  column,
  initial,
  onLiveChange,
  onClose,
  onCancel,
}: EditingProps) {
  if (column.kind === 'database_picker') {
    return (
      <DatabasePickerInput
        column={column}
        initial={initial}
        onLiveChange={onLiveChange}
        onClose={onClose}
        onCancel={onCancel}
      />
    )
  }
  if (column.options && column.options.length > 0) {
    return (
      <SelectInput
        options={column.options}
        initial={initial}
        kind={column.kind}
        onLiveChange={onLiveChange}
        onClose={onClose}
        onCancel={onCancel}
      />
    )
  }
  if (column.kind === 'datetime') {
    return (
      <DateInput
        initial={initial}
        onLiveChange={onLiveChange}
        onClose={onClose}
        onCancel={onCancel}
      />
    )
  }
  return (
    <TextLikeInput
      column={column}
      initial={initial}
      onLiveChange={onLiveChange}
      onClose={onClose}
      onCancel={onCancel}
    />
  )
}

function DateInput({
  initial,
  onLiveChange,
  onClose,
  onCancel,
}: {
  initial: unknown
  onLiveChange: (v: unknown) => void
  onClose: () => void
  onCancel: () => void
}) {
  const initialDate =
    typeof initial === 'string' && initial.length >= 10
      ? initial.slice(0, 10)
      : ''
  // UNCONTROLLED on purpose. A native <input type="date"> edits in
  // segments (MM/DD/YYYY). If we commit on every keystroke, the first
  // year digit zero-pads to a *valid* date (e.g. 0002-02-04), and React
  // re-applying that as a controlled `value` makes the browser finalize
  // the year at 0002 — you can't finish typing 2020. So we leave the DOM
  // input to manage its own segment state (defaultValue) and only read +
  // commit the value on blur / Enter.
  const ref = useRef<HTMLInputElement>(null)
  const finalized = useRef(false)

  function commitAndClose() {
    if (finalized.current) return
    finalized.current = true
    const v = ref.current?.value ?? ''
    onLiveChange(v === '' ? null : v)
    onClose()
  }
  function cancel() {
    if (finalized.current) return
    finalized.current = true
    onCancel()
  }

  return (
    <input
      ref={ref}
      type="date"
      autoFocus
      defaultValue={initialDate}
      className="input py-0.5 px-1 text-xs w-auto"
      // Blur fires during unmount after Enter/Escape too; the finalized
      // guard makes that a no-op so a revert (Escape) isn't overwritten.
      onBlur={commitAndClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commitAndClose()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
    />
  )
}

function DatabasePickerInput({
  column,
  initial,
  onLiveChange,
  onClose,
  onCancel,
}: {
  column: ColumnDef
  initial: unknown
  onLiveChange: (v: unknown) => void
  onClose: () => void
  onCancel: () => void
}) {
  const [value, setValue] = useState<string | null>(
    typeof initial === 'string' && initial !== '' ? initial : null,
  )
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <DatabasePicker
        value={value}
        onChange={(v) => {
          setValue(v)
          onLiveChange(v)
          onClose()
        }}
        preserveUnknownValue
        requireDischargeFeatures={column.pickerRequireDischargeFeatures}
        requireNoDischargeFeatures={column.pickerRequireNoDischargeFeatures}
        className="input py-0.5 px-1 text-xs w-auto"
      />
    </div>
  )
}

function SelectInput({
  options,
  initial,
  kind,
  onLiveChange,
  onClose,
  onCancel,
}: {
  options: { value: string | number; label: string }[]
  initial: unknown
  kind: ColumnDef['kind']
  onLiveChange: (v: unknown) => void
  onClose: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => ref.current?.focus(), [])

  function coerce(raw: string): unknown {
    if (kind === 'flag' || kind === 'int') return raw === '' ? null : Number(raw)
    return raw
  }

  return (
    <select
      ref={ref}
      defaultValue={initial === null || initial === undefined ? '' : String(initial)}
      className="input py-0.5 px-1 text-xs w-auto"
      // Live: picking updates the dirty store immediately. The editor closes
      // on blur (so keyboard arrow-navigation through options still works).
      onChange={(e) => onLiveChange(coerce(e.currentTarget.value))}
      onBlur={onClose}
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
  onLiveChange,
  onClose,
  onCancel,
}: {
  column: ColumnDef
  initial: unknown
  onLiveChange: (v: unknown) => void
  onClose: () => void
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

  function emit(text: string) {
    if (text === '') {
      onLiveChange(null)
      return
    }
    if (isNumeric) {
      const n = Number(text)
      onLiveChange(Number.isFinite(n) ? n : null)
      return
    }
    onLiveChange(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onClose()
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
      onChange={(e) => {
        setValue(e.target.value)
        emit(e.target.value)
      }}
      onBlur={onClose}
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

/** Bold the "ABBR" before the em dash in an "ABBR — Name" label. */
function BoldBeforeDash({ text }: { text: string }) {
  const sep = ' — '
  const idx = text.indexOf(sep)
  if (idx < 0) return <>{text}</>
  return (
    <>
      <strong className="font-semibold">{text.slice(0, idx)}</strong>
      {text.slice(idx)}
    </>
  )
}
