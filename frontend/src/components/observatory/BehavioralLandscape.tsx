import { useAdminFetch } from '../../lib/adminApi'

interface Bucket { category?: string; tool?: string; bucket?: string; count: number }
interface BehaviorData {
  category_mix: Bucket[]
  tool_distribution: Bucket[]
  length_distribution: Bucket[]
}

/// Group patterns, not individual surveillance: what kinds of research
/// activity are happening, what Jarvis actually gets asked to do, and
/// whether conversations tend to be quick check-ins or long deep-dives.
/// Replaces the old visitor-hour/weekday bar charts entirely — those told
/// you about website traffic, not about the research itself.
export function BehavioralLandscape() {
  const { data, loading } = useAdminFetch<BehaviorData>('/api/observatory/behavior')

  if (loading) return <div className="obs-panel"><div className="obs-empty">Lade…</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const maxCategory = Math.max(...data.category_mix.map(b => b.count), 1)
  const maxTool = Math.max(...data.tool_distribution.map(b => b.count), 1)
  const maxLength = Math.max(...data.length_distribution.map(b => b.count), 1)

  return (
    <div className="obs-panel">
      <div className="obs-section-label">Research-Aktivität nach Kategorie</div>
      <div className="obs-card">
        {data.category_mix.length === 0 && <div className="obs-empty">Noch keine Research Notes.</div>}
        {data.category_mix.map(b => (
          <div className="obs-bar-row" key={b.category}>
            <span style={{ width: 90, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{b.category}</span>
            <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${(b.count / maxCategory) * 100}%` }} /></div>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#3b6bf6', minWidth: 24, textAlign: 'right' }}>{b.count}</span>
          </div>
        ))}
      </div>

      <div className="obs-section-label">Jarvis-Werkzeugnutzung (30 T.)</div>
      <div className="obs-card">
        {data.tool_distribution.length === 0 && <div className="obs-empty">Noch keine Werkzeugaufrufe.</div>}
        {data.tool_distribution.map(b => (
          <div className="obs-bar-row" key={b.tool}>
            <span style={{ width: 150, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{b.tool}</span>
            <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${(b.count / maxTool) * 100}%`, background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)' }} /></div>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#8b5cf6', minWidth: 24, textAlign: 'right' }}>{b.count}</span>
          </div>
        ))}
      </div>

      <div className="obs-section-label">Gesprächslänge — Verteilung</div>
      <div className="obs-card">
        {data.length_distribution.length === 0 && <div className="obs-empty">Noch keine Gespräche.</div>}
        {data.length_distribution.map(b => (
          <div className="obs-bar-row" key={b.bucket}>
            <span style={{ width: 60, fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0, textTransform: 'capitalize' }}>{b.bucket}</span>
            <div className="obs-bar-track"><div className="obs-bar-fill" style={{ width: `${(b.count / maxLength) * 100}%`, background: 'linear-gradient(90deg, #14b8a6, #5eead4)' }} /></div>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#14b8a6', minWidth: 24, textAlign: 'right' }}>{b.count}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Aggregierte Muster über alle Gespräche und Einträge — keine Einzelpersonen-Überwachung.
      </p>
    </div>
  )
}
