import type { AboutContent } from './AboutDrawer'

/**
 * No counts are hardcoded here.
 *
 * The old About drawer said "71 devices" and "49 of them" in prose, which was
 * true when it was written and became a lie the next time the data changed.
 * Anything countable is rendered from the bundles in the view itself.
 */
export const ABOUT: Record<string, AboutContent> = {
  reference: {
    title: 'About Reference & Methodology',
    lead:
      'The source of truth for how every other view was produced, and for what this tool deliberately does not claim.',
    sections: [
      {
        heading: 'Where this comes from',
        body:
          'The confidence, methodology and systems sections are generated from the classification tables the ingest actually runs. Editing a rule changes this page, so the documentation cannot drift from the behaviour it describes.',
      },
      {
        heading: 'Reading the confidence cards',
        body:
          'High confidence means a value was read from a cell. Moderate means a rule produced it. Low means someone guessed and said so. The out-of-scope card is the list of questions this tool will not answer, which is as important as the ones it will.',
      },
      {
        heading: 'The owner rules table',
        body:
          'Owner classification is first match wins, so the order of those rules is load-bearing and was previously invisible. Matches of four characters or fewer use word boundaries, which is what keeps the word office out of the ICE rule.',
      },
    ],
  },

  analytics: {
    title: 'About Analytics',
    lead:
      'How risk and ownership are distributed today, and how much of the original requirement baseline survives into the current architecture.',
    sections: [
      {
        heading: 'The heatmap',
        body:
          'Counts of systems by owner group and risk level. Hover a cell to see which systems it counts. Risk comes from the Risk Level column where the workbook sets one, and from a keyword rule where it does not; the Reference tab lists both.',
      },
      {
        heading: 'Requirements coverage',
        body:
          'Each original requirement flows to the systems that carry it forward. Requirements nobody carried forward end at an explicit loss node rather than quietly leaving the diagram. This reads from the workbook crosswalk sheet, not from a copy inside the tool.',
      },
      {
        heading: 'Why coverage is lower than you may remember',
        body:
          'A mapping counts only when it names hardware and names a matrix system. Software-only entries and devices that are not matrix systems are listed separately rather than folded into the percentage, so this figure is lower and more honest than the one the previous tool reported.',
      },
    ],
  },

  lossiness: {
    title: 'About Lossiness',
    lead:
      'Seven measures of what falls out between the requirement, the system and the hardware.',
    sections: [
      {
        heading: 'Every number opens',
        body:
          'Each card drills through to the entities behind its figure. A measure you cannot audit is a claim, not a measurement, so nothing here is shown without a way to see what it counted.',
      },
      {
        heading: 'The attrition flow is not a funnel',
        body:
          'Requirements, systems and devices are three different populations, and the unconfirmed and unmapped sets overlap. Each stage is therefore measured against its own denominator. Read the arrows as the next question, not as a conversion rate.',
      },
      {
        heading: 'The composite is opt-in',
        body:
          'A single index invites exactly the false precision this tool exists to prevent, so it is hidden by default and labelled a management indicator rather than a metric. Show the seven.',
      },
    ],
  },

  network: {
    title: 'About Network Topology',
    lead:
      'Every device and link extracted from the site diagrams, with the systems each device is claimed to realize.',
    sections: [
      {
        heading: 'Layouts',
        body:
          'Force is a physics layout with zones pulled toward their tier. Zones packs each zone into its own grid. Tree lays tiers out in rows. All three use the tuning carried over from the original graph.',
      },
      {
        heading: 'Labels are off by default',
        body:
          'Labelling every device at once is unreadable at this density. Selected and focused devices always label; the Labels button shows the rest once you have zoomed in.',
      },
      {
        heading: 'Unclaimed devices',
        body:
          'A device no system claims is hardware in the rack that no architecture document explains. That count feeds the orphaned hardware measure on the Lossiness tab, and it is the inverse of the integration gap: things that exist but are unaccounted for, rather than things accounted for that do not exist.',
      },
    ],
  },

  map: {
    title: 'About the Orientation Map',
    lead:
      'The whole architecture in one picture: the inventory grouped by owner, and the baselines and gaps beside it.',
    sections: [
      {
        heading: 'Getting around',
        body:
          'Click a branch to expand or collapse it and a leaf to open its detail. Expand All opens everything. Scroll to zoom, drag to pan, and Reset returns to the starting view.',
      },
      {
        heading: 'Links',
        body:
          'Current links are integrations mined from the workbook prose plus hand-curated additions. Desired links are integrations the architecture calls for that do not exist yet. They toggle separately because the difference between them is the point.',
      },
      {
        heading: 'Unconfirmed ownership',
        body:
          'A dashed outline means the owning organization is assumed rather than stated. Where the workbook has a Confirmed column it wins over every rule, which is why a system can be on the always-soft list and still read as confirmed.',
      },
    ],
  },
}
