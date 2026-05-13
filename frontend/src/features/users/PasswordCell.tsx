import { useState } from 'react'
import { revealPassword } from '@/api/users'

interface PasswordCellProps {
  userId: string
  databaseName: string
}

/**
 * A masked password cell.
 *
 * - Default state: dots + a small "reveal" button.
 * - On reveal: fetches plaintext from the server (which writes an audit row)
 *   and shows it monospace. A "hide" button puts it back.
 * - On copy: same fetch path, copies to clipboard, shows a brief confirmation.
 *
 * We don't cache revealed passwords: each session, each click. The server
 * call is cheap but the audit trail is the real point.
 */
export function PasswordCell({ userId, databaseName }: PasswordCellProps) {
  const [value, setValue] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reveal() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const r = await revealPassword(userId, databaseName)
      setValue(r.user_password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const r = await revealPassword(userId, databaseName)
      await navigator.clipboard.writeText(r.user_password)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  if (value !== null) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs">{value}</span>
        <button
          type="button"
          onClick={() => setValue(null)}
          className="text-[11px] text-secondary-500 hover:text-secondary-700"
        >
          hide
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 select-none tracking-widest">••••••••</span>
      <button
        type="button"
        onClick={reveal}
        disabled={loading}
        className="text-[11px] text-secondary-500 hover:text-secondary-700 disabled:opacity-50"
        title="Reveal password (audited)"
      >
        {loading ? '…' : 'reveal'}
      </button>
      <button
        type="button"
        onClick={copy}
        disabled={loading}
        className="text-[11px] text-secondary-500 hover:text-secondary-700 disabled:opacity-50"
        title="Copy password to clipboard (audited)"
      >
        {copied ? 'copied!' : 'copy'}
      </button>
      {error && (
        <span className="text-[11px] text-error-600" title={error}>
          !
        </span>
      )}
    </div>
  )
}
