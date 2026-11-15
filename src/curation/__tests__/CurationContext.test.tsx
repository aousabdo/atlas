import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AtlasProvider, SAMPLE_SOURCE, useProvider, useProviderSwitch, type DataSource,
} from '../../data/ProviderContext'
import { AtlasDataError, type AtlasDataProvider } from '../../data/provider'
import { StaticProvider } from '../../data/StaticProvider'
import * as png from '../../export/png'
import { getExportBand, setExportEditsNote, setExportMarking } from '../../export/png'
import { renderWithProvider, settleCuration } from '../../test/renderWithProvider'
import { CuratedProvider } from '../CuratedProvider'
import { CurationProvider, useCuration, type Curation } from '../CurationContext'
import { CurationError, editKey, type Edit } from '../edits'
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
    // Review Focus 5: after an export the count is 0, the band is gone and
    // leaving is not held; one further edit makes the count 1, not the total.
    await renderWithProvider(<Probe />, { curation: true })
    act(() => {
      seen.curation.apply(BEACON)
      seen.curation.apply(TRACKWELL)
    })
    await act(() => seen.curation.exportMap())
    expect(seen.curation.unsaved).toBe(0)
    expect(getExportBand()).toBeNull()
    expect(leavingIsHeld()).toBe(false)

    act(() => seen.curation.apply(SCAN))
    expect(seen.curation.edits).toHaveLength(3)
    expect(seen.curation.unsaved).toBe(1)
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
    expect(leavingIsHeld()).toBe(true)
  })

  it('counts a review reverted after the export as unsaved', async () => {
    // The file still carries it and the screen no longer does.
    await renderWithProvider(<Probe />, { curation: true })
    act(() => {
      seen.curation.apply(BEACON)
      seen.curation.apply(SCAN)
    })
    await act(() => seen.curation.exportMap())
    act(() => seen.curation.revert(editKey(BEACON)))
    expect(seen.curation.edits).toEqual([SCAN])
    expect(seen.curation.unsaved).toBe(1)
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
    expect(leavingIsHeld()).toBe(true)
  })

  it('counts the Undo of the only exported review, since the file still holds it', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())
    act(() => seen.curation.revert(editKey(BEACON)))
    expect(seen.curation.edits).toEqual([])
    expect(seen.curation.unsaved).toBe(1)
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
    expect(leavingIsHeld()).toBe(true)

    // Exporting the screen as it now is leaves nothing unsaved.
    await act(() => seen.curation.exportMap())
    expect(seen.curation.unsaved).toBe(0)
    expect(getExportBand()).toBeNull()
    expect(leavingIsHeld()).toBe(false)
  })

  it('counts nothing for an empty list with no export, since the screen is the loaded data', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    act(() => seen.curation.revert(editKey(BEACON)))
    expect(seen.curation.edits).toEqual([])
    expect(seen.curation.unsaved).toBe(0)
    expect(getExportBand()).toBeNull()
    expect(leavingIsHeld()).toBe(false)
  })

  it('clears an exported and undone review on discard', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())
    act(() => seen.curation.revert(editKey(BEACON)))
    act(() => seen.curation.discard())
    expect(seen.curation.unsaved).toBe(0)
    expect(getExportBand()).toBeNull()
    expect(leavingIsHeld()).toBe(false)
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
  it('agrees without asking when nothing is unsaved', async () => {
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

  it('only asks on yes: the reviews stay until they are discarded or new data arrives', async () => {
    // A load can still fail after the yes, and must leave the reviews as they were.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))

    let answer = false
    act(() => {
      answer = seen.curation.confirmDiscard()
    })
    expect(confirm).toHaveBeenCalledWith('Discard 1 unsaved review?')
    expect(answer).toBe(true)
    expect(seen.curation.edits).toHaveLength(1)
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
  })

  it('drops every edit on discard, and serves the base again', async () => {
    const { provider } = await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    act(() => seen.curation.discard())
    expect(seen.curation.edits).toEqual([])
    expect(seen.provider).toBe(provider)
    expect(getExportBand()).toBeNull()
  })

  it('forgets the last export on discard', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())
    act(() => seen.curation.discard())
    act(() => seen.curation.apply(BEACON))
    expect(seen.curation.unsaved).toBe(1)
  })
})

