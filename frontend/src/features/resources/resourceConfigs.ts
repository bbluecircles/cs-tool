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

import { US_STATE_OPTIONS } from './usStates'

export type ColumnKind =
  | 'text'       // free-form string
  | 'int'        // whole number
  | 'flag'       // 0/1, rendered as Yes/No
  | 'readonly'   // never editable inline (IDs)
  | 'datetime'   // ISO string, read-only formatted
  | 'customer_code'  // int with a dropdown picker (customers list)
  | 'database_picker' // string with a dropdown picker (myuser.db_database list)

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
  | 'database_picker'

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
  /**
   * Cross-field disabled / value-override hook. Called by both the
   * create modal and the inline-edit cell with the current row state
   * (the in-progress form values for create; the persisted row for
   * inline-edit). Returns `null` for "no override", or an object with
   * either:
   *   - disabled: true  → the input is rendered but read-only
   *   - valueOverride   → forces a specific value, regardless of what
   *                       the user might have typed before
   * Used for IP/OP/ED/APR-DRG which depend on the picked database's
   * feature flags (myuser.db_features_list).
   */
  computeDisabledOverride?: (
    row: Record<string, unknown>,
    features: import('./DatabasePicker').DbFeatures,
  ) => { disabled?: boolean; valueOverride?: unknown } | null
  /**
   * For database_picker columns: when true, the dropdown only lists
   * databases that support at least one discharge feature
   * (IP/OP/ED/APR-DRG). Used on the Discharge Databases create form so
   * agents can't pick a database that can't back a discharge dataset.
   */
  pickerRequireDischargeFeatures?: boolean
  /**
   * For database_picker columns: when true, the dropdown only lists
   * databases with NONE of the four discharge features (claims-only
   * databases). Used on the Claim Databases create form.
   */
  pickerRequireNoDischargeFeatures?: boolean
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
  /**
   * Whether delete is allowed. True for customer-datasets and ppi-datasets.
   */
  allowDelete: boolean
  /**
   * Drives the delete-confirm modal's impact section.
   *  - 'customer_dataset' : fetches /delete-impact and shows the active-
   *                         user count for the customer (the existing
   *                         behavior).
   *  - 'none' (default)   : skips the impact fetch and shows a plain
   *                         confirm. Used for resources whose rows have
   *                         no per-row downstream fanout (e.g. PPI).
   */
  deleteImpactKind?: 'customer_dataset' | 'none'
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
    case 'database_picker': return 'database_picker'  // dropdown sourced from db_database
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
// Customers
//
// HIDDEN FROM UI (per Stage 7 column-list spec): max_bytes, 5_digit_zip,
// max_row_cnt. Underlying columns still exist in secure.customer and are
// still written with defaults at create time by customer_repo. They just
// don't appear in the table or in the create form anymore.
//
// ADDED TO UI: state, customer_desc, cancelled_date (already exist on
// secure.customer; types assumed varchar(2) / varchar(255) / datetime
// respectively — adjust if wrong).
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
    'state', 'customer_desc',
    'create_date', 'modify_date', 'cancelled_date',
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
      // Integer-typed (even though the DB column is varchar). Optional
      // on create — when omitted the backend defaults entity_code to
      // the new customer_code, which matches the convention in existing
      // data. Inline-edit (in the table) still requires a valid int via
      // edit_registry; empty values break the main app's
      // tsp_entity_users stored proc.
      key: 'entity_code', label: 'Entity', kind: 'int', editable: true,
      min: 1, max: 32767,
      showInCreate: true,
    },
    {
      key: 'state', label: 'State', kind: 'text', editable: true,
      maxLength: 2, showInCreate: true,
      // All US states + DC. Optional, so a blank choice leads the list.
      options: [{ value: '', label: '— none —' }, ...US_STATE_OPTIONS],
    },
    {
      key: 'customer_desc', label: 'Description', kind: 'text', editable: true,
      maxLength: 255, showInCreate: true,
    },
    {
      key: 'max_bytes', label: 'Max Bytes', kind: 'int', editable: true,
      min: 0, showInCreate: false, createDefault: 24_000_000,
      show: false,
    },
    {
      key: '5_digit_zip', label: '5-Digit Zip', kind: 'flag', editable: true,
      options: yesNoOptions, showInCreate: false, createDefault: 1,
      show: false,
    },
    {
      key: 'max_row_cnt', label: 'Max Rows', kind: 'int', editable: true,
      min: 0, showInCreate: false, createDefault: 200_000,
      show: false,
    },
    datetime('create_date', 'Created'),
    datetime('modify_date', 'Modified'),
    datetime('cancelled_date', 'Cancelled'),
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
// Customer Datasets ("Discharge Databases" in the UI; backend slug stays
// 'customer-datasets' and the underlying table is secure.customer_dataset).
//
// HIDDEN FROM UI: sg2, sg2_op, claritas_flag, prism_flag, projection_flag,
// transfers_flag, cell_size_limit, export_detail, export_row_limit,
// webapp_flag, claritas_state, cms_states, export_flag.
//
// dataset_type is settable on create (the UX needs the discharge/claims
// distinction at create time) but read-only after — agents shouldn't be
// flipping a dataset's type once it's wired up downstream.
// ---------------------------------------------------------------------------

const datasetTypeOptions = [
  { value: '', label: '(none)' },
  { value: 'd', label: 'd — discharge' },
  { value: 'c', label: 'c — claims' },
]

