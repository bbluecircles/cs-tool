/**
 * Per-table column order: defaults, localStorage persistence, and
 * reconciliation against the current config.
 *
 * Extracted from ResourceTable so the export path can read the SAME
 * order the agent sees on screen. ResourceTable owns the order as React
 * state and mirrors every change into localStorage; export re-reads
 * localStorage at click time rather than threading the state up through
 * ResourcePage. That keeps the table's state local while guaranteeing the
 * two agree — including drag-reorders made earlier in the same session.
 */
import type { ColumnDef, ResourceConfig } from './resourceConfigs'

// v2: bumped when the default column order changed (Users left-shift) so
// stored orders from before don't mask the new default. Old keys are
// simply abandoned (harmless localStorage cruft).
const COL_ORDER_PREFIX = 'cs-tool:colorder:v2:'

export function colOrderKey(slug: string): string {
  return COL_ORDER_PREFIX + slug
}

/** Columns the table actually renders, in config order. */
export function visibleColumns(config: ResourceConfig): ColumnDef[] {
  return config.columns.filter((c) => c.show !== false)
}

export function defaultColumnOrder(
  cols: ColumnDef[],
  preferred?: string[],
): string[] {
  if (preferred && preferred.length > 0) {
    const visibleKeys = new Set(cols.map((c) => c.key))
    // Preferred keys first (only those actually visible), then the rest in
    // config order, then the pinned actions column.
    const head = preferred.filter((k) => visibleKeys.has(k))
    const headSet = new Set(head)
    const tail = cols.map((c) => c.key).filter((k) => !headSet.has(k))
    return [...head, ...tail, '__actions']
  }
  return [...cols.map((c) => c.key), '__actions']
}

/**
 * Load the saved column order for a table, reconciled against the current
 * columns: unknown ids are dropped, newly-added columns are appended, and
 * the trailing actions column is always pinned last. `preferred` sets the
 * default order used when nothing is stored yet (config.tableColumnOrder).
 */
export function loadColumnOrder(
  slug: string,
  cols: ColumnDef[],
  preferred?: string[],
): string[] {
  const def = defaultColumnOrder(cols, preferred)
  try {
    const raw = localStorage.getItem(colOrderKey(slug))
    if (!raw) return def
    const stored = JSON.parse(raw) as unknown
    if (!Array.isArray(stored)) return def
    const valid = new Set(def)
    const kept = stored.filter(
      (id): id is string =>
        typeof id === 'string' && valid.has(id) && id !== '__actions',
    )
    const missing = def.filter((id) => id !== '__actions' && !kept.includes(id))
    return [...kept, ...missing, '__actions']
  } catch {
    return def
  }
}

/**
 * Apply a column-order id list to the visible column defs. Ids with no
 * matching column are skipped; columns not named in the order are
 * appended in config order. The synthetic '__actions' id has no column
 * def, so it drops out naturally.
 */
export function applyColumnOrder(
  cols: ColumnDef[],
  order: string[],
): ColumnDef[] {
  const byKey = new Map(cols.map((c) => [c.key, c]))
  const ordered: ColumnDef[] = []
  for (const id of order) {
    const c = byKey.get(id)
    if (c) ordered.push(c)
  }
  for (const c of cols) {
    if (!order.includes(c.key)) ordered.push(c)
  }
  return ordered
}

/**
 * The table's visible columns in the agent's current left-to-right
 * order. Reads persisted state, so it matches what's on screen.
 */
export function orderedVisibleColumns(config: ResourceConfig): ColumnDef[] {
  const cols = visibleColumns(config)
  return applyColumnOrder(
    cols,
    loadColumnOrder(config.slug, cols, config.tableColumnOrder),
  )
}
