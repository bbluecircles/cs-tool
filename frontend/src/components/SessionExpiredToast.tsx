import { useEffect, useState } from 'react'

/**
 * Listens for the session-expired event (emitted when silent refresh
 * fails) and shows a dismissible banner explaining why the user was
 * bounced to login. Rendered at the app root so it survives navigation.
 */
export function SessionExpiredToast() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onExpired = () => setVisible(true)
    window.addEventListener('cs-tool:session-expired', onExpired)
    return () =>
      window.removeEventListener('cs-tool:session-expired', onExpired)
  }, [])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
      <div className="rounded-md border border-warning-600/30 bg-warning-100 px-4 py-3 shadow-card text-sm text-gray-900">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="font-medium">Your session expired</div>
            <div className="mt-0.5 text-[11px] text-gray-700">
              Sign in again to continue.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="text-[11px] text-secondary-500 hover:text-secondary-700"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
