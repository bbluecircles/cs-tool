/**
 * Step 1: Customer selection.
 *
 * Two modes:
 *   - existing: pick from a searchable dropdown of known customers
 *   - new: fill in customer_name, entity_code, quotas
 *
 * Picking existing skips the dataset step (the customer already has
 * whatever datasets it has). Picking new requires at least one dataset
 * in step 2.
 */
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { listCustomersBrief, type CustomerBrief } from '@/api/users'
import type {
  ExistingCustomerRef,
  NewCustomerInput,
} from '@/api/create_user'
import { Field, NumberField, SectionHeader, TextField } from './formFields'

export type CustomerStepValue =
  | { mode: 'existing'; customer_code: number | null }
  | {
      mode: 'new'
      customer_name: string
      entity_code: string
      max_bytes: number | null
      '5_digit_zip': 0 | 1
      max_row_cnt: number | null
    }

interface CustomerStepProps {
  value: CustomerStepValue
  onChange: (next: CustomerStepValue) => void
  errors?: Partial<Record<string, string>>
}

export function CustomerStep({
  value,
  onChange,
  errors = {},
}: CustomerStepProps) {
  const customers = useQuery({
    queryKey: ['customers-brief'],
    queryFn: () => listCustomersBrief(),
    staleTime: 5 * 60_000,
  })

  function setMode(mode: 'existing' | 'new') {
    if (mode === 'existing') {
      onChange({ mode: 'existing', customer_code: null })
    } else {
      onChange({
        mode: 'new',
        customer_name: '',
        entity_code: '',
        max_bytes: 24_000_000,
        '5_digit_zip': 1,
        max_row_cnt: 200_000,
      })
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader>Customer</SectionHeader>

      <div className="grid grid-cols-2 gap-2">
        <ModeCard
          active={value.mode === 'existing'}
          title="Existing customer"
          description="Attach the user to a customer that already exists."
          onClick={() => setMode('existing')}
        />
        <ModeCard
          active={value.mode === 'new'}
          title="New customer"
          description="Create the customer record and its first dataset."
          onClick={() => setMode('new')}
        />
      </div>

      {value.mode === 'existing' ? (
        <Field
          label="Select customer"
          required
          error={errors.customer_code ?? null}
        >
          <select
            className="input"
            value={value.customer_code ?? ''}
            onChange={(e) =>
              onChange({
                mode: 'existing',
                customer_code: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          >
            <option value="" disabled>
              — choose —
            </option>
            {(customers.data ?? []).map((c: CustomerBrief) => (
              <option key={c.customer_code} value={c.customer_code}>
                {c.customer_name ?? '(unnamed)'} — code {c.customer_code}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Customer name"
            required
            error={errors.customer_name ?? null}
            className="col-span-2"
          >
            <TextField
              value={value.customer_name}
              onChange={(v) =>
                onChange({ ...value, customer_name: v })
              }
              maxLength={80}
              invalid={!!errors.customer_name}
              autoFocus
            />
          </Field>
          <Field label="Entity code" error={errors.entity_code ?? null}>
            <TextField
              value={value.entity_code}
              onChange={(v) =>
                onChange({ ...value, entity_code: v })
              }
              maxLength={15}
              invalid={!!errors.entity_code}
            />
          </Field>
          <Field label="Max rows" hint="Per-query row cap">
            <NumberField
              value={value.max_row_cnt}
              onChange={(v) => onChange({ ...value, max_row_cnt: v })}
              min={0}
              max={2_000_000_000}
            />
          </Field>
          <Field label="Max bytes" hint="Storage quota">
            <NumberField
              value={value.max_bytes}
              onChange={(v) => onChange({ ...value, max_bytes: v })}
              min={0}
            />
          </Field>
          <Field label="5-digit zip">
            <select
              className="input"
              value={value['5_digit_zip']}
              onChange={(e) =>
                onChange({
                  ...value,
                  '5_digit_zip': Number(e.target.value) as 0 | 1,
                })
              }
            >
              <option value={1}>Enabled</option>
              <option value={0}>Disabled</option>
            </select>
          </Field>
        </div>
      )}
    </div>
  )
}

function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-md border p-3 text-left transition-colors',
        active
          ? 'border-secondary-500 bg-secondary-100'
          : 'border-border bg-white hover:bg-gray-50',
      )}
    >
      <div
        className={clsx(
          'text-sm font-medium',
          active ? 'text-secondary-700' : 'text-gray-900',
        )}
      >
        {title}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500">{description}</div>
    </button>
  )
}

/** Coerces CustomerStepValue into the API's customer block. */
export function toCustomerPayload(
  v: CustomerStepValue,
): NewCustomerInput | ExistingCustomerRef | null {
  if (v.mode === 'existing') {
    if (v.customer_code === null) return null
    return { mode: 'existing', customer_code: v.customer_code }
  }
  if (!v.customer_name.trim()) return null
  return {
    mode: 'new',
    customer_name: v.customer_name.trim(),
    entity_code: v.entity_code.trim() || null,
    max_bytes: v.max_bytes,
    '5_digit_zip': v['5_digit_zip'],
    max_row_cnt: v.max_row_cnt,
  }
}

export function validateCustomerStep(
  v: CustomerStepValue,
): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}
  if (v.mode === 'existing') {
    if (v.customer_code === null) errors.customer_code = 'Select a customer.'
  } else {
    if (!v.customer_name.trim()) {
      errors.customer_name = 'Required.'
    } else if (v.customer_name.length > 80) {
      errors.customer_name = 'Max 80 characters.'
    }
    if (v.entity_code && v.entity_code.length > 15) {
      errors.entity_code = 'Max 15 characters.'
    }
  }
  return errors
}
