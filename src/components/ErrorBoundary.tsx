import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  label: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * One per tab, so a broken visualization does not take down the app.
 * Spec section 9.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="m-6 rounded border border-risk-high p-4">
        <h2 className="font-semibold text-risk-high-ink">
          {this.props.label} could not render
        </h2>
        <p className="mt-2 text-sm text-muted">
          The rest of ATLAS is unaffected. This is a bug in the view, not a statement
          about the data.
        </p>
        <pre className="mt-3 overflow-x-auto text-xs text-muted-2">{error.message}</pre>
      </div>
    )
  }
}
