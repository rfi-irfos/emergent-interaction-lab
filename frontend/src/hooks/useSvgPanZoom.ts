import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  PAN_DRAG_THRESHOLD,
  WHEEL_ZOOM_STEP,
  panViewBox,
  screenDeltaToSvgDelta,
  screenToSvgPoint,
  viewBoxToString,
  zoomLevelOf,
  zoomViewBox,
  type ViewBox,
} from '../lib/svgPanZoom'

export interface UseSvgPanZoomOptions {
  minZoom?: number
  maxZoom?: number
}

/// Hand-rolled SVG viewBox zoom/pan, shared by KnowledgeGraph and SystemMap
/// so the math (see lib/svgPanZoom.ts) lives in exactly one place. Wheel
/// zooms toward the cursor, pointer-drag pans, a `resetView`/`relayout`
/// pair drives the reset-view button and the "re-layout" action.
///
/// `base` must be a referentially stable ViewBox (e.g. a module-level
/// constant) — it's used as a dependency for the wheel listener and the
/// reset/relayout callbacks, and isn't deep-compared on every render.
export function useSvgPanZoom(base: ViewBox, options: UseSvgPanZoomOptions = {}) {
  const minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM
  const maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM

  const [viewBox, setViewBox] = useState<ViewBox>(base)
  const [isPanning, setIsPanning] = useState(false)
  const [layoutKey, setLayoutKey] = useState(0)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // Set true for one tick after a drag that actually moved the view, so the
  // click that naturally follows pointerup doesn't also fire a node's
  // onClick (which would otherwise pop the detail panel open every time you
  // release a pan over a node).
  const justPannedRef = useRef(false)

  // React attaches onWheel as a passive listener by default, so
  // e.preventDefault() inside a JSX handler silently no-ops (and warns) —
  // the page would scroll underneath the zoom. A manual, non-passive
  // addEventListener is the only reliable way to stop that.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      setViewBox(vb => {
        const focus = screenToSvgPoint(vb, rect, e.clientX, e.clientY)
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
        return zoomViewBox(vb, base, factor, focus.x, focus.y, minZoom, maxZoom)
      })
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
  }, [base, minZoom, maxZoom])

  const resetView = useCallback(() => setViewBox(base), [base])

  // "Adjust/readjust": the radial-trig layout is already deterministic (no
  // physics sim to re-settle), so there's nothing to recompute numerically —
  // this resets the view and bumps `layoutKey`, which callers use as a React
  // `key` on the node group to force a remount, replaying the entrance
  // (sprout/hud-card-in) animation as visible "readjust" feedback.
  const relayout = useCallback(() => {
    setViewBox(base)
    setLayoutKey(k => k + 1)
  }, [base])

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false }
    setIsPanning(true)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    const svg = svgRef.current
    if (!drag || !svg) return
    const dxScreen = e.clientX - drag.x
    const dyScreen = e.clientY - drag.y
    if (!drag.moved && Math.abs(dxScreen) + Math.abs(dyScreen) > PAN_DRAG_THRESHOLD) drag.moved = true
    dragRef.current = { x: e.clientX, y: e.clientY, moved: drag.moved }
    const rect = svg.getBoundingClientRect()
    setViewBox(vb => {
      const { dx, dy } = screenDeltaToSvgDelta(vb, rect, dxScreen, dyScreen)
      return panViewBox(vb, dx, dy, base)
    })
  }, [base])

  const endDrag = useCallback(() => {
    if (dragRef.current?.moved) {
      justPannedRef.current = true
      setTimeout(() => { justPannedRef.current = false }, 0)
    }
    dragRef.current = null
    setIsPanning(false)
  }, [])

  const onClickCapture = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (justPannedRef.current) {
      e.stopPropagation()
      e.preventDefault()
    }
  }, [])

  return {
    svgRef,
    viewBox,
    viewBoxStr: viewBoxToString(viewBox),
    zoomLevel: zoomLevelOf(viewBox, base),
    isPanning,
    layoutKey,
    resetView,
    relayout,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onPointerLeave: endDrag,
    onClickCapture,
  }
}
