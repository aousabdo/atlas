import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EvidenceSplit } from '../EvidenceSplit'

const split = (high: number, medium: number, low: number, unspecified = 0) => ({
  high, medium, low, unspecified,
})

describe('EvidenceSplit', () => {
  it('states the range from what is proven to what is believed, and the parts', () => {
    render(<EvidenceSplit counts={split(5, 3, 2)} />)
    expect(screen.getByText(/Proven to believed: 5 to 10\./)).toHaveTextContent(
      '5 physically verified, 3 by strong inference, 2 best guesses.',
    )
  })

  it('says a figure holds at every level when all of it is verified', () => {
    render(<EvidenceSplit counts={split(2, 0, 0)} />)
    expect(
      screen.getByText('All 2 physically verified, so this holds at every evidence level.'),
    ).toBeInTheDocument()
  })

  it('leaves out an empty grade but never the verified floor', () => {
    render(<EvidenceSplit counts={split(0, 0, 1, 1)} />)
    expect(screen.getByText(/Proven to believed: 0 to 2\./)).toHaveTextContent(
      '0 physically verified, 1 best guess, 1 ungraded.',
    )
  })

  it('says nothing when nothing is realized', () => {
    const { container } = render(<EvidenceSplit counts={split(0, 0, 0)} />)
    expect(container).toBeEmptyDOMElement()
  })
})
