import { useAdminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { HudGrid, HudTile, HudStat } from './Hud'

/// Bucket 3 + META-LAYER ('Dyad + Meta') of the 40/40/20 Deep Self-Analysis
/// framework — the co-evolution view: who shapes whom
/// (Direction-of-Influence), how the shared mind grows (CCET / shared
/// vocabulary), and who flagged whom (Mutual-Flagging Matrix). Read-only over
/// the three dedicated backend feeds:
///
///   * GET /api/observatory/influence          — analytics_influence.rs
///   * GET /api/observatory/flagging           — analytics_flagging.rs
///   * GET /api/observatory/emergence/ccet     — chat.rs::ccet_summary
///
/// Same honest-empty house rule as MindDashboard/MachineDashboard: a metric
/// the backend reports as null/0-sample renders 'Noch keine Daten', never a
/// fabricated number. All three feeds are all-time/rolling-window global
/// reads (no ?range support server-side), so there is deliberately NO range
/// selector here — pretending to filter would be a lie.

interface InfluenceTerm {
  term: string
  first_user_at?: string
  first_assistant_at?: string
}

interface InfluenceData {
  laura_to_jarvis: { count: number; terms: InfluenceTerm[] }
  jarvis_to_laura: {
    adopted_terms: { count: number; terms: InfluenceTerm[] }
    correction_pressure: number
  }
  balance: { laura_to_jarvis_count: number; jarvis_to_laura_count: number; ratio: number | null }
}

interface FlaggingData {
  matrix: {
    laura_flags_jarvis: { modify: number; reject: number; total: number }
    jarvis_flags: { hallucination_mismatch: number; anomalies: number; total: number }
    total_flags: number
  }
  flag_resolution: { resolved: number; open: number; total: number; resolved_ratio: number }
}

interface CcetData {
  cei: number
  cep: number
  resonance_frequency: number
  turns_considered: number
  stability_threshold: number
  definitions_note: string
}

/// A simple horizontal proportion bar for the two influence directions —
/// existing CSS vars only, no new classes (inline layout like the bar lists
/// MindDashboard already uses for the 8-layer distribution).
function DirectionBar({ label, value, max, accent }: { label: string; value: number; max: number; accent: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <span style={{ flex: '0 0 130px', color: '#9aa0a8' }}>{label}</span>
      <span style={{ flex: 1, background: 'color-mix(in srgb, currentColor 8%, transparent)', borderRadius: 3, overflow: 'hidden', height: 8 }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: accent, transition: 'width .4s ease' }} />
      </span>
      <span style={{ flex: '0 0 28px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

export function DyadDashboard() {
  const { data: influence, loading: l1, error: e1 } = useAdminFetch<InfluenceData>('/api/observatory/influence', [])
  const { data: flagging, loading: l2, error: e2 } = useAdminFetch<FlaggingData>('/api/observatory/flagging', [])
  const { data: ccet, loading: l3, error: e3 } = useAdminFetch<CcetData>('/api/observatory/emergence/ccet', [])

  if (l1 || l2 || l3) return <div className="obs-panel"><div className="obs-empty">Lade Dyaden-Daten…</div></div>
  if (e1 && e2 && e3) return <div className="obs-panel"><div className="obs-empty">Fehler beim Laden.</div></div>

  const l2j = influence?.balance.laura_to_jarvis_count ?? 0
  const j2l = influence?.balance.jarvis_to_laura_count ?? 0
  const maxDir = Math.max(l2j, j2l)
  const adopted = [
    ...(influence?.laura_to_jarvis.terms ?? []).map(t => ({ ...t, dir: 'Laura → Jarvis' as const })),
    ...(influence?.jarvis_to_laura.adopted_terms.terms ?? []).map(t => ({ ...t, dir: 'Jarvis → Laura' as const })),
  ]

  const m = flagging?.matrix
  const res = flagging?.flag_resolution

  return (
    <div className="obs-panel">
      {/* ── Direction of Influence (wer prägt wen) ── */}
      <HudGrid cols={4}>
        <HudTile title="Einfluss-Richtung" badge="TRAIT" accent="var(--obs-purple)" span={2}>
          {influence && (l2j > 0 || j2l > 0) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
              <DirectionBar label="Laura → Jarvis" value={l2j} max={maxDir} accent="var(--obs-purple)" />
              <DirectionBar label="Jarvis → Laura" value={j2l} max={maxDir} accent="var(--obs-teal)" />
              <p style={{ fontSize: 11, color: '#9aa0a8', margin: '4px 0 0' }}>
                Vokabel-Übernahme in beide Richtungen plus Korrektur-Druck (Mismatch, auf den Laura reagiert hat).
                {influence.balance.ratio != null && <> Verhältnis: {influence.balance.ratio.toFixed(2)}</>}
              </p>
            </div>
          ) : (
            <div className="obs-empty">Noch keine gerichtete Einfluss-Beobachtung.</div>
          )}
        </HudTile>

        <HudTile title="Geteiltes Vokabular" badge="WACHSTUM" accent="var(--obs-amber)" span={2}>
          {adopted.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              {adopted.map((t, i) => (
                <div key={`${t.term}-${i}`} style={{ ...hudStagger(i), display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline' }}>
                  <span className="obs-pill" style={{ flex: '0 0 auto' }}>{t.dir}</span>
                  <span style={{ fontWeight: 600 }}>{t.term}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="obs-empty">Noch kein organisch übernommener Begriff — nur das Seed-Vokabular.</div>
          )}
        </HudTile>
      </HudGrid>

      {/* ── Shared-Mind-Growth (CCET) ── */}
      <div className="obs-section-label">Gemeinsames Feld (CCET, rollierendes Fenster)</div>
      <HudGrid cols={4}>
        {ccet && ccet.turns_considered > 0 ? (
          <>
            <HudTile title="CEI" badge="PAPER" accent="var(--obs-teal)">
              <HudStat value={ccet.cei} label="Co-Evolution Index" format={v => v.toFixed(2)} />
            </HudTile>
            <HudTile title="CEP" badge="EIGENE OP." accent="var(--obs-teal)">
              <HudStat value={ccet.cep} label="längste stabile Phase" />
            </HudTile>
            <HudTile title="Resonanz" badge="EIGENE OP." accent="var(--obs-purple)">
              <HudStat value={ccet.resonance_frequency} label="Resonance Frequency" format={v => v.toFixed(2)} />
            </HudTile>
            <HudTile title="Basis" badge="FENSTER" accent="var(--obs-amber)">
              <HudStat value={ccet.turns_considered} label="Turns im Fenster" />
            </HudTile>
          </>
        ) : (
          <HudTile title="CCET" span={4}>
            <div className="obs-empty">Noch keine CCET-Turns erfasst.</div>
          </HudTile>
        )}
      </HudGrid>
      {ccet && <p style={{ fontSize: 11, color: '#9aa0a8', lineHeight: 1.5 }}>{ccet.definitions_note}</p>}

      {/* ── Mutual-Flagging Matrix (META) ── */}
      <div className="obs-section-label">Mutual Flagging — wer hat wen geflaggt (META-Layer)</div>
      <HudGrid cols={4}>
        <HudTile title="Laura flaggt Jarvis" badge="META" accent="var(--sem-warning, var(--obs-amber))" span={2}>
          {m && m.laura_flags_jarvis.total > 0 ? (
            <div style={{ display: 'flex', gap: 18 }}>
              <HudStat value={m.laura_flags_jarvis.modify} label="Modify (editiert)" />
              <HudStat value={m.laura_flags_jarvis.reject} label="Reject (verworfen)" />
              <HudStat value={m.laura_flags_jarvis.total} label="Gesamt" />
            </div>
          ) : (
            <div className="obs-empty">Noch kein Flag von Laura protokolliert.</div>
          )}
        </HudTile>

        <HudTile title="Jarvis flaggt" badge="META" accent="var(--sem-danger)" span={2}>
          {m && m.jarvis_flags.total > 0 ? (
            <div style={{ display: 'flex', gap: 18 }}>
              <HudStat value={m.jarvis_flags.hallucination_mismatch} label="Mismatch (Selbst-Flag)" />
              <HudStat value={m.jarvis_flags.anomalies} label="Anomalien" />
              <HudStat value={m.jarvis_flags.total} label="Gesamt" />
            </div>
          ) : (
            <div className="obs-empty">Noch kein maschinenseitiges Flag protokolliert.</div>
          )}
        </HudTile>

        <HudTile title="Flag-Auflösung" badge="META" accent="var(--sem-success)" span={2}>
          {res && res.total > 0 ? (
            <div style={{ display: 'flex', gap: 18 }}>
              <HudStat value={res.resolved} label="aufgelöst (Dialog ging weiter)" />
              <HudStat value={res.open} label="offen (letztes Wort)" />
              <HudStat value={res.resolved_ratio * 100} label="Auflösungsquote" format={v => `${Math.round(v)} %`} />
            </div>
          ) : (
            <div className="obs-empty">Noch keine Flags — daher auch keine Auflösung.</div>
          )}
        </HudTile>
      </HudGrid>

      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6 }}>
        Alle Werte sind beobachtbares, log-reproduzierbares Verhalten (Nachrichten, Revisionen, Prüf-Verdicts) —
        keine unterstellten mentalen Zustände. Flags sind hier Arbeitssignale der Dyade, keine Schuldzuweisung.
      </p>
    </div>
  )
}
