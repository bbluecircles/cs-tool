/**
 * Generic create-row modal driven by ResourceConfig.
 *
 * Iterates columns where showInCreate is true and renders the appropriate
 * input (text / number / flag-select / enum-select / customer-code picker).
 * Required fields are enforced client-side; the backend validates too.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { createResource } from '@/api/resources'
import type { ColumnDef, ResourceConfig } from './resourceConfigs'
import { CustomerPicker } from './CustomerPicker'
import { DatabasePicker, useDbFeatures } from './DatabasePicker'
import { ModalShell } from './ModalShell'

interface CreateRowModalProps {
  config: ResourceConfig
  onClose: () => void
  onCreated: () => void
}

export function CreateRowModal({
  config,
  onClose,
  onCreated,
}: CreateRowModalProps) {
  const qc = useQueryClient()

  const createFields = useMemo(
    () => config.columns.filter((c) => c.showInCreate),
    [config],
  )

  // Seed form state from createDefault values.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {}
    for (const c of createFields) {
      out[c.key] = c.createDefault ?? defaultForKind(c)
    }
    return out
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Feature flags for the currently picked database (if any). Drives the
  // IP/OP/ED/APR-DRG locks. NO_DB_FEATURES until a database is selected.
  const dbName =
    typeof values.database_name === 'string' ? values.database_name : null
  const features = useDbFeatures(dbName)

  // Apply per-column value overrides. When a column has a
  // computeDisabledOverride that returns { valueOverride: X }, force the
  // form state to X. This is what locks IP/OP/ED/APR-DRG to 0 when the
  // database doesn't support them. Submitted payload reflects what the
  // user sees.
  const effectiveValues = useMemo(() => {
    const out: Record<string, unknown> = { ...values }
    for (const c of createFields) {
      if (!c.computeDisabledOverride) continue
      const override = c.computeDisabledOverride(values, features)
      if (override && 'valueOverride' in override && override.valueOverride !== undefined) {
        out[c.key] = override.valueOverride
      }
    }
    return out
  }, [values, features, createFields])

  function setValue(key: string, v: unknown) {
    setValues((prev) => {
      const next = { ...prev, [key]: v }
      // When the database selection changes, reset every column whose
      // disabled-override depends on db features. Per spec: agent must
      // re-pick IP/OP/ED/APR-DRG after switching databases.
      if (key === 'database_name') {
        for (const c of createFields) {
          if (c.computeDisabledOverride) {
            next[c.key] = 0
          }
        }
      }
      return next
    })
  }

  const m = useMutation({
    mutationFn: () => createResource(config.slug, effectiveValues),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [config.slug] })
      // Customers list also powers pickers elsewhere.
      qc.invalidateQueries({ queryKey: ['customer-picker'] })
      onCreated()
    },
  })

  function validate(): boolean {
    const next: Record<string, string> = {}
    for (const c of createFields) {
      if (c.requiredOnCreate) {
        const v = effectiveValues[c.key]
        if (v === null || v === undefined || v === '') {
          next[c.key] = 'Required.'
        }
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function onSubmit() {
    if (!validate()) return
    m.mutate()
  }

  const submitError =
    m.error instanceof ApiError
      ? m.error.message
      : m.error instanceof Error
        ? m.error.message
        : null

  return (
    <ModalShell onClose={m.isPending ? () => {} : onClose} locked={m.isPending}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Create {config.shortLabel.replace(/s$/, '')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{config.description}</p>
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
        {createFields.map((col) => {
          const override = col.computeDisabledOverride?.(values, features) ?? null
          return (
            <FieldRow
              key={col.key}
              column={col}
              value={effectiveValues[col.key]}
              error={errors[col.key]}
              disabled={override?.disabled ?? false}
              onChange={(v) => setValue(col.key, v)}
            />
          )
        })}
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
          disabled={m.isPending}
        >
          {m.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </ModalShell>
  )
}

function FieldRow({
  column,
  value,
  error,
  disabled,
  onChange,
}: {
  column: ColumnDef
  value: unknown
  error?: string
  disabled?: boolean
  onChange: (v: unknown) => void
}) {
  const spanClass =
    column.createSpan === 1
      ? ''
      : column.createSpan === 2
        ? 'col-span-2'
        : column.kind === 'text' && (column.maxLength ?? 0) > 40
          ? 'col-span-2'
          : ''
  return (
    <div className={`space-y-1 ${spanClass}`}>
      <label className="label">
        {column.label}
        {column.requiredOnCreate && <span className="ml-0.5 text-error-600">*</span>}
      </label>
      <FieldInput
        column={column}
        value={value}
        onChange={onChange}
        invalid={!!error}
        disabled={disabled}
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
  disabled,
}: {
  column: ColumnDef
  value: unknown
  onChange: (v: unknown) => void
  invalid?: boolean
  disabled?: boolean
}) {
  const cls = `input ${invalid ? 'input-error' : ''}`

  if (column.kind === 'customer_code') {
    return (
      <CustomerPicker
        value={typeof value === 'number' ? value : null}
        onChange={(v) => onChange(v)}
        required={column.requiredOnCreate}
        className={cls}
        disabled={disabled}
      />
    )
  }

  if (column.kind === 'database_picker') {
    return (
      <DatabasePicker
        value={typeof value === 'string' && value !== '' ? value : null}
        onChange={(v) => onChange(v)}
        required={column.requiredOnCreate}
        className={cls}
        disabled={disabled}
        requireDischargeFeatures={column.pickerRequireDischargeFeatures}
        requireNoDischargeFeatures={column.pickerRequireNoDischargeFeatures}
      />
    )
  }

  if (column.options && column.options.length > 0) {
    return (
      <select
        className={cls}
        disabled={disabled}
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
        disabled={disabled}
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

  return (
    <input
      type={column.isPassword ? 'text' : 'text'}
      className={cls}
      disabled={disabled}
      value={typeof value === 'string' ? value : ''}
      maxLength={column.maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function defaultForKind(c: ColumnDef): unknown {
  if (c.kind === 'flag' || c.kind === 'int') return c.min ?? 0
  return ''
}