import { useAdminFetch } from '../../lib/adminApi'
import { ObsChart } from './ObsChart'

interface DayCount { day: string; count: number }
interface EmergenceData {
  visits_by_day: DayCount[]
  messages_by_day: DayCount[]
  variance_index: number | null
  variance_index_label: string
}

export function EmergenceMonitor() {
  const { data, loading } = useAdminFetch<EmergenceData>('/api/observatory/emergence')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const toChartData = (series: DayCount[]) => series.map(d => ({ label: d.day.slice(5), value: d.count }))

  return (
    <div className="obs-panel">
      <div className="obs-badge-experimental">Experimenteller Indikator</div>
      <div className="obs-stat c-amber" style={{ marginBottom: 22, maxWidth: 320 }}>
        <div className="obs-stat-value">{data.variance_index !== null ? data.variance_index.toFixed(2) : '—'}</div>
        <div className="obs-stat-label">{data.variance_index_label}</div>
      </div>
      <div className="obs-card">
        <div className="obs-section-label">Besuche pro Tag (14 T.)</div>
        <ObsChart data={toChartData(data.visits_by_day)} color="#3b6bf6" gradientId="emergence-visits" />
      </div>
      <div className="obs-card">
        <div className="obs-section-label">Nachrichten pro Tag (14 T.)</div>
        <ObsChart data={toChartData(data.messages_by_day)} color="#8b5cf6" gradientId="emergence-messages" />
      </div>
    </div>
  )
}
