/**
 * Per-row dirty-state tracker, keyed by the resource's own rowKey().
 *
 * Same semantics as the previous useDirtyRows hook but parameterized so a
 * single instance can work across all four resource tabs. Each tab gets
 * its own hook instance via ResourceTable.
 */
import { useCallback, useMemo, useState } from 'react'

export type DirtyMap = Record<string, Record<string, unknown>>

export interface UseDirtyRows {
  dirty: DirtyMap
  getDirty: (rowKey: string) => Record<string, unknown>
  setField: (
    rowKey: string,
    column: string,
    newValue: unknown,
    originalValue: unknown,
  ) => void
  clearRow: (rowKey: string) => void
  clearAll: () => void
  hasDirty: (rowKey: string) => boolean
  isDirty: (rowKey: string, column: string) => boolean
  dirtyCount: number
}

export function useDirtyRows(): UseDirtyRows {
  const [dirty, setDirty] = useState<DirtyMap>({})

  const setField = useCallback(
    (
      rowKey: string,
      column: string,
      newValue: unknown,
      originalValue: unknown,
    ) => {
      setDirty((prev) => {
        const current = { ...(prev[rowKey] ?? {}) }
        if (valueEquals(newValue, originalValue)) {
          delete current[column]
        } else {
          current[column] = newValue
        }
        const next = { ...prev }
        if (Object.keys(current).length === 0) {
          delete next[rowKey]
        } else {
          next[rowKey] = current
        }
        return next
      })
    },
    [],
  )

  const clearRow = useCallback((rowKey: string) => {
    setDirty((prev) => {
      if (!(rowKey in prev)) return prev
      const next = { ...prev }
      delete next[rowKey]
      return next
    })
  }, [])

  const clearAll = useCallback(() => setDirty({}), [])

  const getDirty = useCallback(
    (rowKey: string) => dirty[rowKey] ?? {},
    [dirty],
  )
  const hasDirty = useCallback(
    (rowKey: string) => !!dirty[rowKey],
    [dirty],
  )
  const isDirty = useCallback(
    (rowKey: string, column: string) => {
      const row = dirty[rowKey]
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
    clearAll,
    hasDirty,
    isDirty,
    dirtyCount,
  }
}

function valueEquals(a: unknown, b: unknown): boolean {
  const na = a === null || a === undefined || a === '' ? null : a
  const nb = b === null || b === undefined || b === '' ? null : b
  if (na === nb) return true
  if (typeof na === 'number' && typeof nb === 'string') return String(na) === nb
  if (typeof na === 'string' && typeof nb === 'number') return na === String(nb)
  return false
}
