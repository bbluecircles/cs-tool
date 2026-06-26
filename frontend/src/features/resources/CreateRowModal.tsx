/**
 * Generic create-row modal driven by ResourceConfig.
 *
 * Iterates columns where showInCreate is true and renders the appropriate
 * input (text / number / flag-select / enum-select / customer-code picker).
 * Required fields are enforced client-side; the backend validates too.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ApiError, apiErrorDetail } from '@/api/client'
import { createResource } from '@/api/resources'
import type { ColumnDef, ResourceConfig } from './resourceConfigs'
import { CustomerSearchSelect } from './CustomerSearchSelect'
import { DatabasePicker, useDbFeatures } from './DatabasePicker'
import { DatabasePickerMulti } from './DatabasePickerMulti'
import { ModalShell } from './ModalShell'

interface CreateRowModalProps {
  config: ResourceConfig
  onClose: () => void
  onCreated: () => void
  /** Pre-fill the customer_code field — used when the create modal is
   *  launched from a table already filtered by Code. */
  initialCustomerCode?: number | null
}

export function CreateRowModal({
  config,
  onClose,
  onCreated,
  initialCustomerCode,
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
    // Pre-fill the customer when launched from a Code-filtered table.
    if (
      initialCustomerCode != null &&
      createFields.some((c) => c.key === 'customer_code')
    ) {
      out.customer_code = initialCustomerCode
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

  // Submission mode. For Claim (createMultiColumnKey set), we loop one
  // POST per value in that column's array. For everything else, a
  // single POST. Single-row mode goes through a normal useMutation;
  // multi mode uses local state for progress + per-item error capture.
  const multiKey = config.createMultiColumnKey
  const multiValues: string[] =
    multiKey && Array.isArray(effectiveValues[multiKey])
      ? (effectiveValues[multiKey] as string[])
      : []
  const isMultiMode = !!multiKey

  const [multiProgress, setMultiProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [multiResult, setMultiResult] = useState<{
    created: number
    failed: number
    failures: { value: string; error: string }[]
  } | null>(null)

  const m = useMutation({
    mutationFn: () => createResource(config.slug, effectiveValues),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [config.slug] })
      qc.invalidateQueries({ queryKey: ['customer-picker'] })
      onCreated()
    },
    onError: (err) => {
      // Surface a structured field error (e.g. a duplicate user_id) on the
      // offending input, on top of the banner message.
      const d = apiErrorDetail(err)
      if (d?.field) {
        setErrors((prev) => ({
          ...prev,
          [d.field as string]: d.message ?? 'Invalid.',
        }))
      }
    },
  })

  function validate(): boolean {
    const next: Record<string, string> = {}
    for (const c of createFields) {
      if (c.requiredOnCreate) {
        const v = effectiveValues[c.key]
        // For multi columns, "required" means at least one value.
        if (c.createKind === 'database_picker_multi') {
          if (!Array.isArray(v) || v.length === 0) {
            next[c.key] = 'Pick at least one.'
          }
        } else if (v === null || v === undefined || v === '') {
          next[c.key] = 'Required.'
        }
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function doMultiCreate() {
    if (!multiKey) return
    setMultiProgress({ current: 0, total: multiValues.length })
    setMultiResult(null)
    let created = 0
    const failures: { value: string; error: string }[] = []
    for (let i = 0; i < multiValues.length; i++) {
      const v = multiValues[i]!
      setMultiProgress({ current: i + 1, total: multiValues.length })
      // Per-row payload: all the shared fields plus this one value
      // for the multi column.
      const payload: Record<string, unknown> = {
        ...effectiveValues,
        [multiKey]: v,
      }
      try {
        await createResource(config.slug, payload)
        created += 1
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e)
        failures.push({ value: v, error: msg })
      }
    }
    setMultiProgress(null)
    setMultiResult({ created, failed: failures.length, failures })
    qc.invalidateQueries({ queryKey: [config.slug] })
    qc.invalidateQueries({ queryKey: ['multi-picker-exclude'] })
    if (failures.length === 0) {
      // Clean success — close like normal. If any failed, leave the
      // modal open so the agent can see what didn't go through.
      onCreated()
    }
  }

  function onSubmit() {
    if (!validate()) return
    if (isMultiMode) {
      void doMultiCreate()
    } else {
      m.mutate()
    }
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
              allValues={effectiveValues}
            />
          )
        })}
      </div>

      {submitError && (
        <div className="mt-4 rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
          {submitError}
        </div>
      )}

      {/* Multi-create progress / result. Only relevant when the resource
          opted into multi-mode via createMultiColumnKey (Claim today). */}
      {multiProgress !== null && (
        <div className="mt-4 rounded-md border border-secondary-500/40 bg-secondary-100/40 px-3 py-2 text-sm text-gray-900">
          Creating {multiProgress.current} of {multiProgress.total}…
        </div>
      )}
      {multiResult !== null && (
        <div
          className={clsx(
            'mt-4 rounded-md border px-3 py-2 text-sm text-gray-900',
            multiResult.failed === 0
              ? 'border-secondary-500/40 bg-secondary-100/40'
              : 'border-error-600/40 bg-error-100/40',
          )}
        >
          {multiResult.failed === 0
            ? `Created ${multiResult.created} row${multiResult.created === 1 ? '' : 's'}.`
            : `${multiResult.created} created, ${multiResult.failed} failed.`}
          {multiResult.failures.length > 0 && (
            <ul className="mt-1 text-xs space-y-0.5">
              {multiResult.failures.map((f) => (
                <li key={f.value}>
                  <span className="font-mono">{f.value}</span>: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={m.isPending || multiProgress !== null}
        >
          {multiResult !== null && multiResult.failed === 0 ? 'Close' : 'Cancel'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onSubmit}
          disabled={m.isPending || multiProgress !== null}
        >
          {m.isPending || multiProgress !== null
            ? 'Creating…'
            : isMultiMode && multiValues.length > 1
              ? `Create ${multiValues.length} rows`
              : 'Create'}
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
  allValues,
}: {
  column: ColumnDef
  value: unknown
  error?: string
  disabled?: boolean
  onChange: (v: unknown) => void
  allValues?: Record<string, unknown>
}) {
  // An explicit createSpan wins; otherwise a multi-select takes the full
  // row (it shows chips), and long text fields span both columns.
  const isMulti = column.createKind === 'database_picker_multi'
  const spanClass =
    column.createSpan === 1
      ? ''
      : column.createSpan === 2
        ? 'col-span-2'
        : isMulti
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
        allValues={allValues}
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
  allValues,
}: {
  column: ColumnDef
  value: unknown
  onChange: (v: unknown) => void
  invalid?: boolean
  disabled?: boolean
  /** Other form fields, so multi-picker can read customer_code for
   *  its exclude query. Passed through from CreateRowModal. */
  allValues?: Record<string, unknown>
}) {
  const cls = `input ${invalid ? 'input-error' : ''}`

  // Effective kind for the create form. Defaults to base kind unless
  // the column overrides it (only Claim's ppi_state does today).
  const effectiveKind = column.createKind ?? column.kind

  if (effectiveKind === 'database_picker_multi') {
    const customerCode =
      typeof allValues?.customer_code === 'number'
        ? (allValues.customer_code as number)
        : null
    return (
      <DatabasePickerMulti
        values={Array.isArray(value) ? (value as string[]) : []}
        onChange={(v: string[]) => onChange(v)}
        required={column.requiredOnCreate}
        className={cls}
        disabled={disabled}
        requireDischargeFeatures={column.pickerRequireDischargeFeatures}
        requireNoDischargeFeatures={column.pickerRequireNoDischargeFeatures}
        excludeFromResourceSlug={column.pickerExcludeFromResource}
        excludeColumnKey={column.pickerExcludeColumnKey}
        excludeForCustomerCode={customerCode}
      />
    )
  }

  if (column.kind === 'customer_code') {
    return (
      <CustomerSearchSelect
        value={typeof value === 'number' ? value : null}
        onChange={(v) => onChange(v)}
        disabled={disabled}
        invalid={invalid}
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
  // The create form may render this column as a multi-select even if
  // its base kind is single-select. Seed the form value to match what
  // the input expects.
  if (c.createKind === 'database_picker_multi') return []
  if (c.kind === 'flag' || c.kind === 'int') return c.min ?? 0
  return ''
}