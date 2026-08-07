import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../App'

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('routes', () => {
  it('redirects the root to the reference tab', async () => {
    at('/')
    expect(
      await screen.findByRole('heading', { name: /Reference & Methodology/i }),
    ).toBeInTheDocument()
  })

  it.each([
    ['/reference', /Reference & Methodology/i],
    ['/analytics', /Analytics/i],
    ['/lossiness', /Lossiness/i],
    ['/network', /Network Topology/i],
    ['/map', /Orientation Map/i],
  ])('renders %s', async (path, heading) => {
    at(path)
    // The map and network tabs load three bundles and lay out before their
    // heading settles, which is longer than findBy's one-second default.
    expect(
      await screen.findByRole('heading', { name: heading }, { timeout: 5000 }),
    ).toBeInTheDocument()
  })

  it('shows a not-found page for an unknown route rather than a blank screen', async () => {
    at('/nonsense')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  it('presents the five tabs in spec order', () => {
    at('/reference')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Reference & Methodology',
      'Analytics',
      'Lossiness',
      'Network Topology',
      'Orientation Map',
    ])
  })

  it('uses real routes, not hash state, so a view is a shareable URL', () => {
    at('/map')
    const mapTab = screen.getByRole('tab', { name: 'Orientation Map' })
    expect(mapTab).toHaveAttribute('href', '/map')
  })
})
