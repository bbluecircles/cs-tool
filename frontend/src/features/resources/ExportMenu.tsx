/**
 * Export dropdown.
 *
 * One component, mounted in two places: the table toolbar (all scopes)
 * and the selection banner (selected-rows only), so the action is
 * available both where agents look for global table actions and right
 * where they just finished making a selection.
 *
 * The panel lays scopes out as rows with a CSV and an Excel button each.
 * That's deliberately flat — a nested "scope → format" submenu would be
 * two hovers and a hunt for what is fundamentally a six-way choice.
 * Every row states its row count so nobody exports 12,000 rows expecting
 * the 40 on screen.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import type { ExportFormat } from './export'

export interface ExportScopeOption {
  id: string
  label: string
  /** Row count for this scope. `null` when not yet known. */
  count: number | null
  /** Secondary line — e.g. "matches the current filters". */
  hint?: string
  disabled?: boolean
}

interface ExportMenuProps {
  scopes: ExportScopeOption[]
  onExport: (scopeId: string, format: ExportFormat) => void
  buttonLabel?: string
  variant?: 'primary' | 'secondary' | 'ghost'
  /** Which edge the panel is anchored to. */
  align?: 'left' | 'right'
  busy?: boolean
  disabled?: boolean
  /** Caveat rendered at the foot of the panel (e.g. unsaved edits). */
  note?: string
}

export function ExportMenu({
  scopes,
  onExport,
  buttonLabel = 'Export',
  variant = 'secondary',
  align = 'right',
  busy = false,
  disabled = false,
  note,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape. Bound only while open so we're not
  // holding document listeners for every mounted menu.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // A run started elsewhere (or the scope list emptying out) should not
  // leave a stale panel hanging open.
  useEffect(() => {
    if (busy) setOpen(false)
  }, [busy])

  function pick(scopeId: string, format: ExportFormat) {
    setOpen(false)
    onExport(scopeId, format)
  }

  const btnClass =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'btn-ghost'
        : 'btn-secondary'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className={btnClass}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download these rows as a spreadsheet"
      >
        {busy ? 'Exporting…' : buttonLabel}
        <span aria-hidden className="text-[10px] leading-none opacity-70">
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-30 mt-1 w-[310px] rounded-md border border-border',
            'bg-white shadow-lg p-1.5',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="px-2 pt-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Download as
          </div>

          {scopes.map((scope) => {
            const isDisabled = scope.disabled || scope.count === 0
            return (
              <div
                key={scope.id}
                className={clsx(
                  'flex items-center gap-2 rounded px-2 py-1.5',
                  isDisabled ? 'opacity-50' : 'hover:bg-gray-100',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900">{scope.label}</div>
                  <div className="text-[11px] text-gray-500">
                    {scope.count === null
                      ? 'counting…'
                      : `${scope.count.toLocaleString()} row${scope.count === 1 ? '' : 's'}`}
                    {scope.hint ? ` · ${scope.hint}` : ''}
                  </div>
                </div>
                <FormatButton
                  label="CSV"
                  disabled={isDisabled}
                  onClick={() => pick(scope.id, 'csv')}
                />
                <FormatButton
                  label="Excel"
                  disabled={isDisabled}
                  onClick={() => pick(scope.id, 'xlsx')}
                />
              </div>
            )
          })}

          {note && (
            <div className="mt-1 border-t border-divider px-2 pt-2 pb-1 text-[11px] text-warning-600">
              {note}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FormatButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'shrink-0 rounded border px-2 py-1 text-xs font-medium transition-colors',
        disabled
          ? 'border-border text-gray-500 cursor-not-allowed'
          : 'border-secondary-500/40 text-secondary-700 hover:bg-secondary-500 hover:text-white hover:border-secondary-500',
      )}
    >
      {label}
    </button>
  )
}
