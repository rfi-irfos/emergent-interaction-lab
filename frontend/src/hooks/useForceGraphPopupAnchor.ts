import { useEffect, useRef, useState } from 'react'

/// Keeps a detail popover's screen position glued to a live force-graph
/// node's actual coordinates every frame — via ForceGraph2D's own
/// `graph2ScreenCoords`, not a fixed corner offset. Fixes the "detail card
/// renders pinned to the bottom-right corner no matter which node you
/// clicked, with only a thin unreadable line back to the real node" bug in
/// SystemMap.tsx/KnowledgeGraph.tsx: previously the popup's position had no
/// relationship at all to the clicked node's actual (x,y), so it never read
/// as "this popup belongs to that node." Runs a rAF loop only while a node
/// is actually selected, so it keeps tracking through simulation settling,
/// dragging, and pan/zoom — not just a one-time snapshot at click time.
export function useForceGraphPopupAnchor(
  fgRef: { current: any },
  activeNode: { x?: number; y?: number } | null | undefined,
): { x: number; y: number } | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!activeNode) {
      setPos(null)
      return
    }
    const tick = () => {
      const fg = fgRef.current
      if (fg && typeof activeNode.x === 'number' && typeof activeNode.y === 'number' && typeof fg.graph2ScreenCoords === 'function') {
        const screen = fg.graph2ScreenCoords(activeNode.x, activeNode.y)
        if (screen) setPos({ x: screen.x, y: screen.y })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // activeNode is a fresh object identity per render, deliberately not a dep —
    // only whether a node is selected at all (and which id) should restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fgRef, activeNode?.x !== undefined && activeNode?.y !== undefined, (activeNode as any)?.id])

  return pos
}
