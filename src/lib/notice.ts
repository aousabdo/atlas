/**
 * What ATLAS does and does not promise about the data you put into it.
 *
 * ONE COPY, BECAUSE A DISCLAIMER THAT DRIFTS IS WORSE THAN NONE. The panel,
 * the About drawer, the README and docs/data-inputs.md all read from here, so
 * there is no second wording to fall out of date. A test asserts the strings
 * this module exports appear in the documents.
 *
 * IT DISCLAIMS, IT DOES NOT PROHIBIT, and that is deliberate. The local load
 * path exists precisely so an analyst can work with their own matrix without
 * handing it to anyone. Telling people never to load controlled data would
 * make LocalFileProvider, the marking banner and the upload hardening
 * decorative, and would push the people who need the tool towards retyping,
 * screenshots, or something that really does upload. None of those are safer.
 *
 * So it states the technical facts, which are checkable, and leaves the
 * determination with the person who owns the data, which is where it belongs.
 * What it must never do is imply an approval nobody has given.
 */

/** The one-line version, for anywhere a paragraph will not fit. */
export const NOTICE_SHORT =
  'ATLAS is not accredited for controlled information. Files you load are parsed ' +
  'in this browser and are never uploaded, but whether your data may be handled ' +
  'this way is your determination, not this tool’s.'

/**
 * The full notice.
 *
 * Every clause is here because it is a real exposure, not because it sounds
 * prudent. The exports clause in particular: parsing stays in the tab, but a
 * PNG, a PDF or a CSV leaves it and lands on a disk, and carries a marking
 * only if one was stated.
 */
export const NOTICE_POINTS: readonly string[] = [
  'ATLAS has no accreditation, authorisation to operate, or security ' +
    'assessment of any kind. Nobody has reviewed it for handling controlled ' +
    'information, and nothing in it should be read as approval to do so.',

  'Files you load are read in this browser tab. Nothing is uploaded, nothing ' +
    'is written to storage, and closing the tab discards them. That is a ' +
    'property of the code, and you can verify it: the network panel stays ' +
    'empty while a file loads.',

  'Exports leave the tab. A PNG, a PDF or a CSV is written to your disk and ' +
    'travels however you then send it. It carries a control marking only if ' +
    'one was stated, and ATLAS cannot know the right marking for your data.',

  'Your browser is outside this tool’s control. Extensions, profile sync, ' +
    'screen sharing, developer tools and the operating system can all see a ' +
    'page that ATLAS never sends anywhere.',

  'The hosted site is publicly readable by anyone with the link, even though ' +
    'the source repository is private. It serves a fabricated sample bundle ' +
    'and no real architecture.',

  'The sample data is invented. Site names, addresses, device names and every ' +
    'figure derived from them describe no real deployment.',

  'Whether your information may be handled this way is a determination for ' +
    'you and your data owner, under your own policy. This notice is not legal ' +
    'advice and ATLAS makes no warranty of any kind.',
]

/** Markdown rendering, for the README and the input contract. */
export function noticeMarkdown(): string {
  return [`> **${NOTICE_SHORT}**`, '', ...NOTICE_POINTS.map((p) => `- ${p}`)].join('\n')
}
