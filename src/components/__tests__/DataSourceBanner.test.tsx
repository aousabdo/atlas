import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  ProviderSwitchContext,
  SAMPLE_SOURCE,
  UNMARKED_NOTICE,
  type DataSource,
} from '../../data/ProviderContext'
import { StaticProvider } from '../../data/StaticProvider'
import { DataSourceBanner } from '../DataSourceBanner'

function renderBanner(source: DataSource) {
  const useSampleData = vi.fn()
  const adopt = vi.fn()
  render(
    <ProviderSwitchContext.Provider
      value={{ provider: new StaticProvider('/data'), source, adopt, useSampleData }}
    >
      <DataSourceBanner />
    </ProviderSwitchContext.Provider>,
  )
  return { useSampleData, user: userEvent.setup() }
}

const LOCAL: DataSource = {
  kind: 'local',
  label: 'fixture-matrix.xlsx',
  marking: 'TEST//SYNTHETIC',
}

describe('DataSourceBanner', () => {
  it('says the sample is on screen when nothing has been loaded', () => {
    renderBanner(SAMPLE_SOURCE)
    const banner = screen.getByRole('status', { name: /data source/i })
    expect(banner).toHaveTextContent(/sample data/i)
    expect(banner).toHaveTextContent(/synthetic reference bundle/i)
  })

  it('offers no way back to the sample while the sample is what is showing', () => {
    renderBanner(SAMPLE_SOURCE)
    expect(screen.queryByRole('button', { name: /return to sample/i })).toBeNull()
  })

  it('shows the marking the loaded files carry', () => {
    renderBanner(LOCAL)
    expect(screen.getByRole('status', { name: /data source/i })).toHaveTextContent(
      'TEST//SYNTHETIC',
    )
  })

  it('names the file the data came from', () => {
    renderBanner(LOCAL)
    expect(screen.getByRole('status', { name: /data source/i })).toHaveTextContent(
      'fixture-matrix.xlsx',
    )
  })

  it('says the files state no marking rather than showing an empty space', () => {
    // Blank is indistinguishable from unclassified, and one of those is a
    // claim this tool has no basis to make.
    renderBanner({ ...LOCAL, marking: null })
    expect(screen.getByRole('status', { name: /data source/i })).toHaveTextContent(
      UNMARKED_NOTICE,
    )
  })

  it('never describes local data as the sample', () => {
    // Mistaking real data for the sample is the worse of the two mistakes.
    const banner = (renderBanner(LOCAL), screen.getByRole('status', { name: /data source/i }))
    expect(banner).not.toHaveTextContent(/synthetic reference bundle/i)
  })

  it('returns to the sample on request', async () => {
    const { useSampleData, user } = renderBanner(LOCAL)
    await user.click(screen.getByRole('button', { name: /return to sample/i }))
    expect(useSampleData).toHaveBeenCalledTimes(1)
  })

  it('says a marking the analyst stated is theirs, not the files', () => {
    renderBanner({
      ...LOCAL,
      marking: 'TEST//STATED',
      markingSource: 'analyst',
      declaredMarking: null,
    })
    const banner = screen.getByRole('status', { name: /data source/i })
    expect(banner).toHaveTextContent('TEST//STATED')
    expect(banner).toHaveTextContent(/stated by the analyst/i)
    expect(banner).toHaveTextContent(/files state none/i)
  })

  it('shows the overridden marking alongside, so the override is never silent', () => {
    renderBanner({
      ...LOCAL,
      marking: 'TEST//STATED',
      markingSource: 'analyst',
      declaredMarking: 'TEST//SYNTHETIC',
    })
    const banner = screen.getByRole('status', { name: /data source/i })
    expect(banner).toHaveTextContent('TEST//STATED')
    expect(banner).toHaveTextContent(/files declare TEST\/\/SYNTHETIC/i)
  })

  it('claims nothing about who stated a marking the files carried', () => {
    renderBanner(LOCAL)
    expect(screen.getByRole('status', { name: /data source/i })).not.toHaveTextContent(
      /stated by the analyst/i,
    )
  })

  it('states that the file was parsed here and never uploaded', () => {
    renderBanner(LOCAL)
    expect(screen.getByRole('status', { name: /data source/i })).toHaveTextContent(
      /nothing was uploaded/i,
    )
  })
})
