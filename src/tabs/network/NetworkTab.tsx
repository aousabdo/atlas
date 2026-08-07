import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { LoadFailed } from '../../components/LoadFailed'
import { useAtlas } from '../../data/useAtlas'
import type {
  CoverageMatrix,
  Device,
  Project,
  SiteId,
  System,
  Topology,
} from '../../types/atlas'
import {
  computeLayout,
  LAYOUT_CANVAS,
  withOffsets,
  type NodeOffset,
  type ViewMode,
} from '../../viz/force'
import { IDENTITY, panToFit, zoomAbout, type Size, type Transform } from '../../viz/zoom'
import { DeviceDetail, type DeviceConnection, type DeviceSystem } from './DeviceDetail'
import { ForceGraph } from './ForceGraph'
import { NetworkLegend } from './NetworkLegend'
import { NetworkMinimap } from './NetworkMinimap'
import { ViewStrip } from '../../components/ViewStrip'
import { deviceRisks } from './risk'
import { SiteSelector } from './SiteSelector'
import { ZonePanel } from './ZonePanel'

const VIEW_MODES: Array<{ mode: ViewMode; label: string; hint: string; key: string }> = [
  { mode: 'force', label: 'Force', hint: 'Physics layout, zones pulled towards their tier.', key: '1' },
  { mode: 'zone', label: 'Zones', hint: 'One packed grid per zone, largest zone first.', key: '2' },
  { mode: 'tree', label: 'Tree', hint: 'Tier rows, zone columns weighted by device count.', key: '3' },
]

/**
 * Full bleed. The canvas is the view, not a card inside it: the tool being
 * replaced gave the graph the whole viewport and floated the sidebar, legend,
 * minimap and hints over it, and boxing it into a column is most of why this
 * felt worse.
 */
export function NetworkTab() {
  const project = useAtlas((provider) => provider.getProject())

  return (
    <section className="relative h-[calc(100vh-4.5rem)] w-full overflow-hidden bg-bg">
      {/* One heading node from loading through ready. React then reuses it
          rather than swapping it, so a test that finds it while the bundle is
          still in flight is not left holding a detached element. */}
      <h1 className="pointer-events-none absolute top-2 left-3 z-30 text-sm font-semibold tracking-wide text-accent-ink uppercase">
        Network Topology
      </h1>
      {project.status === 'loading' && (
        <p role="status" className="px-3 pt-10 text-sm text-muted">
          Loading the site index.
        </p>
      )}
      {project.status === 'failed' && (
        <div className="px-3 pt-10">
          <LoadFailed
            resource="the site index"
            message={project.error.message}
            onRetry={project.retry}
          />
        </div>
      )}
      {project.status === 'ready' && <SiteView project={project.data} />}
    </section>
  )
}

function SiteView({ project }: { project: Project }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const requested = searchParams.get('site')
  const siteId: SiteId =
    project.sites.find((site) => site.id === requested)?.id ??
    project.default_site ??
    project.sites[0]?.id ??
    ''

  const focusParam = searchParams.get('focus') ?? ''
  const focusIds = useMemo(
    () => focusParam.split(',').map((id) => id.trim()).filter(Boolean),
    [focusParam],
  )

  const bundle = useAtlas(
    async (provider) => {
      const [topology, coverage, systems] = await Promise.all([
        provider.getTopology(siteId),
        provider.getCoverage(),
        provider.getSystems(),
      ])
      return { topology, coverage, systems }
    },
    [siteId],
  )

  if (project.sites.length === 0) {
    return (
      <div className="px-3 pt-10">
        <EmptyState
          title="No sites in this bundle"
          detail="The project index lists no sites, so there is no topology to draw."
        />
      </div>
    )
  }

  if (bundle.status === 'loading') {
    return (
      <p role="status" className="px-3 pt-10 text-sm text-muted">
        Loading the topology for this site.
      </p>
    )
  }

  if (bundle.status === 'failed') {
    return (
      <div className="px-3 pt-10">
        <LoadFailed
          resource={`the topology for ${siteId}`}
          message={bundle.error.message}
          onRetry={bundle.retry}
        />
      </div>
    )
  }

  return (
    // Keyed by site so switching sites resets zone, selection, drags and view
    // state instead of carrying one site's choices into another.
    <SiteTopology
      key={siteId}
      topology={bundle.data.topology}
      coverage={bundle.data.coverage}
      systems={bundle.data.systems}
      focusIds={focusIds}
      sites={project.sites}
      onSite={(id) => setSearchParams({ site: id })}
    />
  )
}