describe('switching data', () => {
  it('drops the edits when the switch returns to the sample', async () => {
    render(
      <AtlasProvider>
        <SwitchProbe />
      </AtlasProvider>,
    )
    await settleCuration(seen.curation.base)
    act(() => seen.curation.apply(BEACON))
    expect(seen.curation.edits).toHaveLength(1)

    act(() => switched.useSampleData())
    expect(seen.curation.edits).toEqual([])
    expect(seen.provider).toBe(switched.provider)
    expect(seen.provider).not.toBeInstanceOf(CuratedProvider)
    expect(getExportBand()).toBeNull()
  })

  it('forgets the last export when the data changes', async () => {
    render(
      <AtlasProvider>
        <SwitchProbe />
      </AtlasProvider>,
    )
    await settleCuration(seen.curation.base)
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())
    act(() => switched.useSampleData())
    await settleCuration(seen.curation.base)
    act(() => seen.curation.apply(BEACON))
    expect(seen.curation.unsaved).toBe(1)
  })

  it('forgets an exported and undone review when the data changes', async () => {
    render(
      <AtlasProvider>
        <SwitchProbe />
      </AtlasProvider>,
    )
    await settleCuration(seen.curation.base)
    act(() => seen.curation.apply(BEACON))
    await act(() => seen.curation.exportMap())
    act(() => seen.curation.revert(editKey(BEACON)))
    expect(seen.curation.unsaved).toBe(1)
    act(() => switched.useSampleData())
    expect(seen.curation.unsaved).toBe(0)
    expect(getExportBand()).toBeNull()
    expect(leavingIsHeld()).toBe(false)
  })

  it('keeps the note when only the marking is stated, since the edits stay', async () => {
    render(
      <AtlasProvider>
        <SwitchProbe />
      </AtlasProvider>,
    )
    await settleCuration(seen.curation.base)
    act(() =>
      switched.adopt(new StaticProvider('/data'), {
        kind: 'local', label: 'fixture-matrix.xlsx', marking: null,
      }),
    )
    await settleCuration(seen.curation.base)
    act(() => seen.curation.apply(BEACON))
    act(() => switched.stateMarking('TEST MARKING'))
    expect(seen.curation.edits).toHaveLength(1)
    expect(getExportBand()).toBe(
      'TEST MARKING · Includes 1 unsaved review, not yet exported to a file',
    )
  })
})

describe('checking edits against data not yet read', () => {
  const NOT_READ = 'The loaded data is still being read; try again in a moment.'

  /** The sample, whose coverage will not load the first time it is asked for. */
  class CoverageFailsOnce extends StaticProvider {
    failures = 1
    async getCoverage() {
      if (this.failures > 0) {
        this.failures -= 1
        throw new AtlasDataError('coverage.json returned 503', undefined, 'coverage.json')
      }
      return super.getCoverage()
    }
  }

  const refusal = (change: () => void): unknown => {
    try {
      act(change)
    } catch (error) {
      return error
    }
    return null
  }

  it('refuses an edit, and an Undo, until the data has been read', async () => {
    const base = new StaticProvider('/data')
    render(
      <CurationProvider base={base} source={SAMPLE_SOURCE}>
        <Probe />
      </CurationProvider>,
    )
    const early = refusal(() => seen.curation.apply(BEACON))
    expect(early).toBeInstanceOf(CurationError)
    expect((early as Error).message).toBe(NOT_READ)
    expect((refusal(() => seen.curation.revert(editKey(BEACON))) as Error).message).toBe(NOT_READ)
    expect(seen.curation.edits).toEqual([])
    expect(getExportBand()).toBeNull()

    await settleCuration(base)
    act(() => seen.curation.apply(BEACON))
    expect(seen.curation.edits).toEqual([BEACON])
  })

  it('stays closed after a failed read, and reads again on the next edit', async () => {
    const base = new CoverageFailsOnce('/data')
    render(
      <CurationProvider base={base} source={SAMPLE_SOURCE}>
        <Probe />
      </CurationProvider>,
    )
    await settleCuration(base)
    expect(base.failures).toBe(0)

    // The first read failed: the edit is refused, not taken unchecked.
    const refused = refusal(() => seen.curation.apply(BEACON))
    expect(refused).toBeInstanceOf(CurationError)
    expect((refused as Error).message).toBe(NOT_READ)
    expect(seen.curation.edits).toEqual([])

    // That refusal read the data again, and this time it loads.
    await settleCuration(base)
    act(() => seen.curation.apply(BEACON))
    expect(seen.curation.edits).toEqual([BEACON])
    // Checked, too: an edit the data cannot take is refused by the data's own rule.
    expect(() =>
      seen.curation.apply({
        kind: 'check', site: 'westfield', device: 'wf_gate_sensor',
        check: { reviewed_by: 'Site lead', reviewed_on: '2026-11-14' },
      }),
    ).toThrow('wf_gate_sensor is named by a mapping, so it cannot be checked as unclaimed')
  })

  it('reads again on an Undo after a failed read', async () => {
    const base = new CoverageFailsOnce('/data')
    render(
      <CurationProvider base={base} source={SAMPLE_SOURCE}>
        <Probe />
      </CurationProvider>,
    )
    await settleCuration(base)
    expect((refusal(() => seen.curation.revert(editKey(BEACON))) as Error).message).toBe(NOT_READ)
    await settleCuration(base)
    act(() => seen.curation.apply(BEACON))
    expect(seen.curation.edits).toEqual([BEACON])
  })
})

