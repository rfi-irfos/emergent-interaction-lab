import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRID_COLS,
  clampToGrid,
  layout,
  rectsOverlap,
  resolveOverlaps,
  type PlacedWidget,
  type UnplacedWidget,
} from './dashboardLayout'

describe('layout', () => {
  it('flows widgets left-to-right on an empty board', () => {
    const incoming: UnplacedWidget[] = [
      { id: 'a', w: 4, h: 3 },
      { id: 'b', w: 4, h: 3 },
      { id: 'c', w: 4, h: 3 },
    ]
    const result = layout([], incoming, 12)
    expect(result).toEqual([
      { id: 'a', x: 0, y: 0, w: 4, h: 3 },
      { id: 'b', x: 4, y: 0, w: 4, h: 3 },
      { id: 'c', x: 8, y: 0, w: 4, h: 3 },
    ])
  })

  it('wraps to a new row when the next widget would overflow the column count', () => {
    const incoming: UnplacedWidget[] = [
      { id: 'a', w: 5, h: 3 },
      { id: 'b', w: 5, h: 4 }, // row so far: 10/12, tallest so far = 4
      { id: 'c', w: 5, h: 2 }, // 10+5=15 > 12 -> wraps to a new row at y = 4
    ]
    const result = layout([], incoming, 12)
    expect(result[0]).toEqual({ id: 'a', x: 0, y: 0, w: 5, h: 3 })
    expect(result[1]).toEqual({ id: 'b', x: 5, y: 0, w: 5, h: 4 })
    expect(result[2]).toEqual({ id: 'c', x: 0, y: 4, w: 5, h: 2 })
  })

  it('exactly-fitting widgets (sum === gridCols) share a row without a spurious wrap', () => {
    const incoming: UnplacedWidget[] = [
      { id: 'a', w: 6, h: 2 },
      { id: 'b', w: 6, h: 2 },
    ]
    const result = layout([], incoming, 12)
    expect(result[0]).toEqual({ id: 'a', x: 0, y: 0, w: 6, h: 2 })
    expect(result[1]).toEqual({ id: 'b', x: 6, y: 0, w: 6, h: 2 })
  })

  it('leaves existing widgets completely untouched and flows incoming ones below them', () => {
    const existing: PlacedWidget[] = [
      { id: 'existing-1', x: 0, y: 0, w: 4, h: 3 },
      { id: 'existing-2', x: 4, y: 0, w: 8, h: 5 }, // tallest bottom edge = 5
    ]
    const incoming: UnplacedWidget[] = [{ id: 'new-1', w: 4, h: 2 }]
    const result = layout(existing, incoming, 12)
    expect(result[0]).toBe(existing[0]) // same values, untouched (not just equal)
    expect(result[1]).toBe(existing[1])
    expect(result[2]).toEqual({ id: 'new-1', x: 0, y: 5, w: 4, h: 2 })
  })

  it('clamps a widget wider than the grid itself instead of producing a negative remainder', () => {
    const incoming: UnplacedWidget[] = [
      { id: 'too-wide', w: 20, h: 3 },
      { id: 'after', w: 4, h: 2 },
    ]
    const result = layout([], incoming, 12)
    expect(result[0]).toEqual({ id: 'too-wide', x: 0, y: 0, w: 12, h: 3 })
    // The next widget must wrap cleanly to its own row, never land at a
    // negative x or overlap the clamped full-width widget.
    expect(result[1]).toEqual({ id: 'after', x: 0, y: 3, w: 4, h: 2 })
    expect(result[1].x).toBeGreaterThanOrEqual(0)
  })

  it('defaults to DEFAULT_GRID_COLS when gridCols is omitted', () => {
    const incoming: UnplacedWidget[] = [{ id: 'a', w: DEFAULT_GRID_COLS, h: 2 }]
    const result = layout([], incoming)
    expect(result[0].w).toBe(DEFAULT_GRID_COLS)
  })

  it('treats non-finite or non-positive widget dimensions defensively (falls back to 1, never 0/negative/NaN)', () => {
    const incoming: UnplacedWidget[] = [
      { id: 'zero-w', w: 0, h: 3 },
      { id: 'negative-h', w: 4, h: -5 },
      { id: 'nan-w', w: NaN, h: 2 },
    ]
    const result = layout([], incoming, 12)
    for (const widget of result) {
      expect(widget.w).toBeGreaterThan(0)
      expect(widget.h).toBeGreaterThan(0)
      expect(Number.isFinite(widget.w)).toBe(true)
      expect(Number.isFinite(widget.h)).toBe(true)
    }
  })

  it('is a no-op append when incoming is empty', () => {
    const existing: PlacedWidget[] = [{ id: 'a', x: 0, y: 0, w: 4, h: 3 }]
    expect(layout(existing, [], 12)).toEqual(existing)
  })
})

