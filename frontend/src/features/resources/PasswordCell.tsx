import { useRef, useState } from 'react'
import { revealPassword } from '@/api/resources'

interface PasswordCellProps {
  userId: string
  customerCode: number
}

/**
 * Reveal/hide/copy a password on demand. Each reveal or copy hits the
 * server and writes an audit entry. We don't cache the revealed value —
 * a hide puts us back in the masked state.
 *
 * The revealed plaintext is stored together with the identity it was
 * fetched for, and read back only while that identity still matches the
 * current props. The table keys rows by primary key (see getRowId in
 * ResourceTable), so an instance should stay with its row — this makes a
 * mismatch structurally impossible rather than merely unlikely. If this
 * cell is ever re-pointed at a different user, whether by a re-parent or
 * by a response landing after the row changed underneath, it falls back
 * to masked instead of showing or copying someone else's password.
 */
export function PasswordCell({ userId, customerCode }: PasswordCellProps) {
  const identity = `${userId}|${customerCode}`
  const [shown, setShown] = useState<{ identity: string; value: string } | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lets the async handlers below compare against the *current* identity
  // after their await, not the one captured when the closure was made.
  const identityRef = useRef(identity)
  identityRef.current = identity

  // Derived rather than stored, so a value left over from a previous
  // occupant of this position can never render.
  const value = shown && shown.identity === identity ? shown.value : null

  async function reveal() {
    if (loading) return
    setLoading(true)
    setError(null)
    const requested = identity
    try {
      const r = await revealPassword(userId, customerCode)
      // Row changed under us mid-flight: drop the response rather than
      // parking another user's password in this cell's state.
      if (identityRef.current !== requested) return
      setShown({ identity: requested, value: r.user_password })
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
    const requested = identity
    try {
      const r = await revealPassword(userId, customerCode)
      if (identityRef.current !== requested) {
        setError('Row changed — copy cancelled')
        return
      }
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
          onClick={() => setShown(null)}
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
