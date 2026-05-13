import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useHealth } from '@/api/health'
import { displayName } from '@/api/auth'
import { useAuth, useLogout } from '@/features/auth/useAuth'
import { hasUnsaved } from '@/lib/unsavedSignal'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen flex bg-surface">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function Sidebar() {
  const { agent } = useAuth()
  return (
    <aside className="w-60 shrink-0 bg-primary-900 text-white flex flex-col">
      <div className="h-14 flex items-center px-5 border-b border-white/10">
        <span className="ml-2 text-xs text-primary-300 font-normal">
          Resources
        </span>
      </div>
      <nav className="flex-1 py-4">
        <NavItem
          to="/resources/customers"
          label="Resources"
          activePrefix="/resources"
        />
        {agent?.is_admin && <NavItem to="/admin" label="Admin" />}
      </nav>
      <div className="px-5 py-3 text-xs text-primary-300 border-t border-white/10">
        v0.1.0
      </div>
    </aside>
  )
}

function NavItem({
  to,
  label,
  activePrefix,
}: {
  to: string
  label: string
  /** If given, the link is "active" whenever pathname starts with this.
   *  Useful for grouped subroutes (e.g. /resources/*). */
  activePrefix?: string
}) {
  const location = useLocation()
  return (
    <NavLink
      to={to}
      className={({ isActive }) => {
        const active =
          activePrefix !== undefined
            ? location.pathname.startsWith(activePrefix)
            : isActive
        return clsx(
          'flex items-center px-5 py-2 text-sm transition-colors',
          active
            ? 'bg-primary-700 text-white'
            : 'text-primary-100 hover:bg-primary-700/60 hover:text-white',
        )
      }}
    >
      {label}
    </NavLink>
  )
}

function Topbar() {
  const { data, isError } = useHealth()
  const { agent } = useAuth()
  const logout = useLogout()
  const dbUp = data?.database === 'up'
  const showDot = !!data || isError

  return (
    <header className="h-14 bg-white border-b border-border flex items-center px-6 gap-4">
      <h1 className="text-base font-semibold text-gray-900">
        <img src="/logo.png" style={{ width: 100 }} /> 
      </h1>

      <div className="ml-auto flex items-center gap-4">
        {/* {showDot && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span
              className={clsx(
                'inline-block h-2 w-2 rounded-full',
                dbUp ? 'bg-success-600' : 'bg-error-600',
              )}
            />
            {dbUp ? 'API online' : 'API degraded'}
          </span>
        )} */}

        {agent && (
          <>
            <div className="h-6 w-px bg-divider" aria-hidden />
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <div className="text-xs font-medium text-gray-900">
                  {displayName(agent)}
                </div>
                {/* <div className="text-[11px] text-gray-500 font-mono">
                  {agent.user_id}
                </div> */}
              </div>
              <button
                type="button"
                className="btn-ghost text-xs px-2 py-1"
                onClick={() => {
                  if (hasUnsaved()) {
                    const ok = window.confirm(
                      'You have unsaved edits. Sign out anyway?',
                    )
                    if (!ok) return
                  }
                  logout.mutate()
                }}
                disabled={logout.isPending}
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
