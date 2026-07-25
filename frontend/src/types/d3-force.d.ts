/// No @types/d3-force package is installed (d3-force ships its own JS with
/// no bundled .d.ts) — this repo's two force-graph instruments
/// (SystemMap.tsx/KnowledgeGraph.tsx via lib/forceGraphTuning.ts) only need
/// forceCollide's radius-accessor form, so a minimal shape is enough rather
/// than pulling in the full @types/d3-force dependency for one function.
declare module 'd3-force' {
  export function forceCollide(radius?: number | ((node: any, i: number, nodes: any[]) => number)): any
}
