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
}

/// Surfaces the blog_posts table (drafted by Jarvis via draft_blog_post, or
/// by a human here directly) — previously invisible: the backend had full
/// CRUD from day one, but nothing in the frontend ever listed these rows.
/// "Veröffentlichen" flips status server-side AND stages a matching entry
/// into the site's real news.items (via onPromoteToSite) — publishing still
/// requires the existing top "Speichern" button to actually go live, same
/// as every other content edit in the builder.
export function BlogDrafts({ onPromoteToSite }: { onPromoteToSite: (title: string, body: string) => void }) {
  const { data, loading } = useAdminFetch<BlogPost[]>('/api/blog/posts')
  const [posts, setPosts] = useState<BlogPost[] | null>(null)

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

  if (loading && !posts) return <div className="obs-empty">Lade…</div>

  return (
    <div>
      <p style={{ fontSize: 12, color: '#888', margin: '4px 0 14px', lineHeight: 1.6 }}>
        Entwürfe, die Jarvis (im Forschungstab) oder du hier angelegt habt. „Veröffentlichen" übernimmt den Beitrag in
        den öffentlichen Blog oben — anschließend oben rechts auf „Speichern" klicken, um ihn live zu schalten.
      </p>
      {list.length === 0 && <div className="obs-empty">Noch keine Blogpost-Entwürfe.</div>}
      {list.map(p => (
        <div className="obs-item-card" key={p.id}>
          <div className="obs-item-title">{p.title}</div>
          <div className="obs-item-meta">{p.status} · {p.source === 'agent' ? 'von Jarvis' : 'manuell'} · {p.updated_at}</div>
          <div className="obs-item-body">{p.body}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {p.status === 'draft' && (
              <button className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => publish(p)}>
                Veröffentlichen
              </button>
            )}
            {p.status === 'published' && <span style={{ fontSize: 11, color: '#38A169', fontWeight: 700 }}>✓ Im öffentlichen Blog vorgemerkt</span>}
            <button className="panel-delete-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => remove(p.id)}>Löschen</button>
          </div>
        </div>
      ))}
    </div>
  )
}
