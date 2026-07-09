import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'

interface BlogPost {
  id: string
  title: string
  body: string
  status: string
  source: string
  created_at: string
  updated_at: string
  published_at: string | null
  source_conversation_id: string | null
}

/// Surfaces the blog_posts table (drafted by Jarvis via draft_blog_post, or
/// by a human here directly) — previously invisible: the backend had full
/// CRUD from day one, but nothing in the frontend ever listed these rows.
/// "Veröffentlichen" flips status server-side AND stages a matching entry
/// into the site's real news.items (via onPromoteToSite) — publishing still
/// requires the existing top "Speichern" button to actually go live, same
/// as every other content edit in the builder. Editing here (or by asking
/// Jarvis to revise_blog_post from the source conversation) is the
/// co-authoring loop: a draft is never a one-shot, it can be reopened either
/// way until it's ready to publish.
export function BlogDrafts({ onPromoteToSite, onOpenConversation }: {
  onPromoteToSite: (title: string, body: string) => void
  onOpenConversation?: (conversationId: string) => void
}) {
  const { data, loading } = useAdminFetch<BlogPost[]>('/api/blog/posts')
  const [posts, setPosts] = useState<BlogPost[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const list = posts ?? data ?? []

  const refresh = async () => {
    const res = await fetch(`${API_BASE}/api/blog/posts`, { headers: authHeaders() })
    setPosts(await res.json())
  }

  const publish = async (post: BlogPost) => {
    await fetch(`${API_BASE}/api/blog/posts/${post.id}/publish`, { method: 'POST', headers: authHeaders() })
    onPromoteToSite(post.title, post.body)
    await refresh()
  }

  const remove = async (id: string) => {
    await fetch(`${API_BASE}/api/blog/posts/${id}`, { method: 'DELETE', headers: authHeaders() })
    await refresh()
  }

  const startEdit = (post: BlogPost) => {
    setEditingId(post.id)
    setEditTitle(post.title)
    setEditBody(post.body)
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (id: string) => {
    if (!editTitle.trim() || savingEdit) return
    setSavingEdit(true)
    try {
      await fetch(`${API_BASE}/api/blog/posts/${id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: editTitle, body: editBody }),
      })
      setEditingId(null)
      await refresh()
    } finally {
      setSavingEdit(false)
    }
  }

  const STATUS_ACCENT: Record<string, string> = { draft: '#f59e0b', published: '#10b981' }

  if (loading && !posts) return <div className="obs-empty">Lade…</div>

  return (
    <div>
      <p style={{ fontSize: 12, color: '#9aa0a8', margin: '4px 0 16px', lineHeight: 1.6 }}>
        Entwürfe, die Jarvis (im Forschungstab) oder du hier angelegt habt. „Veröffentlichen" übernimmt den Beitrag in
        den öffentlichen Blog oben — anschließend oben rechts auf „Speichern" klicken, um ihn live zu schalten.
      </p>
      {list.length === 0 && <div className="obs-empty">Noch keine Blogpost-Entwürfe.</div>}
      {list.map(p => (
        <div className="obs-item-card" key={p.id} style={{ ['--obs-accent' as string]: STATUS_ACCENT[p.status] ?? '#3b6bf6' }}>
          {editingId === p.id ? (
            <div className="obs-form" style={{ marginBottom: 0 }}>
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)} />
              <textarea value={editBody} onChange={e => setEditBody(e.target.value)} style={{ minHeight: 140 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px' }} disabled={savingEdit || !editTitle.trim()} onClick={() => saveEdit(p.id)}>
                  {savingEdit ? 'Speichert…' : 'Speichern'}
                </button>
                <button className="panel-delete-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={cancelEdit}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <>
              <div className="obs-item-title">{p.title}</div>
              <div className="obs-item-meta">
                <span className="obs-pill" style={{ background: `${STATUS_ACCENT[p.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[p.status] ?? '#3b6bf6' }}>{p.status}</span>
                {' · '}{p.source === 'agent' ? '🤖 Jarvis' : 'manuell'} · {p.updated_at}
                {p.source_conversation_id && onOpenConversation && (
                  <>
                    {' · '}
                    <button
                      className="chat-inspect-toggle"
                      style={{ fontSize: 11, padding: 0 }}
                      onClick={() => onOpenConversation(p.source_conversation_id!)}
                    >
                      aus Gespräch ↗
                    </button>
                  </>
                )}
              </div>
              <div className="obs-item-body">{p.body}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {p.status === 'draft' && (
                  <>
                    <button className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => publish(p)}>
                      Veröffentlichen
                    </button>
                    <button className="panel-delete-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => startEdit(p)}>
                      Bearbeiten
                    </button>
                  </>
                )}
                {p.status === 'published' && <span className="obs-status-pill ok">✓ Im öffentlichen Blog vorgemerkt</span>}
                <button className="panel-delete-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => remove(p.id)}>Löschen</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
