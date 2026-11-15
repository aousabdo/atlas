import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCuration, type Curation } from '../../../curation/CurationContext'
import { localDate } from '../../../curation/dates'
import { setExportEditsNote } from '../../../export/png'
import { renderWithProvider } from '../../../test/renderWithProvider'
import { WalkTab } from '../WalkTab'

type User = ReturnType<typeof userEvent.setup>

const WESTFIELD_SYSTEMS =
  '0 of 30 realized · 0 recorded with no hardware · 0 checked absent · 30 not looked at'
const WESTFIELD_DEVICES =
  '8 devices · 0 carry a recorded system · 0 checked, carrying none · 8 with no record'
const NORTHGATE_SYSTEMS =
  '10 of 30 realized · 2 recorded with no hardware · 18 checked absent · 0 not looked at'
const NORTHGATE_DEVICES =
  '71 devices · 20 carry a recorded system · 0 checked, carrying none · 51 with no record'

let curation: Curation

function Probe() {
  curation = useCuration()
  return null
}

afterEach(() => {
  vi.restoreAllMocks()
  // A review arms the band on every export; it is module state, so it is
  // cleared here rather than carried into the next test.
  setExportEditsNote(null)
})

const summary = () => screen.getByTestId('walk-summary')
const systemRow = (name: string) => screen.getByRole('listitem', { name })
const deviceRow = (label: string) => screen.getByRole('listitem', { name: label })

async function renderWalk() {
  const view = await renderWithProvider(
    <>
      <WalkTab />
      <Probe />
    </>,
    { curation: true },
  )
  await waitFor(() => expect(summary()).toHaveTextContent(NORTHGATE_SYSTEMS))
  return view
}

async function atWestfield(user: User) {
  await user.click(screen.getByRole('button', { name: /Westfield Proving Ground/ }))
  await waitFor(() => expect(summary()).toHaveTextContent(WESTFIELD_DEVICES))
}

/** Opens the review form on a system row and returns it. */
async function review(user: User, name: string) {
  await user.click(within(systemRow(name)).getByRole('button', { name: 'Review' }))
  return within(systemRow(name)).getByRole('form', { name: `Review ${name}` })
}

const save = (form: HTMLElement) => within(form).getByRole('button', { name: 'Save' })
const reviewerBox = (form: HTMLElement) => within(form).getByRole('textbox', { name: 'Reviewer' })

describe('the Site walk summary', () => {
  it('opens on the default site and counts Northgate in disjoint buckets', async () => {
    await renderWalk()
    expect(screen.getByRole('heading', { level: 1, name: 'Site walk' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Northgate Sports Campus/ })).toHaveAttribute(
      'aria-pressed', 'true',
    )
    expect(summary()).toHaveTextContent(NORTHGATE_SYSTEMS)
    expect(summary()).toHaveTextContent(NORTHGATE_DEVICES)
  })

  it('reads Westfield as not looked at, every device without a record', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    expect(summary()).toHaveTextContent(WESTFIELD_SYSTEMS)
    expect(summary()).toHaveTextContent(WESTFIELD_DEVICES)
    expect(screen.queryByText(/71 devices/)).not.toBeInTheDocument()
  })

  it('names the shortfall rows only in the note, never as systems to review', async () => {
    await renderWalk()
    const note = screen.getByText(/shortfall rows/)
    expect(note).toHaveTextContent('Dispatch Management System (DMS/CAD), Partner Agency Data Sharing')
    for (const name of ['Dispatch Management System (DMS/CAD)', 'Partner Agency Data Sharing']) {
      expect(screen.queryByRole('listitem', { name })).not.toBeInTheDocument()
      expect(screen.getAllByText(new RegExp(name.replace(/[()/]/g, '\\$&')))).toEqual([note])
    }
    const systems = within(screen.getByRole('region', { name: 'Systems' }))
    expect(systems.getAllByRole('button', { name: 'Review' })).toHaveLength(30)
  })
})

