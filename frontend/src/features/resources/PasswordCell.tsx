import { useState } from 'react'
import { revealPassword } from '@/api/resources'

interface PasswordCellProps {
  userId: string
  customerCode: number
}

/**
 * Reveal/hide/copy a password on demand. Each reveal or copy hits the
 * server and writes an audit entry. We don't cache the revealed value —
 * a hide puts us back in the masked state.
 */
export function PasswordCell({ userId, customerCode }: PasswordCellProps) {
  const [value, setValue] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reveal() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const r = await revealPassword(userId, customerCode)
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
      const r = await revealPassword(userId, customerCode)
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
      >
        {loading ? '…' : 'reveal'}
      </button>
      <button
        type="button"
        onClick={copy}
        disabled={loading}
        className="text-[11px] text-secondary-500 hover:text-secondary-700 disabled:opacity-50"
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
