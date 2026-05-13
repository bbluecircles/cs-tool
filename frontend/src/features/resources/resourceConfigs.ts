/**
 * Resource configuration objects.
 *
 * Each tab is driven by one ResourceConfig. The config declares:
 *   - slug (the URL path segment + query key)
 *   - label (tab title)
 *   - how to extract the primary-key path segment from a row (for PATCH/DELETE URLs)
 *   - which columns are sortable / filterable (must match the server's allowlists)
 *   - column definitions: label, editability, input type, filter input type
 *   - create form field definitions (subset of columns, plus FK pickers)
 *   - whether delete is allowed
 *
 * Adding a new column to a resource is one entry here (and matching columns
 * on the backend repo). The ResourceTable and CreateRowModal read from this
 * without knowing anything resource-specific.
 *
 * Three orthogonal flags live on each column:
 *   - editable      : can the cell be inline-edited on existing rows?
 *   - showInCreate  : does the create-row modal render an input for it?
 *   - filterable    : does the table show a per-column filter input?
 *
 * They're independent. user_id is showInCreate=true (you type one when
 * creating) but editable=false (you can't rename a MariaDB user via this
 * tool). Timestamps are filterable=true (date range) but editable=false.
 *
 * Note on field removal: when a column is dropped from this file, the
 * backend repo's EDITABLE_COLUMNS / SORTABLE_COLUMNS / _LIST_COLUMNS must
 * be updated to match. The underlying table columns are NOT dropped — the
 * tool simply stops projecting/editing them. Any external system that
 * still reads those columns continues to work. Defaults for the now-hidden
 * fields are baked into the repo's INSERT statements.
 */

export type ColumnKind =
  | 'text'       // free-form string
  | 'int'        // whole number
  | 'flag'       // 0/1, rendered as Yes/No
  | 'readonly'   // never editable inline (IDs)
  | 'datetime'   // ISO string, read-only formatted
  | 'customer_code'  // int with a dropdown picker (customers list)

/**
 * Drives which input renders in the per-column filter row beneath the
 * header. Most columns use a kind-derived default — this override is for
 * cases where the editor kind and the filter kind diverge.
 */
export type FilterKind =
  | 'text'
  | 'int'
  | 'flag'
  | 'enum'
  | 'date'
  | 'customer_code'

export interface ColumnDef {
  key: string
  label: string
  kind: ColumnKind
  editable: boolean
  /** Shows in the table. Defaults to true. */
  show?: boolean
  /** Max chars for text inputs. */
  maxLength?: number
  /** Min/max for numeric inputs. */
  min?: number
  max?: number
  /** If provided, renders as a select with these options. */
  options?: { value: string | number; label: string }[]
  /** Whether this column appears in the Create form. */
  showInCreate?: boolean
  /** Whether this field is required on create. */
  requiredOnCreate?: boolean
  /** Default for create form. */
  createDefault?: unknown
  /**
   * Column span (out of 2) in the create form's two-column grid.
   * Defaults: long text fields (maxLength > 40) span 2; everything else
   * spans 1. Set explicitly to 1 to force a long-text field onto half-
   * width (e.g. user_id, where 64 chars is plenty but we want it to sit
   * next to the customer picker).
   */
  createSpan?: 1 | 2
  /** Password columns get the reveal/mask treatment. */
  isPassword?: boolean
  /** Whether the column appears in the per-column filter row. Defaults
   *  to true. Set false for columns where filtering is genuinely
   *  meaningless (e.g. autoincrement rec_id, password column). */
  filterable?: boolean
  /** Override the auto-derived filter input type. */
  filterKind?: FilterKind
}

export interface ResourceConfig {
  slug: string
  label: string
  shortLabel: string
  description: string
  buildId: (row: Record<string, unknown>) => string
  rowKey: (row: Record<string, unknown>) => string
  primaryKeyColumns: string[]
  columns: ColumnDef[]
  /** Sortable columns. Must match the backend repo's SORTABLE_COLUMNS. */
  sortableColumns: Set<string>
  /** Whether the toolbar shows a customer_code filter dropdown. */
  filterByCustomerCode: boolean
  /** True only for customer_dataset. */
  allowDelete: boolean
}

/**
 * Resolve the effective filter kind for a column.
 */
export function effectiveFilterKind(col: ColumnDef): FilterKind | null {
  if (col.filterable === false) return null
  if (col.filterKind) return col.filterKind
  if (col.options && col.options.length > 0) return 'enum'
  switch (col.kind) {
    case 'text':         return 'text'
    case 'int':          return 'int'
    case 'flag':         return 'flag'
    case 'datetime':     return 'date'
    case 'customer_code': return 'customer_code'
    case 'readonly':     return null
  }
}

// ---------------------------------------------------------------------------
// Shared column fragments
// ---------------------------------------------------------------------------

const yesNoOptions = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
]

