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
  const { data, loading } = useAdminFetch<NoteOut[]>(`/api/research/items${query}`, [query])
  const [items, setItems] = useState<NoteOut[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState(categories[0])
  const [saving, setSaving] = useState(false)

  const list = items ?? data ?? []

  const refresh = async () => {
    const res = await fetch(`${API_BASE}/api/research/items${query}`, { headers: authHeaders() })
    setItems(await res.json())
  }

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/research/items`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ category, title, body }),
      })
      await refresh()
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

      {loading && !items && <div className="obs-empty">Lade…</div>}
      {list.length === 0 && !loading && <div className="obs-empty">Noch keine Einträge.</div>}
      {list.map(n => (
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
        </div>
      ))}
    </div>
  )
}
