/**
 * Generic edit-row modal driven by ResourceConfig.
 *
 * Triggered by double-clicking a row (see ResourceTable). Iterates
 * columns where editable is true and renders the appropriate input
 * (text / number / flag-select / enum-select / customer-code picker /
 * database_picker / datetime). Primary-key columns are shown read-only
 * as a header so the agent sees which row they're editing.
 *
 * Only changed fields are sent in the PATCH body — submitting without
 * changes is a no-op (the modal just closes).
 *
 * NOTE: input rendering is duplicated with CreateRowModal's FieldInput.
 * If we touch field rendering again, extract a shared component. Both
 * modals would benefit, and divergence is a real risk over time.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { revealPassword, updateResource } from '@/api/resources'
import type { ColumnDef, ResourceConfig } from './resourceConfigs'
import { CustomerPicker } from './CustomerPicker'
import { DatabasePicker } from './DatabasePicker'
import { ModalShell } from './ModalShell'

interface EditRowModalProps {
  config: ResourceConfig
  row: Record<string, unknown>
  onClose: () => void
  onSaved: () => void
}

export function EditRowModal({
  config,
  row,
  onClose,
  onSaved,
}: EditRowModalProps) {
  const qc = useQueryClient()

  // Editable fields = columns marked editable. Excludes primary-key
  // columns even if marked editable (changing a PK from the edit form
  // would be confusing UX — use the create flow + delete instead).
  const editableFields = useMemo(
    () =>
      config.columns.filter(
        (c) =>
          c.editable &&
          !config.primaryKeyColumns.includes(c.key) &&
          c.kind !== 'readonly',
      ),
    [config],
  )

  // PK columns shown read-only at the top so the agent sees which row
  // they're editing (e.g. "Customer 42 / database az_main").
  const pkSummary = useMemo(
    () =>
      config.primaryKeyColumns
        .map((key) => {
          const col = config.columns.find((c) => c.key === key)
          const v = row[key]
          return `${col?.label ?? key}: ${v === null || v === undefined ? '—' : v}`
        })
        .join(' • '),
    [row, config],
  )

  // Initialize values from the row. We track all editable fields so a
  // "no changes" check is just shallow-equality against the seed.
  const [seed, setSeed] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {}
    for (const c of editableFields) out[c.key] = row[c.key] ?? null
    return out
  })
  const [values, setValues] = useState<Record<string, unknown>>(seed)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Password columns aren't returned by the list endpoint, so the row
  // carries no value for them — the input would render empty. Fetch the
  // current password on open (audited server-side) and seed it so the
  // field shows the real value, masked, with a reveal toggle. Seeding
  // BOTH seed and values means an untouched password isn't counted as a
  // change; an edited one is.
  const passwordCols = useMemo(
    () => editableFields.filter((c) => c.isPassword),
    [editableFields],
  )
  const [pwLoading, setPwLoading] = useState(passwordCols.length > 0)
  const [pwError, setPwError] = useState<string | null>(null)

  useEffect(() => {
    if (passwordCols.length === 0) return
    const uid = row.user_id
    const cc = row.customer_code
    if (uid === undefined || uid === null || cc === undefined || cc === null) {
      setPwLoading(false)
      return
    }
    let cancelled = false
    setPwLoading(true)
    setPwError(null)
    revealPassword(String(uid), Number(cc))
      .then((r) => {
        if (cancelled) return
        const pw = r.user_password
        setSeed((prev) => {
          const next = { ...prev }
          for (const c of passwordCols) next[c.key] = pw
          return next
        })
        setValues((prev) => {
          const next = { ...prev }
          for (const c of passwordCols) {
            // Don't clobber an edit the agent already started typing.
            if (shallowEqual(prev[c.key], seed[c.key])) next[c.key] = pw
          }
          return next
        })
      })
      .catch((e) => {
        if (!cancelled) {
          setPwError(e instanceof Error ? e.message : 'Failed to load password')
        }
      })
      .finally(() => {
        if (!cancelled) setPwLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Run once on open. seed/passwordCols are stable for the modal's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const m = useMutation({
    mutationFn: (changes: Record<string, unknown>) => {
      const idPath = config.primaryKeyColumns
        .map((k) => String(row[k] ?? ''))
        .join('/')
      return updateResource(config.slug, idPath, changes)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [config.slug] })
      qc.invalidateQueries({ queryKey: ['customer-picker'] })
      onSaved()
    },
  })

  function validate(changes: Record<string, unknown>): boolean {
    const next: Record<string, string> = {}
    for (const c of editableFields) {
      // Only validate fields the agent actually touched. Required-on-
      // create doesn't apply here — the row already exists and we're
      // patching, so an unchanged required field is fine.
      if (!(c.key in changes)) continue
      const v = changes[c.key]
      if (
        c.kind === 'text' &&
        c.maxLength &&
        typeof v === 'string' &&
        v.length > c.maxLength
      ) {
        next[c.key] = `Max ${c.maxLength} chars.`
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function onSubmit() {
    // Build a changeset: only fields that actually differ.
    const changes: Record<string, unknown> = {}
    for (const c of editableFields) {
      if (!shallowEqual(values[c.key], seed[c.key])) {
        changes[c.key] = values[c.key]
      }
    }
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }
    if (!validate(changes)) return
    m.mutate(changes)
  }

  const submitError =
    m.error instanceof ApiError
      ? m.error.message
      : m.error instanceof Error
        ? m.error.message
        : null

  const isDirty = editableFields.some(
    (c) => !shallowEqual(values[c.key], seed[c.key]),
  )

  return (
    <ModalShell onClose={m.isPending ? () => {} : onClose} locked={m.isPending}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Edit {config.shortLabel.replace(/s$/, '')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{pkSummary}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={m.isPending}
          className="text-gray-400 hover:text-gray-600 text-sm"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {editableFields.map((col) => (
          <FieldRow
            key={col.key}
            column={col}
            value={values[col.key]}
            error={
              errors[col.key] ?? (col.isPassword ? pwError ?? undefined : undefined)
            }
            loading={col.isPassword ? pwLoading : false}
            onChange={(v) =>
              setValues((prev) => ({ ...prev, [col.key]: v }))
            }
          />
        ))}
      </div>

      {submitError && (
        <div className="mt-4 rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
          {submitError}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={m.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onSubmit}
          disabled={m.isPending || !isDirty}
        >
          {m.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </ModalShell>
  )
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null && b === undefined) return true
  if (a === undefined && b === null) return true
  return String(a) === String(b)
}

function FieldRow({
  column,
  value,
  error,
  loading,
  onChange,
}: {
  column: ColumnDef
  value: unknown
  error?: string
  loading?: boolean
  onChange: (v: unknown) => void
}) {
  const spanClass =
    column.kind === 'text' && (column.maxLength ?? 0) > 40
      ? 'col-span-2'
      : ''
  return (
    <div className={`space-y-1 ${spanClass}`}>
      <label className="label">{column.label}</label>
      <FieldInput
        column={column}
        value={value}
        onChange={onChange}
        invalid={!!error}
        loading={loading}
      />
      {error && <div className="text-[11px] text-error-600">{error}</div>}
    </div>
  )
}

function FieldInput({
  column,
  value,
  onChange,
  invalid,
  loading,
}: {
  column: ColumnDef
  value: unknown
  onChange: (v: unknown) => void
  invalid?: boolean
  loading?: boolean
}) {
  const cls = `input ${invalid ? 'input-error' : ''}`

  if (column.isPassword) {
    return (
      <PasswordField
        value={value}
        onChange={onChange}
        invalid={invalid}
        loading={loading}
        maxLength={column.maxLength}
      />
    )
  }

  if (column.kind === 'customer_code') {
    return (
      <CustomerPicker
        value={typeof value === 'number' ? value : null}
        onChange={(v) => onChange(v)}
        className={cls}
      />
    )
  }

  if (column.kind === 'database_picker') {
    return (
      <DatabasePicker
        value={typeof value === 'string' && value !== '' ? value : null}
        onChange={(v) => onChange(v)}
        className={cls}
        emphasize={false}
        requireDischargeFeatures={column.pickerRequireDischargeFeatures}
        requireNoDischargeFeatures={column.pickerRequireNoDischargeFeatures}
      />
    )
  }

  if (column.options && column.options.length > 0) {
    return (
      <select
        className={cls}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => {
          if (column.kind === 'flag' || column.kind === 'int') {
            onChange(e.target.value === '' ? null : Number(e.target.value))
          } else {
            onChange(e.target.value)
          }
        }}
      >
        {column.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  if (column.kind === 'int') {
    return (
      <input
        type="number"
        className={cls}
        value={typeof value === 'number' ? value : ''}
        min={column.min}
        max={column.max}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') onChange(null)
          else {
            const n = Number(raw)
            onChange(Number.isFinite(n) ? n : null)
          }
        }}
      />
    )
  }

  if (column.kind === 'datetime') {
    // Native date input. Backend coerces YYYY-MM-DD strings.
    const initial =
      typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : ''
    return (
      <input
        type="date"
        className={cls}
        value={initial}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : e.target.value)
        }
      />
    )
  }

  return (
    <input
      type="text"
      className={cls}
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      maxLength={column.maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * Password input: masked by default with an inline reveal/hide toggle.
 * The value is the user's real password (fetched on modal open). While
 * that fetch is in flight the input is disabled and shows a placeholder.
 */
function PasswordField({
  value,
  onChange,
  invalid,
  loading,
  maxLength,
}: {
  value: unknown
  onChange: (v: unknown) => void
  invalid?: boolean
  loading?: boolean
  maxLength?: number
}) {
  const [revealed, setRevealed] = useState(false)
  const cls = `input pr-14 ${invalid ? 'input-error' : ''}`
  return (
    <div className="relative">
      <input
        type={revealed ? 'text' : 'password'}
        className={cls}
        value={
          typeof value === 'string' ? value : value == null ? '' : String(value)
        }
        placeholder={loading ? 'Loading…' : ''}
        disabled={loading}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        disabled={loading}
        tabIndex={-1}
        className="absolute inset-y-0 right-2 my-auto text-[11px] text-secondary-500 hover:text-secondary-700 disabled:opacity-50"
      >
        {revealed ? 'hide' : 'reveal'}
      </button>
    </div>
  )
}