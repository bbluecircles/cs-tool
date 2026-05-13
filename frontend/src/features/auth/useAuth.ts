/**
 * Auth state via React Query.
 *
 * We treat /auth/me as the source of truth. The cached result IS the
 * "current user" — no parallel state to keep in sync.
 *
 *  useAuth()    — read-only: { agent, status }
 *  useLogin()   — mutation; on success, populates the /auth/me cache
 *  useLogout()  — mutation; on success, clears the cache and redirects
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CurrentAgent,
  LoginRequest,
  isUnauthenticated,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
} from '@/api/auth'

export const AUTH_QUERY_KEY = ['auth', 'me'] as const

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthState {
  agent: CurrentAgent | null
  status: AuthStatus
  /** True on the very first load before we know either way. */
  isInitialLoading: boolean
}

export function useAuth(): AuthState {
  const q = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: ({ signal }) => apiMe(signal),
    // Don't retry on a real 401 — that's the expected "not signed in" answer,
    // not a transient failure worth hammering the server over.
    retry: (failureCount, error) => {
      if (isUnauthenticated(error)) return false
      return failureCount < 1
    },
    // We don't want stale flashes; refetch whenever a consumer mounts.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  if (q.isPending) {
    return { agent: null, status: 'loading', isInitialLoading: true }
  }
  if (q.data) {
    return { agent: q.data, status: 'authenticated', isInitialLoading: false }
  }
  return { agent: null, status: 'unauthenticated', isInitialLoading: false }
}

export function useLogin() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (body: LoginRequest) => apiLogin(body),
    onSuccess: (agent) => {
      qc.setQueryData(AUTH_QUERY_KEY, agent)
      navigate('/resources/customers', { replace: true })
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => apiLogout(),
    onSettled: () => {
      // Clear whether or not the server call succeeded — the intent is
      // "sign me out locally regardless."
      qc.setQueryData(AUTH_QUERY_KEY, null)
      qc.clear()
      navigate('/login', { replace: true })
    },
  })
}
