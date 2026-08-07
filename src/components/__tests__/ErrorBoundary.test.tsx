import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EmptyState } from '../EmptyState'
import { ErrorBoundary } from '../ErrorBoundary'
import { LoadFailed } from '../LoadFailed'

function Boom(): never {
  throw new Error('chart exploded')
}

describe('ErrorBoundary', () => {
  it('contains a failure to its own tab', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <ErrorBoundary label="Analytics">
          <Boom />
        </ErrorBoundary>
        <p>the rest of the app</p>
      </div>,
    )
    expect(screen.getByText(/Analytics could not render/i)).toBeInTheDocument()
    expect(screen.getByText('the rest of the app')).toBeInTheDocument()
  })

  it('names the error so a bug report can start somewhere', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary label="Analytics">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/chart exploded/)).toBeInTheDocument()
  })

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary label="Analytics">
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
  })
})

describe('empty versus failed', () => {
  it('an empty state says the data loaded and is genuinely empty', () => {
    render(<EmptyState title="No snapshots yet" detail="Trends need a second build." />)
    expect(screen.getByText('No snapshots yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a load failure is an alert and says no figure is trustworthy', () => {
    render(<LoadFailed resource="systems.json" message="404" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/not an empty result/i)).toBeInTheDocument()
  })
})
