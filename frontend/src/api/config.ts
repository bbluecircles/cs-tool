/**
 * Client-side feature-flag fetching.
 *
 * Cached for the session. Components that care about flags (e.g. whether
 * to show the confirm-save modal) subscribe via useConfig().
 */
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface ClientConfig {
  enable_edit_confirmation: boolean
  enable_view_refresh: boolean
  admin_customer_codes: string
}

export function fetchConfig(): Promise<ClientConfig> {
  return api.get<ClientConfig>('/api/config')
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => fetchConfig(),
    staleTime: 5 * 60_000,
  })
}
