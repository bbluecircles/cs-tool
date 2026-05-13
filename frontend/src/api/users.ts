/**
 * Users API client.
 *
 * The UserRow shape mirrors the backend. Note that `user_password` is NOT
 * here — it only comes back from the reveal endpoint.
 */
import { api } from './client'

export interface UserRow {
  user_id: string
  database_name: string
  customer_code: number
  customer_name: string | null
  entity_code: string | null

  e_mail: string
  first_name: string
  last_name: string
  disable: number
  pw_flag: number | null

  // Dataset-level flags
  sg2: number | null
  sg2_op: number | null
  inpatient: number | null
  outpatient: number | null
  ed: number | null
  claritas_flag: number | null
  claritas_state: string | null
  prism_flag: number | null
  projection_flag: number | null
  cms_states: string | null
  transfers_flag: number | null
  dataset_type: string | null
  cell_size_limit: number | null
  export_detail: string | null
  aprdrg_flag: number | null
  export_flag: number | null
  export_row_limit: number | null
  webapp_flag: number | null

  // User-level access flags
  logging_flag: number | null
  esri_access: number | null
  esri_tap_access: number | null
  esri_state: string | null
  webuser: number | null
  ppiuser: number | null
  mapping: number | null
  user_priority: number | null
  max_birt_processes: number | null
  ppi_detail_user: number | null
  web_esri_access: number | null
  web_esri_tap_access: number | null
  web_inpatient_access: number | null
  web_outpatient_access: number | null
  web_ed_access: number | null
  web_claims_access: number | null

  // Customer-level quotas
  max_bytes: number | null
  '5_digit_zip': number | null
  max_row_cnt: number | null

  create_date: string | null
  modify_date: string | null
}

export interface UserListResponse {
  rows: UserRow[]
  total: number
  page: number
  page_size: number
}

export interface UserListParams {
  page: number
  page_size: number
  search?: string
  customer_code?: number
  database_name?: string
  disable?: 0 | 1
  sort_by?: string
  sort_dir?: 'asc' | 'desc'
}

function toQuery(params: UserListParams): string {
  const sp = new URLSearchParams()
  sp.set('page', String(params.page))
  sp.set('page_size', String(params.page_size))
  if (params.search) sp.set('search', params.search)
  if (params.customer_code !== undefined)
    sp.set('customer_code', String(params.customer_code))
  if (params.database_name) sp.set('database_name', params.database_name)
  if (params.disable !== undefined) sp.set('disable', String(params.disable))
  if (params.sort_by) sp.set('sort_by', params.sort_by)
  if (params.sort_dir) sp.set('sort_dir', params.sort_dir)
  return sp.toString()
}

export function listUsers(
  params: UserListParams,
  signal?: AbortSignal,
): Promise<UserListResponse> {
  return api.get<UserListResponse>(`/api/users?${toQuery(params)}`, signal)
}

export interface PasswordRevealResponse {
  user_id: string
  user_password: string
}

export function revealPassword(
  userId: string,
  databaseName: string,
): Promise<PasswordRevealResponse> {
  return api.get<PasswordRevealResponse>(
    `/api/users/${encodeURIComponent(userId)}/${encodeURIComponent(
      databaseName,
    )}/password`,
  )
}

export interface CustomerBrief {
  customer_code: number
  customer_name: string | null
}

export function listCustomersBrief(): Promise<CustomerBrief[]> {
  return api.get<CustomerBrief[]>('/api/customers/brief')
}

export function listDatabasesBrief(): Promise<string[]> {
  return api.get<string[]>('/api/databases/brief')
}