/** Same rule as the app-wide shortcuts: never steal a key from a text field. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

function SiteTopology({
  topology,
  coverage,
  systems,
  focusIds,
  sites,
  onSite,
}: {
  topology: Topology
  coverage: CoverageMatrix
  systems: System[]
  focusIds: string[]
  sites: Project['sites']
  onSite: (siteId: SiteId) => void
}) {
  const [mode, setMode] = useState<ViewMode>('force')
  const [showLabels, setShowLabels] = useState(false)
  const [riskMode, setRiskMode] = useState(false)
  const [textScale, setTextScale] = useState(1)
  const [nodeScale, setNodeScale] = useState(1)
  // The tool being replaced let the sidebar collapse, bound to backslash. At
  // 320px it is a fifth of the canvas, which matters on a laptop.
  const [showPanel, setShowPanel] = useState(true)
  const stepNode = (d: number) =>
    setNodeScale((s) => Math.min(2.2, Math.max(0.6, Math.round((s + d * 0.15) * 100) / 100)))
  const stepText = (delta: number) =>
    setTextScale((s) => Math.min(2.6, Math.max(0.6, Math.round((s + delta) * 100) / 100)))
  const [activeZone, setActiveZone] = useState<string | null>(null)
  const [zonePreview, setZonePreview] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [dismissedFocus, setDismissedFocus] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [offsets, setOffsets] = useState<Record<string, NodeOffset>>({})
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [canvasSize, setCanvasSize] = useState<Size>({ width: 0, height: 0 })
  const [fitNonce, setFitNonce] = useState(0)

  const searchRef = useRef<HTMLInputElement>(null)

  const deviceById = useMemo(
    () => new Map(topology.devices.map((device) => [device.id, device])),
    [topology.devices],
  )
  const labelById = useMemo(
    () => new Map(topology.devices.map((device) => [device.id, device.label])),
    [topology.devices],
  )

  const zoneIds = useMemo(() => Object.keys(topology.zones), [topology.zones])

  // d3 works out every coordinate; React renders all of it. The layout is
  // computed against a fixed canvas so a resize re-fits the view instead of
  // reshuffling a graph the reader is looking at.
  const baseLayout = useMemo(
    () =>
      computeLayout(
        { devices: topology.devices, edges: topology.edges, zoneIds },
        mode,
        LAYOUT_CANVAS,
      ),
    [topology.devices, topology.edges, zoneIds, mode],
  )
  const layout = useMemo(() => withOffsets(baseLayout, offsets), [baseLayout, offsets])

  // A device dragged into place in one layout means nothing in the next.
  useEffect(() => {
    setOffsets({})
  }, [mode])

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const zone of zoneIds) counts[zone] = 0
    for (const device of topology.devices) counts[device.zone] = (counts[device.zone] ?? 0) + 1
    return counts
  }, [topology.devices, zoneIds])

  const systemsById = useMemo(
    () => new Map(systems.map((system) => [system.id, system])),
    [systems],
  )

  /** Reverse of coverage: which systems each device is claimed to realize. */
  const systemsByDevice = useMemo(() => {
    const index = new Map<string, DeviceSystem[]>()
    const site = coverage.sites[topology.site_id]
    if (!site) return index
    for (const [systemId, mapping] of Object.entries(site.mappings)) {
      for (const deviceId of mapping.devices) {
        const entry: DeviceSystem = {
          systemId,
          system: systemsById.get(systemId) ?? null,
          note: mapping.note,
          confidence: mapping.confidence,
          inMatrix: mapping.matrix_id_exists !== false,
        }
        const existing = index.get(deviceId)
        if (existing) existing.push(entry)
        else index.set(deviceId, [entry])
      }
    }
    return index
  }, [coverage, systemsById, topology.site_id])

  const riskById = useMemo(
    () => deviceRisks(coverage, systems, topology.site_id),
    [coverage, systems, topology.site_id],
  )
  // No mappings means the overlay has nothing to say, so the original hid the
  // toggle rather than offering a button that greys the whole graph out.
  const hasRisk = riskById.size > 0

  const mappedCount = Object.keys(coverage.sites[topology.site_id]?.mappings ?? {}).length

  const selectedId = picked ?? (dismissedFocus ? null : (focusIds[0] ?? null))
  const selectedDevice = selectedId ? (deviceById.get(selectedId) ?? null) : null

  const focused = useMemo(() => {
    const ids = new Set(dismissedFocus ? [] : focusIds)
    if (selectedId) ids.add(selectedId)
    return ids
  }, [focusIds, selectedId, dismissedFocus])

  /** Who is wired to whom, which is what isolating a device dims against. */
  const adjacency = useMemo(() => {
    const index = new Map<string, Set<string>>()
    for (const edge of topology.edges) {
      if (!index.has(edge.source)) index.set(edge.source, new Set())
      if (!index.has(edge.target)) index.set(edge.target, new Set())
      index.get(edge.source)!.add(edge.target)
      index.get(edge.target)!.add(edge.source)
    }
    return index
  }, [topology.edges])

  /** Hover wins over selection, exactly as in the tool being replaced. */
  const highlight = useMemo(() => {
    const focus = hoverId ?? selectedId
    if (!focus) return null
    const set = new Set<string>([focus])
    for (const id of adjacency.get(focus) ?? []) set.add(id)
    return set
  }, [hoverId, selectedId, adjacency])

  const connections: DeviceConnection[] = useMemo(() => {
    if (!selectedDevice) return []
    return topology.edges
      .filter((edge) => edge.source === selectedDevice.id || edge.target === selectedDevice.id)
      .map((edge) => {
        const outgoing = edge.source === selectedDevice.id
        const otherId = outgoing ? edge.target : edge.source
        return {
          edge,
          otherId,
          otherLabel: deviceById.get(otherId)?.label ?? otherId,
          outgoing,
        }
      })
  }, [selectedDevice, topology.edges, deviceById])

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return topology.devices.filter((device) => {
      if (activeZone && device.zone !== activeZone) return false
      if (!needle) return true
      return (
        device.label.toLowerCase().includes(needle) ||
        device.type.toLowerCase().includes(needle) ||
        (device.ip ?? '').toLowerCase().includes(needle)
      )
    })
  }, [topology.devices, activeZone, query])

  const deviceTypes = useMemo(
    () => [...new Set(topology.devices.map((device) => device.type))].sort(),
    [topology.devices],
  )
  const linkTypes = useMemo(
    () => [...new Set(topology.edges.map((edge) => edge.link_type))].sort(),
    [topology.edges],
  )

  const select = useCallback((deviceId: string) => {
    setPicked(deviceId)
    setDismissedFocus(false)
  }, [])

  const clearSelection = useCallback(() => {
    setPicked(null)
    setDismissedFocus(true)
  }, [])

  /** Escape means all of it: selection, zone filter and any live preview. */
  const clearAll = useCallback(() => {
    clearSelection()
    setActiveZone(null)
    setZonePreview(null)
    setHoverId(null)
  }, [clearSelection])

  const onOffset = useCallback((deviceId: string, delta: NodeOffset) => {
    setOffsets((previous) => {
      const current = previous[deviceId] ?? { dx: 0, dy: 0 }
      return { ...previous, [deviceId]: { dx: current.dx + delta.dx, dy: current.dy + delta.dy } }
    })
  }, [])

  const recenter = useCallback(
    (world: { x: number; y: number }) => {
      setTransform((previous) => {
        if (!Number.isFinite(previous.k) || previous.k <= 0) return previous
        return {
          ...previous,
          x: canvasSize.width / 2 - world.x * previous.k,
          y: canvasSize.height / 2 - world.y * previous.k,
        }
      })
    },
    [canvasSize.width, canvasSize.height],
  )

  /** ?focus= pans onto the named devices once the canvas has a real size. */
  const focusKey = focusIds.join(',')
  useLayoutEffect(() => {
    if (!focusKey) return
    const ids = new Set(focusKey.split(','))
    const points = baseLayout.nodes.filter((n) => ids.has(n.id)).map((n) => ({ x: n.x, y: n.y }))
    setTransform((previous) => panToFit(points, canvasSize, previous.k) ?? previous)
  }, [focusKey, baseLayout, canvasSize])

  /**
   * The graph shortcuts, in the same document as everything else.
   *
   * Capture phase, because the app-wide handler also binds 1, 2 and 3 and the
   * view a reader is looking at owns those keys while it is on screen. Only
   * keys this view actually consumes are stopped; anything else, including
   * every keystroke aimed at a text field or an open dialog, passes through.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (document.querySelector('[role="dialog"]')) return

      const consume = () => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }

      switch (event.key) {
        case '/':
          searchRef.current?.focus()
          searchRef.current?.select()
          return consume()
        case '1':
          setMode('force')
          return consume()
        case '2':
          setMode('zone')
          return consume()
        case '3':
          setMode('tree')
          return consume()
        case 'f':
        case 'F':
          setFitNonce((n) => n + 1)
          return consume()
        case 'l':
        case 'L':
          setShowLabels((on) => !on)
          return consume()
        case 'r':
        case 'R':
          if (!hasRisk) return
          setRiskMode((on) => !on)
          return consume()
        case '\\':
          setShowPanel((on) => !on)
          return consume()
        case 'Escape':
          // Nothing isolated and no zone filtered: leave Escape to whoever
          // else wants it rather than swallowing it.
          if (!selectedId && !activeZone) return
          clearAll()
          return consume()
        default:
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hasRisk, selectedId, activeZone, clearAll])

  if (topology.devices.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No devices recorded for this site"
          detail="The site bundle loaded and carries no devices. Nothing failed; there is simply nothing to draw yet."
        />
      </div>
    )
  }

  const modeHint = VIEW_MODES.find((view) => view.mode === mode)?.hint ?? ''

  return (
    <>
      <ForceGraph
        siteLabel={topology.meta.label}
        layout={layout}
        labelById={labelById}
        focused={focused}
        selectedId={selectedId}
        hoverId={hoverId}
        highlight={highlight}
        activeZone={activeZone ?? zonePreview}
        showLabels={showLabels}
        textScale={textScale}
        nodeScale={nodeScale}
        riskMode={riskMode}
        riskById={riskById}
        transform={transform}
        onTransform={setTransform}
        onSize={setCanvasSize}
        onSelect={select}
        onHover={setHoverId}
        onOffset={onOffset}
        onClearSelection={clearSelection}
        fitKey={`${topology.site_id}:${mode}`}
        fitNonce={fitNonce}
      />

      <aside
        aria-label="Topology controls"
        hidden={!showPanel}
        className="absolute inset-y-0 left-0 z-20 flex w-80 flex-col overflow-hidden border-r border-line bg-surface/95 backdrop-blur"
      >
        {/* Top padding clears the heading, which is mounted once by the tab
            itself so it survives the load states. */}
        <div className="shrink-0 border-b border-line px-3 pt-8 pb-2">
          <p className="text-[11px] tracking-wide text-muted-3 uppercase">
            {topology.meta.label}
          </p>
        </div>

        <div className="shrink-0 border-b border-line px-3 py-2">
          <SiteSelector sites={sites} activeId={topology.site_id} onSelect={onSite} />
        </div>

        <div className="shrink-0 border-b border-line">
          <DeviceList
            ref={searchRef}
            devices={listed}
            total={topology.devices.length}
            query={query}
            onQuery={setQuery}
            selectedId={selectedId}
            onSelect={select}
            onPreview={setHoverId}
            zoneLabel={(zone) => topology.zones[zone]?.label ?? zone}
          />
        </div>

        <div className="max-h-64 shrink-0 overflow-y-auto border-b border-line">
          <ZonePanel
            zones={topology.zones}
            counts={zoneCounts}
            total={topology.devices.length}
            activeZone={activeZone}
            onSelect={setActiveZone}
            onPreview={setZonePreview}
          />
        </div>

        {mappedCount === 0 && (
          <p className="shrink-0 border-b border-line px-3 py-2 text-xs text-muted">
            No systems are mapped to this site yet, so every device reads as
            unclaimed. That is a pending mapping, not an empty network.
          </p>
        )}

        <div className="min-h-40 flex-1 overflow-y-auto px-3 py-2">
          <DeviceDetail
            device={selectedDevice}
            zone={selectedDevice ? topology.zones[selectedDevice.zone] : undefined}
            systems={selectedDevice ? (systemsByDevice.get(selectedDevice.id) ?? []) : []}
            connections={connections}
            onSelect={select}
          />
        </div>
      </aside>

      {/* Chrome floating over the canvas, clear of the sidebar. */}
      <div
        className={[
          'pointer-events-none absolute inset-y-0 right-0 z-10 flex flex-col p-3',
          showPanel ? 'left-80' : 'left-0',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="View mode"
              className="flex overflow-hidden rounded border border-line bg-surface/90 backdrop-blur"
            >
              {VIEW_MODES.map((view) => (
                <button
                  key={view.mode}
                  type="button"
                  aria-pressed={mode === view.mode}
                  onClick={() => setMode(view.mode)}
                  title={`${view.hint} (${view.key})`}
                  className={[
                    'px-3 py-1 text-xs tracking-wider uppercase',
                    mode === view.mode
                      ? 'bg-surface-2 text-accent-ink'
                      : 'text-muted hover:text-ink',
                  ].join(' ')}
                >
                  {view.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-pressed={showPanel}
              onClick={() => setShowPanel((on) => !on)}
              title="Show or hide the panel (\\)"
              className={toggleClass(showPanel)}
            >
              Panel
            </button>

            <button
              type="button"
              aria-pressed={showLabels}
              onClick={() => setShowLabels((on) => !on)}
              title="Label every device (L). Unreadable at this density until you zoom in."
              className={toggleClass(showLabels)}
            >
              Labels
            </button>

            {hasRisk && (
              <button
                type="button"
                aria-pressed={riskMode}
                onClick={() => setRiskMode((on) => !on)}
                title="Colour devices by the worst risk of any system they implement (R)"
                className={toggleClass(riskMode)}
              >
                Risk
              </button>
            )}

          </div>

          <p className="pointer-events-auto rounded border border-line bg-surface/90 px-2.5 py-1 text-xs text-muted backdrop-blur">
            <span className="tabular text-ink">{topology.devices.length} devices</span>
            {' · '}
            <span className="tabular text-ink">{topology.edges.length} links</span>
            {' · '}
            <span className="tabular text-ink">{zoneIds.length} zones</span>
            {' · '}
            <span className="tabular text-ink">{mappedCount} mapped systems</span>
          </p>
        </div>

        <p className="pointer-events-none mt-1 text-[11px] text-muted-3">{modeHint}</p>

        <div className="mt-auto flex items-end justify-between gap-3">
          <div className="pointer-events-auto max-w-3xl rounded border border-line bg-surface/90 px-3 py-2 backdrop-blur">
            <NetworkLegend
              deviceTypes={deviceTypes}
              linkTypes={linkTypes}
              riskMode={riskMode}
            />
          </div>

          <div className="flex flex-col items-end gap-2">
            <ViewStrip
              steppers={[
                {
      label: 'Zoom',
      value: transform.k,
      decreaseLabel: 'Zoom out',
      increaseLabel: 'Zoom in',
      onStep: (d) =>
        setTransform((prev) =>
          zoomAbout(prev, d > 0 ? 1.3 : 1 / 1.3, canvasSize.width / 2, canvasSize.height / 2),
        ),
    },
    {
      label: 'Nodes',
      value: nodeScale,
      decreaseLabel: 'Smaller nodes',
      increaseLabel: 'Larger nodes',
      onStep: stepNode,
    },
    {
      label: 'Labels',
      value: textScale,
      decreaseLabel: 'Smaller labels',
      increaseLabel: 'Larger labels',
      onStep: (d) => stepText(d * 0.15),
    },
  ]}
              actions={[
    { label: 'Fit', title: 'Fit the whole topology (F)', onClick: () => setFitNonce((n) => n + 1) },
  ]}
            />
            <div className="pointer-events-auto mr-10 w-52 rounded border border-line bg-surface/90 p-1.5 backdrop-blur">
            <NetworkMinimap
              nodes={layout.nodes}
              bbox={layout.bbox}
              zoneOrder={layout.zones}
              selectedId={selectedId}
              transform={transform}
              canvasSize={canvasSize}
              onRecenter={recenter}
            />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function toggleClass(on: boolean): string {
  return [
    'rounded border px-3 py-1 text-xs tracking-wider uppercase backdrop-blur',
    on
      ? 'border-accent bg-surface-2 text-accent-ink'
      : 'border-line bg-surface/90 text-muted hover:text-ink',
  ].join(' ')
}

function DeviceList({
  ref,
  devices,
  total,
  query,
  onQuery,
  selectedId,
  onSelect,
  onPreview,
  zoneLabel,
}: {
  ref: React.Ref<HTMLInputElement>
  devices: Device[]
  total: number
  query: string
  onQuery: (value: string) => void
  selectedId: string | null
  onSelect: (deviceId: string) => void
  /** Same preview a pointer gets on the canvas, reachable from the keyboard. */
  onPreview: (deviceId: string | null) => void
  zoneLabel: (zone: string) => string
}) {
  return (
    <section aria-label="Devices" className="px-3 py-2">
      <h2 className="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-3 uppercase">
        Devices{' '}
        <span className="tabular font-normal normal-case">
          {devices.length} of {total}
        </span>
      </h2>
      <input
        ref={ref}
        type="search"
        aria-label="Filter devices"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Name, type or address  ( / )"
        className="mb-1.5 w-full rounded border border-line bg-bg px-2 py-1 text-sm text-ink placeholder:text-muted-3"
      />
      {devices.length === 0 ? (
        <p className="text-sm text-muted">No device matches that filter.</p>
      ) : (
        <ul className="flex max-h-52 flex-col gap-px overflow-y-auto">
          {devices.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                aria-pressed={device.id === selectedId}
                onClick={() => onSelect(device.id)}
                onPointerEnter={() => onPreview(device.id)}
                onPointerLeave={() => onPreview(null)}
                onFocus={() => onPreview(device.id)}
                onBlur={() => onPreview(null)}
                className={[
                  'w-full rounded px-2 py-1 text-left text-sm',
                  device.id === selectedId
                    ? 'bg-surface-2 text-ink'
                    : 'text-muted hover:bg-surface-2 hover:text-ink',
                ].join(' ')}
              >
                <span className="block truncate">{device.label}</span>
                <span className="block truncate text-xs text-muted-3">
                  {zoneLabel(device.zone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
