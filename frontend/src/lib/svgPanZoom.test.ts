import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  clampPanToBounds,
  clampZoomLevel,
  panViewBox,
  screenDeltaToSvgDelta,
  screenToSvgPoint,
  viewBoxToString,
  zoomLevelOf,
  zoomViewBox,
  type ViewBox,
} from './svgPanZoom'

const BASE: ViewBox = { x: 0, y: 0, w: 600, h: 460 }

describe('clampZoomLevel', () => {
  it('passes values inside the range through unchanged', () => {
    expect(clampZoomLevel(3, 1, 6)).toBe(3)
  })
  it('clamps below the minimum', () => {
    expect(clampZoomLevel(0.2, 1, 6)).toBe(1)
  })
  it('clamps above the maximum', () => {
    expect(clampZoomLevel(50, 1, 6)).toBe(6)
  })
  it('falls back to the minimum for non-finite input', () => {
    expect(clampZoomLevel(NaN, 1, 6)).toBe(1)
    expect(clampZoomLevel(Infinity, 1, 6)).toBe(1)
  })
})

describe('zoomViewBox', () => {
  it('zooming in shrinks the viewBox and raises the zoom level', () => {
    const next = zoomViewBox(BASE, BASE, 1.15, 300, 230)
    expect(next.w).toBeLessThan(BASE.w)
    expect(next.h).toBeLessThan(BASE.h)
    expect(zoomLevelOf(next, BASE)).toBeCloseTo(1.15, 5)
  })

  it('never zooms in past DEFAULT_MAX_ZOOM no matter how many wheel ticks are applied', () => {
    let vb = BASE
    for (let i = 0; i < 200; i++) {
      vb = zoomViewBox(vb, BASE, 1.15, 300, 230)
    }
    expect(zoomLevelOf(vb, BASE)).toBeLessThanOrEqual(DEFAULT_MAX_ZOOM + 1e-9)
    expect(zoomLevelOf(vb, BASE)).toBeCloseTo(DEFAULT_MAX_ZOOM, 5)
  })

  it('never zooms out past the original (base) view — can\'t zoom "past the original view"', () => {
    let vb = zoomViewBox(BASE, BASE, 1.15, 300, 230) // zoom in once first
    for (let i = 0; i < 200; i++) {
      vb = zoomViewBox(vb, BASE, 1 / 1.15, 300, 230)
    }
    expect(zoomLevelOf(vb, BASE)).toBeGreaterThanOrEqual(DEFAULT_MIN_ZOOM - 1e-9)
    expect(vb.w).toBeLessThanOrEqual(BASE.w + 1e-9)
    expect(vb.h).toBeLessThanOrEqual(BASE.h + 1e-9)
  })

  it('respects custom min/max zoom bounds', () => {
    let vb = BASE
    for (let i = 0; i < 50; i++) vb = zoomViewBox(vb, BASE, 1.15, 300, 230, 1, 2)
    expect(zoomLevelOf(vb, BASE)).toBeLessThanOrEqual(2 + 1e-9)
  })

  it('keeps the focus point stable (zoom toward cursor, not toward the corner)', () => {
    const focusX = 450
    const focusY = 100
    const before = screenFractionOfPoint(BASE, focusX, focusY)
    const after = zoomViewBox(BASE, BASE, 1.15, focusX, focusY)
    const afterFraction = screenFractionOfPoint(after, focusX, focusY)
    expect(afterFraction.fx).toBeCloseTo(before.fx, 5)
    expect(afterFraction.fy).toBeCloseTo(before.fy, 5)
  })
})

function screenFractionOfPoint(vb: ViewBox, px: number, py: number) {
  return { fx: (px - vb.x) / vb.w, fy: (py - vb.y) / vb.h }
}

describe('panViewBox', () => {
  it('translates x/y by the given SVG-space delta', () => {
    const next = panViewBox(BASE, 20, -10, BASE)
    expect(next.x).toBeCloseTo(BASE.x - 20, 9)
    expect(next.y).toBeCloseTo(BASE.y - -10, 9)
  })

  it('does not drift or lose precision over many round-trip pan operations', () => {
    let vb: ViewBox = { x: 50, y: 30, w: 300, h: 230 } // an already-zoomed-in view, well inside pan bounds
    const start = { x: vb.x, y: vb.y }
    for (let i = 0; i < 1000; i++) {
      vb = panViewBox(vb, 3.3, -1.7, BASE)
      vb = panViewBox(vb, -3.3, 1.7, BASE)
    }
    expect(vb.x).toBeCloseTo(start.x, 6)
    expect(vb.y).toBeCloseTo(start.y, 6)
    expect(vb.w).toBe(300)
    expect(vb.h).toBe(230)
  })

  it('clamps panning so the view cannot drift infinitely far from the canvas', () => {
    let vb = BASE
    for (let i = 0; i < 500; i++) vb = panViewBox(vb, 10000, 10000, BASE)
    // Bounded by clampPanToBounds' margin (one base width/height), not unbounded.
    expect(vb.x).toBeGreaterThanOrEqual(BASE.x - BASE.w - 1e-6)
    expect(vb.y).toBeGreaterThanOrEqual(BASE.y - BASE.h - 1e-6)
  })
})

describe('clampPanToBounds', () => {
  it('leaves an in-bounds viewBox untouched', () => {
    const vb: ViewBox = { x: 50, y: 40, w: 300, h: 230 }
    expect(clampPanToBounds(vb, BASE)).toEqual(vb)
  })

  it('pulls an out-of-bounds viewBox back within the margin', () => {
    const vb: ViewBox = { x: -100000, y: -100000, w: 300, h: 230 }
    const clamped = clampPanToBounds(vb, BASE)
    expect(clamped.x).toBeGreaterThan(vb.x)
    expect(clamped.y).toBeGreaterThan(vb.y)
  })
})

describe('screenToSvgPoint / screenDeltaToSvgDelta', () => {
  const rect = { left: 100, top: 50, width: 300, height: 230 } // half-scale render of BASE

  it('maps a screen point to SVG space using the current viewBox scale', () => {
    const p = screenToSvgPoint(BASE, rect, 100, 50) // top-left corner of the rendered rect
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(0, 6)

    const center = screenToSvgPoint(BASE, rect, 250, 165) // rect center
    expect(center.x).toBeCloseTo(300, 6)
    expect(center.y).toBeCloseTo(230, 6)
  })

  it('scales a screen-space delta into SVG-space using the same ratio', () => {
    const { dx, dy } = screenDeltaToSvgDelta(BASE, rect, 30, 23)
    // rect is a half-scale render of BASE (300/600, 230/460), so a 30px/23px
    // screen delta should double to a 60/46 SVG-space delta.
    expect(dx).toBeCloseTo(60, 6)
    expect(dy).toBeCloseTo(46, 6)
  })

  it('does not divide by zero when the rect has not been measured yet (width/height 0)', () => {
    const p = screenToSvgPoint(BASE, { left: 0, top: 0, width: 0, height: 0 }, 10, 10)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })
})

describe('viewBoxToString', () => {
  it('formats as a valid SVG viewBox attribute value', () => {
    expect(viewBoxToString(BASE)).toBe('0 0 600 460')
    expect(viewBoxToString({ x: 12.5, y: -3, w: 100, h: 80 })).toBe('12.5 -3 100 80')
  })
})
