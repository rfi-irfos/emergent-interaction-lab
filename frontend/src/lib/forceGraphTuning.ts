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

/// Called from `onNodeDrag` — react-force-graph-2d's default drag behavior
/// pins the dragged node's (fx,fy) but does NOT keep reheating the
/// simulation for its neighbors once the initial `cooldownTicks` budget is
/// exhausted, so a graph that has already settled can appear to "stop
/// responding" to drags partway through a session (only the very first drag,
/// while the sim is still warm, visibly moves anything). Reheating on every
/// drag tick keeps the simulation live for the whole interaction, matching
/// what a user expects from "drag a node in a live physics graph."
export function reheatOnDrag(fg: any) {
  if (fg && typeof fg.d3ReheatSimulation === 'function') fg.d3ReheatSimulation()
}
