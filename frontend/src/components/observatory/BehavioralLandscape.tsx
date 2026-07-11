import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'

interface Bucket { category?: string; tool?: string; bucket?: string; count: number }
interface ToolCallEntry { tool_name: string; status: string; conversation_id: string | null; result: string | null; created_at: string }
interface BehaviorData {
  range: string
  category_mix: Bucket[]
  tool_distribution: Bucket[]
  length_distribution: Bucket[]
  recent_tool_calls: ToolCallEntry[]
}

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]

/// Short, inline-friendly variant of the same labels for section headings
/// (e.g. "Jarvis-Werkzeugnutzung (letzte 7 Tage)") — echoes the backend's
/// resolved `range` (not the local `range` state) so the heading always
/// matches what was actually applied, even if an unrecognized value fell
/// back server-side.
const RANGE_SUFFIX: Record<string, string> = { '7d': 'letzte 7 Tage', '30d': 'letzte 30 Tage', all: 'alle' }

/// Group patterns, not individual surveillance: what kinds of research
/// activity are happening, what Jarvis actually gets asked to do, and
/// whether conversations tend to be quick check-ins or long deep-dives.
/// Replaces the old visitor-hour/weekday bar charts entirely — those told
/// you about website traffic, not about the research itself.
///
/// Previously every breakdown here was either an all-time snapshot
/// (category_mix, length_distribution) or a hardcoded 30-day window
/// (tool_distribution), with no way to ask "how did this look last week"
/// instead of "right now" — `range` below (see backend/src/observatory.rs's
/// `?range=7d|30d|all`) fixes that.
export function BehavioralLandscape({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [range, setRange] = useState('30d')
  const { data, loading, error } = useAdminFetch<BehaviorData>(`/api/observatory/behavior?range=${range}`, [range])

  if (loading) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!data) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>

  const maxCategory = Math.max(...data.category_mix.map(b => b.count), 1)
  const maxTool = Math.max(...data.tool_distribution.map(b => b.count), 1)
  const maxLength = Math.max(...data.length_distribution.map(b => b.count), 1)

  return (
    <div className="obs-panel">
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
          {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {/* Exports the real per-event tool-call feed below, gated by the
            same `range` selector — the granular record set on this page,
            as opposed to category_mix/tool_distribution/length_distribution
            (small bucketed bar-chart counts, not individual real records). */}
        <ExportButtons
          rows={data.recent_tool_calls.map(c => ({ ...c }))}
          filenameBase={`behavioral-tool-calls-${range}`}
          title={`Jarvis-Werkzeugaufrufe (${RANGE_SUFFIX[data.range] ?? data.range})`}
        />
      </div>
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

      <div className="obs-section-label">Jarvis-Werkzeugnutzung ({RANGE_SUFFIX[data.range] ?? data.range})</div>
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

      <div className="obs-section-label">Jarvis-Aktivität (letzte Aufrufe)</div>
      {data.recent_tool_calls.length === 0
        ? <div className="obs-card"><div className="obs-empty">Noch keine Werkzeugaufrufe protokolliert.</div></div>
        : data.recent_tool_calls.map((c, i) => (
            <div className="obs-item-card" key={i} style={{ ...hudStagger(i), ['--obs-accent' as string]: c.status === 'ok' ? '#8b5cf6' : '#ef4444' }}>
              <div className="obs-item-title">{TOOL_LABELS[c.tool_name] ?? c.tool_name}</div>
              <div className="obs-item-meta">
                <span
                  className="obs-pill"
                  style={{ background: c.status === 'ok' ? 'rgba(139,92,246,.12)' : 'rgba(239,68,68,.12)', color: c.status === 'ok' ? '#8b5cf6' : '#ef4444' }}
                >
                  {c.status === 'ok' ? 'ok' : 'Fehler'}
                </span>
                {' · '}{c.created_at}
                {c.conversation_id && onOpenConversation && (
                  <>
                    {' · '}
                    <button
                      className="chat-inspect-toggle"
                      style={{ fontSize: 11, padding: 0 }}
                      onClick={() => onOpenConversation(c.conversation_id!)}
                    >
                      aus Gespräch ↗
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
      }

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
