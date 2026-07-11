import { useAdminFetch } from '../../lib/adminApi'
import { ResearchNotesPanel } from './ResearchNotesPanel'
import { HudSkeleton } from './HudSkeleton'
import type { AdminSection } from '../../types/admin'

interface BlogPost { id: string; title: string; status: string; source: string; updated_at: string }

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
          <span className="obs-activity-kind">{p.status}</span>
          <span className="obs-activity-label">{p.source === 'agent' ? '🤖 ' : ''}{p.title}</span>
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
export function ResearchPulse({ onNavigate, onOpenConversation }: {
  onNavigate: (s: AdminSection) => void
  onOpenConversation?: (conversationId: string) => void
}) {
  return (
    <div className="obs-panel">
      <div className="obs-section-label">Papers &amp; Hypothesen</div>
      <ResearchNotesPanel categories={['paper', 'hypothesis']} addLabel="Eintrag hinzufügen" placeholder="Titel (Paper oder Hypothese)" onOpenConversation={onOpenConversation} />

      <div className="obs-section-label" style={{ marginTop: 8 }}>Ideen, Konzepte &amp; Frameworks</div>
      <ResearchNotesPanel categories={['idea', 'concept', 'framework', 'prototype']} addLabel="Idee hinzufügen" placeholder="Titel (Idee, Konzept, Framework oder Prototyp)" onOpenConversation={onOpenConversation} />

      <div className="obs-section-label" style={{ marginTop: 8 }}>Simulationen</div>
      <button type="button" className="panel-add-btn" onClick={() => onNavigate('simulationcenter')}>
        → Simulation Center öffnen
      </button>

      <div className="obs-section-label" style={{ marginTop: 24 }}>Blog-Aktivität</div>
      <BlogActivity />
    </div>
  )
}
