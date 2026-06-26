/**
 * Dropdown of databases sourced from myuser.db_database via
 * GET /api/db-databases. Used in the customer-dataset create form and
 * inline-edit cell — database_name is constrained to values that exist
 * in that table.
 *
 * Modeled on CustomerPicker. Same staleTime convention so the list is
 * fetched once per session-ish and reused across modals/cells.
 */
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { fetchDbDatabases } from '@/api/resources'
import type { QueryClient } from '@tanstack/react-query'
import type { DbDatabaseRow } from '@/api/resources'

/**
 * Per-database feature availability. Drives the IP/OP/ED/APR-DRG locks
 * in the dataset create form and inline edit. Mirrors the four
 * feat_* fields in DbDatabaseRow.
 *
 * available[k] = true  → the feature can be selected for this database
 * available[k] = false → locked to No (UI disables the select and forces 0)
 */
export interface DbFeatures {
  inpatient: boolean
  outpatient: boolean
  ed: boolean
  aprdrg: boolean
}

/**
 * Default for "no database selected" or "database unknown" — everything
 * locked. The create form uses this to keep the four selects disabled
 * until a database is picked.
 */
export const NO_DB_FEATURES: DbFeatures = {
  inpatient: false,
  outpatient: false,
  ed: false,
  aprdrg: false,
}

/**
 * Look up feature availability for the given database_name. Reads from
 * the same react-query cache the DatabasePicker uses, so this is
 * synchronous after the first fetch.
 *
 * Returns NO_DB_FEATURES if:
 *   - database_name is null/empty (nothing selected yet)
 *   - the cache hasn't loaded yet
 *   - the database isn't in db_database (legacy row, etc.)
 * In all those cases the safer default is "everything locked".
 */
export function useDbFeatures(database_name: string | null | undefined): DbFeatures {
  const q = useQuery({
    queryKey: ['db-database-picker'],
    queryFn: fetchDbDatabases,
    staleTime: 60_000,
  })
  if (!database_name) return NO_DB_FEATURES
  const row = q.data?.rows.find((r) => r.database_name === database_name)
  if (!row) return NO_DB_FEATURES
  return {
    inpatient:  row.feat_inpatient  === 1,
    outpatient: row.feat_outpatient === 1,
    ed:         row.feat_ed         === 1,
    aprdrg:     row.feat_aprdrg     === 1,
  }
}

/**
 * Sync version of useDbFeatures for use outside React component scope
 * (e.g. TanStack Table cell render callbacks). Reads from the same
 * react-query cache; returns NO_DB_FEATURES if the cache hasn't loaded.
 */
export function lookupDbFeatures(
  qc: QueryClient,
  database_name: string | null | undefined,
): DbFeatures {
  if (!database_name) return NO_DB_FEATURES
  const data = qc.getQueryData<{ rows: DbDatabaseRow[] }>(['db-database-picker'])
  const row = data?.rows.find((r) => r.database_name === database_name)
  if (!row) return NO_DB_FEATURES
  return {
    inpatient:  row.feat_inpatient  === 1,
    outpatient: row.feat_outpatient === 1,
    ed:         row.feat_ed         === 1,
    aprdrg:     row.feat_aprdrg     === 1,
  }
}

/**
 * True if a database supports at least one discharge feature
 * (inpatient / outpatient / ed / aprdrg). Databases with all four at 0
 * have nothing to offer a discharge dataset and are filtered out of the
 * Create Discharge picker.
 */
export function hasAnyDischargeFeature(r: DbDatabaseRow): boolean {
  return (
    r.feat_inpatient === 1 ||
    r.feat_outpatient === 1 ||
    r.feat_ed === 1 ||
    r.feat_aprdrg === 1
  )
}

/**
 * Inverse of hasAnyDischargeFeature: true if a database has NONE of the
 * four discharge features. These are the claims-only databases the
 * Create Claim modal lists.
 */
export function hasNoDischargeFeature(r: DbDatabaseRow): boolean {
  return !hasAnyDischargeFeature(r)
}

interface DatabasePickerProps {
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  required?: boolean
  className?: string
  /**
   * When true, the dropdown still renders any current value even if it
   * isn't in the list (so inline-editing a legacy row doesn't visually
   * drop its existing database_name). The agent still has to actively
   * pick a different value to change it.
   */
  preserveUnknownValue?: boolean
  /**
   * When true, only databases that support at least one discharge
   * feature (IP/OP/ED/APR-DRG) are listed. Used by the Create Discharge
   * modal — a database with all four flags at 0 can't back a discharge
   * dataset, so offering it would only let the agent create a dead row.
   */
  requireDischargeFeatures?: boolean
  /**
   * When true, only databases with NONE of the four discharge features
   * are listed (the claims-only databases). Used by the Create Claim
   * modal. Mutually exclusive with requireDischargeFeatures.
   */
  requireNoDischargeFeatures?: boolean
  /**
   * When true, the placeholder option is selectable and labeled "All".
   * Used by filter rows where clearing the selection should clear the
   * filter. In create/edit contexts the placeholder stays disabled so
   * the agent has to actively pick something.
   */
  allowAll?: boolean
}

export function DatabasePicker({
  value,
  onChange,
  disabled,
  required,
  className,
  preserveUnknownValue,
  requireDischargeFeatures,
  requireNoDischargeFeatures,
  allowAll,
}: DatabasePickerProps) {
  const q = useQuery({
    queryKey: ['db-database-picker'],
    queryFn: fetchDbDatabases,
    staleTime: 60_000,
  })

  const allRows = q.data?.rows ?? []
  const rows = requireDischargeFeatures
    ? allRows.filter(hasAnyDischargeFeature)
    : requireNoDischargeFeatures
      ? allRows.filter(hasNoDischargeFeature)
      : allRows
  const knownNames = new Set(rows.map((r) => r.database_name))
  const showLegacyValue =
    preserveUnknownValue && value != null && value !== '' && !knownNames.has(value)

  return (
    <select
      // Database/state values render bold + uppercase for visibility.
      className={clsx(className ?? 'input', 'font-bold uppercase')}
      value={value ?? ''}
      disabled={disabled || q.isLoading}
      required={required}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : e.target.value)
      }
    >
      <option value="" disabled={!allowAll}>
        {q.isLoading ? 'Loading…' : allowAll ? 'All' : '— choose —'}
      </option>
      {showLegacyValue && (
        <option value={value as string}>
          {(value as string).toUpperCase()} (not in db_database)
        </option>
      )}
      {rows.map((r) => (
        <option key={r.db_connection_id} value={r.database_name}>
          {r.database_name.toUpperCase()}
        </option>
      ))}
    </select>
  )
}