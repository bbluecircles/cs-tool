/**
 * Create-user modal.
 *
 * A wizard with 2 or 3 steps depending on path:
 *   - Existing customer: [Customer] → [User]
 *   - New customer:      [Customer] → [Datasets] → [User]
 *
 * State lives here. Each step is a pure component that takes its slice of
 * state and emits changes back up. Validation runs on each Next click;
 * blocked transitions surface errors inline.
 *
 * Submit hits POST /api/users. On success we close the modal, invalidate
 * the users list, and surface the sync result (refresh/grants) via a
 * toast-style banner so the CS agent knows if post-commit sync failed.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ApiError } from '@/api/client'
import {
  createUser,
  type CreateUserRequest,
  type CreateUserResponse,
} from '@/api/create_user'
import {
  CustomerStep,
  toCustomerPayload,
  validateCustomerStep,
  type CustomerStepValue,
} from './CustomerStep'
import {
  DatasetsStep,
  validateDatasetsStep,
  type DatasetsStepValue,
} from './DatasetsStep'
import {
  UserStep,
  defaultUserStepValue,
  validateUserStep,
  type AvailabilityState,
  type UserStepValue,
} from './UserStep'

interface CreateUserModalProps {
  onClose: () => void
  onCreated: (result: CreateUserResponse) => void
}

type StepId = 'customer' | 'datasets' | 'user'

export function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const qc = useQueryClient()

  const [customer, setCustomer] = useState<CustomerStepValue>({
    mode: 'existing',
    customer_code: null,
  })
  const [datasets, setDatasets] = useState<DatasetsStepValue>({
    datasets: [],
    ppi_datasets: [],
  })
  const [user, setUser] = useState<UserStepValue>(defaultUserStepValue())
  const [availability, setAvailability] = useState<AvailabilityState>('idle')

  const [step, setStep] = useState<StepId>('customer')
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})

  const steps: StepId[] =
    customer.mode === 'new'
      ? ['customer', 'datasets', 'user']
      : ['customer', 'user']
  const stepIdx = steps.indexOf(step)
  const isFirst = stepIdx === 0
  const isLast = stepIdx === steps.length - 1

  const create = useMutation({
    mutationFn: (req: CreateUserRequest) => createUser(req),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['customers-brief'] })
      qc.invalidateQueries({ queryKey: ['databases-brief'] })
      onCreated(res)
    },
  })

  function validateCurrent(): boolean {
    if (step === 'customer') {
      const e = validateCustomerStep(customer)
      setErrors(e)
      return Object.keys(e).length === 0
    }
    if (step === 'datasets') {
      const e = validateDatasetsStep(datasets)
      setErrors(e)
      return Object.keys(e).length === 0
    }
    if (step === 'user') {
      const e = validateUserStep(user)
      if (availability === 'taken') e.user_id = 'Already taken — pick another.'
      setErrors(e)
      return Object.keys(e).length === 0
    }
    return true
  }

  function onNext() {
    if (!validateCurrent()) return
    const next = steps[stepIdx + 1]
    if (next) {
      setStep(next)
      setErrors({})
    }
  }

  function onBack() {
    const prev = steps[stepIdx - 1]
    if (prev) {
      setStep(prev)
      setErrors({})
    }
  }

  function onSubmit() {
    if (!validateCurrent()) return
    const customerPayload = toCustomerPayload(customer)
    if (!customerPayload) {
      // Should not happen given validation, but guard regardless.
      setErrors({ customer_code: 'Customer is invalid.' })
      setStep('customer')
      return
    }
    const req: CreateUserRequest = {
      customer: customerPayload,
      datasets:
        customer.mode === 'new' ? datasets.datasets : datasets.datasets,
      ppi_datasets:
        customer.mode === 'new'
          ? datasets.ppi_datasets
          : datasets.ppi_datasets,
      user,
    }
    create.mutate(req)
  }

  const submitError = useMemo(() => {
    if (!create.error) return null
    if (create.error instanceof ApiError) {
      // 409 = user_id conflict or validation error with a detail message
      return create.error.message
    }
    return create.error instanceof Error
      ? create.error.message
      : 'Unknown error'
  }, [create.error])

  return (
    <ModalShell onClose={create.isPending ? () => {} : onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Create user</h2>
          <StepCrumb steps={steps} current={step} />
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={create.isPending}
          className="text-gray-400 hover:text-gray-600 text-sm"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="mt-4">
        {step === 'customer' && (
          <CustomerStep
            value={customer}
            onChange={(v) => {
              setCustomer(v)
              // Changing customer mode resets downstream steps to avoid
              // carrying stale data across modes.
              if (v.mode === 'existing') {
                setDatasets({ datasets: [], ppi_datasets: [] })
              }
              setErrors({})
            }}
            errors={errors}
          />
        )}
        {step === 'datasets' && (
          <DatasetsStep
            value={datasets}
            onChange={setDatasets}
            errors={errors}
          />
        )}
        {step === 'user' && (
          <UserStep
            value={user}
            onChange={setUser}
            errors={errors}
            onAvailabilityChange={setAvailability}
          />
        )}
      </div>

      {submitError && (
        <div className="mt-4 rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600">
          {submitError}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={onBack}
          disabled={isFirst || create.isPending}
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </button>
          {!isLast ? (
            <button
              type="button"
              className="btn-primary"
              onClick={onNext}
              disabled={create.isPending}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={onSubmit}
              disabled={create.isPending || availability === 'taken'}
            >
              {create.isPending ? 'Creating…' : 'Create user'}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

function StepCrumb({
  steps,
  current,
}: {
  steps: StepId[]
  current: StepId
}) {
  const label: Record<StepId, string> = {
    customer: 'Customer',
    datasets: 'Datasets',
    user: 'User',
  }
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px]">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          <span
            className={clsx(
              'rounded-full px-2 py-0.5',
              s === current
                ? 'bg-secondary-100 text-secondary-700 font-medium'
                : 'text-gray-500',
            )}
          >
            {i + 1}. {label[s]}
          </span>
          {i < steps.length - 1 && (
            <span className="text-gray-300" aria-hidden>
              ›
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl p-6 shadow-modal max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/** Result banner shown after a successful create, mirroring edit's SyncResultToast. */
export function CreateResultToast({
  result,
  onDismiss,
}: {
  result: CreateUserResponse
  onDismiss: () => void
}) {
  const both = result.refresh_ok && result.grants_ok
  const tone = both
    ? 'bg-success-100 text-success-600 border-success-600/30'
    : 'bg-warning-100 text-warning-600 border-warning-600/30'
  return (
    <div
      className={clsx(
        'fixed bottom-4 right-4 z-40 rounded-md border px-4 py-3 shadow-card max-w-sm',
        tone,
      )}
    >
      <div className="font-medium">
        {both
          ? `Created ${result.user_id}`
          : `Created ${result.user_id}, sync incomplete`}
      </div>
      <div className="mt-1 text-[11px] text-gray-900">
        {result.customer_created && (
          <div>New customer code: {result.customer_code}</div>
        )}
        {result.datasets_created > 0 && (
          <div>{result.datasets_created} dataset(s) added.</div>
        )}
        {!both && (
          <>
            {!result.refresh_ok && (
              <div>Refresh failed: {result.refresh_error}</div>
            )}
            {!result.grants_ok && (
              <div>Grants failed: {result.grants_error}</div>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-[11px] underline"
      >
        Dismiss
      </button>
    </div>
  )
}