describe('clampToGrid', () => {
  it('leaves an already on-grid rect unchanged', () => {
    expect(clampToGrid({ x: 2, y: 3, w: 4, h: 2 }, 12)).toEqual({ x: 2, y: 3, w: 4, h: 2 })
  })

  it('caps width to the grid column count and pulls x back onto the grid', () => {
    const clamped = clampToGrid({ x: 10, y: 0, w: 8, h: 2 }, 12)
    expect(clamped.w).toBe(8)
    expect(clamped.x).toBe(4) // 10 -> pulled back so x+w (12) never exceeds gridCols
  })

  it('clamps negative x/y up to 0', () => {
    const clamped = clampToGrid({ x: -5, y: -10, w: 4, h: 2 }, 12)
    expect(clamped.x).toBe(0)
    expect(clamped.y).toBe(0)
  })
})

describe('rectsOverlap', () => {
  it('detects a genuine overlap', () => {
    expect(rectsOverlap({ id: 'a', x: 0, y: 0, w: 4, h: 3 }, { id: 'b', x: 2, y: 1, w: 4, h: 3 })).toBe(true)
  })

  it('does not count merely touching edges as an overlap', () => {
    expect(rectsOverlap({ id: 'a', x: 0, y: 0, w: 4, h: 3 }, { id: 'b', x: 4, y: 0, w: 4, h: 3 })).toBe(false)
    expect(rectsOverlap({ id: 'a', x: 0, y: 0, w: 4, h: 3 }, { id: 'b', x: 0, y: 3, w: 4, h: 3 })).toBe(false)
  })

  it('returns false for widgets that are simply far apart', () => {
    expect(rectsOverlap({ id: 'a', x: 0, y: 0, w: 2, h: 2 }, { id: 'b', x: 10, y: 10, w: 2, h: 2 })).toBe(false)
  })
})

