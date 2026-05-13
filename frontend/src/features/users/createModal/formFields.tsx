/**
 * Minimal form primitives for the create-user modal.
 *
 * Keeps the modal file focused on structure rather than repeating
 * label + input + error markup over and over.
 */
import { ReactNode } from 'react'
import clsx from 'clsx'

interface FieldProps {
  label: string
  required?: boolean
  error?: string | null
  hint?: string
  children: ReactNode
  className?: string
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
  className,
}: FieldProps) {
  return (
    <div className={clsx('space-y-1', className)}>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-error-600">*</span>}
      </label>
      {children}
      {error && (
        <div className="text-[11px] text-error-600" role="alert">
          {error}
        </div>
      )}
      {!error && hint && (
        <div className="text-[11px] text-gray-500">{hint}</div>
      )}
    </div>
  )
}

interface TextFieldProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  maxLength?: number
  type?: 'text' | 'email' | 'password' | 'number'
  autoFocus?: boolean
  id?: string
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  maxLength,
  type = 'text',
  autoFocus,
  id,
}: TextFieldProps) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      autoFocus={autoFocus}
      className={clsx('input', invalid && 'input-error')}
    />
  )
}

interface NumberFieldProps {
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  max?: number
  disabled?: boolean
  placeholder?: string
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder,
}: NumberFieldProps) {
  return (
    <input
      type="number"
      value={value === null ? '' : value}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') onChange(null)
        else {
          const n = Number(raw)
          onChange(Number.isFinite(n) ? n : null)
        }
      }}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      className="input"
    />
  )
}

interface ToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** A labeled checkbox with an optional one-line description. */
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: ToggleProps) {
  return (
    <label
      className={clsx(
        'flex items-start gap-2 rounded-md border border-border bg-white p-2.5',
        'cursor-pointer select-none',
        'hover:bg-gray-50',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-border text-secondary-500 focus:ring-focus-ring"
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        {description && (
          <div className="text-[11px] text-gray-500">{description}</div>
        )}
      </div>
    </label>
  )
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-gray-900 border-b border-divider pb-1">
      {children}
    </h3>
  )
}
