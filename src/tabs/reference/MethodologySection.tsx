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
          mapping. A shortfall row is never mapped: it records that no system exists,
          so it takes no mapping at all and the load fails if it has one.
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

      <Block title="Proven to believed">
        <p>
          A realization figure counts every mapping alike, so each one also says how
          much of it rests on what. A realized system counts as physically verified
          when its strongest mapping at any site is graded high, a strong inference
          when it is medium, a best guess when it is low, and ungraded when the file
          gives no grade. The verified count is the floor of the range and the whole
          count is the ceiling. A figure that is all verified holds at every evidence
          level.
        </p>
      </Block>

      <Block title="Network resilience">
        <p>
          Single points of failure and single links are counted on the physical links
          only, cable and radio. A VLAN rides on those same links, so it is never a
          second way round. A single point of failure is a device whose loss leaves part
          of the site with no path to the rest. A single link is a link whose loss leaves
          two or more devices with no path to the rest. A link that is the only
          attachment of a device cuts off that one device and nothing else, so those
          devices are counted and named once rather than listed as single links.
        </p>
      </Block>

      <Block title="Documented vs wired">
        <p>
          Each integration the documents record is checked against one site at a
          time. Both systems need hardware on that site&rsquo;s drawing. If they share a
          device, they are on a shared device. Otherwise the check looks for a path on
          cable and radio between any device of one and any device of the other, and
          shows one shortest path. A device whose loss alone leaves no such path is
          named as one the integration breaks on; every such device lies on every
          path, so testing one shortest path finds them all. A path that exists only
          through a VLAN is reported as joined only by VLAN, never as wired. An
          integration with an end that is checked absent, software only or unmapped
          at the site cannot be checked there, and a site that records no system as
          either present or checked absent is reported as not reviewed. A path means the integration can run at the site,
          not that it does: nothing here reads ports, protocols or firewall rules.
        </p>
      </Block>

      <Block title="What to build next">
        <p>
          Each planned integration is described by facts, not scored. Owners counts how
          many of its two systems have a confirmed owner. Owner groups says whether it
          crosses from one group to another. Risk is the higher of its two ends. A
          planned integration joins a requirement when both of its ends carry that
          requirement in the crosswalk, and touches one when either end does; a
          requirement that was not kept is carried by nothing. Today is the shortest
          chain of integrations recorded now that joins the two, or none; a chain is a
          path on paper and says nothing about whether data passes along it. Sites
          applies the documented vs wired check to each site, and names a site with a
          drawing but no device map as not reviewed. An end filed as a shortfall row is
          named as one. A planned link already recorded as current is built, and one
          from a system to itself is not an integration, so both are set aside and
          named. There is no total and no build order, because
          any weighting of these facts would be a judgement presented as a finding; the
          table sorts by one fact at a time and keeps the listed order for ties.
        </p>
      </Block>

      <Block title="What rests on a device">
        <p>
          Each device is removed from the drawing on its own, one at a time, and the
          questions below are asked on cable and radio only. A VLAN rides on those links
          and is never a way round. This is arithmetic on the recorded drawing, not a
          forecast: a drawing shows what can reach, not what does, and nothing here reads
          ports, protocols, traffic or how likely a failure is.
        </p>
        <p className="mt-2">
          Roots. Reachability is measured from a set of roots, and the set in use is
          printed wherever a result is. The default is the site&rsquo;s declared decision
          positions: devices where someone acts on a detection, listed in the device map
          with a note saying who chose them and why. Some may be marked as assumptions.
          Where a site declares none, the roots are the drawing&rsquo;s entry points, and
          every result says so. Any one device type can be chosen instead; a device type
          is not a decision position. Reaching any one root counts. Removing the only root
          leaves nothing to measure from, so that device gets no verdict.
        </p>
        <p className="mt-2">
          Strands. A realized system is stranded by a device when, with that device
          removed, none of the system&rsquo;s devices on the drawing that reached a root
          before reaches one after. When some do and some do not, part of it is cut off,
          both lists are named, and it is not counted as stranded. When the removed device
          is the only one of the system&rsquo;s devices that reached a root, the system
          runs only there: that is the device&rsquo;s own risk, not a dependency. A system
          with a device in the root set is never stranded by another device. A system with
          no path to any root before anything is removed is named once and never counted
          against a device.
        </p>
        <p className="mt-2">
          Cuts a decision position off. A root other than the removed device is cut off
          from every system when, before the removal, it had a path to some device a
          realized system runs on, other than itself, and after it has none.
        </p>
        <p className="mt-2">
          Breaks. A documented integration that is wired, or on a shared device, breaks
          on a device when the documented vs wired check, run again without that device,
          finds neither a shared device nor a cable or radio path between the two
          systems&rsquo; hardware. A path left only through a VLAN counts as broken. It
          loses an end when the device was all of one system&rsquo;s drawn hardware.
          Breaking does not depend on the roots: both ends can keep a path to a decision
          position and still lose each other.
        </p>
        <p className="mt-2">
          Unclaimed devices. A device is unclaimed when no realized system lists it. Each
          one goes in one group: load-bearing, if its removal strands a system, cuts part
          of one off, breaks an integration, or cuts a decision position off from every
          system; cuts devices off, if devices lose their path but every system keeps
          one; hangs off one link, if it has at most one cable or radio link; otherwise,
          nothing loses its path. A device joined only by VLAN, and the only root, are not
          assessed. The groups are not a priority order; within a group, devices are
          listed by name. Two failures at once are not modelled.
        </p>
        <p className="mt-2">
          The dashed ring. In the risk overlay, a dashed ring marks a device whose loss
          would strand a system that does not run on it, coloured by the highest risk
          among those systems. It is drawn apart from the device&rsquo;s own colour, and
          only from declared decision positions. A root never carries one, and a partial
          loss, a broken integration or a cut-off position does not colour it.
        </p>
        <p className="mt-2">
          Assumptions. When some declared positions are marked as assumptions, every
          verdict is computed again without them and each device whose verdict changes is
          named. Broken integrations never change, because they do not depend on the
          roots. A site that records no system as present or checked absent is not
          reviewed, and nothing there is called unclaimed, load-bearing or safe.
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
