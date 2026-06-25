import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAdmin } from '@/features/auth/RequireAdmin'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { AdminPage } from '@/features/admin/AdminPage'
import { ResourceTabs } from '@/features/resources/ResourceTabs'

/**
 * Route map.
 *
 *   /login                 public
 *   /                      → /resources/customers
 *   /resources             → /resources/customers (default tab)
 *   /resources/:slug       authenticated tabbed resource view
 *   /admin                 admin-only (all authenticated agents are admins today)
 *
 * The whole tree sits inside ErrorBoundary. SessionExpiredToast is mounted
 * globally so it survives navigation after a silent-refresh failure.
 */
export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/resources/customers" replace />} />
        <Route path="/resources" element={<Navigate to="/resources/customers" replace />} />
        <Route
          path="/resources/:slug"
          element={
            <RequireAuth>
              <AppShell>
                <ResourceTabs />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AppShell>
                <AdminPage />
              </AppShell>
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center">
        <p className="text-sm text-gray-500">Not found.</p>
      </div>
    </div>
  )
}
