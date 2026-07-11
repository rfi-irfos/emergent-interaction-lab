import { describe, expect, it } from 'vitest'
import { describeArc, donutSegments, foldIntoOther, gaugeSweepAngle, polarToCartesian, smoothPath } from './chartMath'

describe('polarToCartesian', () => {
  it('places 0deg at 3 o\'clock (directly right of center)', () => {
    const p = polarToCartesian(50, 50, 20, 0)
    expect(p.x).toBeCloseTo(70, 5)
    expect(p.y).toBeCloseTo(50, 5)
  })
  it('places -90deg at 12 o\'clock (directly above center)', () => {
    const p = polarToCartesian(50, 50, 20, -90)
    expect(p.x).toBeCloseTo(50, 5)
    expect(p.y).toBeCloseTo(30, 5)
  })
  it('places 90deg at 6 o\'clock (directly below center) — increasing angle is clockwise', () => {
    const p = polarToCartesian(50, 50, 20, 90)
    expect(p.x).toBeCloseTo(50, 5)
    expect(p.y).toBeCloseTo(70, 5)
  })
})

// "M sx sy A rx ry x-axis-rotation large-arc-flag sweep-flag ex ey" — fixed
// token positions once split on whitespace, used below instead of a fragile
// destructure so each index is explicit about what it's checking.
const ARC = { startX: 1, startY: 2, xRot: 6, largeArc: 7, sweep: 8, endX: 9, endY: 10 }

describe('describeArc', () => {
  it('produces a valid SVG arc path string', () => {
    const d = describeArc(50, 50, 20, -90, 0)
    expect(d.startsWith('M ')).toBe(true)
    expect(d).toContain('A 20 20 0')
  })
  it('uses the small-arc flag for a span under 180deg', () => {
    const d = describeArc(0, 0, 10, -90, 0)
    expect(d.split(' ')[ARC.largeArc]).toBe('0')
  })
  it('uses the large-arc flag for a span over 180deg', () => {
    const d = describeArc(0, 0, 10, -90, 200)
    expect(d.split(' ')[ARC.largeArc]).toBe('1')
  })
  it('does not collapse to a zero-length path for a full 360deg sweep', () => {
    const d = describeArc(0, 0, 10, -90, 270)
    const parts = d.split(' ')
    // Start and end points must differ — a literal 360deg span would make
    // them coincide and the arc would silently vanish.
    expect(`${parts[ARC.startX]},${parts[ARC.startY]}`).not.toBe(`${parts[ARC.endX]},${parts[ARC.endY]}`)
  })
})

describe('donutSegments', () => {
  it('splits a 40/35/25 three-slice donut into the expected start/end angles', () => {
    const segments = donutSegments([{ value: 40 }, { value: 35 }, { value: 25 }])
    expect(segments).toHaveLength(3)

    expect(segments[0].startAngle).toBeCloseTo(-90, 5)
    expect(segments[0].endAngle).toBeCloseTo(54, 5) // -90 + 0.40*360
    expect(segments[0].pct).toBeCloseTo(0.4, 5)

    expect(segments[1].startAngle).toBeCloseTo(54, 5)
    expect(segments[1].endAngle).toBeCloseTo(180, 5) // 54 + 0.35*360
    expect(segments[1].pct).toBeCloseTo(0.35, 5)

    expect(segments[2].startAngle).toBeCloseTo(180, 5)
    expect(segments[2].endAngle).toBeCloseTo(270, 5) // 180 + 0.25*360
    expect(segments[2].pct).toBeCloseTo(0.25, 5)

    // Slices sweep a full circle between them.
    expect(segments[2].endAngle - segments[0].startAngle).toBeCloseTo(360, 5)
  })

  it('respects a custom startAngle', () => {
    const segments = donutSegments([{ value: 1 }, { value: 1 }], 0)
    expect(segments[0].startAngle).toBeCloseTo(0, 5)
    expect(segments[0].endAngle).toBeCloseTo(180, 5)
    expect(segments[1].startAngle).toBeCloseTo(180, 5)
    expect(segments[1].endAngle).toBeCloseTo(360, 5)
  })

  it('treats negative values as zero instead of producing a negative share', () => {
    const segments = donutSegments([{ value: 10 }, { value: -5 }])
    expect(segments[1].pct).toBe(0)
    expect(segments[1].startAngle).toBe(segments[1].endAngle)
  })

  it('returns zero-width slices at startAngle for an all-zero/empty input, without dividing by zero', () => {
    const segments = donutSegments([{ value: 0 }, { value: 0 }])
    expect(segments).toEqual([
      { startAngle: -90, endAngle: -90, pct: 0 },
      { startAngle: -90, endAngle: -90, pct: 0 },
    ])
    expect(donutSegments([])).toEqual([])
  })
})

