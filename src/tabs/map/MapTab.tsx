import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { LoadFailed } from '../../components/LoadFailed'
import { useAtlas } from '../../data/useAtlas'
import { useWork } from '../../lib/ready'
import {
  ancestorsOf, branchIds, buildTree, defaultExpanded, findNode, parentMap,
} from '../../lib/tree'
import type { CoverageMatrix, LinkSet, System } from '../../types/atlas'
import { boundsOf, doLayout, snapToGrid } from '../../viz/radial'
import { DetailPanel } from './DetailPanel'
import { legendGroups, MapLegendCard } from './MapLegend'
import { topReserve } from './chrome'
import { MapToolbar, type MapToggles } from './MapToolbar'
import { Minimap } from './Minimap'
import { mapAction } from './shortcuts'
import { fitToScreen, IDENTITY, zoomAbout, type Size, type Transform } from '../../viz/zoom'
import { TreeCanvas, type Offset } from './TreeCanvas'
import { ViewStrip } from '../../components/ViewStrip'
import {
  clamp, DEFAULT_NODE_SCALE, DEFAULT_TEXT_SCALE, NODE_MAX, NODE_MIN, TEXT_MAX, TEXT_MIN,
} from './scales'

/** Zoom used when centring on the root, and the nudge that clears the chrome. */
const ROOT_ZOOM = 0.85
const ROOT_PAN_Y = 55

const NO_TOGGLES: MapToggles = {
  links: false, clean: false, grid: false, desired: false, risk: false,
}

interface MapData {
  systems: System[]
  links: LinkSet
  coverage: CoverageMatrix
}

/**
 * The heading sits outside the load switch on purpose.
 *
 * React then reuses the same <h1> node from loading through ready, so a test
 * that finds the heading before the bundle resolves is not left holding a
 * detached element once it does.
 */
export function MapTab() {
  return (
    /* Full bleed. The map is the view, not a card inside it: the tool being
       replaced gave the canvas the whole viewport and floated its chrome on
       top, and boxing it into a column is most of why this felt worse. */
    <section className="relative h-[calc(100vh-4.5rem)] w-full overflow-hidden">
      {/* Above the detail column, which docks against this edge and would
          otherwise be drawn over the only place the view is named. */}
      <h1 className="pointer-events-none absolute top-3 left-3 z-30 text-lg font-semibold text-ink">
        Orientation Map
      </h1>
      <MapBody />
    </section>
  )
}

function MapBody() {
  const state = useAtlas<MapData>(async (provider) => {
    const [systems, links, coverage] = await Promise.all([
      provider.getSystems(),
      provider.getLinks(),
      provider.getCoverage(),
    ])
    return { systems, links, coverage }
  })

  if (state.status === 'loading') {
    return (
      <p aria-busy="true" className="text-sm text-muted">
        Loading the orientation map.
      </p>
    )
  }

  if (state.status === 'failed') {
    return (
      <LoadFailed
        resource="the orientation map"
        message={state.error.message}
        onRetry={state.retry}
      />
    )
  }

  if (state.data.systems.length === 0) {
    return (
      <EmptyState
        title="No systems to map"
        detail="The bundle loaded and contains no systems, so there is no architecture to draw."
      />
    )
  }

  return <MapView {...state.data} />
}

