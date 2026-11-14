import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AtlasProvider, useProvider, useProviderSwitch, type DataSource,
} from '../../data/ProviderContext'
import type { AtlasDataProvider } from '../../data/provider'
import { StaticProvider } from '../../data/StaticProvider'
import * as png from '../../export/png'
import { getExportBand, setExportEditsNote, setExportMarking } from '../../export/png'
import { renderWithProvider } from '../../test/renderWithProvider'
import { CuratedProvider } from '../CuratedProvider'
import { CurationProvider, useCuration, type Curation } from '../CurationContext'
import { editKey, type Edit } from '../edits'
import { SAMPLE_WALK } from './sampleWalk'

const [BEACON, SCAN, TRACKWELL] = SAMPLE_WALK

/** The beacon's row again, reviewed a second time: a new edit for the same key. */
const BEACON_AGAIN: Edit = {
  kind: 'review', site: 'westfield', system: 'beacon',
  review: {
    status: 'found', devices: ['wf_gate_sensor'], confidence: 'high', note: 'Looked again',
    reviewed_by: 'Site lead', reviewed_on: '2026-11-14',
  },
}

/** What the tree below the curation layer sees, as of its latest render. */
let seen: { provider: AtlasDataProvider; curation: Curation }

function Probe() {
  seen = { provider: useProvider(), curation: useCuration() }
  return null
}

let switched: ReturnType<typeof useProviderSwitch>

function SwitchProbe() {
  switched = useProviderSwitch()
  return <Probe />
}

/** True when the page asked the browser to hold the reader on it. */
function leavingIsHeld(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

let download: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  download = vi.spyOn(png, 'downloadBlob').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  setExportMarking(null)
  setExportEditsNote(null)
})

describe('the curation layer', () => {
  it('serves the base provider itself while there are no edits', async () => {
    const { provider } = await renderWithProvider(<Probe />, { curation: true })
    expect(seen.provider).toBe(provider)
    expect(seen.curation.edits).toEqual([])
    expect(seen.curation.unsaved).toBe(0)
    expect(getExportBand()).toBeNull()
  })

  it('serves the edited provider once a review is made, and says so on every export', async () => {
    const { provider } = await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    expect(seen.provider).toBeInstanceOf(CuratedProvider)
    expect(seen.provider.kind).toBe(provider.kind)
    expect(seen.curation.unsaved).toBe(1)
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
  })

  it('counts reviews in the plural past one', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => {
      seen.curation.apply(BEACON)
      seen.curation.apply(SCAN)
    })
    expect(seen.curation.unsaved).toBe(2)
    expect(getExportBand()).toBe('Includes 2 unsaved reviews, not yet exported to a file')
  })

  it('keeps one edit per row, the last word on it', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    act(() => seen.curation.apply(BEACON_AGAIN))
    expect(seen.curation.edits).toEqual([BEACON_AGAIN])
  })

  it('reverts one row by its key', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => {
      seen.curation.apply(BEACON)
      seen.curation.apply(SCAN)
    })
    act(() => seen.curation.revert(editKey(BEACON)))
    expect(seen.curation.edits).toEqual([SCAN])
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
  })

  it('remembers the reviewer in memory', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.setReviewer('Site lead'))
    expect(seen.curation.reviewer).toBe('Site lead')
  })

  it('names the file by the data it describes', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    expect(seen.curation.exportFileName).toBe('atlas-sample-system-device-map.json')

    const local: DataSource = { kind: 'local', label: 'fixture-matrix.xlsx', marking: null }
    render(
      <CurationProvider base={new StaticProvider('/data')} source={local}>
        <Probe />
      </CurationProvider>,
    )
    expect(seen.curation.exportFileName).toBe('system_device_map.json')
  })
})

