import { useState } from 'react'
import { useAdminFetch } from '../../lib/adminApi'
import { TOOL_LABELS } from '../../lib/toolLabels'
import { hudStagger } from '../../lib/hudStagger'
import { foldIntoOther } from '../../lib/chartMath'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { ObsDonut } from './ObsDonut'
import { HudGrid, HudTile, HudSectionHeader } from './Hud'

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

  // foldIntoOther is a no-op under its 6-slice ceiling (research categories
  // and length buckets are always a handful) — it only matters for
  // tool_distribution, where Jarvis's real tool count can plausibly exceed
  // it; folding the tail into "Andere" instead of generating more hues is
  // this codebase's own dataviz skill's prescribed fix for that.
  const categoryMixData = foldIntoOther(data.category_mix.map(b => ({ label: b.category ?? '—', value: b.count })))
  const toolDistributionData = foldIntoOther(data.tool_distribution.map(b => ({ label: TOOL_LABELS[b.tool ?? ''] ?? (b.tool ?? '—'), value: b.count })))
  const lengthDistributionData = foldIntoOther(
    data.length_distribution.map(b => ({ label: (b.bucket ?? '—').replace(/^./, c => c.toUpperCase()), value: b.count })),
  )

  return (
    <div className="obs-panel">
      <HudSectionHeader
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={range} onChange={e => setRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
              {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ExportButtons
              rows={data.recent_tool_calls.map(c => ({ ...c }))}
              filenameBase={`behavioral-tool-calls-${range}`}
              title={`Jarvis-Werkzeugaufrufe (${RANGE_SUFFIX[data.range] ?? data.range})`}
            />
          </div>
        }
      />
      <HudGrid cols={4}>
        <HudTile title="Research-Aktivität" badge="KAT" accent="var(--obs-purple)" span={2}>
          {data.category_mix.length === 0
            ? <div className="obs-empty">Noch keine Research Notes.</div>
            : <ObsDonut data={categoryMixData} gradientIdPrefix="behavior-category-mix" />
          }
        </HudTile>

        <HudTile title="Jarvis-Werkzeuge" badge={RANGE_SUFFIX[data.range] ?? data.range} accent="var(--obs-teal)" span={2}>
          {data.tool_distribution.length === 0
            ? <div className="obs-empty">Noch keine Werkzeugaufrufe.</div>
            : <ObsDonut data={toolDistributionData} gradientIdPrefix="behavior-tool-distribution" />
          }
        </HudTile>
      </HudGrid>

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

      <HudGrid cols={4}>
        <HudTile title="Gesprächslänge" badge="VERT" accent="var(--obs-amber)" span={2}>
          {data.length_distribution.length === 0
            ? <div className="obs-empty">Noch keine Gespräche.</div>
            : <ObsDonut data={lengthDistributionData} gradientIdPrefix="behavior-length-distribution" />
          }
        </HudTile>
      </HudGrid>
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Aggregierte Muster über alle Gespräche und Einträge — keine Einzelpersonen-Überwachung.
      </p>
    </div>
  )
}
