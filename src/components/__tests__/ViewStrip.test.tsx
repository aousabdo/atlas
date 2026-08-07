import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_VIEW_STRIP_LABEL, ViewStrip, type ViewStripStepper } from '../ViewStrip'

/**
 * The strip has to be findable by name and complete when found.
 *
 * A control was deleted from the network strip and the visual suite still went
 * green: the layout is a two-column grid, so the missing button left an empty
 * cell and moved 33 pixels. Nothing here asserts pixels. It asserts that the
 * strip is a toolbar, that its name comes from the caller so the two tabs can
 * be told apart, and that every control is present under the name a reader
 * would use for it.
 */

function stepper(over: Partial<ViewStripStepper> = {}): ViewStripStepper {
  return {
    label: 'Zoom',
    value: 1,
    decreaseLabel: 'Zoom out',
    increaseLabel: 'Zoom in',
    onStep: () => {},
    ...over,
  }
}

/**
 * The accessible name of every button, in order.
 *
 * Deliberately not the inner text: two of every three buttons here are a bare
 * minus or plus sign, so the visible text of a strip reads "- + - + Fit" and a
 * deleted stepper is indistinguishable from a deleted action. This mirrors what
 * e2e/visual.spec.ts reads out of the real page.
 */
function controlNames(scope: HTMLElement): string[] {
  return within(scope)
    .getAllByRole('button')
    .map((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())
}

describe('ViewStrip identity', () => {
  it('is a toolbar under the name the caller gives it', () => {
    render(<ViewStrip label="Network view controls" steppers={[stepper()]} actions={[]} />)
    expect(screen.getByRole('toolbar', { name: 'Network view controls' })).toBeInTheDocument()
  })

  it('lets two strips on one page be told apart', () => {
    // The reason the label is a prop. With one shared constant, an inventory
    // test could only ever assert that some strip somewhere was intact.
    render(
      <>
        <ViewStrip label="Map view controls" steppers={[stepper()]} actions={[]} />
        <ViewStrip label="Network view controls" steppers={[stepper()]} actions={[]} />
      </>,
    )
    expect(screen.getByRole('toolbar', { name: 'Map view controls' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Network view controls' })).toBeInTheDocument()
  })

  it('still has a name when the caller gives none', () => {
    render(<ViewStrip steppers={[stepper()]} actions={[]} />)
    expect(screen.getByRole('toolbar', { name: DEFAULT_VIEW_STRIP_LABEL })).toBeInTheDocument()
  })
})

describe('ViewStrip inventory', () => {
  it('carries every stepper and action as a named button', () => {
    render(
      <ViewStrip
        label="Network view controls"
        steppers={[
          stepper(),
          stepper({
            label: 'Nodes',
            decreaseLabel: 'Smaller nodes',
            increaseLabel: 'Larger nodes',
          }),
        ]}
        actions={[{ label: 'Fit', title: 'Fit the whole topology (F)', onClick: () => {} }]}
      />,
    )
    expect(controlNames(screen.getByRole('toolbar', { name: 'Network view controls' }))).toEqual([
      'Zoom out',
      'Zoom in',
      'Smaller nodes',
      'Larger nodes',
      'Fit',
    ])
  })

  it('loses exactly one name when an action is dropped', () => {
    // The shipped regression, in miniature: the same strip minus its only
    // action. On screen this is an empty grid cell. Here it is a missing name.
    render(<ViewStrip label="Network view controls" steppers={[stepper()]} actions={[]} />)
    expect(controlNames(screen.getByRole('toolbar', { name: 'Network view controls' }))).toEqual([
      'Zoom out',
      'Zoom in',
    ])
  })
})

describe('ViewStrip controls', () => {
  it('steps down and up with the sign of the direction', async () => {
    const user = userEvent.setup()
    const onStep = vi.fn()
    render(<ViewStrip label="Map view controls" steppers={[stepper({ onStep })]} actions={[]} />)

    await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(onStep.mock.calls).toEqual([[-1], [1]])
  })

  it('runs the action it was handed', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <ViewStrip
        label="Map view controls"
        steppers={[]}
        actions={[{ label: 'Fit', title: 'Fit the whole map', onClick }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Fit' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
