import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface HealthResponse {
  status: 'ok' | 'degraded'
  env: string
  database: 'up' | 'down'
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}
