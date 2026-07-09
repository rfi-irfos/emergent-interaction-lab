import { useAdminFetch } from '../../lib/adminApi'

interface RetrievalDay { day: string; avg_top_score: number; avg_hit_count: number }
interface InformationData {
  documents: number
  chunks: number
  retrieval_by_day: RetrievalDay[]
}

export function InformationDynamics() {
  const { data, loading } = useAdminFetch<InformationData>('/api/observatory/information')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">
      <div className="obs-grid">
        <div className="obs-stat"><div className="obs-stat-value">{data.documents}</div><div className="obs-stat-label">Dokumente</div></div>
        <div className="obs-stat"><div className="obs-stat-value">{data.chunks}</div><div className="obs-stat-label">Embedding-Chunks</div></div>
      </div>
      <div className="obs-section">
        <div className="obs-section-label">Retrieval-Trend (14 T.)</div>
        {data.retrieval_by_day.length === 0 && <div className="obs-empty">Noch keine Retrieval-Daten.</div>}
        {data.retrieval_by_day.map(d => (
          <div className="obs-bar-row" key={d.day}>
            <span style={{ width: 68, fontSize: 11, color: '#555', flexShrink: 0 }}>{d.day.slice(5)}</span>
            <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${Math.min(d.avg_top_score * 100, 100)}%` }} /></div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#0099CC', minWidth: 76, textAlign: 'right' }}>
              {d.avg_top_score.toFixed(2)} score · {d.avg_hit_count.toFixed(1)} hits
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
