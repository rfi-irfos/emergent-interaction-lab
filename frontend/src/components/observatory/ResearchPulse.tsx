import { useAdminFetch } from '../../lib/adminApi'
import { ResearchNotesPanel } from './ResearchNotesPanel'
import { HudSkeleton } from './HudSkeleton'
import { HudSectionHeader } from './Hud'
import type { AdminSection } from '../../types/admin'
import { BLOG_STATUS_LABELS } from '../../lib/labels'

interface BlogPost { id: string; title: string; status: string; source: string; updated_at: string }

// draft/published is a real 2-value status, not a rotating identity —
// previously this badge carried no color of its own, so it fell straight
// through to .obs-activity-kind's positional nth-child(4n+…) rotation
// (blue/purple/teal/amber purely by ROW INDEX), the exact "no shared
// meaning" anti-pattern the design pass targeted. draft = still in
// progress (--sem-warning), published = done (--sem-success).
const BLOG_STATUS_ACCENT: Record<string, string> = { draft: 'var(--sem-warning)', published: 'var(--sem-success)' }

function BlogActivity() {
  // 18s poll — Jarvis's draft_blog_post/revise_blog_post tools write here
  // autonomously mid-session; this feed should notice without the user
  // navigating away from Research Pulse and back.
  const { data, loading, error } = useAdminFetch<BlogPost[]>('/api/blog/posts', [], 18000)
  if (loading) return <HudSkeleton variant="list" rows={2} />
  if (error) return <div className="obs-card"><div className="obs-empty">Fehler beim Laden.</div></div>
  const posts = (data ?? []).slice(0, 8)
  if (posts.length === 0) return <div className="obs-card"><div className="obs-empty">Noch keine Blogbeiträge.</div></div>
  return (
    <div className="obs-card">
      {posts.map(p => (
        <div className="obs-activity-row" key={p.id}>
          <span className="obs-activity-kind" style={{ background: BLOG_STATUS_ACCENT[p.status] ?? 'var(--sem-neutral)' }}>{BLOG_STATUS_LABELS[p.status] ?? p.status}</span>
          <span className="obs-activity-label">{p.source === 'agent' ? '◆ ' : ''}{p.title}</span>
          <span className="obs-activity-ts">{p.updated_at}</span>
        </div>
      ))}
    </div>
  )
}

/// Research activity in one place: papers/hypotheses, ideas/concepts/
/// frameworks/prototypes, and blog activity as a read-only feed (per the
/// lab's own rule: the only place blog may appear in the Observatory —
/// actual editing/publishing stays in Verwaltung → Blog). Simulations used
/// to be embedded here too, but moved to their own "Simulation Center" —
/// simulation is a Kernbereich in its own right, not a Research Pulse
/// sub-panel (see plan). Notes/ideas can each carry a source_conversation_id
/// back to the Forschung talk that prompted them (see ResearchNotesPanel).
///
/// HONEST NOTE (2026-08-01 HUD migration pass): this module is genuinely
/// thin relative to what its sidebar label ("Research Pulse") promises —
/// almost all of its real content lives inside <ResearchNotesPanel> (a
/// separate component, out of scope for this pass) plus two one-line
/// delegations (a button linking out to Simulation Center, and a read-only
/// blog feed that's a deliberate cross-link, not this module's own data).
/// This pass only swapped the two bare obs-section-label divs for
/// HudSectionHeader — it does NOT invent new metrics/content here to make
/// the page look fuller than it is; that would be fabricating data the
/// backend doesn't have. If "Research Pulse" is meant to carry more than
/// "notes panel + 2 links," that's a product/backend scope question for a
/// separate pass, not something to paper over with decoration.
export function ResearchPulse({ onNavigate, onOpenConversation }: {
  onNavigate: (s: AdminSection) => void
  onOpenConversation?: (conversationId: string) => void
}) {
  return (
    <div className="obs-panel">
      <ResearchNotesPanel addLabel="Eintrag hinzufügen" placeholder="Titel" onOpenConversation={onOpenConversation} />

      <HudSectionHeader title="Simulationen" />
      <button type="button" className="panel-add-btn" onClick={() => onNavigate('simulationcenter')}>
        → Simulation Center öffnen
      </button>

      <div style={{ marginTop: 24 }}>
        <HudSectionHeader title="Blog-Aktivität" />
      </div>
      <BlogActivity />
    </div>
  )
}
