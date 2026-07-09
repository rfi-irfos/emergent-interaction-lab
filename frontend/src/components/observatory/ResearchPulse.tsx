import { useAdminFetch } from '../../lib/adminApi'
import { ResearchNotesPanel } from './ResearchNotesPanel'
import { SimulationLab } from './SimulationLab'

interface BlogPost { id: string; title: string; status: string; source: string; updated_at: string }

function BlogActivity() {
  const { data, loading } = useAdminFetch<BlogPost[]>('/api/blog/posts')
  if (loading) return <div className="obs-empty">Lade…</div>
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
/// frameworks/prototypes, simulations, and blog activity as a read-only feed
/// (per the lab's own rule: the only place blog may appear in the
/// Observatory — actual editing/publishing stays in Verwaltung → Blog).
/// Consolidates what used to be three separate nav items (Research
/// Workspace, Innovation Lab, Simulation Lab).
export function ResearchPulse() {
  return (
    <div className="obs-panel">
      <div className="obs-section-label">Papers &amp; Hypothesen</div>
      <ResearchNotesPanel categories={['paper', 'hypothesis']} addLabel="Eintrag hinzufügen" placeholder="Titel (Paper oder Hypothese)" />

      <div className="obs-section-label" style={{ marginTop: 8 }}>Ideen, Konzepte &amp; Frameworks</div>
      <ResearchNotesPanel categories={['idea', 'concept', 'framework', 'prototype']} addLabel="Idee hinzufügen" placeholder="Titel (Idee, Konzept, Framework oder Prototyp)" />

      <div className="obs-section-label" style={{ marginTop: 8 }}>Simulationen</div>
      <SimulationLab />

      <div className="obs-section-label" style={{ marginTop: 8 }}>Blog-Aktivität</div>
      <BlogActivity />
    </div>
  )
}