function flag(
  key: string,
  label: string,
  opts: Partial<ColumnDef> = {},
): ColumnDef {
  return {
    key,
    label,
    kind: 'flag',
    editable: true,
    options: yesNoOptions,
    showInCreate: true,
    createDefault: 0,
    ...opts,
  }
}

function readonly(key: string, label: string): ColumnDef {
  return {
    key,
    label,
    kind: 'readonly',
    editable: false,
    filterable: false,
  }
}

function datetime(key: string, label: string): ColumnDef {
  return { key, label, kind: 'datetime', editable: false, show: true }
}

// ---------------------------------------------------------------------------
// Customers (no fields removed)
// ---------------------------------------------------------------------------

export const customersConfig: ResourceConfig = {
  slug: 'customers',
  label: 'Customers',
  shortLabel: 'Customers',
  description:
    'The customer accounts. No deletes — disable at the user level instead.',
  buildId: (r) => String(r.customer_code),
  rowKey: (r) => `c-${r.customer_code}`,
  primaryKeyColumns: ['customer_code'],
  sortableColumns: new Set([
    'customer_code', 'customer_name', 'entity_code',
    'max_bytes', '5_digit_zip', 'max_row_cnt',
    'create_date', 'modify_date',
  ]),
  filterByCustomerCode: false,
  allowDelete: false,
  columns: [
    {
      key: 'customer_code', label: 'Code', kind: 'readonly',
      editable: false, filterable: true, filterKind: 'int',
    },
    {
      key: 'customer_name', label: 'Name', kind: 'text', editable: true,
      maxLength: 80, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'entity_code', label: 'Entity', kind: 'text', editable: true,
      maxLength: 15, showInCreate: true,
    },
    {
      key: 'max_bytes', label: 'Max Bytes', kind: 'int', editable: true,
      min: 0, showInCreate: true, createDefault: 24_000_000,
      // Hidden from the table; default applied on create, edits not
      // surfaced through this tool.
      show: false,
    },
    {
      key: '5_digit_zip', label: '5-Digit Zip', kind: 'flag', editable: true,
      options: yesNoOptions, showInCreate: true, createDefault: 1,
    },
    {
      key: 'max_row_cnt', label: 'Max Rows', kind: 'int', editable: true,
      min: 0, showInCreate: true, createDefault: 200_000,
    },
    datetime('create_date', 'Created'),
    datetime('modify_date', 'Modified'),
  ],
}

// ---------------------------------------------------------------------------
// Customer Users
//
// REMOVED FROM UI: mapping, logging_flag, max_birt_processes, user_priority
// (Underlying columns still exist in secure.customer_users; defaults
//  applied at INSERT time by customer_users_repo.create_customer_user.)
// ---------------------------------------------------------------------------

export const customerUsersConfig: ResourceConfig = {
  slug: 'customer-users',
  label: 'Customer Users',
  shortLabel: 'Users',
  description: 'End users. Disable instead of delete.',
  buildId: (r) => `${encodeURIComponent(String(r.user_id))}/${r.customer_code}`,
  rowKey: (r) => `u-${r.user_id}-${r.customer_code}`,
  primaryKeyColumns: ['user_id', 'customer_code'],
  sortableColumns: new Set([
    'user_id', 'customer_code', 'e_mail', 'disable',
    'first_name', 'last_name', 'pw_flag',
    'esri_access', 'esri_tap_access', 'esri_state',
    'webuser', 'ppiuser', 'ppi_detail_user',
    'web_esri_access', 'web_esri_tap_access',
    'web_inpatient_access', 'web_outpatient_access',
    'web_ed_access', 'web_claims_access',
    'create_date', 'modify_date',
  ]),
  filterByCustomerCode: true,
  allowDelete: false,
  columns: [
    {
      key: 'user_id', label: 'User ID', kind: 'text', editable: false,
      maxLength: 64, showInCreate: true, requiredOnCreate: true,
      // Half-width so the customer picker sits next to it in the create form.
      createSpan: 1,
    },
    {
      key: 'customer_code', label: 'Customer', kind: 'customer_code',
      editable: false, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'user_password', label: 'Password', kind: 'text', editable: true,
      maxLength: 15, isPassword: true,
      showInCreate: true, requiredOnCreate: true,
      filterable: false,
    },
    flag('pw_flag', 'Pw Prefix', { createDefault: 0 }),
    {
      key: 'e_mail', label: 'Email', kind: 'text', editable: true,
      maxLength: 200, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'first_name', label: 'First', kind: 'text', editable: true,
      maxLength: 35, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'last_name', label: 'Last', kind: 'text', editable: true,
      maxLength: 35, showInCreate: true, requiredOnCreate: true,
    },
    flag('disable', 'Disabled', { createDefault: 0 }),
    flag('webuser', 'Web', { createDefault: 1 }),
    flag('ppiuser', 'PPI'),
    flag('esri_access', 'ESRI'),
    flag('esri_tap_access', 'ESRI TAP'),
    flag('ppi_detail_user', 'PPI Detail'),
    flag('web_inpatient_access', 'Web IP'),
    flag('web_outpatient_access', 'Web OP'),
    flag('web_ed_access', 'Web ED'),
    flag('web_claims_access', 'Web Claims'),
    flag('web_esri_access', 'Web ESRI'),
    flag('web_esri_tap_access', 'Web ESRI TAP'),
    {
      key: 'esri_state', label: 'ESRI States', kind: 'text', editable: true,
      maxLength: 254, show: false, showInCreate: false,
    },
    datetime('create_date', 'Created'),
    datetime('modify_date', 'Modified'),
  ],
}

