/**
 * App-wide error boundary.
 *
 * React error boundaries still need to be class components as of React 18.
 * We show a friendly card with a reload button. In development we also
 * surface the stack so bugs are debuggable; production hides it.
 */
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    // Log to console so devs can see the stack; the server side of the
    // story is already covered by request-level exception logging.
    console.error('Unhandled error in app:', error, info)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children

    const isDev = import.meta.env.MODE === 'development'
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4">
        <div className="card p-6 max-w-md w-full">
          <h1 className="text-lg font-semibold text-gray-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            The page ran into an unexpected error. Try reloading — if it keeps
            happening, let your tools team know.
          </p>
          {isDev && (
            <pre className="mt-3 rounded-md bg-gray-50 border border-border p-2 text-[11px] text-gray-700 whitespace-pre-wrap break-words max-h-48 overflow-auto">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          )}
          <div className="mt-4 flex gap-2 justify-end">
            <button
              type="button"
              className="btn-secondary"
              onClick={this.reset}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
