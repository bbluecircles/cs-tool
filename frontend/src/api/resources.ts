/**
 * Generic CRUD client for the four tabbed resources.
 *
 * Each resource exposes:
 *   GET    /api/{slug}            list (with filter/sort/pagination)
 *   POST   /api/{slug}            create
 *   GET    /api/{slug}/{id}       fetch one
 *   PATCH  /api/{slug}/{id}       update
 *   DELETE /api/{slug}/{id}       delete (customer-datasets only)
 *
 * Filters travel as repeated `?filter=column:operator:value` query
 * params. The backend's filter_parser module owns the grammar; this
 * file's job is just to serialize the JS-side ResourceFilter array into
 * that format. Operator names (eq/ne/like/gt/gte/lt/lte) match the
 * backend's OPERATORS dict exactly.
 */
import { api } from './client'

export interface ListResponse<Row = Record<string, unknown>> {
  rows: Row[]
  total: number
  page: number
  page_size: number
}

/**
 * One filter clause. Multiple clauses are AND'd together by the backend.
 *
 * For text columns the frontend always emits operator='like' and lets the
 * backend wrap the value in `%...%`. For numeric/flag/enum columns,
 * operator='eq'. For date ranges, the from-picker emits 'gte' and the
 * to-picker emits 'lte' as two separate filters on the same column.
 */
export interface ResourceFilter {
  column: string
  operator: 'eq' | 'ne' | 'like' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string | number
}

export interface ListParams {
  page: number
  page_size: number
  sort_by?: string
  sort_dir?: 'asc' | 'desc'
  filters?: ResourceFilter[]
}

function toQuery(params: ListParams): string {
  const sp = new URLSearchParams()
  sp.set('page', String(params.page))
  sp.set('page_size', String(params.page_size))
  if (params.sort_by) sp.set('sort_by', params.sort_by)
  if (params.sort_dir) sp.set('sort_dir', params.sort_dir)

  // Repeated `filter=...` params. URLSearchParams.append (not set) is
  // the right method here — set() would overwrite previous filters.
  if (params.filters) {
    for (const f of params.filters) {
      sp.append('filter', `${f.column}:${f.operator}:${f.value}`)
    }
  }
  return sp.toString()
}

export function listResource<Row = Record<string, unknown>>(
  slug: string,
  params: ListParams,
  signal?: AbortSignal,
): Promise<ListResponse<Row>> {
  return api.get<ListResponse<Row>>(
    `/api/${slug}?${toQuery(params)}`, signal,
  )
}

export interface CreateResponse<Row = Record<string, unknown>> {
  created: Row
}

export function createResource<Row = Record<string, unknown>>(
  slug: string,
  body: Record<string, unknown>,
): Promise<CreateResponse<Row>> {
  return api.post<CreateResponse<Row>>(`/api/${slug}`, body)
}

export interface UpdateResponse<Row = Record<string, unknown>> {
  updated: Row
}

export function updateResource<Row = Record<string, unknown>>(
  slug: string,
  idPath: string,
  changes: Record<string, unknown>,
): Promise<UpdateResponse<Row>> {
  return api.patch<UpdateResponse<Row>>(
    `/api/${slug}/${idPath}`, { changes },
  )
}

export interface DeleteResponse {
  deleted: boolean
  rec_id: number
}

export function deleteResource(
  slug: string,
  idPath: string,
): Promise<DeleteResponse> {
  return api.del<DeleteResponse>(`/api/${slug}/${idPath}`)
}

export interface DeleteImpact {
  rec_id: number
  customer_code: number
  database_name: string
  active_user_count: number
}

export function fetchDeleteImpact(
  slug: string,
  rec_id: number,
): Promise<DeleteImpact> {
  return api.get<DeleteImpact>(`/api/${slug}/${rec_id}/delete-impact`)
}

export function checkUserIdAvailable(user_id: string): Promise<{
  user_id: string
  available: boolean
}> {
  return api.get(`/api/customer-users/check-id?user_id=${encodeURIComponent(user_id)}`)
}

export function revealPassword(
  user_id: string,
  customer_code: number,
): Promise<{ user_id: string; customer_code: number; user_password: string }> {
  return api.get(
    `/api/customer-users/${encodeURIComponent(user_id)}/${customer_code}/password`,
  )
}