describe('reviewing a system', () => {
  it('records Beacon as found, says what the figure was when loaded, and undoes it', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    expect(within(systemRow('Beacon')).getByText('Not looked at')).toBeInTheDocument()

    const form = await review(user, 'Beacon')
    await user.click(within(form).getByRole('radio', { name: 'Found on devices' }))
    await user.click(within(form).getByRole('button', { name: /Proving Ground Site/ }))
    await user.click(within(form).getByRole('checkbox', { name: 'Gate Detection Sensor' }))
    await user.click(within(form).getByRole('radio', { name: 'High (physically verified)' }))
    await user.type(reviewerBox(form), 'Site lead')
    await user.click(save(form))

    await waitFor(() =>
      expect(summary()).toHaveTextContent(
        '1 of 30 realized (0 when loaded) · 0 recorded with no hardware · 0 checked absent · 29 not looked at',
      ),
    )
    expect(summary()).toHaveTextContent(
      '8 devices · 1 carry a recorded system · 0 checked, carrying none · 7 with no record',
    )
    const row = systemRow('Beacon')
    expect(within(row).queryByRole('form')).not.toBeInTheDocument()
    expect(within(row).getByText('Edited')).toBeInTheDocument()
    expect(within(row).getByText('Found on Gate Detection Sensor · High (physically verified)'))
      .toBeInTheDocument()
    expect(within(row).getByText(`Reviewed by Site lead on ${localDate(new Date())}`))
      .toBeInTheDocument()
    expect(within(deviceRow('Gate Detection Sensor')).getByText('Beacon · High (physically verified)'))
      .toBeInTheDocument()
    expect(curation.reviewer).toBe('Site lead')

    await user.click(within(row).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(summary()).toHaveTextContent(WESTFIELD_SYSTEMS))
    expect(summary()).not.toHaveTextContent('when loaded')
    expect(within(systemRow('Beacon')).queryByText('Edited')).not.toBeInTheDocument()
  })

  it('prefills the reviewer from the session and the date with today', async () => {
    const { user } = await renderWalk()
    act(() => curation.setReviewer('Range lead'))
    const form = await review(user, 'Beacon')
    expect(reviewerBox(form)).toHaveValue('Range lead')
    expect(within(form).getByLabelText('Date')).toHaveValue(localDate(new Date()))
  })

  it('opens a recorded system with what the file says about it', async () => {
    const { user } = await renderWalk()
    const form = await review(user, 'Bastion Effector')
    expect(within(form).getByRole('radio', { name: 'Found on devices' })).toBeChecked()
    expect(within(form).getByRole('checkbox', { name: '2x Directional Effector (Pair)' }))
      .toBeChecked()
    expect(within(form).getByRole('radio', { name: 'High (physically verified)' })).toBeChecked()
  })

  it('takes a reason and no note for a checked absence', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const form = await review(user, 'Fathom')
    await user.click(within(form).getByRole('radio', { name: 'Checked, not here' }))
    expect(within(form).queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
    expect(within(form).queryByRole('radio', { name: 'Low (best guess)' })).not.toBeInTheDocument()
    await user.type(within(form).getByRole('textbox', { name: 'Reason' }), 'No sonar on a dry range')
    await user.type(reviewerBox(form), 'Site lead')
    await user.click(save(form))
    await waitFor(() => expect(summary()).toHaveTextContent('1 checked absent · 29 not looked at'))
    expect(within(systemRow('Fathom')).getByText('Checked, not here: No sonar on a dry range'))
      .toBeInTheDocument()
  })

  it('clears a record on Not looked at, and asks for nothing else', async () => {
    const { user } = await renderWalk()
    const form = await review(user, 'Bastion Effector')
    await user.click(within(form).getByRole('radio', { name: 'Not looked at' }))
    expect(
      within(form).getByText("Removes this site's record of Bastion Effector. Nothing else is written."),
    ).toBeInTheDocument()
    expect(within(form).queryByRole('textbox', { name: 'Reviewer' })).not.toBeInTheDocument()
    expect(within(form).queryByLabelText('Date')).not.toBeInTheDocument()
    expect(within(form).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(form).queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
    await user.click(save(form))
    await waitFor(() =>
      expect(summary()).toHaveTextContent(
        '9 of 30 realized (10 when loaded) · 2 recorded with no hardware · 18 checked absent · 1 not looked at',
      ),
    )
  })
})

describe('Save is held back', () => {
  it('while a found system names no device', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const form = await review(user, 'Beacon')
    await user.click(within(form).getByRole('radio', { name: 'Found on devices' }))
    await user.type(reviewerBox(form), 'Site lead')
    expect(save(form)).toBeDisabled()
    await user.click(within(form).getByRole('button', { name: /Proving Ground Site/ }))
    await user.click(within(form).getByRole('checkbox', { name: 'Site Server' }))
    expect(save(form)).toBeEnabled()
  })

  it('while a checked absence gives no reason', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const form = await review(user, 'Beacon')
    await user.click(within(form).getByRole('radio', { name: 'Checked, not here' }))
    await user.type(reviewerBox(form), 'Site lead')
    expect(save(form)).toBeDisabled()
    const reason = within(form).getByRole('textbox', { name: 'Reason' })
    await user.type(reason, '   ')
    expect(save(form)).toBeDisabled()
    await user.type(reason, 'Not fielded here')
    expect(save(form)).toBeEnabled()
  })

  it('while nobody is named as the reviewer', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const form = await review(user, 'Beacon')
    await user.click(within(form).getByRole('radio', { name: 'Present, no dedicated hardware' }))
    expect(reviewerBox(form)).toHaveValue('')
    expect(save(form)).toBeDisabled()
    await user.type(reviewerBox(form), ' \u001c ')
    expect(save(form)).toBeDisabled()
    await user.type(reviewerBox(form), 'Site lead')
    expect(save(form)).toBeEnabled()
  })

  it('while the date is not a calendar day', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const form = await review(user, 'Beacon')
    await user.click(within(form).getByRole('radio', { name: 'Present, no dedicated hardware' }))
    await user.type(reviewerBox(form), 'Site lead')
    expect(save(form)).toBeEnabled()
    const date = within(form).getByLabelText('Date')
    fireEvent.change(date, { target: { value: '' } })
    expect(save(form)).toBeDisabled()
    fireEvent.change(date, { target: { value: '2026-02-30' } })
    expect(save(form)).toBeDisabled()
    fireEvent.change(date, { target: { value: '2028-02-29' } })
    expect(save(form)).toBeEnabled()
  })
})