describe('validating every edit list', () => {
  const STAMP = { reviewed_by: 'Site lead', reviewed_on: '2026-11-13' }
  const EFFECTOR = 'field_house_effector'

  /** Bastion moved off the effector, which releases it. */
  const bastionOn = (confidence: 'high' | 'medium'): Edit => ({
    kind: 'review', site: 'northgate', system: 'bastion',
    review: { status: 'found', devices: ['ops_workstation_a'], confidence, note: 'Moved', ...STAMP },
  })
  const CHECK_EFFECTOR: Edit = { kind: 'check', site: 'northgate', device: EFFECTOR, check: STAMP }

  it('takes a re-review after a check its first review made possible', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(bastionOn('high')))
    act(() => seen.curation.apply(CHECK_EFFECTOR))
    act(() => seen.curation.apply(bastionOn('medium')))

    expect(seen.curation.edits).toEqual([CHECK_EFFECTOR, bastionOn('medium')])
    const northgate = (await seen.provider.getCoverage()).sites.northgate
    expect(northgate.mappings.bastion).toMatchObject({ devices: ['ops_workstation_a'], confidence: 'medium' })
    expect(northgate.unclaimed_devices.checked).toEqual({ [EFFECTOR]: STAMP })
  })

  it('refuses an Undo that would leave a checked device named, and changes nothing', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(bastionOn('high')))
    act(() => seen.curation.apply(CHECK_EFFECTOR))
    act(() => seen.curation.apply(bastionOn('medium')))
    const before = { edits: seen.curation.edits, unsaved: seen.curation.unsaved, served: seen.provider }

    let refusal: unknown = null
    act(() => {
      try {
        seen.curation.revert(editKey(bastionOn('medium')))
      } catch (error) {
        refusal = error
      }
    })
    expect(refusal).toBeInstanceOf(CurationError)
    expect((refusal as Error).message).toBe(
      'Undo would leave 2x Directional Effector (Pair) checked while a mapping names it; ' +
        'clear its check first.',
    )
    expect(seen.curation.edits).toBe(before.edits)
    expect(seen.curation.unsaved).toBe(before.unsaved)
    expect(seen.provider).toBe(before.served)
    expect(getExportBand()).toBe('Includes 2 unsaved reviews, not yet exported to a file')
    await expect(seen.provider.getCoverage()).resolves.toBeTruthy()
  })

  it('refuses an edit the data cannot take, and changes nothing', async () => {
    await renderWithProvider(<Probe />, { curation: true })
    act(() => seen.curation.apply(BEACON))
    expect(() => seen.curation.apply(CHECK_EFFECTOR)).toThrow(CurationError)
    expect(() => seen.curation.apply(CHECK_EFFECTOR)).toThrow(
      `${EFFECTOR} is named by a mapping, so it cannot be checked as unclaimed`,
    )
    expect(seen.curation.edits).toEqual([BEACON])
    expect(getExportBand()).toBe('Includes 1 unsaved review, not yet exported to a file')
  })
})
