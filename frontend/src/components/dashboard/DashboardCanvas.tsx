import { useEffect, useRef, useState } from 'react'
import { DEFAULT_GRID_COLS, resolveOverlaps, type PlacedWidget } from '../../lib/dashboardLayout'
import { WidgetCard } from './WidgetCard'
import type { DashboardWidget } from './types'

const ROW_HEIGHT_PX = 96
const GAP_PX = 14

function toPlaced(w: DashboardWidget): PlacedWidget {
  return { id: w.id, x: w.position_x, y: w.position_y, w: w.width, h: w.height }
}

/// The actual drag/resize canvas. Grid math (layout/resolveOverlaps/
/// clampToGrid) is Phase 6b's pure module — this component owns only
/// pixel↔grid conversion and the pointer-event wiring, same
/// mousedown→document-mousemove/mouseup idiom as WebsiteKit.tsx's own
/// `startPanelResize`. Drag/resize positions update local state live for a
/// responsive feel, but only PATCH the backend once, on mouseup — matching
/// dashboards.rs's own doc comment ("debounce to mouseup, not mousemove":
/// SQLite is single-writer, a live drag firing dozens of PATCHes would
/// hammer it).
///
/// `resolveOverlaps` can move widgets OTHER than the one the user is
/// dragging (anything it now overlaps gets pushed down) — `onPersist` is
/// therefore called once per widget whose x/y/w/h actually changed from
/// before the drag/resize, not just the one under the pointer.
export function DashboardCanvas({
  widgets, editMode, refreshSignal, onWidgetsChange, onPersist, onEdit, onRemove,
}: {
  widgets: DashboardWidget[]
  editMode: boolean
  refreshSignal: number
  onWidgetsChange: (widgets: DashboardWidget[]) => void
  onPersist: (changed: { id: string; position_x: number; position_y: number; width: number; height: number }[]) => void
  onEdit: (widget: DashboardWidget) => void
  onRemove: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [colWidth, setColWidth] = useState(80)

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return
      setColWidth(containerRef.current.clientWidth / DEFAULT_GRID_COLS)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const height = Math.max(1, ...widgets.map(w => w.position_y + w.height)) * (ROW_HEIGHT_PX + GAP_PX)

  const commit = (moved: PlacedWidget) => {
    const others = widgets.filter(w => w.id !== moved.id).map(toPlaced)
    const resolved = resolveOverlaps([...others, moved], DEFAULT_GRID_COLS)
    const byId = new Map(resolved.map(r => [r.id, r]))
    const next = widgets.map(w => {
      const r = byId.get(w.id)
      return r ? { ...w, position_x: r.x, position_y: r.y, width: r.w, height: r.h } : w
    })
    onWidgetsChange(next)
    const changed = next
      .filter(w => {
        const before = widgets.find(b => b.id === w.id)!
        return before.position_x !== w.position_x || before.position_y !== w.position_y || before.width !== w.width || before.height !== w.height
      })
      .map(w => ({ id: w.id, position_x: w.position_x, position_y: w.position_y, width: w.width, height: w.height }))
    if (changed.length > 0) onPersist(changed)
  }

  const startDrag = (widget: DashboardWidget) => (e: React.MouseEvent) => {
    if (!editMode || colWidth <= 0) return
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const startGridX = widget.position_x, startGridY = widget.position_y
    let liveX = startGridX, liveY = startGridY
    const onMove = (ev: MouseEvent) => {
      const dxCols = Math.round((ev.clientX - startX) / colWidth)
      const dyRows = Math.round((ev.clientY - startY) / (ROW_HEIGHT_PX + GAP_PX))
      liveX = Math.max(0, Math.min(DEFAULT_GRID_COLS - widget.width, startGridX + dxCols))
      liveY = Math.max(0, startGridY + dyRows)
      onWidgetsChange(widgets.map(w => (w.id === widget.id ? { ...w, position_x: liveX, position_y: liveY } : w)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      commit({ id: widget.id, x: liveX, y: liveY, w: widget.width, h: widget.height })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startResize = (widget: DashboardWidget) => (e: React.MouseEvent) => {
    if (!editMode || colWidth <= 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startW = widget.width, startH = widget.height
    let liveW = startW, liveH = startH
    const onMove = (ev: MouseEvent) => {
      const dCols = Math.round((ev.clientX - startX) / colWidth)
      const dRows = Math.round((ev.clientY - startY) / (ROW_HEIGHT_PX + GAP_PX))
      liveW = Math.max(1, Math.min(DEFAULT_GRID_COLS - widget.position_x, startW + dCols))
      liveH = Math.max(1, startH + dRows)
      onWidgetsChange(widgets.map(w => (w.id === widget.id ? { ...w, width: liveW, height: liveH } : w)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      commit({ id: widget.id, x: widget.position_x, y: widget.position_y, w: liveW, h: liveH })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div ref={containerRef} className={`dash-canvas ${editMode ? 'dash-canvas--edit' : ''}`} style={{ height }}>
      {widgets.map(w => (
        <div
          key={w.id}
          className="dash-widget-wrap"
          style={{
            left: w.position_x * colWidth,
            top: w.position_y * (ROW_HEIGHT_PX + GAP_PX),
            width: w.width * colWidth - GAP_PX,
            height: w.height * (ROW_HEIGHT_PX + GAP_PX) - GAP_PX,
          }}
          onMouseDown={startDrag(w)}
        >
          <WidgetCard
            widget={w}
            refreshSignal={refreshSignal}
            editMode={editMode}
            onEdit={() => onEdit(w)}
            onRemove={() => onRemove(w.id)}
          />
          {editMode && (
            <div className="dash-widget-resize" onMouseDown={startResize(w)} title="Größe ziehen" />
          )}
        </div>
      ))}
      {widgets.length === 0 && (
        <div className="obs-empty" style={{ padding: '40px 0' }}>Noch keine Widgets — „+ Widget" hinzufügen.</div>
      )}
    </div>
  )
}
