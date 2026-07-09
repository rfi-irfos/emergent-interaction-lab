import { useAdminFetch } from '../../lib/adminApi'
import { ObsChart } from './ObsChart'

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
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.documents}</div><div className="obs-stat-label">Dokumente</div></div>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.chunks}</div><div className="obs-stat-label">Embedding-Chunks</div></div>
      </div>
      <div className="obs-card">
        <div className="obs-section-label">Retrieval-Score-Trend (14 T.)</div>
        {data.retrieval_by_day.length === 0
          ? <div className="obs-empty">Noch keine Retrieval-Daten.</div>
          : <ObsChart
              data={data.retrieval_by_day.map(d => ({ label: d.day.slice(5), value: d.avg_top_score }))}
              color="#14b8a6"
              gradientId="info-score"
              valueFormat={v => v.toFixed(2)}
            />
        }
      </div>
      {data.retrieval_by_day.length > 0 && (
        <div className="obs-card">
          <div className="obs-section-label">Treffer pro Anfrage (Ø, 14 T.)</div>
          <ObsChart
            data={data.retrieval_by_day.map(d => ({ label: d.day.slice(5), value: d.avg_hit_count }))}
            color="#3b6bf6"
            gradientId="info-hits"
            valueFormat={v => v.toFixed(1)}
          />
        </div>
      )}
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Wissensbasis und wie gut sie tatsächlich wiederverwendet wird — Score und Trefferzahl zeigen, ob frühere Gespräche und Dokumente aktiv ins Denken einfließen, nicht nur wie viel gespeichert ist.
      </p>
    </div>
  )
}
