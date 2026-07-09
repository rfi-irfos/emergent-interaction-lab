import { useAdminFetch } from '../../lib/adminApi'

interface DayCount { day: string; count: number }
interface EmergenceData {
  visits_by_day: DayCount[]
  messages_by_day: DayCount[]
  variance_index: number | null
  variance_index_label: string
}

function Bars({ series }: { series: DayCount[] }) {
  const max = Math.max(...series.map(d => d.count), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
      {series.map(d => (
        <div key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}>
          <div style={{ width: '100%', height: `${Math.max((d.count / max) * 50, 2)}px`, background: '#0099CC', borderRadius: '3px 3px 0 0' }} />
          <span style={{ fontSize: 7, color: '#aaa' }}>{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

export function EmergenceMonitor() {
  const { data, loading } = useAdminFetch<EmergenceData>('/api/observatory/emergence')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">
      <div className="obs-badge-experimental">Experimenteller Indikator</div>
      <div className="obs-stat" style={{ marginBottom: 18 }}>
        <div className="obs-stat-value">{data.variance_index !== null ? data.variance_index.toFixed(2) : '—'}</div>
        <div className="obs-stat-label">{data.variance_index_label}</div>
      </div>
      <div className="obs-section">
        <div className="obs-section-label">Besuche pro Tag (14 T.)</div>
        {data.visits_by_day.length > 0 ? <Bars series={data.visits_by_day} /> : <div className="obs-empty">Keine Daten.</div>}
      </div>
      <div className="obs-section">
        <div className="obs-section-label">Nachrichten pro Tag (14 T.)</div>
        {data.messages_by_day.length > 0 ? <Bars series={data.messages_by_day} /> : <div className="obs-empty">Keine Daten.</div>}
      </div>
    </div>
  )
}
