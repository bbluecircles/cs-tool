/**
 * Dirty-row state for inline edits.
 *
 * We track pending changes per (user_id, database_name) composite key.
 * When the user commits a field edit, we compare the new value against the
 * row's original value; if different, it's recorded as dirty, if same, it's
 * removed. Saving a row clears its dirty state.
 *
 * This is intentionally simple and local — no persistence, no cross-tab
 * sync, no undo stack. An internal tool doesn't need that complexity.
 */
import { useCallback, useMemo, useState } from 'react'
import type { UserRow } from '@/api/users'

export type RowKey = string

export function rowKey(row: Pick<UserRow, 'user_id' | 'database_name'>): RowKey {
  return `${row.user_id}|${row.database_name}`
}

/**
 * Map of dirty fields per row.
 * dirty[rowKey][columnName] = pending new value.
 */
export type DirtyMap = Record<RowKey, Record<string, unknown>>

export interface UseDirtyRows {
  dirty: DirtyMap
  getDirty: (key: RowKey) => Record<string, unknown>
  setField: (
    row: UserRow,
    column: string,
    newValue: unknown,
  ) => void
  clearRow: (key: RowKey) => void
  hasDirty: (key: RowKey) => boolean
  isDirty: (key: RowKey, column: string) => boolean
  /** Total count of dirty fields across all rows. */
  dirtyCount: number
}

export function useDirtyRows(): UseDirtyRows {
  const [dirty, setDirty] = useState<DirtyMap>({})

  const setField = useCallback(
    (row: UserRow, column: string, newValue: unknown) => {
      const key = rowKey(row)
      // The "original" value lives on the row itself. If the new value
      // matches, we drop the entry rather than recording a no-op diff.
      const original = (row as unknown as Record<string, unknown>)[column]
      setDirty((prev) => {
        const current = { ...(prev[key] ?? {}) }
        if (valueEquals(newValue, original)) {
          delete current[column]
        } else {
          current[column] = newValue
        }
        const next = { ...prev }
        if (Object.keys(current).length === 0) {
          delete next[key]
        } else {
          next[key] = current
        }
        return next
      })
    },
    [],
  )

  const clearRow = useCallback((key: RowKey) => {
    setDirty((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const getDirty = useCallback(
    (key: RowKey) => dirty[key] ?? {},
    [dirty],
  )

  const hasDirty = useCallback((key: RowKey) => !!dirty[key], [dirty])

  const isDirty = useCallback(
    (key: RowKey, column: string) => {
      const row = dirty[key]
      return row !== undefined && column in row
    },
    [dirty],
  )

  const dirtyCount = useMemo(
    () => Object.values(dirty).reduce((n, r) => n + Object.keys(r).length, 0),
    [dirty],
  )

  return {
    dirty,
    getDirty,
    setField,
    clearRow,
    hasDirty,
    isDirty,
    dirtyCount,
  }
}

function valueEquals(a: unknown, b: unknown): boolean {
  // Normalize null/undefined/'' so "cleared an empty cell" doesn't mark dirty.
  const na = a === null || a === undefined || a === '' ? null : a
  const nb = b === null || b === undefined || b === '' ? null : b
  if (na === nb) return true
  // Handle string <-> number comparisons from inputs.
  if (typeof na === 'number' && typeof nb === 'string') return String(na) === nb
  if (typeof na === 'string' && typeof nb === 'number') return na === String(nb)
  return false
}
