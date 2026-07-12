import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import { HudSkeleton } from '../observatory/HudSkeleton'
import { ObsDonut } from '../observatory/ObsDonut'
import { ObsGauge } from '../observatory/ObsGauge'
import { ObsRadar } from '../observatory/ObsRadar'
import { ObsMultiChart } from '../observatory/ObsMultiChart'
import { catalogEntry } from '../../lib/dashboardCatalog'
import type { DashboardWidget } from './types'

/// One placed widget: fetches its own catalog entry's `fetchPath` (every
/// widget owns its own request — same "each module fetches independently"
/// convention as the rest of Observatory, no shared cache) and renders via
/// `entry.chartKind`. `refreshSignal` bump re-fetches (same pattern as
/// ForschungKpis' own poll-on-signal convention) — this card never polls on
/// an interval by itself, only when the dashboard page's manual refresh
/// button bumps the shared signal.
///
/// Edit mode overlays a pencil + remove (×) button in the header — wired by
/// DashboardCanvas, this component only renders them, it owns none of the
/// drag/resize/CRUD logic itself.
export function WidgetCard({
  widget, refreshSignal, editMode, onEdit, onRemove,
}: {
  widget: DashboardWidget
  refreshSignal: number
  editMode: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const entry = catalogEntry(widget.catalog_key)
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!entry) return
    let cancelled = false
    setLoading(true)
    setError(false)
    fetch(`${API_BASE}${entry.fetchPath}`, { headers: authHeaders() })
      .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
      .then(raw => { if (!cancelled) { setData(entry.transform(raw)); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.key, refreshSignal])

  const title = widget.title?.trim() || entry?.title || widget.catalog_key
  const accent = widget.color_key || undefined

  return (
    <div className="dash-widget" style={accent ? ({ ['--dash-accent' as string]: accent }) : undefined}>
      <div className="dash-widget-head">
        <span className="dash-widget-title">{title}</span>
        {editMode && (
          <div className="dash-widget-actions">
            <button type="button" className="dash-widget-btn" title="Bearbeiten" aria-label="Widget bearbeiten" onClick={onEdit}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button type="button" className="dash-widget-btn dash-widget-btn--danger" title="Entfernen" aria-label="Widget entfernen" onClick={onRemove}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        )}
      </div>
      <div className="dash-widget-body">
        {!entry && <div className="obs-empty">Unbekannter Katalog-Eintrag „{widget.catalog_key}".</div>}
        {entry && loading && <HudSkeleton variant="chart" />}
        {entry && !loading && error && <div className="obs-empty">Konnte nicht geladen werden.</div>}
        {entry && !loading && !error && data != null && renderChart(entry.chartKind, data, widget.id, accent)}
      </div>
    </div>
  )
}

function renderChart(kind: 'donut' | 'gauge' | 'radar' | 'multiline', data: any, widgetId: string, accent?: string) {
  switch (kind) {
    case 'donut':
      return <ObsDonut data={data.data} gradientIdPrefix={`dash-${widgetId}`} size={132} thickness={15} />
    case 'gauge':
      return <ObsGauge value={data.value} label={data.label} color={accent} />
    case 'radar':
      return <ObsRadar axes={data.axes} size={200} />
    case 'multiline':
      return <ObsMultiChart labels={data.labels} series={data.series} gradientIdPrefix={`dash-${widgetId}`} />
    default:
      return null
  }
}
