import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'

interface NoteOut {
  id: string
  category: string
  title: string
  body: string
  tags: string
  status: string
  source: string
  created_at: string
  updated_at: string
  source_conversation_id: string | null
}

const CATEGORY_ACCENT: Record<string, string> = {
  paper: '#3b6bf6', hypothesis: '#8b5cf6', idea: '#14b8a6',
  concept: '#f59e0b', framework: '#10b981', prototype: '#ef4444',
}

// `tags` has been on research_notes since day one — Jarvis's own
// log_research_note(category, title, body, tags?) tool already populates it
// on every note it logs autonomously — but this panel only ever read
// n.category off the row, silently dropping tags on the floor. Free-text
// field, so split defensively on the two separators a model or human is
// likely to use.
function parseTags(raw: string): string[] {
  return raw.split(/[,;]+/).map(t => t.trim()).filter(Boolean)
}

/// Research Workspace and Innovation Lab are the same table filtered by
/// category (see backend/src/research.rs) — one shared panel, two thin
/// wrappers configuring which categories it shows. Avoids building two
/// near-identical CRUD surfaces for structurally identical data.
export function ResearchNotesPanel({ categories, addLabel, placeholder, onOpenConversation }: {
  categories: string[]
  addLabel: string
  placeholder: string
  onOpenConversation?: (conversationId: string) => void
}) {
  const query = `?category=${categories.join(',')}`
  // 18s background poll — same refreshKey idiom EmergenceMonitor uses for its
  // manual "reanalyze" button, just on a timer too: Jarvis's log_research_note
  // tool writes rows here autonomously mid-session, so this panel needs to
  // notice on its own instead of only ever refreshing after a manual submit.
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useAdminFetch<NoteOut[]>(`/api/research/items${query}`, [query, refreshKey], 18000)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState(categories[0])
  const [saving, setSaving] = useState(false)

  const list = data ?? []

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/research/items`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ category, title, body }),
      })
      setRefreshKey(k => k + 1)
      setTitle(''); setBody('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="obs-panel">
      <div className="obs-card">
        <div className="obs-form" style={{ marginBottom: 0 }}>
          <input placeholder={placeholder} value={title} onChange={e => setTitle(e.target.value)} />
          <textarea placeholder="Inhalt" value={body} onChange={e => setBody(e.target.value)} />
          {categories.length > 1 && (
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={saving || !title.trim()}>
            {saving ? 'Speichert…' : addLabel}
          </button>
        </div>
      </div>

      {loading && !data && <div className="obs-empty">Lade…</div>}
      {error && <div className="obs-empty">Fehler beim Laden.</div>}
      {list.length === 0 && !loading && !error && <div className="obs-empty">Noch keine Einträge.</div>}
      {list.map(n => {
        const tags = parseTags(n.tags)
        return (
          <div className="obs-item-card" key={n.id} style={{ ['--obs-accent' as string]: CATEGORY_ACCENT[n.category] ?? '#3b6bf6' }}>
            <div className="obs-item-title">{n.title}</div>
            <div className="obs-item-meta">
              <span className="obs-pill" style={{ background: `${CATEGORY_ACCENT[n.category] ?? '#3b6bf6'}1a`, color: CATEGORY_ACCENT[n.category] ?? '#3b6bf6' }}>{n.category}</span>
              {' · '}{n.source === 'agent' ? '🤖 Jarvis' : 'manuell'} · {n.updated_at}
              {n.source_conversation_id && onOpenConversation && (
                <>
                  {' · '}
                  <button
                    className="chat-inspect-toggle"
                    style={{ fontSize: 11, padding: 0 }}
                    onClick={() => onOpenConversation(n.source_conversation_id!)}
                  >
                    aus Gespräch ↗
                  </button>
                </>
              )}
            </div>
            <div className="obs-item-body">{n.body}</div>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
                {tags.map((t, i) => (
                  <span key={i} className="obs-pill" style={{ background: 'rgba(107,114,128,.12)', color: '#6b7280' }}>{t}</span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
