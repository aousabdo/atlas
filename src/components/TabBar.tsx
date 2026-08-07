import { NavLink } from 'react-router-dom'

import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

/** Spec order: Reference proves the pipeline, the map is the hardest port. */
export const TABS = [
  { path: '/reference', label: 'Reference & Methodology' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/lossiness', label: 'Lossiness' },
  { path: '/network', label: 'Network Topology' },
  { path: '/map', label: 'Orientation Map' },
] as const

export function TabBar({ actions }: { actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
      <Logo />
      <nav role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            role="tab"
            className={({ isActive }) =>
              [
                'rounded px-3 py-1 text-sm',
                isActive
                  ? 'bg-surface-2 text-ink'
                  : 'text-muted hover:text-ink',
              ].join(' ')
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <ThemeToggle />
      </div>
    </header>
  )
}
