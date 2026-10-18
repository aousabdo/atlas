/**
 * The app's own build stamp, read from the page.
 *
 * vite.config.ts stamps the commit a build was made from (atlas-build) and
 * when it was made (atlas-built-at) into the document head, and the deploy
 * passes the commit it checked out. That is the stamp that says which code
 * drew these tabs. The data bundle carries a stamp of its own, which says
 * which ingest run produced the figures; the two are different facts and the
 * Reference tab shows both.
 */
export type AppBuild =
  | { kind: 'commit'; id: string; short: string; builtAt: string | null }
  /** A build from a working copy, or a test run's minted id: not a commit. */
  | { kind: 'local'; id: string; short: string; builtAt: string | null }
  | { kind: 'unstamped'; id: null; short: null; builtAt: null }

const meta = (doc: Document, name: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() || null

export function readAppBuild(doc: Document = document): AppBuild {
  const id = meta(doc, 'atlas-build')
  if (!id) return { kind: 'unstamped', id: null, short: null, builtAt: null }
  const builtAt = meta(doc, 'atlas-built-at')
  return /^[0-9a-f]{7,40}$/.test(id)
    ? { kind: 'commit', id, short: id.slice(0, 7), builtAt }
    : { kind: 'local', id, short: id, builtAt }
}
