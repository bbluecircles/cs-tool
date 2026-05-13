/**
 * Column definitions for the users table.
 *
 * Each column carries `meta.scope` indicating what the column writes to:
 *   - 'user'     — secure.customer_users   (edit is per-user; changing this
 *                  propagates across all rows with the same user_id)
 *   - 'customer' — secure.customer         (affects all users of the customer)
 *   - 'dataset'  — secure.customer_dataset (affects all users on that dataset)
 *   - 'readonly' — not editable from this tool
 *
 * Stage 3 only uses `scope` for visual grouping and to decide which columns
 * can be sorted on the server (whitelist enforced server-side). Stage 4 is
 * where scope drives inline-edit behavior.
 */
import type { ColumnDef } from '@tanstack/react-table'
import type { UserRow } from '@/api/users'

export type EditScope = 'user' | 'customer' | 'dataset' | 'readonly'

export interface ColumnMeta {
  scope: EditScope
  sortable?: boolean
  /** Optional human label shown in group headers or edit dialogs. */
  group?: 'identity' | 'customer' | 'dataset' | 'access' | 'quota' | 'meta'
}

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends unknown, TValue> {
    scope: EditScope
    sortable?: boolean
    group?: 'identity' | 'customer' | 'dataset' | 'access' | 'quota' | 'meta'
  }
}

/** Must match the server-side SORTABLE_COLUMNS whitelist exactly. */
export const SORTABLE_COLUMNS = new Set<string>([
  'user_id',
  'e_mail',
  'first_name',
  'last_name',
  'customer_code',
  'customer_name',
  'database_name',
  'disable',
  'create_date',
  'modify_date',
])

function flagCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (value === 0 || value === '0') return 'No'
  return 'Yes'
}

function col<K extends keyof UserRow>(
  key: K,
  header: string,
  opts: Partial<ColumnMeta> & { format?: (v: UserRow[K]) => string } = {},
): ColumnDef<UserRow> {
  const { scope = 'readonly', sortable, group, format } = opts
  return {
    id: String(key),
    accessorKey: key as string,
    header,
    cell: (info) => {
      const v = info.getValue() as UserRow[K]
      if (format) return format(v)
      if (v === null || v === undefined || v === '') return '—'
      return String(v)
    },
    meta: { scope, sortable: sortable ?? SORTABLE_COLUMNS.has(String(key)), group },
    enableSorting: SORTABLE_COLUMNS.has(String(key)),
  }
}

export const USER_COLUMNS: ColumnDef<UserRow>[] = [
  // Identity
  col('user_id', 'User ID', { scope: 'readonly', group: 'identity' }),
  col('first_name', 'First', { scope: 'user', group: 'identity' }),
  col('last_name', 'Last', { scope: 'user', group: 'identity' }),
  col('e_mail', 'Email', { scope: 'user', group: 'identity' }),
  col('disable', 'Active', {
    scope: 'user',
    group: 'identity',
    format: (v) => (v === 0 ? 'Yes' : 'No'),
  }),

  // Customer
  col('customer_code', 'Cust Code', { scope: 'readonly', group: 'customer' }),
  col('customer_name', 'Customer', { scope: 'customer', group: 'customer' }),
  col('entity_code', 'Entity', { scope: 'customer', group: 'customer' }),

  // Dataset
  col('database_name', 'Database', { scope: 'readonly', group: 'dataset' }),
  col('dataset_type', 'Type', { scope: 'dataset', group: 'dataset' }),
  col('inpatient', 'IP', { scope: 'dataset', group: 'dataset', format: flagCell }),
  col('outpatient', 'OP', { scope: 'dataset', group: 'dataset', format: flagCell }),
  col('ed', 'ED', { scope: 'dataset', group: 'dataset', format: flagCell }),
  col('sg2', 'SG2', { scope: 'dataset', group: 'dataset', format: flagCell }),
  col('prism_flag', 'Prism', { scope: 'dataset', group: 'dataset', format: flagCell }),
  col('projection_flag', 'Proj', { scope: 'dataset', group: 'dataset', format: flagCell }),

  // Access
  col('webuser', 'Web', { scope: 'user', group: 'access', format: flagCell }),
  col('ppiuser', 'PPI', { scope: 'user', group: 'access', format: flagCell }),
  col('esri_access', 'ESRI', { scope: 'user', group: 'access', format: flagCell }),
  col('mapping', 'Map', { scope: 'user', group: 'access', format: flagCell }),

  // Quota
  col('max_bytes', 'Max Bytes', { scope: 'customer', group: 'quota' }),
  col('max_row_cnt', 'Max Rows', { scope: 'customer', group: 'quota' }),
  col('max_birt_processes', 'BIRT', { scope: 'user', group: 'quota' }),

  // Meta
  col('create_date', 'Created', {
    scope: 'readonly',
    group: 'meta',
    format: (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—'),
  }),
  col('modify_date', 'Modified', {
    scope: 'readonly',
    group: 'meta',
    format: (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—'),
  }),
]