describe('the devices by zone', () => {
  it('assigns a device to a chosen system with the device already picked', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const sensor = deviceRow('Gate Detection Sensor')
    await user.click(within(sensor).getByRole('button', { name: 'Assign to systems' }))
    await user.selectOptions(within(sensor).getByRole('combobox', { name: 'System' }), 'Beacon')
    const form = within(sensor).getByRole('form', { name: 'Review Beacon' })
    expect(within(form).getByRole('checkbox', { name: 'Gate Detection Sensor' })).toBeChecked()
    await user.type(reviewerBox(form), 'Site lead')
    await user.click(save(form))
    await waitFor(() => expect(summary()).toHaveTextContent('1 of 30 realized (0 when loaded)'))
    expect(within(deviceRow('Gate Detection Sensor')).getByText(/^Beacon · /)).toBeInTheDocument()
  })

  it('records a device as carrying no system, and clears the check', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const gateway = deviceRow('Northwind Telecom GW')
    await user.click(within(gateway).getByRole('button', { name: 'Checked, carries no system' }))
    const form = within(gateway).getByRole('form', { name: 'Check Northwind Telecom GW' })
    expect(save(form)).toBeDisabled()
    await user.type(reviewerBox(form), 'Site lead')
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Carrier gateway')
    await user.click(save(form))

    await waitFor(() =>
      expect(summary()).toHaveTextContent(
        '8 devices · 0 carry a recorded system · 1 checked, carrying none · 7 with no record',
      ),
    )
    const checked = deviceRow('Northwind Telecom GW')
    expect(
      within(checked).getByText(`Checked by Site lead on ${localDate(new Date())}: carries no system.`),
    ).toBeInTheDocument()
    expect(within(checked).getByText('Carrier gateway')).toBeInTheDocument()
    expect(within(checked).queryByRole('button', { name: 'Checked, carries no system' }))
      .not.toBeInTheDocument()

    await user.click(within(checked).getByRole('button', { name: 'Clear check' }))
    await waitFor(() => expect(summary()).toHaveTextContent('0 checked, carrying none'))
  })

  it('does not offer the check on a device a mapping names', async () => {
    await renderWalk()
    const effector = deviceRow('2x Directional Effector (Pair)')
    expect(within(effector).getByRole('button', { name: 'Assign to systems' })).toBeInTheDocument()
    expect(within(effector).queryByRole('button', { name: 'Checked, carries no system' }))
      .not.toBeInTheDocument()
  })

  it('shows a mapping outside the matrix read-only', async () => {
    await renderWalk()
    const atak = deviceRow('ATAK / iTAK Field Devices')
    const entry = within(atak).getByText('atak (outside the matrix)').closest('li') as HTMLElement
    expect(within(entry).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('listitem', { name: 'atak' })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Systems' })).queryByText(/^atak/),
    ).not.toBeInTheDocument()
  })

  it('heads each zone with its label, in the checklist order', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    const devices = within(screen.getByRole('region', { name: 'Devices by zone' }))
    expect(devices.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Proving Ground Site', 'WAN / Internet',
    ])
  })

  it('keeps a form open and says why when the coverage refuses the edit', async () => {
    const { user } = await renderWalk()
    await atWestfield(user)
    await user.click(
      within(deviceRow('Northwind Telecom GW')).getByRole('button', { name: 'Checked, carries no system' }),
    )
    // The device is named while the form is open, so the check can no longer be taken.
    act(() =>
      curation.apply({
        kind: 'review', site: 'westfield', system: 'beacon',
        review: {
          status: 'found', devices: ['wf_northwind_gw'], confidence: 'high', note: '',
          reviewed_by: 'Site lead', reviewed_on: '2026-11-13',
        },
      }),
    )
    await waitFor(() => expect(summary()).toHaveTextContent('1 carry a recorded system'))
    const form = within(deviceRow('Northwind Telecom GW')).getByRole('form', {
      name: 'Check Northwind Telecom GW',
    })
    await user.type(reviewerBox(form), 'Site lead')
    await user.click(save(form))
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'wf_northwind_gw is named by a mapping, so it cannot be checked as unclaimed',
    )
    expect(summary()).toHaveTextContent('0 checked, carrying none')
    expect(curation.edits).toHaveLength(1)
  })
})

describe('the printed checklist', () => {
  it('prints from a button', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { user } = await renderWalk()
    await user.click(screen.getByRole('button', { name: 'Print checklist' }))
    expect(print).toHaveBeenCalledTimes(1)
  })
})
