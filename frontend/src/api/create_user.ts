/**
 * Create-user API client.
 *
 * The payload shape mirrors the Pydantic schemas on the backend:
 *   - customer block is a discriminated union on `mode`
 *   - datasets and ppi_datasets are optional arrays (only used on the
 *     new-customer path or when adding datasets to an existing customer)
 *   - user block is the per-user record
 */
import { api } from './client'

export interface ExistingCustomerRef {
  mode: 'existing'
  customer_code: number
}

export interface NewCustomerInput {
  mode: 'new'
  customer_name: string
  /**
   * Optional integer (1..32767). When omitted, the backend defaults
   * this to the auto-assigned customer_code (matches the convention
   * in existing data). See create_user.py for full rationale.
   */
  entity_code?: number
  /** Two-letter state code, optional. */
  state?: string
  /** Free-form description, optional. Max 255 chars. */
  customer_desc?: string
}

export interface DatasetInput {
  database_name: string
  odbc_dataset?: string | null
  inpatient?: 0 | 1
  outpatient?: 0 | 1
  ed?: 0 | 1
  cms_states?: string | null
  aprdrg_flag?: 0 | 1
  export_flag?: 0 | 1
  export_row_limit?: number
  webapp_flag?: 0 | 1
}

export interface PpiDatasetInput {
  ppi_state: string
  ppi_detail?: 0 | 1
  ppi_summary?: 0 | 1
}

export interface UserInput {
  user_id: string
  user_password: string
  pw_flag?: 0 | 1
  e_mail: string
  first_name: string
  last_name: string
  logging_flag?: 0 | 1
  esri_access?: 0 | 1
  esri_tap_access?: 0 | 1
  esri_state?: string
  webuser?: 0 | 1
  ppiuser?: 0 | 1
  mapping?: 0 | 1
  user_priority?: number
  max_birt_processes?: number
  ppi_detail_user?: 0 | 1
  web_esri_access?: 0 | 1
  web_esri_tap_access?: 0 | 1
  web_inpatient_access?: 0 | 1
  web_outpatient_access?: 0 | 1
  web_ed_access?: 0 | 1
  web_claims_access?: 0 | 1
}

export interface CreateUserRequest {
  customer: NewCustomerInput | ExistingCustomerRef
  datasets?: DatasetInput[]
  ppi_datasets?: PpiDatasetInput[]
  user: UserInput
}

export interface CreateUserResponse {
  user_id: string
  customer_code: number
  datasets_created: number
  ppi_datasets_created: number
  customer_created: boolean
  refresh_ok: boolean
  grants_ok: boolean
  refresh_error: string | null
  grants_error: string | null
}

export interface UserIdCheckResponse {
  user_id: string
  available: boolean
}

export function checkUserId(userId: string): Promise<UserIdCheckResponse> {
  return api.get<UserIdCheckResponse>(
    `/api/users/check-id?user_id=${encodeURIComponent(userId)}`,
  )
}

export function createUser(
  payload: CreateUserRequest,
): Promise<CreateUserResponse> {
  return api.post<CreateUserResponse>('/api/users', payload)
}