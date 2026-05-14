/**
 * Admin API client. All endpoints here require an authenticated CS agent
 * whose customer_code matches the configured admin code.
 */
import { api } from './client'

export interface RetryResponse {
  ok: boolean
  error: string | null
  statement_count?: number
  /** True when the endpoint declined to run because a config flag is off. */
  disabled?: boolean
  /**
   * Only populated by retry-grants: describes the refresh phase that
   * runs before grants. 'skipped_disabled' means refresh is owned by an
   * external process; 'succeeded' means the views were just rebuilt;
   * 'failed' means the refresh raised and grants did NOT run.
   */
  refresh_status?: 'skipped_disabled' | 'succeeded' | 'failed' | null
  refresh_error?: string | null
}

export function retryRefresh(): Promise<RetryResponse> {
  return api.post<RetryResponse>('/api/admin/retry-refresh')
}

export function retryGrants(customerCode: number): Promise<RetryResponse> {
  return api.post<RetryResponse>(`/api/admin/retry-grants/${customerCode}`)
}

export interface AuditEntry {
  id: number
  user_id: string | null
  action: string
  entity_type: string
  entity_key: string | null
  notes: string | null
  ip: string | null
  created_at: string
}

export interface AuditListResponse {
  entries: AuditEntry[]
}

export function listAudit(params: {
  limit?: number
  action_prefix?: string
}): Promise<AuditListResponse> {
  const sp = new URLSearchParams()
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.action_prefix) sp.set('action_prefix', params.action_prefix)
  const qs = sp.toString()
  return api.get<AuditListResponse>(`/api/admin/audit${qs ? '?' + qs : ''}`)
}