describe('exporting the map', () => {
  it('downloads the edited map and clears the unsaved count and the band', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())

    expect(download).toHaveBeenCalledTimes(1)
    const [fileName, blob] = download.mock.calls[0] as [string, Blob]
    expect(fileName).toBe('atlas-sample-system-device-map.json')
    const written = JSON.parse(await blob.text())
    expect(written.sites.westfield.mappings.beacon.devices).toEqual(['wf_gate_sensor'])
    expect(written._comment).toMatch(/describes no real site/)

    expect(seen.curation.edits).toHaveLength(1)
    expect(seen.curation.unsaved).toBe(0)
    expect(getExportBand()).toBeNull()
  })

  it('counts one further review as one, not as every review on screen', async () => {
    // Review Focus 5.
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())
    act(() => seen.curation.apply(SCAN))
    expect(seen.curation.edits).toHaveLength(2)
    expect(seen.curation.unsaved).toBe(1)
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
  })

  it('counts a row reviewed again after the export as unsaved', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())
    act(() => seen.curation.apply(BEACON_AGAIN))
    expect(seen.curation.edits).toHaveLength(1)
    expect(seen.curation.unsaved).toBe(1)
  })
})

describe('leaving the page', () => {
  it('holds the reader only while a review is unsaved', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    expect(leavingIsHeld()).toBe(false)

    act(() => seen.curation.apply(BEACON))
    expect(leavingIsHeld()).toBe(true)

    await act(() => seen.curation.exportMap())
    expect(leavingIsHeld()).toBe(false)

    act(() => seen.curation.apply(SCAN))
    expect(leavingIsHeld()).toBe(true)

    act(() => seen.curation.discard())
    expect(leavingIsHeld()).toBe(false)
  })

  it('stops listening once unmounted', async () => {
    const { unmount } = await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    unmount()
    expect(leavingIsHeld()).toBe(false)
  })
})

describe('discarding', () => {
  it('discards without asking when nothing is unsaved', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())

    let answer = false
    act(() => {
      answer = seen.curation.confirmDiscard()
    })
    expect(answer).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(seen.curation.edits).toEqual([])
  })

  it('asks before discarding unsaved reviews, and keeps them on no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderWithProvider(<Probe />, { curation: true })
    act(() => {
      seen.curation.apply(BEACON)
      seen.curation.apply(SCAN)
      seen.curation.apply(TRACKWELL)
    })

    let answer = true
    act(() => {
      answer = seen.curation.confirmDiscard()
    })
    expect(confirm).toHaveBeenCalledWith('Discard 3 unsaved reviews?')
    expect(answer).toBe(false)
    expect(seen.curation.edits).toHaveLength(3)
    expect(getExportBand()).toBe('Includes 3 unsaved reviews, not yet exported to a file')
  })

  it('clears them on yes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { provider } = await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))

    let answer = false
    act(() => {
      answer = seen.curation.confirmDiscard()
    })
    expect(confirm).toHaveBeenCalledWith('Discard 1 unsaved review?')
    expect(answer).toBe(true)
    expect(seen.curation.edits).toEqual([])
    expect(seen.provider).toBe(provider)
    expect(getExportBand()).toBeNull()
  })
})

describe('switching data', () => {
  it('drops the edits when the switch returns to the sample', async () => {
    render(
      <AtlasProvider>
        <SwitchProbe />
      </AtlasProvider>,
    )
    act(() => seen.curation.apply(BEACON))
    expect(seen.curation.edits).toHaveLength(1)

    act(() => switched.useSampleData())
    expect(seen.curation.edits).toEqual([])
    expect(seen.provider).toBe(switched.provider)
    expect(seen.provider).not.toBeInstanceOf(CuratedProvider)
    expect(getExportBand()).toBeNull()
  })

  it('keeps the note when only the marking is stated, since the edits stay', async () => {
    render(
      <AtlasProvider>
        <SwitchProbe />
      </AtlasProvider>,
    )
    act(() =>
      switched.adopt(new StaticProvider('/data'), {
        kind: 'local', label: 'fixture-matrix.xlsx', marking: null,
      }),
    )
    act(() => seen.curation.apply(BEACON))
    act(() => switched.stateMarking('TEST MARKING'))
    expect(seen.curation.edits).toHaveLength(1)
    expect(getExportBand()).toBe(
      'TEST MARKING · Includes 1 unsaved review, not yet exported to a file',
    )
  })
})
