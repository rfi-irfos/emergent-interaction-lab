import { useAdminFetch } from '../../lib/adminApi'
import { HudGrid, HudTile } from './Hud'
import { HudSkeleton } from './HudSkeleton'
import { ObsDonut } from './ObsDonut'

interface CenterCashflow {
  name: string
  sessions: number
  revenue_eur: number
  paid_eur: number
  stripe_link: string | null
}

interface LastDebate {
  run_id: string | null
  center: string | null
  adjacent: string[] | null
  status: string | null
  posture: string | null
}

interface SpawnCandidate {
  name: string | null
  mandate: string | null
  status: string | null
  laura_pass: boolean | null
  uncovered_signals: string[] | null
}

interface CoevolutionData {
  centers_total: number
  centers_active: number
  total_sessions: number
  debates_total: number
  debates_resolved: number
  last_debate: LastDebate | null
  virtual_firm: {
    offerings_total: number
    stage_counts: Record<string, number>
    last_offering_id: string | null
  }
  leads_total: number
  cashflow: Record<string, CenterCashflow>
  spawn_candidates: Record<string, SpawnCandidate>
  daughters_total: number
  scaleout_promoted: number
}

interface CoevolutionResponse {
  configured: boolean
  message: string | null
  data: CoevolutionData | null
}

const STAGE_LABELS: Record<string, string> = {
  idea: 'Idee', debate: 'Diskussion', prototype: 'Prototyp', staged: 'Bereit', launched: 'Live',
}

