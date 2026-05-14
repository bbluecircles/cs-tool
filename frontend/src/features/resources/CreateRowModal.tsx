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
import { DatabasePicker } from './DatabasePicker'
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

  const m = useMutation({
    mutationFn: () => createResource(config.slug, values),
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
        const v = values[c.key]
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
        {createFields.map((col) => (
          <FieldRow
            key={col.key}
            column={col}
            value={values[col.key]}
            error={errors[col.key]}
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
  onChange,
}: {
  column: ColumnDef
  value: unknown
  error?: string
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
      <FieldInput column={column} value={value} onChange={onChange} invalid={!!error} />
      {error && <div className="text-[11px] text-error-600">{error}</div>}
    </div>
  )
}

function FieldInput({
  column,
  value,
  onChange,
  invalid,
}: {
  column: ColumnDef
  value: unknown
  onChange: (v: unknown) => void
  invalid?: boolean
}) {
  const cls = `input ${invalid ? 'input-error' : ''}`

  if (column.kind === 'customer_code') {
    return (
      <CustomerPicker
        value={typeof value === 'number' ? value : null}
        onChange={(v) => onChange(v)}
        required={column.requiredOnCreate}
        className={cls}
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

  return (
    <input
      type={column.isPassword ? 'text' : 'text'}
      className={cls}
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