describe('resolveOverlaps', () => {
  it('is a no-op on an already non-overlapping layout — nothing moves that does not need to', () => {
    const widgets: PlacedWidget[] = [
      { id: 'a', x: 0, y: 0, w: 4, h: 3 },
      { id: 'b', x: 4, y: 0, w: 4, h: 3 },
      { id: 'c', x: 0, y: 3, w: 8, h: 2 },
    ]
    expect(resolveOverlaps(widgets, 12)).toEqual(widgets)
  })

  it('pushes the later (in sweep order) of two overlapping widgets straight down', () => {
    const widgets: PlacedWidget[] = [
      { id: 'a', x: 0, y: 0, w: 4, h: 3 }, // occupies y 0-3
      { id: 'b', x: 0, y: 1, w: 4, h: 3 }, // overlaps a; sorts after a (larger y)
    ]
    const result = resolveOverlaps(widgets, 12)
    const a = result.find(w => w.id === 'a')!
    const b = result.find(w => w.id === 'b')!
    expect(a).toEqual({ id: 'a', x: 0, y: 0, w: 4, h: 3 }) // untouched: it was first in sweep order
    expect(b.y).toBe(3) // pushed down to sit directly below a
    expect(rectsOverlap(a, b)).toBe(false)
  })

  it('pushes a widget down out of a same-row horizontal overlap (never sideways)', () => {
    const widgets: PlacedWidget[] = [
      { id: 'a', x: 0, y: 0, w: 6, h: 3 },
      { id: 'b', x: 4, y: 0, w: 6, h: 3 }, // overlaps a horizontally at the same y; x=4 > a.x=0 so sorts after a
    ]
    const result = resolveOverlaps(widgets, 12)
    const a = result.find(w => w.id === 'a')!
    const b = result.find(w => w.id === 'b')!
    expect(a).toEqual({ id: 'a', x: 0, y: 0, w: 6, h: 3 })
    expect(b.x).toBe(4) // x is never touched by resolveOverlaps
    expect(b.y).toBe(3)
    expect(rectsOverlap(a, b)).toBe(false)
  })

  it('cascades: resolving an overlap with the first widget can create a new overlap with a third, which also gets resolved', () => {
    // a: y 0-3. b: y 1-4, overlaps a -> pushed to y 3-6.
    // c: originally y 3-5 (h=2) — doesn't overlap a's 0-3, but *does* overlap
    // b once b has been pushed down to 3-6 (3 < 6 && 3 < 5) -> cascades.
    const widgets: PlacedWidget[] = [
      { id: 'a', x: 0, y: 0, w: 4, h: 3 },
      { id: 'b', x: 0, y: 1, w: 4, h: 3 },
      { id: 'c', x: 0, y: 3, w: 4, h: 2 },
    ]
    const result = resolveOverlaps(widgets, 12)
    const a = result.find(w => w.id === 'a')!
    const b = result.find(w => w.id === 'b')!
    const c = result.find(w => w.id === 'c')!

    expect(a).toEqual({ id: 'a', x: 0, y: 0, w: 4, h: 3 })
    expect(b.y).toBe(3)
    expect(c.y).toBe(6) // pushed past b's new (post-cascade) footprint, not just past b's original position

    // Every pair in the final layout must be genuinely non-overlapping.
    expect(rectsOverlap(a, b)).toBe(false)
    expect(rectsOverlap(a, c)).toBe(false)
    expect(rectsOverlap(b, c)).toBe(false)
  })

  it('normalizes an off-grid rect (negative x, width over gridCols) before resolving overlaps', () => {
    const widgets: PlacedWidget[] = [{ id: 'a', x: -3, y: 0, w: 20, h: 2 }]
    const result = resolveOverlaps(widgets, 12)
    expect(result[0].x).toBe(0)
    expect(result[0].w).toBe(12)
  })

  it('terminates and produces a fully non-overlapping layout on a worst-case, maximally-overlapping stress input', () => {
    // 40 widgets, all initially placed at the exact same (x, y) with the
    // exact same size — the worst case for cascade depth: every widget
    // overlaps every other widget at the start. This is the scenario the
    // termination proof in dashboardLayout.ts is written against; if the
    // bound were wrong this would hang (and vitest's own test timeout would
    // catch that) rather than merely being slow.
    const N = 40
    const widgets: PlacedWidget[] = Array.from({ length: N }, (_, i) => ({
      id: `w${i}`,
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    }))

    const start = Date.now()
    const result = resolveOverlaps(widgets, 12)
    const elapsedMs = Date.now() - start

    expect(result).toHaveLength(N)
    // Strongest possible proof of correct termination: not just "it
    // returned," but the returned layout is actually, fully non-overlapping
    // — an O(N^2) pairwise check over the *result*, independent of however
    // resolveOverlaps got there.
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        expect(rectsOverlap(result[i], result[j])).toBe(false)
      }
    }
    // Comfortably fast, not just "eventually" bounded — a genuine hang or
    // near-exponential blowup would blow well past this.
    expect(elapsedMs).toBeLessThan(2000)
  })

  it('defaults to DEFAULT_GRID_COLS when gridCols is omitted', () => {
    const widgets: PlacedWidget[] = [{ id: 'a', x: 0, y: 0, w: 20, h: 2 }]
    const result = resolveOverlaps(widgets)
    expect(result[0].w).toBe(DEFAULT_GRID_COLS)
  })
})
