/**
 * Thin fetch wrapper.
 *
 * Design notes:
 *  - `credentials: 'include'` so the httpOnly auth cookie goes with every
 *    request. Because Vite proxies /api and /auth to the backend in dev,
 *    the cookie stays same-origin.
 *  - We throw an `ApiError` with status + parsed body on non-2xx so callers
 *    (and React Query) can react to specific codes.
 *  - No generic retry here; React Query handles that at the query level.
 *  - One exception: on a 401 for a non-auth request, we try a single silent
 *    refresh and replay the original request. If refresh fails, we surface
 *    the original 401 and let RequireAuth boot the user to /login.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface RequestOptions {
  method?: Method
  body?: unknown
  signal?: AbortSignal
  /** Internal: set to true on the replay attempt to prevent refresh loops. */
  _retried?: boolean
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, _retried } = opts

  const res = await fetch(path, {
    method,
    credentials: 'include',
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  // 204 and friends — nothing to parse
  if (res.status === 204) return undefined as T

  const text = await res.text()
  const parsed: unknown = text ? safeParse(text) : null

  if (!res.ok) {
    // Silent refresh: if access-cookie expired mid-session, try /auth/refresh
    // once and replay the request. Never do this for the refresh or login
    // endpoints themselves, and never recurse.
    if (
      res.status === 401 &&
      !_retried &&
      !path.startsWith('/auth/refresh') &&
      !path.startsWith('/auth/login')
    ) {
      const refreshed = await tryRefresh()
      if (refreshed) {
        return request<T>(path, { ...opts, _retried: true })
      }
    }

    const message =
      (isObject(parsed) && typeof parsed.detail === 'string'
        ? parsed.detail
        : res.statusText) || `HTTP ${res.status}`
    throw new ApiError(res.status, parsed, message)
  }

  return parsed as T
}

let refreshInFlight: Promise<boolean> | null = null

/**
 * At most one refresh request in flight, ever. If many queries 401 at once
 * (common after a long idle), they all wait on the same refresh and then
 * replay.
 */
function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        // Broadcast so the app can surface a "your session expired" toast
        // rather than silently bouncing the user to /login.
        window.dispatchEvent(new CustomEvent('cs-tool:session-expired'))
      }
      return res.ok
    } catch {
      window.dispatchEvent(new CustomEvent('cs-tool:session-expired'))
      return false
    } finally {
      // Release the lock after a tick so concurrent callers resolve first.
      setTimeout(() => {
        refreshInFlight = null
      }, 0)
    }
  })()
  return refreshInFlight
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export const api = {
  get:   <T,>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', signal }),
  post:  <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body }),
  del:   <T,>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
}
