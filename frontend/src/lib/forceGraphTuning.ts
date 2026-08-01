import { forceCollide } from 'd3-force'

/// Shared d3-force tuning for the two react-force-graph-2d instruments
/// (SystemMap.tsx / KnowledgeGraph.tsx). Neither graph previously configured
/// a collision force at all — d3-force's default charge/link forces only
/// keep node CENTERS apart, which does nothing to stop two nodes' rendered
/// TEXT LABELS from drawing on top of each other once a graph has more than
/// a handful of nodes (confirmed live: 15-20 stacked, illegible Knowledge
/// Graph labels, and a "Mensch"/"Informationsdynamik" node landing directly
/// on the legend text above it in SystemMap). `collideRadius` is a per-node
/// function (not one constant) so a long label reserves real room and a
/// short one doesn't waste it.
export function tuneForceGraph(fg: any, collideRadius: (node: any) => number, opts?: { chargeStrength?: number; linkDistance?: number }) {
  if (!fg || typeof fg.d3Force !== 'function') return
  const charge = fg.d3Force('charge')
  if (charge && typeof charge.strength === 'function') charge.strength(opts?.chargeStrength ?? -190)
  const link = fg.d3Force('link')
  if (link && typeof link.distance === 'function') link.distance(opts?.linkDistance ?? 100)
  fg.d3Force('collide', forceCollide(collideRadius))
}

/// REMOVED (2026-08-01): both graphs used to call `fg.d3ReheatSimulation()`
/// (which forces `forceLayout.alpha(1)`) from `onNodeDrag`, once per drag
/// tick — meant to stop the sim "freezing" once a settled graph's
/// `cooldownTicks` budget was already spent. That was the actual cause of
/// the reported "drag breaks mid-gesture" bug: react-force-graph-2d's OWN
/// internal drag handler (see force-graph's canvas-force-graph 'drag'
/// listener) ALREADY calls `d3AlphaTarget(0.3).resetCountdown()` on every
/// drag tick before invoking the app's `onNodeDrag` callback — that alone
/// both keeps the engine ticking past cooldown AND holds it at a gentle,
/// steady 0.3 energy for the rest of the drag. Forcing `alpha(1)` on top of
/// that on every single mousemove re-spiked the simulation back to full
/// energy each tick, fighting the library's own steady-state target and
/// making untouched neighbor nodes visibly jitter/lurch instead of settling
/// smoothly around the dragged node — confirmed by reading
/// node_modules/force-graph/dist/force-graph.mjs directly, not by guessing.
/// Removing the app-side reheat call (both graphs now pass no `onNodeDrag`
/// at all) leaves the library's already-correct built-in behavior alone.

/// Canvas `fillStyle`/`strokeStyle` can't take a literal `var(--x)` string —
/// the 2D context has no idea what a CSS custom property is, so the two
/// force-graph node painters (KnowledgeGraph.tsx/SystemMap.tsx) used to
/// hard-code their node-chip background (`#0d141f`) and label text
/// (`#eefcff`) as permanent-dark literals, same as the rest of the
/// pre-retheme HUD — correct in dark/hc, but wrong (a dark chip floating on
/// the light shell) once the light theme is real. This resolves the CURRENT
/// computed value of a token at paint time, so canvas drawing tracks
/// whichever theme class (`.gotham`/`.observatory-hc`) is active right now —
/// same tokens `.hud-tile` already uses, just read at runtime instead of
/// left to the cascade.
///
/// Takes the graph's own wrapper element (not `document.documentElement`) —
/// `--gotham-panel`/`--gotham-text`/etc are declared on the `.gotham` shell
/// element itself (see App.css's ADMIN SHELL THEME section), not on
/// `<html>`, so they only resolve correctly when read from an element that's
/// actually a descendant of that shell and inherits the custom property down
/// the cascade. Cheap enough to call once per node per paint (a single
/// getComputedStyle property read, not a full reflow); falls back to the
/// literal if the token isn't set at all (e.g. a non-browser test
/// environment, or the element hasn't mounted yet).
export function resolveThemeColor(el: Element | null | undefined, cssVarName: string, fallback: string): string {
  if (!el || typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(el).getPropertyValue(cssVarName).trim()
  return value || fallback
}

/// Resolves a node's own `accent` field for canvas use. Node accents (see
/// KnowledgeGraph.tsx/SystemMap.tsx's NODES/hub/scopeNodes arrays) are
/// authored as `var(--hud-cyan, #22d3ee)`-style strings so the SAME accent
/// value works two ways: JSX consumers (the legend dot, the anchored detail
/// card's border/text color) hand it straight to a React `style` prop, where
/// `var(...)` is resolved by the browser like any other CSS value — but a
/// canvas 2D context has no CSS engine at all, so `ctx.fillStyle = 'var(--x)'`
/// silently does nothing (canvas falls back to its last valid fillStyle).
/// This is what let the hub/scope dots stay permanently cyan (`#22d3ee`)
/// even in the amber high-contrast theme, once accents were plain hex
/// literals — this parses the same `var(--name, fallback)` string canvas
/// can't read and resolves it exactly like resolveThemeColor does, so the
/// one accent value drives both the DOM chrome and the canvas paint.
export function resolveAccentColor(el: Element | null | undefined, accent: string): string {
  const match = /^var\((--[\w-]+)\s*,\s*(.+)\)$/.exec(accent.trim())
  if (!match) return accent
  const [, varName, fallback] = match
  return resolveThemeColor(el, varName, fallback.trim())
}
