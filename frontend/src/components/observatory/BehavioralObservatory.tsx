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
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.total_visitors_30d}</div><div className="obs-stat-label">Besucher (30 T.)</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.returning_visitors_30d}</div><div className="obs-stat-label">Wiederkehrend</div></div>
        <div className="obs-stat c-purple"><div className="obs-stat-value">{returnRate}%</div><div className="obs-stat-label">Rückkehrrate</div></div>
      </div>

      <div className="obs-section-label">Nach Tageszeit</div>
      <div className="obs-card">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }}>
          {data.by_hour.map(h => (
            <div key={h.hour} title={`${h.hour}:00 Uhr — ${h.count} Besuche`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{
                width: '100%', height: `${Math.max((h.count / maxHour) * 100, 3)}%`,
                background: 'linear-gradient(180deg, #3b6bf6, #6d92f9)', borderRadius: '4px 4px 1px 1px',
                transition: 'opacity .12s',
              }} />
            </div>
          ))}
        </div>
        <div className="obs-chart-axis" style={{ marginTop: 8 }}>
          <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
        </div>
      </div>

      <div className="obs-section-label">Nach Wochentag</div>
      <div className="obs-card">
        {data.by_day_of_week.map(d => (
          <div className="obs-bar-row" key={d.day}>
            <span style={{ width: 28, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{DOW[Number(d.day)] ?? d.day}</span>
            <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${(d.count / maxDow) * 100}%` }} /></div>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#3b6bf6', minWidth: 24, textAlign: 'right' }}>{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
