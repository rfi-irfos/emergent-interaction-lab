import { useAdminFetch } from '../../lib/adminApi'

interface Bucket { hour?: string; day?: string; count: number }
interface BehaviorData {
  by_hour: Bucket[]
  by_day_of_week: Bucket[]
  total_visitors_30d: number
  returning_visitors_30d: number
}

const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

export function BehavioralObservatory() {
  const { data, loading } = useAdminFetch<BehaviorData>('/api/observatory/behavior')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const returnRate = data.total_visitors_30d > 0 ? Math.round((data.returning_visitors_30d / data.total_visitors_30d) * 100) : 0
  const maxHour = Math.max(...data.by_hour.map(h => h.count), 1)
  const maxDow = Math.max(...data.by_day_of_week.map(d => d.count), 1)

  return (
    <div className="obs-panel">
      <div className="obs-grid">
        <div className="obs-stat"><div className="obs-stat-value">{data.total_visitors_30d}</div><div className="obs-stat-label">Besucher (30 T.)</div></div>
        <div className="obs-stat"><div className="obs-stat-value">{data.returning_visitors_30d}</div><div className="obs-stat-label">Wiederkehrend</div></div>
        <div className="obs-stat"><div className="obs-stat-value">{returnRate}%</div><div className="obs-stat-label">Rückkehrrate</div></div>
      </div>

      <div className="obs-section">
        <div className="obs-section-label">Nach Tageszeit</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 50 }}>
          {data.by_hour.map(h => (
            <div key={h.hour} title={`${h.hour}:00 — ${h.count}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: `${Math.max((h.count / maxHour) * 100, 3)}%`, background: '#0099CC', borderRadius: '2px 2px 0 0' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="obs-section">
        <div className="obs-section-label">Nach Wochentag</div>
        {data.by_day_of_week.map(d => (
          <div className="obs-bar-row" key={d.day}>
            <span style={{ width: 28, fontSize: 11, color: '#555', flexShrink: 0 }}>{DOW[Number(d.day)] ?? d.day}</span>
            <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${(d.count / maxDow) * 100}%` }} /></div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#0099CC', minWidth: 24, textAlign: 'right' }}>{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
