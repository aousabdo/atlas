import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  matrixIdSet,
  realizedConfidenceCounts,
} from '../../../lib/coverage'
import { computeLossiness } from '../../../lib/lossiness'
import type {
  CoverageMatrix, Glossary, Mapping, Methodology, Project, System,
} from '../../../types/atlas'
import { ConfidenceSection } from '../ConfidenceSection'

function system(id: string): System {
  return {
    id,
    name: id.toUpperCase(),
    label: id.toUpperCase(),
    category: 'sensor',
    owner_group_id: 'og',
    owner_group: 'Owner Group',
    color_key: 'a',
    confirmed: true,
    risk: 'low',
    risk_source: 'explicit',
    detail: '',
    integrations_prose: '',
  }
}

function mapping(over: Partial<Mapping> = {}): Mapping {
  return { devices: ['dev-1'], note: '', confidence: 'high', ...over }
}

const GLOSSARY: Glossary = {
  confidence_intro: '',
  out_of_scope: [],
  methodology_extras: {
    risk_caveat: '',
    mapping_confidence_scale: '',
    soft_ownership_note: '',
  },
  acronyms: [],
}

const METHODOLOGY = { owner_rules_count: 3 } as Methodology

const PROJECT: Project = {
  slug: 'harbor',
  name: 'Harbor',
  baseline_date: '2026-01-01',
  source_label: 'a fabricated workbook',
  default_site: 'harbor',
  sites: [],
}

/**
 * The contradiction this component used to render in one card.
 *
 * A mapping declaring matrix_id_exists false for an id the matrix DOES carry
 * passed the ingest's gates. The realization gap then tested membership and
 * counted it, while the confidence tally tested the flag and dropped it, so
 * this section printed "2 of 2 systems mapped" a few lines above "1 realized
 * mapping" plus a line calling the same mapping outside the matrix. Every
 * consumer applies one predicate now, and atlas_ingest.validate refuses the
 * bundle outright.
 *
 * Both figures below are computed by the browser, so what this pins is the
 * rendering: whichever bundle arrives, the two mapping counts in this section
 * came from one predicate. The ingest half of the same guarantee is pinned in
 * ingest/tests/test_lossiness.py, which is the test that fails if the Python
 * goes back to counting on matrix membership alone.
 */
function renderSection(mappings: Record<string, Mapping>) {
  const systems = [system('alpha'), system('bravo')]
  const matrixIds = matrixIdSet(systems)
  const coverage: CoverageMatrix = {
    default_site: 'harbor',
    sites: {
      harbor: {
        label: 'Harbor Yard',
        scope: 'Harbor Yard',
        mappings,
        not_deployed_at_site: {},
        unclaimed_devices: { infrastructure: [] },
      },
    },
    pending_review: {},
    confidence_counts: {},
  }
  coverage.confidence_counts = realizedConfidenceCounts(coverage, matrixIds)
  const lossiness = computeLossiness({
    systems,
    links: { current: [], desired: [] },
    requirements: [],
    coverage,
    topologies: {},
  })
  render(
    <ConfidenceSection
      coverage={coverage}
      glossary={GLOSSARY}
      lossiness={lossiness}
      methodology={METHODOLOGY}
      project={PROJECT}
      systems={systems}
    />,
  )
  return { coverage, lossiness }
}

describe('ConfidenceSection', () => {
  it('does not print one mapping count beside a different one', () => {
    renderSection({
      alpha: mapping({ matrix_id_exists: false }),
      bravo: mapping(),
    })

    // The per-site realization line and the realized-mapping denominator are
    // the same quantity and must be the same number.
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.queryByText('2 of 2')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 1 realized mappings')).toBeInTheDocument()

    // And the excluded row is stated rather than dropped.
    expect(
      screen.getByText('1 of 2 recorded mappings'),
    ).toBeInTheDocument()
  })

  it('counts a mapping the matrix carries and hardware backs', () => {
    renderSection({ alpha: mapping(), bravo: mapping() })

    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByText('2 of 2 realized mappings')).toBeInTheDocument()
  })

  it('excludes a mapping that names no hardware from both figures', () => {
    renderSection({ alpha: mapping({ devices: [] }), bravo: mapping() })

    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByText('1 of 1 realized mappings')).toBeInTheDocument()
  })
})
