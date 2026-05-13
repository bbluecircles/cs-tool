import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

interface RequireAuthProps {
  children: ReactNode
}

/**
 * Gate protected routes.
 *
 * - While /auth/me is loading, render a calm placeholder instead of the
 *   login page (avoids a jarring flash on every hard reload).
 * - If unauthenticated, redirect to /login, preserving the attempted URL
 *   in router state so LoginPage can send the user back after sign-in.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { status, isInitialLoading } = useAuth()
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

  return <>{children}</>
}
