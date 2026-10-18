import { describe, expect, it } from 'vitest'

import { readAppBuild } from '../appBuild'

function doc(tags: Record<string, string>): Document {
  const d = document.implementation.createHTMLDocument('t')
  for (const [name, content] of Object.entries(tags)) {
    const meta = d.createElement('meta')
    meta.name = name
    meta.content = content
    d.head.appendChild(meta)
  }
  return d
}

describe('readAppBuild', () => {
  it('reads the commit and build time the deploy stamped into the page', () => {
    expect(
      readAppBuild(
        doc({
          'atlas-build': '2ce23494c506914a4d270653d1f656b007eccdf0',
          'atlas-built-at': '2026-10-18T16:07:12Z',
        }),
      ),
    ).toEqual({
      kind: 'commit',
      id: '2ce23494c506914a4d270653d1f656b007eccdf0',
      short: '2ce2349',
      builtAt: '2026-10-18T16:07:12Z',
    })
  })

  it('says a local build is local rather than dressing it up as a commit', () => {
    expect(readAppBuild(doc({ 'atlas-build': 'local-mgx1abc' }))).toMatchObject({
      kind: 'local', id: 'local-mgx1abc', builtAt: null,
    })
  })

  it('says a page with no stamp is unstamped', () => {
    expect(readAppBuild(doc({}))).toEqual({ kind: 'unstamped', id: null, short: null, builtAt: null })
  })
})
