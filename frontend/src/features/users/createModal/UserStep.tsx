/**
 * Step 3: user details.
 *
 * - user_id is checked against the server as the agent types (debounced)
 *   so they see a live "available / taken" indicator.
 * - password is plaintext (legacy schema constraint, max 15 chars); we
 *   offer a show/hide toggle so the agent can verify what they typed.
 * - Access flags group into a single toggle grid rather than a per-flag
 *   row, because there are a lot of them and they're mostly booleans.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ApiError } from '@/api/client'
import { checkUserId } from '@/api/create_user'
import type { UserInput } from '@/api/create_user'
import { Field, NumberField, SectionHeader, TextField, Toggle } from './formFields'

export type UserStepValue = UserInput

interface UserStepProps {
  value: UserStepValue
  onChange: (next: UserStepValue) => void
  errors?: Partial<Record<string, string>>
  /** Result of availability check exposed so the modal can gate Next. */
  onAvailabilityChange?: (state: AvailabilityState) => void
}

export type AvailabilityState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'taken'
  | 'error'

export function UserStep({
  value,
  onChange,
  errors = {},
  onAvailabilityChange,
}: UserStepProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [availability, setAvailability] = useState<AvailabilityState>('idle')

  // Debounced availability check. Only fires when user_id passes basic
  // shape validation — no point asking the server about obviously-invalid IDs.
  useEffect(() => {
    const uid = value.user_id.trim()
    if (!uid) {
      setAvailability('idle')
      onAvailabilityChange?.('idle')
      return
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(uid) || uid.length > 15) {
      setAvailability('idle')
      onAvailabilityChange?.('idle')
      return
    }

    setAvailability('checking')
    onAvailabilityChange?.('checking')

    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await checkUserId(uid)
        if (cancelled) return
        const next: AvailabilityState = r.available ? 'available' : 'taken'
        setAvailability(next)
        onAvailabilityChange?.(next)
      } catch (e) {
        if (cancelled) return
        // On error, don't block the agent — let the server make the final
        // call on submit. Just tell them we couldn't check.
        const next: AvailabilityState =
          e instanceof ApiError ? 'error' : 'error'
        setAvailability(next)
        onAvailabilityChange?.(next)
      }
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.user_id])

  const passwordLenHint = useMemo(() => {
    const n = value.user_password.length
    return `${n}/15 characters`
  }, [value.user_password])

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionHeader>Identity</SectionHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="User ID"
            required
            error={errors.user_id ?? null}
            hint={availabilityHint(availability)}
          >
            <div className="relative">
              <TextField
                value={value.user_id}
                onChange={(v) =>
                  onChange({ ...value, user_id: v.toLowerCase() })
                }
                maxLength={15}
                invalid={
                  !!errors.user_id || availability === 'taken'
                }
                autoFocus
              />
              <AvailabilityDot state={availability} />
            </div>
          </Field>

          <Field
            label="Password"
            required
            error={errors.user_password ?? null}
            hint={passwordLenHint}
          >
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={value.user_password}
                onChange={(e) =>
                  onChange({ ...value, user_password: e.target.value })
                }
                maxLength={15}
                className={clsx(
                  'input pr-16',
                  errors.user_password && 'input-error',
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 right-2 text-[11px] text-secondary-500 hover:text-secondary-700"
              >
                {showPassword ? 'hide' : 'show'}
              </button>
            </div>
          </Field>

          <Field label="First name" required error={errors.first_name ?? null}>
            <TextField
              value={value.first_name}
              onChange={(v) => onChange({ ...value, first_name: v })}
              maxLength={35}
              invalid={!!errors.first_name}
            />
          </Field>
          <Field label="Last name" required error={errors.last_name ?? null}>
            <TextField
              value={value.last_name}
              onChange={(v) => onChange({ ...value, last_name: v })}
              maxLength={35}
              invalid={!!errors.last_name}
            />
          </Field>
          <Field
            label="Email"
            required
            error={errors.e_mail ?? null}
            className="col-span-2"
          >
            <TextField
              value={value.e_mail}
              onChange={(v) => onChange({ ...value, e_mail: v })}
              type="email"
              maxLength={200}
              invalid={!!errors.e_mail}
            />
          </Field>
        </div>

        {/**<Toggle
          label="Use password prefix (pw_flag)"
          description="Prepends the block21 prefix to the password on login. Leave off unless you know you need it."
          checked={value.pw_flag === 1}
          onChange={(b) => onChange({ ...value, pw_flag: b ? 1 : 0 })}
        />*/}
      </div>

      <div className="space-y-3">
        <SectionHeader>Access</SectionHeader>
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            label="Web user"
            checked={value.webuser === 1}
            onChange={(b) => onChange({ ...value, webuser: b ? 1 : 0 })}
          />
          <Toggle
            label="PPI user"
            checked={value.ppiuser === 1}
            onChange={(b) => onChange({ ...value, ppiuser: b ? 1 : 0 })}
          />
          <Toggle
            label="ESRI access"
            checked={value.esri_access === 1}
            onChange={(b) => onChange({ ...value, esri_access: b ? 1 : 0 })}
          />
          <Toggle
            label="ESRI TAP access"
            checked={value.esri_tap_access === 1}
            onChange={(b) =>
              onChange({ ...value, esri_tap_access: b ? 1 : 0 })
            }
          />
          {/** <Toggle
            label="Mapping"
            checked={value.mapping === 1}
            onChange={(b) => onChange({ ...value, mapping: b ? 1 : 0 })}
          /> */}
          {/** <Toggle
            label="Logging"
            checked={value.logging_flag === 1}
            onChange={(b) => onChange({ ...value, logging_flag: b ? 1 : 0 })}
          /> */}
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader>Web access</SectionHeader>
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            label="Web inpatient"
            checked={value.web_inpatient_access === 1}
            onChange={(b) =>
              onChange({ ...value, web_inpatient_access: b ? 1 : 0 })
            }
          />
          <Toggle
            label="Web outpatient"
            checked={value.web_outpatient_access === 1}
            onChange={(b) =>
              onChange({ ...value, web_outpatient_access: b ? 1 : 0 })
            }
          />
          <Toggle
            label="Web ED"
            checked={value.web_ed_access === 1}
            onChange={(b) =>
              onChange({ ...value, web_ed_access: b ? 1 : 0 })
            }
          />
          <Toggle
            label="Web claims"
            checked={value.web_claims_access === 1}
            onChange={(b) =>
              onChange({ ...value, web_claims_access: b ? 1 : 0 })
            }
          />
          <Toggle
            label="Web ESRI"
            checked={value.web_esri_access === 1}
            onChange={(b) =>
              onChange({ ...value, web_esri_access: b ? 1 : 0 })
            }
          />
          <Toggle
            label="Web ESRI TAP"
            checked={value.web_esri_tap_access === 1}
            onChange={(b) =>
              onChange({ ...value, web_esri_tap_access: b ? 1 : 0 })
            }
          />
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader>Limits</SectionHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="User priority" hint="0 (low) to 10 (high)">
            <NumberField
              value={value.user_priority ?? 1}
              onChange={(v) =>
                onChange({ ...value, user_priority: v ?? 1 })
              }
              min={0}
              max={10}
            />
          </Field>
          <Field label="Max BIRT processes" hint="Concurrent report jobs">
            <NumberField
              value={value.max_birt_processes ?? 1}
              onChange={(v) =>
                onChange({ ...value, max_birt_processes: v ?? 1 })
              }
              min={1}
              max={20}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

function AvailabilityDot({ state }: { state: AvailabilityState }) {
  if (state === 'idle') return null
  const color =
    state === 'available'
      ? 'bg-success-600'
      : state === 'taken'
        ? 'bg-error-600'
        : state === 'error'
          ? 'bg-warning-600'
          : 'bg-gray-300'
  return (
    <span
      className={clsx(
        'absolute right-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full',
        color,
        state === 'checking' && 'animate-pulse',
      )}
      aria-hidden
    />
  )
}

function availabilityHint(state: AvailabilityState): string | undefined {
  switch (state) {
    case 'available': return 'Available.'
    case 'taken':     return 'Already taken — pick another.'
    case 'checking':  return 'Checking…'
    case 'error':     return 'Could not verify. We will re-check on submit.'
    default:          return undefined
  }
}

export function defaultUserStepValue(): UserStepValue {
  return {
    user_id: '',
    user_password: '',
    pw_flag: 0,
    e_mail: '',
    first_name: '',
    last_name: '',
    logging_flag: 0,
    esri_access: 0,
    esri_tap_access: 0,
    webuser: 1,
    ppiuser: 0,
    mapping: 0,
    user_priority: 1,
    max_birt_processes: 1,
    ppi_detail_user: 0,
    web_esri_access: 0,
    web_esri_tap_access: 0,
    web_inpatient_access: 0,
    web_outpatient_access: 0,
    web_ed_access: 0,
    web_claims_access: 0,
  }
}

export function validateUserStep(
  v: UserStepValue,
): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}

  if (!v.user_id.trim()) errors.user_id = 'Required.'
  else if (!/^[a-z0-9_.-]+$/.test(v.user_id))
    errors.user_id = 'Only lowercase letters, digits, _ . - allowed.'
  else if (v.user_id.length > 15) errors.user_id = 'Max 15 characters.'

  if (!v.user_password) errors.user_password = 'Required.'
  else if (v.user_password.length > 15)
    errors.user_password = 'Max 15 characters.'

  if (!v.first_name.trim()) errors.first_name = 'Required.'
  if (!v.last_name.trim()) errors.last_name = 'Required.'

  if (!v.e_mail.trim()) errors.e_mail = 'Required.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.e_mail))
    errors.e_mail = 'Invalid email format.'

  return errors
}
