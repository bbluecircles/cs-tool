import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

interface RequireAdminProps {
  children: ReactNode
}

/**
 * Admin-only route wrapper. Under the current auth model every
 * authenticated CS agent is an admin (their customer_code matches the
 * configured admin code), so is_admin is effectively "are you signed in".
 * We keep the separate guard anyway so a future read-only or non-admin
 * tier needs zero refactoring.
 */
export function RequireAdmin({ children }: RequireAdminProps) {
  const { status, agent, isInitialLoading } = useAuth()
  const location = useLocation()

  if (isInitialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-sm text-gray-500">Loading…</div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    )
  }

  if (!agent?.is_admin) {
    return <Navigate to="/users" replace />
  }

  return <>{children}</>
}