function MapView({ systems, links, coverage }: MapData) {
  const [searchParams] = useSearchParams()
  const focus = searchParams.get('focus')

  const tree = useMemo(() => buildTree(systems), [systems])
  const parentOf = useMemo(() => parentMap(tree), [tree])
  const names = useMemo(
    () => Object.fromEntries(systems.map((s) => [s.id, s.name])),
    [systems],
  )

  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () => defaultExpanded(tree),
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [toggles, setToggles] = useState<MapToggles>(NO_TOGGLES)
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [canvasSize, setCanvasSize] = useState<Size>({ width: 0, height: 0 })
  const [offsets, setOffsets] = useState<Record<string, Offset>>({})
  // Opens fitted, which puts the whole tree on screen at roughly half scale,
  // so the labels need a head start to stay readable.
  const [textScale, setTextScale] = useState(DEFAULT_TEXT_SCALE)
  const [nodeScale, setNodeScale] = useState(DEFAULT_NODE_SCALE)
  const [fitNonce, setFitNonce] = useState(0)
  const fittedOnce = useRef(false)
  const lastNonce = useRef(0)

  /**
   * The top band is measured, not assumed.
   *
   * Its height depends on whether the toolbar wraps, which depends on the
   * viewport: 55px at 1440x900, 115px at 1280x720 and at 1366x768. A constant
   * gutter is right at one width and wrong at the rest.
   */
  const bandRef = useRef<HTMLDivElement>(null)
  const [bandHeight, setBandHeight] = useState(0)
  useLayoutEffect(() => {
    const element = bandRef.current
    if (!element) return
    const measure = () => {
      const height = Math.round(element.getBoundingClientRect().height)
      setBandHeight((previous) => (previous === height ? previous : height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const chromeTop = topReserve(bandHeight)

  const zoomBy = useCallback(
    (factor: number) => {
      setTransform((previous) =>
        zoomAbout(previous, factor, canvasSize.width / 2, canvasSize.height / 2),
      )
    },
    [canvasSize.width, canvasSize.height],
  )


  /** Put a world point in the middle of the canvas, for the minimap. */
  const recenter = useCallback((world: { x: number; y: number }) => {
    setTransform((previous) => ({
      ...previous,
      x: canvasSize.width / 2 - world.x * previous.k,
      y: canvasSize.height / 2 - world.y * previous.k,
    }))
  }, [canvasSize.width, canvasSize.height])

  /**
   * ?focus= has to open the whole ancestor chain, not just select.
   *
   * doLayout skips the children of a collapsed branch, so a focused node whose
   * group is shut is never positioned and therefore never drawn.
   */
  useEffect(() => {
    if (!focus) return
    const chain = ancestorsOf(tree, focus)
    if (!chain) return
    const node = findNode(tree, focus)
    setExpanded((previous) => {
      const next = { ...previous }
      for (const id of chain) next[id] = true
      if (node?.children?.length) next[focus] = true
      return next
    })
    setSelected(focus)
  }, [focus, tree])

  const positions = useMemo(() => {
    const radial = doLayout(tree, expanded)
    return toggles.grid ? snapToGrid(radial, parentOf) : radial
  }, [tree, expanded, toggles.grid, parentOf])

  /**
   * Fit into the area the floating chrome leaves free.
   *
   * Returns null when the canvas has not been laid out, which is the guard
   * that keeps a k of 0 out of the transform.
   */
  const computeFit = useCallback((): Transform | null => {
    const b = boundsOf(positions)
    const fitted = fitToScreen(
      { x: b.minX, y: b.minY, w: b.width, h: b.height },
      { width: canvasSize.width, height: canvasSize.height - chromeTop },
    )
    return fitted ? { ...fitted, y: fitted.y + chromeTop } : null
  }, [positions, canvasSize.width, canvasSize.height, chromeTop])

  /** Open fitted, so the whole map is visible without touching anything. */
  const [everFitted, setEverFitted] = useState(false)
  useEffect(() => {
    if (fittedOnce.current) return
    const fitted = computeFit()
    if (!fitted) return
    fittedOnce.current = true
    setTransform(fitted)
    setEverFitted(true)
  }, [computeFit])

  // Before the first fit the tree sits at the identity transform, off centre
  // and at the wrong scale. Hold data-atlas-ready until it has been placed.
  useWork(!everFitted)

  // Expand All and Reset re-fit; toggling one branch does not, or it would
  // fight a reader who has panned.
  useEffect(() => {
    if (lastNonce.current === fitNonce) return
    lastNonce.current = fitNonce
    const fitted = computeFit()
    if (fitted) setTransform(fitted)
  }, [fitNonce, computeFit])

  /** Ask for a refit. The effect above does it once the canvas has a size. */
  const fit = useCallback(() => {
    setFitNonce((n) => n + 1)
  }, [])

  const clearSelection = useCallback(() => {
    setSelected(null)
  }, [])

  const centreOnRoot = useCallback(() => {
    if (!canvasSize.width || !canvasSize.height) return
    setTransform({
      k: ROOT_ZOOM,
      x: canvasSize.width / 2,
      y: canvasSize.height / 2 + ROOT_PAN_Y,
    })
  }, [canvasSize.width, canvasSize.height])


  const stats = useMemo(
    () => [
      { label: 'Systems', value: systems.length },
      { label: 'Confirmed', value: systems.filter((s) => s.confirmed).length },
      { label: 'Unconfirmed', value: systems.filter((s) => !s.confirmed).length },
      { label: 'High Risk', value: systems.filter((s) => s.risk === 'high').length },
      { label: 'Med Risk', value: systems.filter((s) => s.risk === 'medium').length },
      { label: 'Low Risk', value: systems.filter((s) => s.risk === 'low').length },
      { label: 'Links', value: links.current.length },
    ],
    [systems, links],
  )

  const selectedSystem = selected ? systems.find((s) => s.id === selected) : undefined

  /** One row per colour on the canvas, so the legend cannot drift from it. */
  const groups = useMemo(() => legendGroups(positions), [positions])

  /**
   * The map's own keys, in the same document as everything else.
   *
   * Capture phase and the same manners as the topology's: a keystroke aimed at
   * a text field or at an open dialog is never taken, and only the keys this
   * view actually consumes are stopped. Escape is left alone when there is no
   * selection to clear, so whoever else wants it still gets it.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"]')) return
      const action = mapAction(event)
      if (!action) return
      if (action === 'clear' && !selected) return

      switch (action) {
        case 'fit':
          fit()
          break
        case 'centre':
          centreOnRoot()
          break
        case 'risk':
          setToggles((previous) => ({ ...previous, risk: !previous.risk }))
          break
        case 'clear':
          clearSelection()
          break
      }

      event.preventDefault()
      event.stopImmediatePropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [selected, fit, centreOnRoot, clearSelection])

  const handleToggle = (key: keyof MapToggles) => {
    setToggles((previous) => {
      // Grid routing only reads on right-angle links, so Grid turns Clean on
      // for you, exactly as the tool being replaced does.
      if (key === 'grid') {
        const grid = !previous.grid
        return { ...previous, grid, clean: grid ? true : previous.clean }
      }
      return { ...previous, [key]: !previous[key] }
    })
  }

  return (
    /* Full bleed. The map is the view, not a card inside it: the tool being
       replaced gave the canvas the whole viewport and floated its chrome on
       top, and boxing it into a column is most of why this felt worse. */
    <div className="relative h-full w-full overflow-hidden">
      <TreeCanvas
        positions={positions}
        parentOf={parentOf}
        links={links}
        expanded={expanded}
        selected={selected}
        riskMode={toggles.risk}
        showLinks={toggles.links}
        showDesired={toggles.desired}
        clean={toggles.clean}
        textScale={textScale}
        nodeScale={nodeScale}
        offsets={offsets}
        transform={transform}
        onTransform={setTransform}
        onSize={setCanvasSize}
        // The running total lives here, and each step is added to whatever the
        // step before it produced. Computing the total in the canvas read a
        // prop one render out of date, so a burst of moves kept only its last.
        // The running total lives here, and each step is added to whatever the
        // step before it produced. Computing the total in the canvas read a
        // prop one render out of date, so a burst of moves kept only its last.
        onOffset={(id, delta) => {
          setOffsets((previous) => {
            const current = previous[id] ?? { dx: 0, dy: 0 }
            return {
              ...previous,
              [id]: { dx: current.dx + delta.dx, dy: current.dy + delta.dy },
            }
          })
        }}
        onToggle={(id) => {
          setExpanded((previous) => ({ ...previous, [id]: !previous[id] }))
        }}
        onSelect={setSelected}
        onClearSelection={clearSelection}
      />

      {/*
        The record docks beside the chrome instead of floating over it.

        It used to be an absolutely positioned column at z-10 on the right hand
        edge, and the chrome layer below has no z-index at all and is an earlier
        sibling, so the panel won the stack and buried the minimap whole and
        every control in the view strip. Network Topology already answers this:
        the record lives in a rail on one edge and the floating chrome is inset
        by the width of that rail, so nothing is ever painted over.

        Left, to match that tab. A reader moving between the two graph views
        finds the record in the same place, and if the inset below is ever lost
        again the panel lands on the statistics, which are a readout, rather
        than on the zoom, fit and overview, which are how you drive the canvas.
      */}
      {selectedSystem && (
        <div
          data-testid="map-detail"
          className="absolute inset-y-0 left-0 z-20 w-80 overflow-y-auto overscroll-contain border-r border-line bg-surface/95 px-2 pt-11 pb-3 backdrop-blur"
        >
          <DetailPanel
            system={selectedSystem}
            links={links}
            coverage={coverage}
            names={names}
            onClose={clearSelection}
          />
        </div>
      )}

      <div
        data-testid="map-chrome"
        className={[
          'pointer-events-none absolute inset-y-0 right-0 z-10 flex flex-col gap-3 p-3',
          selectedSystem ? 'left-80' : 'left-0',
        ].join(' ')}
      >
        {/*
          The band itself takes no pointer events.

          It is as wide as the canvas and mostly empty: at 1440 by 900 it is
          1416 by 55 with a fifth of that area belonging to no control at all,
          which is the gutter that clears the heading and the space between the
          statistics and the toolbar. Marked interactive, that empty space ate
          every pan and every node click that started under it. The two blocks
          inside it claim the pointer for themselves instead.
        */}
        <div
          ref={bandRef}
          data-testid="map-chrome-top"
          className={[
            'flex flex-wrap items-start justify-between gap-3',
            // The gutter exists to clear the heading. With the record open the
            // heading sits in that column, so the space would be for nothing.
            selectedSystem ? '' : 'pl-44',
          ].join(' ')}
        >
          {/*
            The tiles claim the pointer, the section does not.

            The section is a block that stretches the width its flex row gives
            it, and most of that width is the gaps between tiles and the empty
            run out to the toolbar. Marked interactive it ate every pan and
            every node click that started under it: sampling elementFromPoint
            every 40px across the band at 1440x900, the canvas was reachable
            only in the left gutter and one 40px gap, with x=200 through x=760
            belonging to a readout that has nothing to respond to a click with.
          */}
          <section
            aria-label="Map statistics"
            className="flex flex-wrap items-stretch gap-1.5"
          >
            {stats.map((stat) => (
              <div
                key={stat.label}
                role="group"
                aria-label={stat.label}
                className="pointer-events-auto flex min-w-20 flex-col rounded border border-line bg-surface/90 px-2.5 py-1.5 backdrop-blur"
              >
                <span className="tabular text-base font-semibold text-ink">{stat.value}</span>
                <span className="text-[11px] text-muted">{stat.label}</span>
              </div>
            ))}
          </section>

          <div className="pointer-events-auto ml-auto rounded border border-line bg-surface/90 p-2 backdrop-blur">
            <MapToolbar
              toggles={toggles}
              onToggle={handleToggle}
              onReset={() => {
                setExpanded(defaultExpanded(tree))
                clearSelection()
                setToggles(NO_TOGGLES)
                setOffsets({})
                setTextScale(DEFAULT_TEXT_SCALE)
                setNodeScale(DEFAULT_NODE_SCALE)
                fit()
              }}
              onExpandAll={() => {
                setExpanded(Object.fromEntries(branchIds(tree).map((id) => [id, true])))
                fit()
              }}
            />
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3">
          <MapLegendCard
            groups={groups}
            showLinks={toggles.links}
            showDesired={toggles.desired}
            riskMode={toggles.risk}
          />

          <div className="flex flex-col items-end gap-2">
            <ViewStrip
              steppers={[
                {
                  label: 'Zoom',
                  value: transform.k,
                  decreaseLabel: 'Zoom out',
                  increaseLabel: 'Zoom in',
                  onStep: (d) => zoomBy(d > 0 ? 1.3 : 1 / 1.3),
                },
                {
                  label: 'Boxes',
                  value: nodeScale,
                  decreaseLabel: 'Smaller boxes',
                  increaseLabel: 'Larger boxes',
                  onStep: (d) => setNodeScale(clamp(nodeScale + d * 0.15, NODE_MIN, NODE_MAX)),
                },
                {
                  label: 'Labels',
                  value: textScale,
                  decreaseLabel: 'Smaller labels',
                  increaseLabel: 'Larger labels',
                  onStep: (d) => setTextScale(clamp(textScale + d * 0.15, TEXT_MIN, TEXT_MAX)),
                },
              ]}
              actions={[
                {
                  label: 'Fit',
                  title: 'Fit the whole map (F)',
                  onClick: fit,
                },
                {
                  label: 'Centre',
                  title: 'Centre on the root at a legible zoom (C)',
                  onClick: centreOnRoot,
                },
              ]}
            />
            <div className="pointer-events-auto w-64 rounded border border-line bg-surface/90 p-2 backdrop-blur">
            <Minimap
              positions={positions}
              selected={selected}
              riskMode={toggles.risk}
              transform={transform}
              canvasSize={canvasSize}
              onRecenter={recenter}
            />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