/// Laura's OTHER project — der Ameisenhaufen — read-only, proxied from
/// coevolution-factory's own /observatory endpoint (see
/// backend/src/coevolution.rs). This is a snapshot of a live, separate
/// system, not something this app can influence or trigger from here — no
/// create/edit actions anywhere on this page, deliberately, unlike every
/// other Observatory module which owns its own data.
export function Ameisenhaufen() {
  const { data: res, loading, error } = useAdminFetch<CoevolutionResponse>('/api/observatory/coevolution', [], 30000)

  if (loading) return <div className="obs-panel"><HudSkeleton variant="panel" /></div>
  if (error) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>
  if (!res) return <div className="obs-panel"><div className="obs-empty">Keine Daten verfügbar.</div></div>
  if (!res.configured || !res.data) {
    return (
      <div className="obs-panel">
        <div className="obs-warning-note">▲ {res.message ?? 'Coevolution Factory ist gerade nicht erreichbar.'}</div>
      </div>
    )
  }

  const data = res.data
  const topCenters = Object.entries(data.cashflow)
    .filter(([, c]) => c.sessions > 0)
    .sort((a, b) => b[1].sessions - a[1].sessions)
    .slice(0, 10)

  const staged = Object.entries(data.spawn_candidates ?? {})

  return (
    <div className="obs-panel">
      <div className="obs-section-label">Übersicht</div>
      <div className="obs-grid">
        <div className="obs-stat c-purple"><div className="obs-stat-value">{data.centers_active} / {data.centers_total}</div><div className="obs-stat-label">Zentren aktiv</div></div>
        <div className="obs-stat c-blue"><div className="obs-stat-value">{data.total_sessions}</div><div className="obs-stat-label">Sitzungen gesamt</div></div>
        <div className="obs-stat c-teal"><div className="obs-stat-value">{data.leads_total}</div><div className="obs-stat-label">Anfragen (Leads)</div></div>
        <div className="obs-stat c-green"><div className="obs-stat-value">{data.daughters_total}</div><div className="obs-stat-label">Neue Zentren entstanden</div></div>
      </div>
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6, marginTop: 8 }}>
        Deine Coevolution Factory — 50 eigenständige Zentren, die selbstständig arbeiten. Diese Seite zeigt nur an, was dort passiert; Änderungen macht man dort, nicht hier.
      </p>

      <HudGrid cols={4}>
        <HudTile title="Aktivste Zentren" badge="SITZUNGEN" accent="var(--obs-purple)" span={2}>
          {topCenters.length === 0 ? (
            <div className="obs-empty">Noch keine Sitzungen in einem Zentrum.</div>
          ) : (
            <div>
              {topCenters.map(([slug, c]) => {
                const max = topCenters[0][1].sessions || 1
                return (
                  <div key={slug} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <span style={{ width: 150, fontSize: 11, color: 'rgba(148,190,199,.72)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</span>
                    <div style={{ flex: 1, height: 9, borderRadius: 4, background: 'rgba(120,150,170,.14)', overflow: 'hidden' }}>
                      <div style={{ width: `${(c.sessions / max) * 100}%`, height: '100%', background: 'var(--obs-purple)' }} />
                    </div>
                    <span style={{ width: 26, fontSize: 11, fontWeight: 700, textAlign: 'right', color: '#cfe8ef' }}>{c.sessions}</span>
                  </div>
                )
              })}
            </div>
          )}
        </HudTile>
        <HudTile title="Virtual-Firm-Pipeline" badge="STUFEN" accent="var(--obs-teal)" span={2}>
          {data.virtual_firm.offerings_total === 0 ? (
            <div className="obs-empty">Noch keine Angebote in der Pipeline.</div>
          ) : (
            <ObsDonut
              data={Object.entries(data.virtual_firm.stage_counts).map(([stage, count]) => ({
                label: STAGE_LABELS[stage] ?? stage,
                value: count,
              }))}
              gradientIdPrefix="ameisenhaufen-vf-stages"
            />
          )}
        </HudTile>
      </HudGrid>
      <p style={{ fontSize: 11, color: '#9aa0a8', lineHeight: 1.5, marginTop: -4 }}>
        Virtual Firm: rein datenverarbeitend, keine echte Firma ersetzt — nur bis zur Stufe "Bereit" automatisch, "Live" braucht Lauras eigene Freigabe.
      </p>

      {(data.debates_total > 0 || staged.length > 0) && (
        <div className="obs-section-label" style={{ marginTop: 16 }}>Zusammenarbeit zwischen Zentren</div>
      )}
      {data.debates_total > 0 && (
        <div className="obs-card">
          <div className="obs-item-meta">
            {data.debates_resolved} von {data.debates_total} Diskussionen zwischen Zentren abgeschlossen.
            {data.last_debate && data.last_debate.center && (
              <> Zuletzt: <strong>{data.last_debate.center}</strong>
                {data.last_debate.adjacent && data.last_debate.adjacent.length > 0 && <> ↔ {data.last_debate.adjacent.join(', ')}</>}
                {data.last_debate.posture && <> — Ergebnis: {data.last_debate.posture}</>}
              </>
            )}
          </div>
        </div>
      )}
      {staged.length > 0 && (
        <>
          <div className="obs-section-label" style={{ marginTop: 12 }}>Vorgeschlagene neue Zentren</div>
          {staged.map(([slug, c]) => (
            <div className="obs-item-card" key={slug}>
              <div className="obs-item-title">{c.name ?? slug}</div>
              <div className="obs-item-meta">
                {c.mandate && <>{c.mandate}{' · '}</>}
                {c.laura_pass ? (
                  <span className="obs-pill" style={{ background: 'rgba(16,185,129,.12)', color: 'var(--obs-green, #10b981)' }}>Von Laura freigegeben</span>
                ) : (
                  <span className="obs-placeholder-tag">Wartet auf Lauras Freigabe</span>
                )}
              </div>
            </div>
          ))}
        </>
      )}
      {data.scaleout_promoted > 0 && (
        <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6, marginTop: 12 }}>
          {data.scaleout_promoted} neue{data.scaleout_promoted === 1 ? 's Zentrum ist' : ' Zentren sind'} in diesem Zyklus tatsächlich entstanden.
        </p>
      )}
    </div>
  )
}