export const customerDatasetsConfig: ResourceConfig = {
  slug: 'customer-datasets',
  label: 'Discharge Databases',
  shortLabel: 'Discharge',
  description: 'Discharge databases attached to customers. Deletes allowed here.',
  buildId: (r) => String(r.rec_id),
  rowKey: (r) => `cd-${r.rec_id}`,
  primaryKeyColumns: ['rec_id'],
  sortableColumns: new Set([
    'rec_id', 'customer_code', 'database_name', 'odbc_dataset',
    'inpatient', 'outpatient', 'ed',
    'dataset_type', 'aprdrg_flag',
    'create_date', 'modify_date',
  ]),
  filterByCustomerCode: true,
  allowDelete: true,
  deleteImpactKind: 'customer_dataset',
  columns: [
    readonly('rec_id', 'Rec ID'),
    {
      key: 'customer_code', label: 'Customer', kind: 'customer_code',
      editable: false, showInCreate: true, requiredOnCreate: true,
    },
    {
      key: 'odbc_dataset', label: 'ODBC Dataset', kind: 'text', editable: true,
      maxLength: 50, showInCreate: true,
      // Filter dropdown: same source/filter as the Database column.
      // The cell + create input stay as plain text.
      filterKind: 'database_picker',
      pickerRequireDischargeFeatures: true,
    },
    {
      // Driven by myuser.db_database via /api/db-databases (DatabasePicker).
      // Only databases with at least one discharge feature are listed.
      key: 'database_name', label: 'Database', kind: 'database_picker',
      editable: true, maxLength: 25,
      showInCreate: true, requiredOnCreate: true,
      pickerRequireDischargeFeatures: true,
    },
    {
      // View-only on the table; not shown on create. The backend defaults
      // this to 'd' (discharge) when omitted — see customer_dataset_repo.
      // PPI/claims datasets go through a different table entirely and
      // never use this dataset_type.
      key: 'dataset_type', label: 'Type', kind: 'text', editable: false,
      options: datasetTypeOptions, showInCreate: false, createDefault: 'd',
    },
    // IP/OP/ED/APR-DRG: locked to No unless the picked database supports
    // the feature in myuser.db_features_list. computeDisabledOverride is
    // honored by both CreateRowModal and EditableCell.
    flag('outpatient', 'OP', {
      computeDisabledOverride: (_row, f) =>
        f.outpatient ? null : { disabled: true, valueOverride: 0 },
    }),
    flag('inpatient', 'IP', {
      createDefault: 1,
      computeDisabledOverride: (_row, f) =>
        f.inpatient ? null : { disabled: true, valueOverride: 0 },
    }),
    flag('ed', 'ED', {
      computeDisabledOverride: (_row, f) =>
        f.ed ? null : { disabled: true, valueOverride: 0 },
    }),
    flag('aprdrg_flag', 'APR-DRG', {
      computeDisabledOverride: (_row, f) =>
        f.aprdrg ? null : { disabled: true, valueOverride: 0 },
    }),
    {
      key: 'export_flag', label: 'Export', kind: 'flag', editable: true,
      options: yesNoOptions, showInCreate: false, createDefault: 1,
      show: false,
    },
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
// PPI Datasets ("Claim Databases" in the UI; backend slug stays 'ppi-datasets'
// and the underlying table is secure.ppi_dataset).
//
// HIDDEN FROM UI: ppi_detail, ppi_summary, cell_size_limit, export_detail.
// Underlying columns still exist in secure.ppi_dataset and are still written
// at create time by ppi_dataset_repo.
// ---------------------------------------------------------------------------

export const ppiDatasetsConfig: ResourceConfig = {
  slug: 'ppi-datasets',
  label: 'Claim Databases',
  shortLabel: 'Claim',
  description: 'Claim databases attached to customers. Deletes allowed.',
  buildId: (r) => String(r.rec_id),
  rowKey: (r) => `p-${r.rec_id}`,
  primaryKeyColumns: ['rec_id'],
  sortableColumns: new Set([
    'rec_id', 'customer_code', 'ppi_state',
    'create_date', 'modify_date',
  ]),
  filterByCustomerCode: true,
  allowDelete: true,
  // PPI rows aren't joined to individual users, so there's no
  // delete-impact preview to fetch.
  deleteImpactKind: 'none',
  columns: [
    readonly('rec_id', 'Rec ID'),
    {
      key: 'customer_code', label: 'Customer', kind: 'customer_code',
      editable: false, showInCreate: true, requiredOnCreate: true,
    },
    {
      // Claims-only database, picked from myuser.db_database (filtered to
      // databases with NONE of the discharge features). The selected
      // database_name string is stored directly into ppi_state.
      key: 'ppi_state', label: 'State', kind: 'database_picker', editable: true,
      maxLength: 25, showInCreate: true, requiredOnCreate: true,
      pickerRequireNoDischargeFeatures: true,
    },
    {
      key: 'ppi_detail', label: 'Detail', kind: 'flag', editable: true,
      options: yesNoOptions, showInCreate: false, createDefault: 1,
      show: false,
    },
    {
      key: 'ppi_summary', label: 'Summary', kind: 'flag', editable: true,
      options: yesNoOptions, showInCreate: false, createDefault: 1,
      show: false,
    },
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