import type { ReactNode } from 'react'

import { EmptyState } from '../../components/EmptyState'
import type { Glossary, Methodology } from '../../types/atlas'

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </div>
  )
}

/** Nothing rather than an empty box: a bordered blank reads as a caveat that
 *  says nothing, when the truth is that the glossary carried no caveat. The
 *  panel at the top of the tab names which one is missing. */
function Caveat({ text }: { text: string }) {
  if (text.trim() === '') return null
  return (
    <p className="mt-3 rounded border border-line bg-surface-2 p-3 text-xs leading-relaxed text-muted-2">
      {text}
    </p>
  )
}

/** The label doubles as the list's accessible name, so what a reader sees and
 *  what a screen reader announces cannot drift apart. */
function Keywords({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-muted">
        {label} <span className="tabular">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted-3">None recorded in the classifier config.</p>
      ) : (
        <ul aria-label={label} className="mt-1 flex flex-wrap gap-1">
          {items.map((keyword) => (
            <li key={keyword}>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink">
                {keyword}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MethodologySection({
  glossary,
  methodology,
}: {
  glossary: Glossary
  methodology: Methodology
}) {
  const extras = glossary.methodology_extras
  const rules = methodology.owner_rules

  return (
    <div className="space-y-4">
      <Block title="Risk classification">
        <p>
          Each system gets one of high, medium or low by a three-step rule, applied in
          this order:
        </p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>
            If the matrix row has an explicit <code>Risk Level</code> cell, that value
            wins.
          </li>
          <li>
            Otherwise, if the system id appears in{' '}
            <code>overrides.json &rarr; risk_overrides</code>, the override wins.
          </li>
          <li>
            Otherwise the <code>Risk/Challenge</code> narrative is scanned for the keyword
            lists below, high first, then low, then medium. The first match wins, and
            medium is the fallback when nothing matches.
          </li>
        </ol>
        <Keywords label="High risk keywords" items={methodology.high_keywords} />
        <Keywords label="Low risk keywords" items={methodology.low_keywords} />
        <Keywords label="Medium risk keywords" items={methodology.medium_keywords} />
        <Caveat text={extras.risk_caveat} />
      </Block>

      <Block title={'"Mapped" definition'}>
        <p>
          A matrix system counts as mapped at a site when the curated system to device map
          gives it at least one device id at that site. A mapping that names devices but
          no matrix system, or a matrix system with an empty device list, is not a
          mapping.
        </p>
        <Caveat text={extras.mapping_confidence_scale} />
      </Block>

      <Block title="Coverage % calculation">
        <p>
          Per site, coverage is the count of matrix systems with at least one device
          mapped at that site, divided by the number of matrix systems that could be
          fielded: every row except the shortfall rows, which record a gap in the
          architecture rather than a system. The realization gap and the risk bands use
          the same denominator and name the shortfall rows they leave out. The
          cross-site difference is a set difference of mapping keys, not a subtraction of
          percentages.
        </p>
      </Block>

      <Block title="Risk overlay aggregation">
        <p>
          A device takes the highest risk of any system that lists it, in the order high,
          medium, low. A device no system lists is drawn muted and counts as unexplained
          hardware rather than as low risk.
        </p>
      </Block>

      <Block title="Soft ownership detection">
        <p>
          An owner assignment is soft, meaning tentative, when a detection keyword appears
          in the Owner Org text or when the system id is on the always-soft list. The
          never-soft list forces the opposite. A workbook <code>Confirmed</code> column
          outranks both lists, which is why <code>scan</code> is confirmed despite being
          always-soft and <code>ist</code> is not despite being never-soft. An Owner Org
          cell that matches no rule at all falls through to External / Industry and is
          flagged soft.
        </p>
        <Keywords label="Soft ownership keywords" items={methodology.soft_keywords} />
        <Keywords label="Always soft system ids" items={methodology.always_soft} />
        <Keywords label="Never soft system ids" items={methodology.never_soft} />
        <Keywords label="Soft owner groups" items={methodology.soft_groups} />
        <p className="mt-1 text-xs text-muted-3">
          The soft owner groups list is declared in the classifier config and shown here
          for completeness. The current classifier does not consult it, so no system is
          soft by virtue of its group alone.
        </p>
        <Caveat text={extras.soft_ownership_note} />
      </Block>

      <Block title="Owner classification rules">
        <p>
          The Owner Org cell is tested against these rules in priority order and the first
          match wins, so the order is part of the answer. Priority 1 (
          <code>CBP AMO</code>) claims a row before priority 5 (<code>CBP</code>) ever
          sees it. A <code>substring</code> rule matches anywhere in the cell; a{' '}
          <code>word_boundary</code> rule matches only a whole word, which is what keeps
          the <code>ICE</code> rule out of the word office. The mode is not authored per
          rule: a match of four characters or fewer is a word boundary, anything longer is
          a substring.
        </p>
        {rules.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No owner rules in this bundle"
              detail="The classifier config carried no routing rules. Every owner group on the other tabs would then be a fallback, not a decision."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table
              aria-label="Owner classification rules"
              className="w-full border-collapse text-sm"
            >
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-muted-3">
                  <th scope="col" className="py-2 pr-4">
                    Priority
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Match
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Match mode
                  </th>
                  <th scope="col" className="py-2">
                    Owner group
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={`${rule.priority}-${rule.match}`}
                    className="border-b border-line"
                  >
                    <td className="py-1.5 pr-4">
                      <span className="tabular text-muted-2">{rule.priority}</span>
                    </td>
                    <td className="py-1.5 pr-4">
                      <code className="text-xs text-ink">{rule.match}</code>
                    </td>
                    <td className="py-1.5 pr-4">
                      <code className="text-xs text-muted-2">{rule.match_mode}</code>
                    </td>
                    <td className="py-1.5 text-muted">
                      {rule.group_label}{' '}
                      <code className="text-xs text-muted-3">{rule.group_id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-3">
          <span className="tabular">{rules.length}</span> rules, and the group label here
          is the graph node label from the classifier config, which is longer than the
          short display label the Systems table shows for the same group id.
        </p>
      </Block>
    </div>
  )
}
