import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useCuration, type Curation } from '../../../curation/CurationContext'
import { localDate } from '../../../curation/dates'
import { CHECKLIST_RULE } from '../../../curation/walk'
import { setExportEditsNote } from '../../../export/png'
import { renderWithProvider } from '../../../test/renderWithProvider'
import { WalkTab } from '../WalkTab'

let curation: Curation

function Probe() {
  curation = useCuration()
  return null
}

afterEach(() => setExportEditsNote(null))

async function renderPrint() {
  const view = await renderWithProvider(
    <>
      <WalkTab />
      <Probe />
    </>,
    { curation: true },
  )
  const printout = await screen.findByTestId('checklist-print')
  return { ...view, printout }
}

describe('the printed checklist', () => {
  it('heads Northgate with its marking, source and the ordering rule', async () => {
    const { printout } = await renderPrint()
    const header = within(printout).getByTestId('checklist-header')
    expect(header).toHaveTextContent('Northgate Sports Campus')
    expect(header).toHaveTextContent('UNCLASSIFIED//SAMPLE')
    expect(header).toHaveTextContent('Data: Sample data')
    expect(header).toHaveTextContent(`Printed ${localDate(new Date())}`)
    expect(header).toHaveTextContent('Reviewer')
    expect(within(header).getByText(CHECKLIST_RULE)).toBeInTheDocument()
    expect(header).not.toHaveTextContent('unsaved')
  })

  it('runs Systems to locate, the zones, then Already settled', async () => {
    const { printout } = await renderPrint()
    const headings = within(printout).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toHaveLength(15)
    expect(headings[0]).toBe('A. Systems to locate')
    expect(headings[14]).toBe('D. Already settled')
    const sectionA = within(printout).getByRole('region', { name: 'A. Systems to locate' })
    const names = within(sectionA).getAllByRole('listitem').map((li) => li.textContent ?? '')
    const kite = names.findIndex((t) => t.includes('KITE Relay Plugin'))
    const homing = names.findIndex((t) => t.includes('Relay Homing Plugin'))
    expect(kite).toBeGreaterThanOrEqual(0)
    expect(homing).toBeGreaterThan(kite)
    expect(names[kite]).toContain('found on')
    expect(names[kite]).toContain('or not here:')
  })

  it('gives each device a box, its systems and a blank for what it carries', async () => {
    const { printout } = await renderPrint()
    const zone = within(printout).getAllByRole('region').filter(
      (r) => !/^(A|D)\. /.test(r.getAttribute('aria-label') ?? ''),
    )[0]
    const row = within(zone).getAllByRole('listitem')[0]
    expect(row).toHaveClass('checklist-row')
    expect(row).toHaveTextContent('carries:')
    expect(row).toHaveTextContent('carries no system')
  })

  it('says how many reviews are unsaved, once there is one', async () => {
    const { printout } = await renderPrint()
    act(() =>
      curation.apply({
        kind: 'review', site: 'northgate', system: 'kite',
        review: {
          status: 'absent', reason: 'Not installed', reviewed_by: 'Site lead',
          reviewed_on: '2026-11-13',
        },
      }),
    )
    const header = within(printout).getByTestId('checklist-header')
    await waitFor(() =>
      expect(header).toHaveTextContent('Includes 1 unsaved review, not yet exported to a file'),
    )
    const settled = within(printout).getByRole('region', { name: 'D. Already settled' })
    expect(within(settled).getAllByText(/KITE Relay Plugin/)).toHaveLength(1)
    expect(settled).toHaveTextContent('Not installed')
  })

  it('marks everything else on the page to stay off the paper', async () => {
    await renderPrint()
    expect(document.querySelector('[data-print-hide]')).not.toBeNull()
    expect(document.querySelector('[data-export-png]')).toBeNull()
  })
})
