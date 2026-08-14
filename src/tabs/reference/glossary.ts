import { mergeGlossary } from '../../data/LocalFileProvider'
import type { Glossary } from '../../types/atlas'

/**
 * What the tab is missing, in the order the glossary declares it, so a reader
 * can scan their own file top to bottom against this list.
 */
const PARTS: { label: string; carried: (g: Glossary) => boolean }[] = [
  { label: 'Confidence intro', carried: (g) => g.confidence_intro.trim() !== '' },
  { label: 'Out of scope declarations', carried: (g) => g.out_of_scope.length > 0 },
  {
    label: 'Risk caveat',
    carried: (g) => g.methodology_extras.risk_caveat.trim() !== '',
  },
  {
    label: 'Mapping confidence scale',
    carried: (g) => g.methodology_extras.mapping_confidence_scale.trim() !== '',
  },
  {
    label: 'Soft ownership note',
    carried: (g) => g.methodology_extras.soft_ownership_note.trim() !== '',
  },
  { label: 'Acronyms', carried: (g) => g.acronyms.length > 0 },
]

export interface GlossaryReading {
  /** Complete, so no section below has to test for a key. */
  glossary: Glossary
  /** Labels of the parts that carry nothing, for the panel to name. */
  absent: string[]
}

/**
 * Normalises the glossary the provider hands over and reports what it lacks.
 *
 * The merge happens here as well as in LocalFileProvider because StaticProvider
 * hands the bundle's JSON through untouched, and a bundle's glossary is
 * hand-edited too: load_glossary in the Python ingest defaults the four top
 * keys but not the three inside methodology_extras, so a bundle can reach this
 * tab with an extras block that is missing its contents. A view that assumes
 * otherwise fails as a crash blaming itself for the state of a file.
 *
 * Absence is reported by content, not by which key was written. A key omitted
 * and a key set to an empty string are the same absence to a reader, and the
 * provider contract carries no channel for the distinction. Saying "supplied
 * no content" rather than "missing" keeps the panel true of both.
 */
export function readGlossary(raw: Glossary | null | undefined): GlossaryReading {
  const glossary = mergeGlossary(raw)
  return {
    glossary,
    absent: PARTS.filter((part) => !part.carried(glossary)).map((part) => part.label),
  }
}
