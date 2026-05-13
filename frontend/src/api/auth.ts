/**
 * Auth endpoints.
 *
 * The backend sets httpOnly cookies on login/refresh, so the frontend never
 * sees the tokens directly. We treat /auth/me as the source of truth for
 * "am I signed in?" — if it returns 200, we are; 401, we're not.
 */
import { api, ApiError } from './client'

export interface CurrentAgent {
  user_id: string
  customer_code: number
  e_mail: string
  first_name: string
  last_name: string
  is_admin: boolean
}

/** Convenient derived field — use this for display rather than composing
 *  first + last everywhere. */
export function displayName(agent: CurrentAgent): string {
  const joined = `${agent.first_name} ${agent.last_name}`.trim()
  return joined || agent.user_id
}

export interface LoginRequest {
  username: string
  password: string
}

export function login(body: LoginRequest): Promise<CurrentAgent> {
  return api.post<CurrentAgent>('/auth/login', body)
}

export function logout(): Promise<{ message: string }> {
  return api.post<{ message: string }>('/auth/logout')
}

export function refresh(): Promise<{ message: string }> {
  return api.post<{ message: string }>('/auth/refresh')
}

export function me(signal?: AbortSignal): Promise<CurrentAgent> {
  return api.get<CurrentAgent>('/auth/me', signal)
}

export function isUnauthenticated(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}
