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
}

/// Research Workspace and Innovation Lab are the same table filtered by
/// category (see backend/src/research.rs) — one shared panel, two thin
/// wrappers configuring which categories it shows. Avoids building two
/// near-identical CRUD surfaces for structurally identical data.
export function ResearchNotesPanel({ categories, addLabel, placeholder }: {
  categories: string[]
  addLabel: string
  placeholder: string
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
      <div className="obs-form">
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

      {loading && !items && <div className="obs-empty">Lade…</div>}
      {list.length === 0 && !loading && <div className="obs-empty">Noch keine Einträge.</div>}
      {list.map(n => (
        <div className="obs-item-card" key={n.id}>
          <div className="obs-item-title">{n.title}</div>
          <div className="obs-item-meta">{n.category} · {n.source === 'agent' ? 'von Jarvis' : 'manuell'} · {n.updated_at}</div>
          <div className="obs-item-body">{n.body}</div>
        </div>
      ))}
    </div>
  )
}
