import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CurationProvider, useCuration, type Curation } from '../../curation/CurationContext'
import { SAMPLE_WALK } from '../../curation/__tests__/sampleWalk'
import { editKey } from '../../curation/edits'
import type { DataSource } from '../../data/ProviderContext'
import { StaticProvider } from '../../data/StaticProvider'
import * as png from '../../export/png'
import { setExportEditsNote, setExportMarking } from '../../export/png'
import { renderWithProvider } from '../../test/renderWithProvider'
import { EditsBanner } from '../EditsBanner'

let curation: Curation

function Probe() {
  curation = useCuration()
  return null
}

const SAMPLE_FILE = 'atlas-sample-system-device-map.json'
const SAMPLE_ONLY = 'Sample only: these edits describe no real site.'

const banner = () => screen.getByRole('status', { name: /reviews/i })
const queryBanner = () => screen.queryByRole('status', { name: /reviews/i })

async function renderBanner() {
  const view = await renderWithProvider(
    <>
      <EditsBanner />
      <Probe />
    </>,
    { curation: true },
  )
  return view
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

describe('EditsBanner', () => {
  it('is not there while there are no edits', async () => {
    await renderBanner()
    expect(queryBanner()).toBeNull()
  })

  it('says one review is unsaved, and how to keep it', async () => {
    await renderBanner()
    act(() => curation.apply(SAMPLE_WALK[0]))
    expect(banner()).toHaveTextContent(
      `1 unsaved review. Export ${SAMPLE_FILE} to keep it. Closing this tab discards it.`,
    )
  })

  it('says three reviews are unsaved', async () => {
    await renderBanner()
    act(() => SAMPLE_WALK.forEach((edit) => curation.apply(edit)))
    expect(banner()).toHaveTextContent(
      `3 unsaved reviews. Export ${SAMPLE_FILE} to keep them. Closing this tab discards them.`,
    )
  })

  it('says where one exported review went', async () => {
    const { user } = await renderBanner()
    act(() => curation.apply(SAMPLE_WALK[0]))
    await user.click(screen.getByRole('button', { name: /^export$/i }))
    expect(banner()).toHaveTextContent(
      `1 review exported to ${SAMPLE_FILE}. It stays on screen until you close this tab; ` +
        'load the file to work from it.',
    )
  })

  it('says where three exported reviews went', async () => {
    const { user } = await renderBanner()
    act(() => SAMPLE_WALK.forEach((edit) => curation.apply(edit)))
    await user.click(screen.getByRole('button', { name: /^export$/i }))
    expect(banner()).toHaveTextContent(
      `3 reviews exported to ${SAMPLE_FILE}. They stay on screen until you close this tab; ` +
        'load the file to work from it.',
    )
  })

  it('exports the map from its Export button', async () => {
    const { user } = await renderBanner()
    act(() => curation.apply(SAMPLE_WALK[0]))
    await user.click(screen.getByRole('button', { name: /^export$/i }))
    expect(download).toHaveBeenCalledWith(SAMPLE_FILE, expect.any(Blob))
  })

  it('says on the sample that the edits describe no real site', async () => {
    await renderBanner()
    act(() => curation.apply(SAMPLE_WALK[0]))
    expect(banner()).toHaveTextContent(SAMPLE_ONLY)
  })

  it('names the local file and drops the sample line over local data', async () => {
    const local: DataSource = { kind: 'local', label: 'fixture-matrix.xlsx', marking: null }
    render(
      <CurationProvider base={new StaticProvider('/data')} source={local}>
        <EditsBanner />
        <Probe />
      </CurationProvider>,
    )
    act(() => curation.apply(SAMPLE_WALK[0]))
    expect(banner()).toHaveTextContent('Export system_device_map.json to keep it.')
    expect(banner()).not.toHaveTextContent(SAMPLE_ONLY)
  })

  it('keeps the reviews when Discard is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderBanner()
    act(() => curation.apply(SAMPLE_WALK[0]))
    await user.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(confirm).toHaveBeenCalledWith('Discard 1 unsaved review?')
    expect(curation.edits).toHaveLength(1)
    expect(banner()).toBeInTheDocument()
  })

  it('names the reverted review among the unsaved ones after an export', async () => {
    const { user } = await renderBanner()
    act(() => {
      curation.apply(SAMPLE_WALK[0])
      curation.apply(SAMPLE_WALK[1])
    })
    await user.click(screen.getByRole('button', { name: /^export$/i }))
    act(() => curation.revert(editKey(SAMPLE_WALK[0])))
    expect(banner()).toHaveTextContent(
      `1 unsaved review. Export ${SAMPLE_FILE} to keep it. Closing this tab discards it.`,
    )
  })

  it('goes once Discard is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = await renderBanner()
    act(() => curation.apply(SAMPLE_WALK[0]))
    await user.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(curation.edits).toEqual([])
    expect(queryBanner()).toBeNull()
  })

  it('is chrome, left out of every capture', async () => {
    await renderBanner()
    act(() => curation.apply(SAMPLE_WALK[0]))
    expect(banner()).toHaveAttribute('data-export-omit')
  })
})
