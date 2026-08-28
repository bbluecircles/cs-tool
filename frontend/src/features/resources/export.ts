/**
 * CSV / XLSX export for the resource tables.
 *
 * Everything here is pure except `downloadBlob` — the callers (ResourcePage
 * for the tabbed tables, AdminPage for the audit log) own row acquisition
 * and progress UI, this module owns turning rows into a file.
 *
 * Design notes:
 *
 *  - Values mirror the on-screen rendering (flags as Yes/No, customer
 *    codes resolved to names where the table does that, timestamps
 *    trimmed to the minute) via the shared `formatReadonly`. An export
 *    that disagrees with the table it came from is a support ticket.
 *  - Genuinely numeric columns stay numeric in XLSX so Excel can sum and
 *    sort them; CSV is text either way.
 *  - Password columns are NEVER exported. Revealing a password is a
 *    per-row, audit-logged action (see PasswordCell / the reveal
 *    endpoint); a bulk export would route around that. The list endpoints
 *    don't even project `user_password`, so the column is empty in the
 *    row objects — excluding it explicitly keeps that a deliberate
 *    guarantee rather than an accident of the SELECT list.
 *  - XLSX support is loaded via dynamic import so `write-excel-file` and
 *    its zip dependency stay out of the initial bundle. Agents who only
 *    ever hit CSV never download it.
 */
import type { QueryClient } from '@tanstack/react-query'

import { formatReadonly } from './cellDisplay'
import { lookupCustomerName } from './CustomerPicker'
import { orderedVisibleColumns } from './columnOrder'
import type { ColumnDef, ResourceConfig } from './resourceConfigs'

export type ExportFormat = 'csv' | 'xlsx'

/** A single exported cell. `null` renders as an empty cell in both formats. */
export type ExportValue = string | number | null

export interface ExportTable {
  headers: string[]
  rows: ExportValue[][]
  /** Parallel to `headers` — drives XLSX column widths. */
  widths: number[]
}

type Row = Record<string, unknown>

// ---------------------------------------------------------------------------
// Building the table
// ---------------------------------------------------------------------------

/**
 * The columns an export covers: the table's visible columns, in the
 * agent's current drag-reordered sequence, minus password columns.
 */
export function exportColumns(config: ResourceConfig): ColumnDef[] {
  return orderedVisibleColumns(config).filter((c) => !c.isPassword)
}

/**
 * Whether a column's values should stay numeric in XLSX. `customer_code`
 * only qualifies when the table shows the raw integer — otherwise the
 * cell holds a substituted customer NAME.
 */
function isNumericColumn(col: ColumnDef): boolean {
  if (col.kind === 'int') return true
  if (col.kind === 'customer_code' && col.displayRaw) return true
  return false
}

function cellValue(col: ColumnDef, row: Row, qc: QueryClient): ExportValue {
  const raw = row[col.key]
  if (raw === null || raw === undefined || raw === '') return null

  // Mirror the table's customer_code -> customer_name substitution.
  if (col.kind === 'customer_code' && !col.displayRaw) {
    const code = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(code)) return lookupCustomerName(qc, code) ?? code
  }

  if (isNumericColumn(col)) {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n)) return n
  }

  // '' as the placeholder: blank cells beat a literal em dash in a file
  // someone is going to pivot on.
  const text = formatReadonly(col.kind, raw, '')
  return text === '' ? null : text
}

export function buildExportTable(
  config: ResourceConfig,
  rows: Row[],
  qc: QueryClient,
): ExportTable {
  const cols = exportColumns(config)
  return {
    headers: cols.map((c) => c.label),
    rows: rows.map((row) => cols.map((col) => cellValue(col, row, qc))),
    widths: cols.map((c) => columnWidthChars(c)),
  }
}

/**
 * XLSX column width, in characters. Excel's unit is roughly "digits of
 * the default font", so a label-length floor plus a kind-aware minimum
 * lands close enough without measuring content.
 */
function columnWidthChars(col: ColumnDef): number {
  const base = col.label.length + 3
  let kindMin: number
  switch (col.kind) {
    case 'flag':          kindMin = 8; break
    case 'int':           kindMin = 10; break
    case 'datetime':      kindMin = 18; break
    case 'customer_code': kindMin = col.displayRaw ? 8 : 28; break
    default:              kindMin = 14; break
  }
  return Math.min(Math.max(base, kindMin), 48)
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

// Leading characters Excel / Sheets treat as the start of a formula. A
// value beginning with one of these is prefixed with an apostrophe so the
// spreadsheet renders it as text. This is user-entered database content
// being opened straight in Excel by CS agents, so the guard is not
// optional (OWASP: CSV injection).
const FORMULA_LEAD = /^[=+\-@\t\r]/

function csvField(v: ExportValue): string {
  if (v === null) return ''
  if (typeof v === 'number') return String(v)

  const guarded = FORMULA_LEAD.test(v) ? "'" + v : v
  // Quote when the field contains a delimiter, a quote, or a line break.
  // Embedded quotes are doubled, per RFC 4180.
  if (/[",\r\n]/.test(guarded)) {
    return '"' + guarded.replace(/"/g, '""') + '"'
  }
  return guarded
}

/**
 * RFC 4180 CSV with a UTF-8 BOM and CRLF line endings — both required for
 * Excel on Windows to open the file correctly by double-click (without the
 * BOM it decodes as the system codepage and mangles non-ASCII names).
 */
export function toCsv(table: ExportTable): Blob {
  const lines: string[] = [table.headers.map((h) => csvField(h)).join(',')]
  for (const row of table.rows) {
    lines.push(row.map(csvField).join(','))
  }
  // U+FEFF as an escape rather than a literal, so the BOM survives
  // editors and diffs that would silently swallow an invisible char.
  const text = '\uFEFF' + lines.join('\r\n') + '\r\n'
  return new Blob([text], { type: 'text/csv;charset=utf-8' })
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim()
  return (cleaned || 'Sheet1').slice(0, 31)
}

export async function toXlsx(
  table: ExportTable,
  sheetName: string,
): Promise<Blob> {
  const writeXlsxFile = (await import('write-excel-file/browser')).default

  const header = table.headers.map((h) => ({
    value: h,
    fontWeight: 'bold' as const,
    backgroundColor: '#EFEFEF',
  }))

  const body = table.rows.map((row) =>
    row.map((v) => {
      if (v === null) return null
      if (typeof v === 'number') return { value: v, type: Number }
      return { value: v, type: String }
    }),
  )

  return writeXlsxFile([header, ...body], {
    sheet: safeSheetName(sheetName),
    columns: table.widths.map((w) => ({ width: w })),
    // Freeze the header so scrolling a long export keeps the labels.
    stickyRowsCount: 1,
  }).toBlob()
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** `customer-users_selected_2026-08-28_1432.csv` */
export function exportFilename(
  slug: string,
  scope: string,
  format: ExportFormat,
): string {
  const d = new Date()
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}`
  return `${slug}_${scope}_${stamp}.${format}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick — revoking synchronously can cancel the
  // download in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Build + serialize + download in one step. */
export async function deliverExport(
  table: ExportTable,
  format: ExportFormat,
  slug: string,
  scope: string,
  sheetName: string,
): Promise<void> {
  const blob = format === 'csv' ? toCsv(table) : await toXlsx(table, sheetName)
  downloadBlob(blob, exportFilename(slug, scope, format))
}
