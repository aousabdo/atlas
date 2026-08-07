import { useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { ABOUT } from './components/aboutContent'
import { AboutDrawer } from './components/AboutDrawer'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ExportMenu } from './components/ExportMenu'
import { ShortcutsDialog, type ShortcutGroup } from './components/ShortcutsDialog'
import { TabBar, TABS } from './components/TabBar'
import { AtlasProvider } from './data/ProviderContext'
import { useShortcuts, type Shortcut } from './lib/useShortcuts'
import { AnalyticsTab } from './tabs/analytics/AnalyticsTab'
import { LossinessTab } from './tabs/lossiness/LossinessTab'
import { MapTab } from './tabs/map/MapTab'
import { NetworkTab } from './tabs/network/NetworkTab'
import { ReferenceTab } from './tabs/reference/ReferenceTab'

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    rows: [
      { keys: ['?'], description: 'Show or hide this dialog' },
      { keys: ['1', '2', '3', '4', '5'], description: 'Jump to a view' },
      { keys: ['E'], description: 'Save the current view as a PNG' },
      { keys: ['A'], description: 'About the current view' },
      { keys: ['Esc'], description: 'Close a dialog' },
    ],
  },
  {
    title: 'Network Topology and Orientation Map',
    rows: [
      { keys: ['Scroll'], description: 'Zoom' },
      { keys: ['Drag'], description: 'Pan' },
      { keys: ['Click'], description: 'Open the detail panel for a device or system' },
    ],
  },
]

function NotFound() {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        That route does not exist. Pick a view from the tabs above.
      </p>
    </div>
  )
}

/** Each route gets its own boundary, so one broken view cannot take the app down. */
function Tab({ label, children }: { label: string; children: React.ReactNode }) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>
}

function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLElement>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showAbout, setShowAbout] = useState(false)

  const viewKey = location.pathname.replace(/^\//, '') || 'reference'
  const about = ABOUT[viewKey]

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      { key: '?', description: 'shortcuts', run: () => setShowShortcuts((on) => !on) },
      { key: 'a', description: 'about', run: () => setShowAbout((on) => !on) },
      {
        key: 'e',
        description: 'png',
        run: () => {
          const button = document.querySelector<HTMLButtonElement>(
            '[data-export-omit] button',
          )
          button?.click()
        },
      },
      ...TABS.map((tab, index) => ({
        key: String(index + 1),
        description: `go to ${tab.label}`,
        run: () => navigate(tab.path),
      })),
    ],
    [navigate],
  )

  useShortcuts(shortcuts)

  return (
    <>
      <TabBar
        actions={
          <>
            {about && (
              <button
                type="button"
                onClick={() => setShowAbout(true)}
                title="About this view (A)"
                className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
              >
                About
              </button>
            )}
            <ExportMenu targetRef={panelRef} view={viewKey} />
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="rounded border border-line px-2 py-1 text-sm text-muted hover:text-ink"
            >
              ?
            </button>
          </>
        }
      />
      <main
        ref={panelRef}
        /* The map and the topology are full bleed; every other view gets the usual gutter. */
        className={viewKey === 'map' || viewKey === 'network' ? '' : 'px-4 py-6'}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/reference" replace />} />
          <Route
            path="/reference"
            element={<Tab label={TABS[0].label}><ReferenceTab /></Tab>}
          />
          <Route
            path="/analytics"
            element={<Tab label={TABS[1].label}><AnalyticsTab /></Tab>}
          />
          <Route
            path="/lossiness"
            element={<Tab label={TABS[2].label}><LossinessTab /></Tab>}
          />
          <Route
            path="/network"
            element={<Tab label={TABS[3].label}><NetworkTab /></Tab>}
          />
          <Route path="/map" element={<Tab label={TABS[4].label}><MapTab /></Tab>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      {showShortcuts && (
        <ShortcutsDialog
          groups={SHORTCUT_GROUPS}
          onClose={() => setShowShortcuts(false)}
        />
      )}
      {showAbout && about && (
        <AboutDrawer content={about} onClose={() => setShowAbout(false)} />
      )}
    </>
  )
}

export default function App() {
  return (
    <AtlasProvider>
      <Shell />
    </AtlasProvider>
  )
}
