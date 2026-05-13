import { FormEvent, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useAuth, useLogin } from './useAuth'

interface LocationState {
  from?: string
}

export function LoginPage() {
  const { status, isInitialLoading } = useAuth()
  const location = useLocation()
  const state = location.state as LocationState | null
  const returnTo =
    state?.from && state.from !== '/login' ? state.from : '/resources/customers'

  // If the user lands here already signed in, bounce them forward.
  if (!isInitialLoading && status === 'authenticated') {
    return <Navigate to={returnTo} replace />
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-surface">
      <BackgroundDecor />
      <div className="relative z-10 w-full max-w-sm px-6">
        <div className="mb-6 text-center">
          <img src="/logo.png" style={{ width: 200, margin: '0 auto'}} />
        </div>
        <LoginCard />
      </div>
    </div>
  )
}

function LoginCard() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const login = useLogin()

  // React Query routes errors through mutation.error; we translate them to
  // something a CS agent can act on.
  const errorMessage = useErrorMessage(login.error)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (!username.trim() || !password) return
    login.mutate({ username: username.trim(), password })
  }

  const usernameInvalid = touched && !username.trim()
  const passwordInvalid = touched && !password

  return (
    <div className="card p-6">
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-4">
          <div>
            <label htmlFor="username" className="label">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              disabled={login.isPending}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`input ${usernameInvalid ? 'input-error' : ''}`}
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={login.isPending}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`input ${passwordInvalid ? 'input-error' : ''}`}
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-error-600/30 bg-error-100 px-3 py-2 text-sm text-error-600"
            >
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={login.isPending}
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  )
}

function useErrorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid username or password.'
    if (err.status === 429) return 'Too many attempts. Try again in a few minutes.'
    if (err.status >= 500) return 'Server error. Please try again.'
    return err.message
  }
  return 'Could not reach the server. Check your connection and try again.'
}

/**
 * Soft branded backdrop. Single radial-gradient blob in primary teal plus a
 * barely-there diagonal hint; does not compete with the card for attention.
 */
function BackgroundDecor() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(30,111,115,0.08), transparent 60%)',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-24 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(135deg, transparent 0 49%, #1E6F73 49% 51%, transparent 51% 100%)',
          backgroundSize: '12px 12px',
        }}
      />
    </>
  )
}