// ---------------------------------------------------------------------------
// Customer Datasets — THE ONE WITH DELETE
//
// REMOVED FROM UI: sg2, sg2_op, claritas_flag, prism_flag, projection_flag,
// transfers_flag, cell_size_limit, export_detail, export_row_limit,
// odbc_dataset, webapp_flag.
// ---------------------------------------------------------------------------

const datasetTypeOptions = [
  { value: '', label: '(none)' },
  { value: 'd', label: 'd — discharge' },
  { value: 'c', label: 'c — claims' },
]

export const customerDatasetsConfig: ResourceConfig = {
  slug: 'customer-datasets',
  label: 'Customer Datasets',
  shortLabel: 'Datasets',
  description: 'Datasets attached to customers. Deletes allowed here.',
  buildId: (r) => String(r.rec_id),
  rowKey: (r) => `cd-${r.rec_id}`,
  primaryKeyColumns: ['rec_id'],
  sortableColumns: new Set([
    'rec_id', 'customer_code', 'database_name',
    'inpatient', 'outpatient', 'ed',
    'claritas_state', 'cms_states',
    'dataset_type', 'aprdrg_flag', 'export_flag',
    'create_date', 'modify_date',
  ]),
  filterByCustomerCode: true,
  allowDelete: true,
  columns: [
    readonly('rec_id', 'Rec ID'),
    {
      key: 'customer_code', label: 'Customer', kind: 'customer_code',
      editable: false, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'database_name', label: 'Database', kind: 'text', editable: true,
      maxLength: 25, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'dataset_type', label: 'Type', kind: 'text', editable: true,
      options: datasetTypeOptions, showInCreate: true, createDefault: 'd',
    },
    flag('inpatient', 'IP', { createDefault: 1 }),
    flag('outpatient', 'OP'),
    flag('ed', 'ED'),
    flag('aprdrg_flag', 'APR-DRG'),
    flag('export_flag', 'Export', { createDefault: 1 }),
    {
      key: 'claritas_state', label: 'Claritas States', kind: 'text', editable: true,
      maxLength: 254, show: false, showInCreate: false,
    },
    {
      key: 'cms_states', label: 'CMS States', kind: 'text', editable: true,
      maxLength: 255, show: false, showInCreate: false,
    },
    datetime('create_date', 'Created'),
    datetime('modify_date', 'Modified'),
  ],
}

// ---------------------------------------------------------------------------
// PPI Datasets
//
// REMOVED FROM UI: cell_size_limit, export_detail
// ---------------------------------------------------------------------------

export const ppiDatasetsConfig: ResourceConfig = {
  slug: 'ppi-datasets',
  label: 'PPI Datasets',
  shortLabel: 'PPI',
  description: 'PPI state-level datasets. No deletes.',
  buildId: (r) => String(r.rec_id),
  rowKey: (r) => `p-${r.rec_id}`,
  primaryKeyColumns: ['rec_id'],
  sortableColumns: new Set([
    'rec_id', 'customer_code', 'ppi_state',
    'ppi_detail', 'ppi_summary',
    'create_date', 'modify_date',
  ]),
  filterByCustomerCode: true,
  allowDelete: false,
  columns: [
    readonly('rec_id', 'Rec ID'),
    {
      key: 'customer_code', label: 'Customer', kind: 'customer_code',
      editable: false, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'ppi_state', label: 'State', kind: 'text', editable: true,
      maxLength: 25, showInCreate: true, requiredOnCreate: true,
    },
    flag('ppi_detail', 'Detail', { createDefault: 1 }),
    flag('ppi_summary', 'Summary', { createDefault: 1 }),
    datetime('create_date', 'Created'),
    datetime('modify_date', 'Modified'),
  ],
}

// ---------------------------------------------------------------------------
// Ordered list for the tab bar
// ---------------------------------------------------------------------------

export const ALL_CONFIGS: ResourceConfig[] = [
  customersConfig,
  customerUsersConfig,
  customerDatasetsConfig,
  ppiDatasetsConfig,
]

export function configBySlug(slug: string): ResourceConfig | undefined {
  return ALL_CONFIGS.find((c) => c.slug === slug)
}