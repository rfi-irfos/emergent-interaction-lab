// Pure viewBox math for hand-rolled SVG zoom/pan — no charting/graph library
// exists in this codebase (see ObsChart.tsx's own "pure inline SVG, no
// library" comment) and the plan is not to add one. This module holds only
// the arithmetic (no DOM, no React) so it can be unit-tested directly; the
// companion hook (`hooks/useSvgPanZoom.ts`) wires it to pointer/wheel events
// and React state.

export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

export const DEFAULT_MIN_ZOOM = 1
export const DEFAULT_MAX_ZOOM = 6
export const WHEEL_ZOOM_STEP = 1.15
export const PAN_DRAG_THRESHOLD = 4

/// zoomLevel is defined relative to `base` (the original, fully-zoomed-out
/// view): 1 == base.w/h exactly (can't zoom out further), higher == zoomed
/// in. Clamping here is what stops the wheel from zooming "into nothing"
/// (runaway small viewBox) or past the original view on the way out.
export function clampZoomLevel(zoom: number, min: number = DEFAULT_MIN_ZOOM, max: number = DEFAULT_MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return min
  return Math.min(max, Math.max(min, zoom))
}

export function zoomLevelOf(viewBox: ViewBox, base: ViewBox): number {
  return base.w / viewBox.w
}

/// Keeps the viewBox from being dragged arbitrarily far off the canvas.
///
/// The margin scales with how far zoomed IN the view currently is, rather
/// than being a fixed `base.w`/`base.h` allowance regardless of zoom level.
/// At exactly 100% zoom (`viewBox.w === base.w`), the margin is 0 — pan is
/// fully locked to `base.x`/`base.y` — because the whole deterministically
/// laid-out graph already fits in that one view; there is nothing further
/// to reveal by panning. A fixed generous margin here previously let an
/// accidental drag/trackpad-scroll push real content (e.g. KnowledgeGraph's
/// leftmost nodes) off the edge of the viewBox with no zoom change to
/// explain it — confirmed via a real screenshot showing left-side node
/// labels cut off mid-word at 100% zoom. The margin grows proportionally
/// once actually zoomed in, so panning around a zoomed-in view still works
/// exactly as before.
export function clampPanToBounds(viewBox: ViewBox, base: ViewBox): ViewBox {
  const zoomedInFractionX = Math.max(0, 1 - viewBox.w / base.w)
  const zoomedInFractionY = Math.max(0, 1 - viewBox.h / base.h)
  const marginX = base.w * zoomedInFractionX
  const marginY = base.h * zoomedInFractionY
  const minX = base.x - marginX
  const maxX = base.x + base.w + marginX - viewBox.w
  const minY = base.y - marginY
  const maxY = base.y + base.h + marginY - viewBox.h
  return {
    ...viewBox,
    x: Math.min(Math.max(viewBox.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(viewBox.y, minY), Math.max(minY, maxY)),
  }
}

/// Zooms `current` by `factor` (>1 zooms in, <1 zooms out) while keeping the
/// SVG-space point (focusX, focusY) — the cursor position — visually fixed,
/// the standard "zoom toward the cursor" feel.
export function zoomViewBox(
  current: ViewBox,
  base: ViewBox,
  factor: number,
  focusX: number,
  focusY: number,
  min: number = DEFAULT_MIN_ZOOM,
  max: number = DEFAULT_MAX_ZOOM,
): ViewBox {
  const currentZoom = zoomLevelOf(current, base)
  const nextZoom = clampZoomLevel(currentZoom * factor, min, max)
  const w = base.w / nextZoom
  const h = base.h / nextZoom
  const x = focusX - (focusX - current.x) * (w / current.w)
  const y = focusY - (focusY - current.y) * (h / current.h)
  return clampPanToBounds({ x, y, w, h }, base)
}

export function panViewBox(current: ViewBox, dxSvg: number, dySvg: number, base: ViewBox): ViewBox {
  return clampPanToBounds({ ...current, x: current.x - dxSvg, y: current.y - dySvg }, base)
}

export function screenToSvgPoint(
  viewBox: ViewBox,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const width = rect.width || 1
  const height = rect.height || 1
  return {
    x: viewBox.x + (clientX - rect.left) * (viewBox.w / width),
    y: viewBox.y + (clientY - rect.top) * (viewBox.h / height),
  }
}

export function screenDeltaToSvgDelta(
  viewBox: ViewBox,
  rect: { width: number; height: number },
  dxScreen: number,
  dyScreen: number,
): { dx: number; dy: number } {
  const width = rect.width || 1
  const height = rect.height || 1
  return { dx: dxScreen * (viewBox.w / width), dy: dyScreen * (viewBox.h / height) }
}

export function viewBoxToString(viewBox: ViewBox): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`
}
