import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ObsChart } from './ObsChart'
import { ObsDonut } from './ObsDonut'
import { HudGrid, HudTile } from './Hud'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

interface RetrievalDay { day: string; avg_top_score: number; avg_hit_count: number }
interface RecentRetrieval { query_text: string; top_score: number; hit_count: number; created_at: string; is_gap: boolean }
interface InformationData {
  documents: number
  chunks: number
  gap_only: boolean
  retrieval_by_day: RetrievalDay[]
  recent_retrievals: RecentRetrieval[]
}

export function InformationDynamics() {
  // `is_gap` was already computed and shown as a per-row pill, but there was
  // no way to filter *to* just the gaps — see backend/src/observatory.rs's
  // `?gap_only=true`, which narrows `recent_retrievals` server-side (so the
  // capped top-10 feed is the 10 most recent gaps, not 10 most-recent-of-
  // anything with gaps buried among them).
  const [gapOnly, setGapOnly] = useState(false)
  const { data, loading, error } = useAdminFetch<InformationData>(
    `/api/observatory/information${gapOnly ? '?gap_only=true' : ''}`,
    [gapOnly],
  )

  if (loading) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  return (
    <div className="obs-panel">
      <div className="obs-grid">
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.documents}</div><div className="obs-stat-label">Dokumente</div></div>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.chunks}</div><div className="obs-stat-label">Embedding-Chunks</div></div>
      </div>
      <HudGrid cols={4}>
        <HudTile title="Retrieval-Score" badge="14 T." accent="var(--obs-teal)" span={2}>
          {data.retrieval_by_day.length === 0
            ? <div className="obs-empty">Noch keine Retrieval-Daten.</div>
            : <ObsChart
                data={data.retrieval_by_day.map(d => ({ label: d.day.slice(5), value: d.avg_top_score }))}
                color="#14b8a6"
                gradientId="info-score"
                valueFormat={v => v.toFixed(2)}
              />
          }
        </HudTile>
        {data.retrieval_by_day.length > 0 && (
          <HudTile title="Treffer / Anfrage" badge="Ø 14 T." accent="var(--obs-blue)" span={2}>
            <ObsChart
              data={data.retrieval_by_day.map(d => ({ label: d.day.slice(5), value: d.avg_hit_count }))}
              color="#3b6bf6"
              gradientId="info-hits"
              valueFormat={v => v.toFixed(1)}
            />
          </HudTile>
        )}
      </HudGrid>
      {data.recent_retrievals.length > 0 && (
        <HudTile title="Retrieval-Qualität" badge="VERT" accent="var(--obs-green)" span={4}>
          <ObsDonut
            data={[
              { label: 'Gut (>0.6)', value: data.recent_retrievals.filter(r => r.top_score > 0.6).length, color: 'var(--obs-green)' },
              { label: 'Mittel (0.3–0.6)', value: data.recent_retrievals.filter(r => r.top_score >= 0.3 && r.top_score <= 0.6).length, color: 'var(--obs-amber)' },
              { label: 'Schwach (<0.3)', value: data.recent_retrievals.filter(r => r.top_score < 0.3).length, color: 'var(--obs-red)' },
            ]}
            gradientIdPrefix="information-retrieval-quality"
          />
          <p style={{ fontSize: 11, color: '#9aa0a8', lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>
            Basis: die {data.recent_retrievals.length} aktuell geladenen Anfragen{gapOnly ? ' (nur Wissenslücken)' : ''} — kein
            serverseitiges Gesamt-Grouping über alle jemals gestellten Anfragen, siehe "Letzte Anfragen" unten.
          </p>
        </HudTile>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 }}>
        <div className="obs-section-label" style={{ marginBottom: 0, flex: '1 1 auto' }}>Letzte Anfragen</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={gapOnly} onChange={e => setGapOnly(e.target.checked)} />
          Nur Wissenslücken
        </label>
        {/* Exports whatever is currently loaded/filtered (`recent_retrievals`)
            — same honesty-about-scope principle as elsewhere: with
            "Nur Wissenslücken" active, the export is the gap-only set, not
            silently the unfiltered top-10. */}
        <ExportButtons
          rows={data.recent_retrievals.map(r => ({ ...r }))}
          filenameBase={`information-retrievals${gapOnly ? '-gaps' : ''}`}
          title="Information Dynamics — letzte Anfragen"
        />
      </div>
      {data.recent_retrievals.length === 0
        ? <div className="obs-card"><div className="obs-empty">{gapOnly ? 'Keine Wissenslücken in den letzten Anfragen.' : 'Noch keine Anfragen protokolliert.'}</div></div>
        : data.recent_retrievals.map((r, i) => (
            <div className="obs-item-card" key={i} style={{ ...hudStagger(i), ['--obs-accent' as string]: r.is_gap ? '#f59e0b' : '#14b8a6' }}>
              <div className="obs-item-title">{r.query_text}</div>
              <div className="obs-item-meta">
                <span
                  className="obs-pill"
                  style={{ background: r.is_gap ? 'rgba(245,158,11,.12)' : 'rgba(20,184,166,.12)', color: r.is_gap ? '#f59e0b' : '#14b8a6' }}
                >
                  {r.is_gap ? 'Wissenslücke' : `${r.hit_count} Treffer`}
                </span>
                {' · '}Score {r.top_score.toFixed(2)} · {r.created_at}
              </div>
            </div>
          ))
      }
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Wissensbasis und wie gut sie tatsächlich wiederverwendet wird — Score und Trefferzahl zeigen, ob frühere Gespräche und Dokumente aktiv ins Denken einfließen, nicht nur wie viel gespeichert ist. Wissenslücken markieren Anfragen, bei denen keine oder zu schwache Treffer gefunden wurden.
      </p>
    </div>
  )
}