describe('gaugeSweepAngle', () => {
  it('maps a mid-range fraction to its proportional share of the sweep', () => {
    expect(gaugeSweepAngle(0.5, 270)).toBeCloseTo(135, 5)
  })
  it('clamps values above 1 to the full sweep', () => {
    expect(gaugeSweepAngle(1.5, 270)).toBe(270)
    expect(gaugeSweepAngle(42, 270)).toBe(270)
  })
  it('clamps values below 0 to zero', () => {
    expect(gaugeSweepAngle(-0.3, 270)).toBe(0)
    expect(gaugeSweepAngle(-99, 270)).toBe(0)
  })
  it('falls back to zero for non-finite input (NaN/Infinity) rather than propagating garbage', () => {
    expect(gaugeSweepAngle(NaN, 270)).toBe(0)
    expect(gaugeSweepAngle(Infinity, 270)).toBe(0)
    expect(gaugeSweepAngle(-Infinity, 270)).toBe(0)
  })
  it('uses the default 270deg sweep when sweepDeg is omitted', () => {
    expect(gaugeSweepAngle(1)).toBe(270)
    expect(gaugeSweepAngle(0)).toBe(0)
  })
})

describe('foldIntoOther', () => {
  it('leaves the list untouched when at or under the ceiling', () => {
    const items = [{ label: 'a', value: 3 }, { label: 'b', value: 1 }]
    expect(foldIntoOther(items, 6)).toEqual(items)
  })
  it('folds the tail beyond the ceiling into a single Andere bucket, keeping the top entries by value', () => {
    const items = [
      { label: 'a', value: 10 }, { label: 'b', value: 9 }, { label: 'c', value: 8 },
      { label: 'd', value: 1 }, { label: 'e', value: 1 }, { label: 'f', value: 1 }, { label: 'g', value: 1 },
    ]
    const folded = foldIntoOther(items, 4)
    expect(folded).toEqual([
      { label: 'a', value: 10 }, { label: 'b', value: 9 }, { label: 'c', value: 8 },
      { label: 'Andere', value: 4 },
    ])
  })
  it('supports a custom Other label', () => {
    const items = [{ label: 'a', value: 1 }, { label: 'b', value: 1 }, { label: 'c', value: 1 }]
    const folded = foldIntoOther(items, 2, 'Sonstige')
    expect(folded[folded.length - 1]).toEqual({ label: 'Sonstige', value: 2 })
  })
})

describe('smoothPath (moved from ObsChart.tsx)', () => {
  it('returns an empty string for no points', () => {
    expect(smoothPath([])).toBe('')
  })
  it('returns a bare moveto for a single point', () => {
    expect(smoothPath([{ x: 5, y: 7 }])).toBe('M 5,7')
  })
  it('produces one cubic Bézier segment per point pair, starting with a moveto', () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }])
    expect(d.startsWith('M 0,0')).toBe(true)
    expect(d.match(/C /g)?.length).toBe(2)
  })
})
