// Pure grid-layout math for the customizable dashboard canvas (plan §A2,
// Phase 6b) — no DOM, no React, plain {id,x,y,w,h}-shaped data in and out, so
// it's unit-testable in isolation and reusable from both the "+ Widget" add
// flow and a live drag/resize handler in Phase 6c. Same separation-of-concerns
// precedent already established by `lib/svgPanZoom.ts` (viewBox arithmetic)
// and `lib/chartMath.ts` (chart geometry): the DOM-facing canvas component
// (`components/dashboard/DashboardCanvas.tsx`, Phase 6c) will wire this to
// pointer events and React state, but owns none of the actual math itself.
//
// Grid units, not pixels: every `x`/`y`/`w`/`h` here is an integer-ish grid
// cell, matching the backend's `dashboard_widgets.position_x/position_y/
// width/height` columns 1:1 (see `backend/src/dashboards.rs`'s `WidgetOut`)
// — the canvas component owns the cells→pixels conversion (a fixed column
// width + row height), this file never touches a pixel value.

/// A widget already placed on the grid. `id` round-trips a widget through
/// `layout`/`resolveOverlaps` so a caller can map results back onto its own
/// widget list (e.g. to build PATCH bodies) without re-deriving identity
/// from array position.
export interface PlacedWidget {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/// A widget that has a size but no position yet — exactly the shape
/// available right after a catalog pick in the "+ Widget" modal (Phase 6c):
/// the catalog entry supplies a default `w`/`h`, but where it lands depends
/// on what's already on the canvas, which is `layout`'s job to decide.
export interface UnplacedWidget {
  id: string
  w: number
  h: number
}

export const DEFAULT_GRID_COLS = 12

/// Defensive numeric clamp shared by every function below — mirrors the
/// non-finite/out-of-range guards `chartMath.ts` already applies
/// (`gaugeSweepAngle`, `radarPoint`): nothing upstream (a stale prop, a
/// division that produced NaN, a hand-edited widget row) guarantees a grid
/// dimension actually stays finite and positive.
function clampDimension(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/// Clamps a widget's rect onto the fixed-width grid: `w` is capped to the
/// grid's own column count (a widget can never be wider than the grid), then
/// `x` is pulled back so the widget's right edge never runs past the last
/// column. `y`/`h` are only defended against non-finite/negative input —
/// the grid has no fixed row count to clamp against vertically, dashboards
/// scroll down indefinitely.
///
/// Exported (not kept private to this module) because Phase 6c's live
/// drag/resize handler needs this exact same clamp while the user is still
/// dragging — not only once `resolveOverlaps` runs on mouseup.
export function clampToGrid(rect: { x: number; y: number; w: number; h: number }, gridCols: number = DEFAULT_GRID_COLS): { x: number; y: number; w: number; h: number } {
  const cols = clampDimension(gridCols, 1, Number.POSITIVE_INFINITY)
  const w = clampDimension(rect.w, 1, cols)
  const h = clampDimension(rect.h, 1, Number.POSITIVE_INFINITY)
  const x = Math.min(Math.max(0, Number.isFinite(rect.x) ? rect.x : 0), cols - w)
  const y = Math.max(0, Number.isFinite(rect.y) ? rect.y : 0)
  return { x, y, w, h }
}

/// Flows `incoming` widgets onto the grid, left-to-right/top-to-bottom, and
/// returns `existing` (verbatim, untouched, in the same order) followed by
/// the now-placed incoming ones. This is a simple line/row flow — like
/// inline text wrapping — not a hole-filling bin-packer: it never searches
/// for gaps *within* the existing layout, it only appends new rows starting
/// directly under the lowest existing widget's bottom edge. That's a
/// deliberate right-sized choice (same "right-sized, not verbatim" call
/// `dashboards.rs`'s own doc comment already made for this feature's
/// backend half) — a real masonry packer is more machinery than a dashboard
/// canvas with a handful of widgets needs, and it would make placement
/// significantly harder for a user to predict.
///
/// Splitting `existing`/`incoming` into two params (rather than one array
/// with a "some already have valid positions" convention) is deliberate: it
/// matches the two real calls Phase 6c actually needs to make —
/// (1) the "+ Widget" modal has exactly one brand-new widget with a size but
/// no position yet, and needs the rest of the canvas left untouched:
/// `layout(currentWidgets, [newWidget], gridCols)`; and
/// (2) an "auto-arrange" that recomputes every position from scratch just
/// re-flows the whole board: `layout([], allWidgetsInOrder, gridCols)`.
/// Neither call needs a sentinel "no position yet" value smuggled through a
/// single shared shape.
///
/// A widget wider than the grid itself is clamped to the grid's column
/// count (see `clampToGrid`) rather than allowed to overflow or produce a
/// negative leftover-width remainder on the row after it.
export function layout(existing: PlacedWidget[], incoming: UnplacedWidget[], gridCols: number = DEFAULT_GRID_COLS): PlacedWidget[] {
  const cols = clampDimension(gridCols, 1, Number.POSITIVE_INFINITY)

  let cursorX = 0
  let cursorY = existing.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0)
  let rowHeight = 0

  const placed: PlacedWidget[] = []
  for (const widget of incoming) {
    const w = clampDimension(widget.w, 1, cols)
    const h = clampDimension(widget.h, 1, Number.POSITIVE_INFINITY)

    // Wrap before placing if this widget would overflow the row — but never
    // wrap an empty row (cursorX === 0) even for an over-wide widget, since
    // it's already been clamped to fit exactly one full row above.
    if (cursorX > 0 && cursorX + w > cols) {
      cursorY += rowHeight
      cursorX = 0
      rowHeight = 0
    }

    placed.push({ id: widget.id, x: cursorX, y: cursorY, w, h })
    cursorX += w
    rowHeight = Math.max(rowHeight, h)
  }

  return [...existing, ...placed]
}

/// AABB overlap test on two grid rects, using half-open intervals
/// (`[x, x+w)`) so widgets that merely touch edges — one ending exactly
/// where another begins — never count as overlapping. Exported alongside
/// the two core functions since Phase 6c's live drag preview plausibly wants
/// the same test to decide whether to render a "this would overlap" hint
/// before the user releases the drag.
export function rectsOverlap(a: PlacedWidget, b: PlacedWidget): boolean {
  const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w
  const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h
  return xOverlap && yOverlap
}

/// Given a set of widgets where one or more may have just been moved/resized
/// (and may now overlap others), sweeps top-to-bottom/left-to-right and
/// pushes each colliding widget straight down until nothing overlaps.
/// Only `y` is ever changed — `x`/`w` are left alone (aside from the
/// defensive on-grid clamp below), matching the spec's "pushes colliding
/// widgets down," never sideways.
///
/// ## Why the sweep order alone is enough to prioritize "the widget the user
/// just dropped"
/// Widgets are processed in a fixed order — sorted by `y` ascending, then
/// `x` ascending, with original array order as the final tiebreak (`Array
/// #sort` is a stable sort per spec, so equal `(y,x)` pairs keep their
/// relative input order for free, no explicit index comparator needed). A
/// widget the user just dragged to a new spot naturally sorts by its *new*
/// position, so if it's now the topmost/leftmost of an overlapping pair it
/// is processed first and stays exactly where it was dropped; anything it
/// now overlaps sorts later and gets pushed out of its way. No separate
/// "which widget is pinned" parameter is needed.
///
/// ## Correctness — every pair ends up non-overlapping
/// Invariant: after processing sweep position `k`, the widgets at
/// `sweepOrder[0..k]` are pairwise non-overlapping.
/// - Base case (`k = 0`): a single widget is vacuously non-overlapping with
///   itself (no pairs to check).
/// - Inductive step: assume the invariant holds through `k - 1`. Processing
///   `sweepOrder[k]` (call it `current`) only ever mutates `current`'s own
///   `y` — every earlier widget in the sweep is left untouched from this
///   point forward (mutation is always confined to the widget whose sweep
///   turn it currently is). The inner loop below re-checks `current`
///   against *all* of `sweepOrder[0..k-1]` and pushes it down whenever it
///   still overlaps one of them, repeating until a full pass finds zero
///   overlaps. When that loop exits, `current` overlaps none of
///   `sweepOrder[0..k-1]` — combined with the inductive hypothesis (that set
///   was already pairwise non-overlapping, and is now frozen), the widgets
///   at `sweepOrder[0..k]` are pairwise non-overlapping too.
/// By induction this holds for every `k` up to the last sweep position, so
/// the full returned set is pairwise non-overlapping.
///
/// ## Termination — provably bounded, not just "hasn't hung in testing"
/// Within a single widget's inner loop: each pass either finds zero
/// overlaps against its (at most `sweepPos`) earlier, already-settled
/// neighbors and exits, or it pushes `current.y` to `other.y + other.h` for
/// some overlapping `other`. That push is strictly increasing (`newY` is
/// only ever applied when `newY > current.y`), and once
/// `current.y >= other.y + other.h`, `current` can *never* overlap that same
/// `other` again — `other`'s own `y`/`h` are frozen (see above), and
/// `current.y` only ever grows further. So every pass that makes a change
/// permanently resolves at least one distinct earlier-widget overlap, and
/// there are at most `sweepPos` of those to resolve — the inner loop is
/// mathematically guaranteed to exit (with zero overlaps left) within
/// `sweepPos` passes, which is always `< normalized.length`.
/// `HARD_CAP` below is set to `normalized.length + 1` as a hard,
/// unconditional iteration ceiling regardless of the above proof — a
/// defensive backstop against a future edit to this function accidentally
/// breaking the monotonic-push argument, not something this loop is
/// expected to ever actually reach. See `dashboardLayout.test.ts`'s
/// `resolveOverlaps` "worst case" test for a maximally-overlapping stress
/// case that exercises this bound directly.
export function resolveOverlaps(widgets: PlacedWidget[], gridCols: number = DEFAULT_GRID_COLS): PlacedWidget[] {
  const cols = clampDimension(gridCols, 1, Number.POSITIVE_INFINITY)

  // Defensive on-grid normalization first, so the overlap math below is
  // never fed a widget that's off-grid (negative x, width beyond the grid,
  // non-finite y/h from some upstream bug) — see clampToGrid's own doc
  // comment for why this exact clamp also needs to be public.
  const normalized: PlacedWidget[] = widgets.map(widget => {
    const clamped = clampToGrid(widget, cols)
    return { id: widget.id, ...clamped }
  })

  const sweepOrder = normalized
    .map((_, index) => index)
    .sort((i, j) => normalized[i].y - normalized[j].y || normalized[i].x - normalized[j].x)

  const HARD_CAP = normalized.length + 1

  for (let sweepPos = 0; sweepPos < sweepOrder.length; sweepPos++) {
    const idx = sweepOrder[sweepPos]
    const earlierIdxs = sweepOrder.slice(0, sweepPos)

    let changed = true
    let iterations = 0
    while (changed && iterations < HARD_CAP) {
      changed = false
      iterations++
      for (const otherIdx of earlierIdxs) {
        const other = normalized[otherIdx]
        const current = normalized[idx]
        if (rectsOverlap(current, other)) {
          const newY = other.y + other.h
          if (newY > current.y) {
            normalized[idx] = { ...current, y: newY }
            changed = true
          }
        }
      }
    }
  }

  return normalized
}
