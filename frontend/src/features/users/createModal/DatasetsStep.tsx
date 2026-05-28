/**
 * Step 2 (new-customer path only): datasets.
 *
 * At least one customer_dataset row is required — the user has to have
 * somewhere to land. PPI datasets are optional and enabled only if the
 * customer does PPI work.
 *
 * Kept intentionally lean: database_name, dataset_type, and the handful
 * of flag toggles CS most often sets. Anything else takes the schema
 * default from the backend. Power users can always edit via the main
 * table after creation.
 */
import type { DatasetInput, PpiDatasetInput } from '@/api/create_user'
import { Field, SectionHeader, TextField, Toggle } from './formFields'
import { DatabasePicker, useDbFeatures } from '../../resources/DatabasePicker'

export interface DatasetsStepValue {
  datasets: DatasetInput[]
  ppi_datasets: PpiDatasetInput[]
}

interface DatasetsStepProps {
  value: DatasetsStepValue
  onChange: (next: DatasetsStepValue) => void
  errors?: Partial<Record<string, string>>
}

export function DatasetsStep({
  value,
  onChange,
  errors = {},
}: DatasetsStepProps) {
  function updateDataset(idx: number, patch: Partial<DatasetInput>) {
    const next = value.datasets.map((d, i) =>
      i === idx ? { ...d, ...patch } : d,
    )
    onChange({ ...value, datasets: next })
  }

  function removeDataset(idx: number) {
    onChange({
      ...value,
      datasets: value.datasets.filter((_, i) => i !== idx),
    })
  }

  function addDataset() {
    onChange({
      ...value,
      datasets: [
        ...value.datasets,
        {
          database_name: '',
          // All discharge flags start off; the agent enables the ones the
          // chosen database supports. dataset_type is always 'd' here —
          // claims/PPI rows are added in the PPI section below.
          inpatient: 0,
          outpatient: 0,
          ed: 0,
          aprdrg_flag: 0,
          dataset_type: 'd',
        },
      ],
    })
  }

  function updatePpi(idx: number, patch: Partial<PpiDatasetInput>) {
    const next = value.ppi_datasets.map((d, i) =>
      i === idx ? { ...d, ...patch } : d,
    )
    onChange({ ...value, ppi_datasets: next })
  }

  function removePpi(idx: number) {
    onChange({
      ...value,
      ppi_datasets: value.ppi_datasets.filter((_, i) => i !== idx),
    })
  }

  function addPpi() {
    onChange({
      ...value,
      ppi_datasets: [
        ...value.ppi_datasets,
        { ppi_state: '', ppi_detail: 1, ppi_summary: 1 },
      ],
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between">
          <SectionHeader>Customer datasets</SectionHeader>
          <button
            type="button"
            onClick={addDataset}
            className="btn-secondary text-xs py-1 px-2"
          >
            + Add dataset
          </button>
        </div>
        {errors.datasets && (
          <div className="mt-1 text-[11px] text-error-600">
            {errors.datasets}
          </div>
        )}
        <div className="mt-3 space-y-2">
          {value.datasets.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-gray-500">
              Add at least one dataset so the user has somewhere to land.
            </div>
          )}
          {value.datasets.map((ds, idx) => (
            <DatasetRow
              key={idx}
              dataset={ds}
              onChange={(patch) => updateDataset(idx, patch)}
              onRemove={() => removeDataset(idx)}
              error={errors[`datasets.${idx}.database_name`]}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <SectionHeader>PPI datasets (optional)</SectionHeader>
          <button
            type="button"
            onClick={addPpi}
            className="btn-secondary text-xs py-1 px-2"
          >
            + Add PPI state
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {value.ppi_datasets.length === 0 && (
            <div className="text-[11px] text-gray-500">
              None. Only needed for customers using PPI state-level data.
            </div>
          )}
          {value.ppi_datasets.map((p, idx) => (
            <PpiRow
              key={idx}
              ppi={p}
              onChange={(patch) => updatePpi(idx, patch)}
              onRemove={() => removePpi(idx)}
              error={errors[`ppi_datasets.${idx}.ppi_state`]}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function DatasetRow({
  dataset,
  onChange,
  onRemove,
  error,
}: {
  dataset: DatasetInput
  onChange: (patch: Partial<DatasetInput>) => void
  onRemove: () => void
  error?: string | null
}) {
  // Feature availability for the picked database. NO_DB_FEATURES (all
  // false) until a database is selected, which keeps every flag toggle
  // disabled + off.
  const features = useDbFeatures(dataset.database_name || null)

  // Changing the database resets all four discharge flags to off — the
  // agent re-picks against the new database's capabilities. Matches the
  // standalone Create Discharge modal's behavior.
  function onDatabaseChange(v: string | null) {
    onChange({
      database_name: v ?? '',
      inpatient: 0,
      outpatient: 0,
      ed: 0,
      aprdrg_flag: 0,
    })
  }

  return (
    <div className="rounded-md border border-border bg-gray-50 p-3">
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <Field label="Database name" required error={error ?? null}>
          <DatabasePicker
            value={dataset.database_name || null}
            onChange={onDatabaseChange}
            required
            requireDischargeFeatures
          />
        </Field>
        <button
          type="button"
          onClick={onRemove}
          className="btn-ghost text-xs px-2 py-1"
          aria-label="Remove dataset"
        >
          Remove
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <FeatureToggle
          label="IP"
          checked={!!dataset.inpatient}
          available={features.inpatient}
          onChange={(b) => onChange({ inpatient: b ? 1 : 0 })}
        />
        <FeatureToggle
          label="OP"
          checked={!!dataset.outpatient}
          available={features.outpatient}
          onChange={(b) => onChange({ outpatient: b ? 1 : 0 })}
        />
        <FeatureToggle
          label="ED"
          checked={!!dataset.ed}
          available={features.ed}
          onChange={(b) => onChange({ ed: b ? 1 : 0 })}
        />
        <FeatureToggle
          label="APR-DRG"
          checked={!!dataset.aprdrg_flag}
          available={features.aprdrg}
          onChange={(b) => onChange({ aprdrg_flag: b ? 1 : 0 })}
        />
      </div>
    </div>
  )
}

function PpiRow({
  ppi,
  onChange,
  onRemove,
  error,
}: {
  ppi: PpiDatasetInput
  onChange: (patch: Partial<PpiDatasetInput>) => void
  onRemove: () => void
  error?: string | null
}) {
  return (
    <div className="rounded-md border border-border bg-gray-50 p-3">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
        <Field label="PPI state" required error={error ?? null}>
          <TextField
            value={ppi.ppi_state}
            onChange={(v) => onChange({ ppi_state: v })}
            maxLength={25}
            invalid={!!error}
            placeholder="e.g. az"
          />
        </Field>
        <Toggle
          label="Detail"
          checked={ppi.ppi_detail === 1}
          onChange={(b) => onChange({ ppi_detail: b ? 1 : 0 })}
        />
        <Toggle
          label="Summary"
          checked={ppi.ppi_summary === 1}
          onChange={(b) => onChange({ ppi_summary: b ? 1 : 0 })}
        />
        <button
          type="button"
          onClick={onRemove}
          className="btn-ghost text-xs px-2 py-1"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

/**
 * Discharge-feature toggle. When the picked database doesn't support the
 * feature (`available={false}`), the toggle is disabled and shown off,
 * regardless of the stored value. Once a database that supports it is
 * picked, it becomes interactive again.
 *
 * Note the reset-on-database-change in DatasetRow already zeroes these
 * when the database switches, so `available={false} && checked` should
 * be transient — but we render off defensively in case state lags.
 */
function FeatureToggle({
  label,
  checked,
  available,
  onChange,
}: {
  label: string
  checked: boolean
  available: boolean
  onChange: (b: boolean) => void
}) {
  return (
    <Toggle
      label={label}
      checked={available && checked}
      disabled={!available}
      onChange={(b) => {
        if (!available) return
        onChange(b)
      }}
    />
  )
}

export function validateDatasetsStep(
  v: DatasetsStepValue,
): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}
  if (v.datasets.length === 0) {
    errors.datasets = 'At least one dataset is required.'
  }
  const seen = new Set<string>()
  v.datasets.forEach((d, i) => {
    if (!d.database_name.trim()) {
      errors[`datasets.${i}.database_name`] = 'Required.'
    } else if (seen.has(d.database_name.trim())) {
      errors[`datasets.${i}.database_name`] = 'Duplicate.'
    } else {
      seen.add(d.database_name.trim())
    }
  })
  const ppiSeen = new Set<string>()
  v.ppi_datasets.forEach((p, i) => {
    if (!p.ppi_state.trim()) {
      errors[`ppi_datasets.${i}.ppi_state`] = 'Required.'
    } else if (ppiSeen.has(p.ppi_state.trim())) {
      errors[`ppi_datasets.${i}.ppi_state`] = 'Duplicate.'
    } else {
      ppiSeen.add(p.ppi_state.trim())
    }
  })
  return errors
}