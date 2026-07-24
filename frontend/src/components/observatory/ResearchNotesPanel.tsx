import { useState } from 'react'
import { adminFetch, useAdminFetch } from '../../lib/adminApi'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudSkeleton } from './HudSkeleton'
import { HudSectionHeader } from './Hud'
import { RESEARCH_CATEGORY_LABELS, RESEARCH_NOTE_STATUS_LABELS } from '../../lib/labels'

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

const ALL_CATEGORIES = ['paper', 'hypothesis', 'idea', 'concept', 'framework', 'prototype']

const CATEGORY_ACCENT: Record<string, string> = {
  paper: '#3b6bf6', hypothesis: '#8b5cf6', idea: '#14b8a6',
  concept: '#f59e0b', framework: '#10b981', prototype: '#ef4444',
}

// research_notes.status has no CHECK constraint server-side (see
// backend/src/research.rs) — 'active' is just the column default. This is
// the only vocabulary this panel offers; a note is either live in the
// current research picture or archived out of it.
const STATUS_ACCENT: Record<string, string> = { active: '#10b981', archived: '#6b7280' }

// Who wrote a note. Both agents can log into Research Pulse now — Jarvis through
// its own `log_research_note` tool, Hermes through the lab's MCP server (see
// backend/src/mcp.rs) — so the panel has to say WHICH one, or the lab's record of
// who-thought-what is wrong. Anything unrecognised falls back to 'manuell', which
// is what a human-written note has always been.
const SOURCE_LABEL: Record<string, string> = {
  agent: '◆ Jarvis',
  hermes: '△ Hermes',
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

/// One panel, one list, one add-form, one filter/export row — covers all 6
/// categories at once (previously rendered as two entirely separate
/// instances on Research Pulse, own add-form + own filter/export bar each,
/// for what's conceptually one "notes" concern). A "Kategorie" select
/// narrows the view the same way "Status" already does — same closed-
/// vocabulary select convention used everywhere else in this app (AnomalyLog's
/// kind filter, EmergenceMonitor's filters), not a separate tab toggle: each
/// note's own category pill already tells papers from ideas apart on the
/// card itself, so a person browsing "everything" isn't missing that
/// information, only someone who wants to see just one slice needs to filter.
export function ResearchNotesPanel({ addLabel, placeholder, onOpenConversation }: {
  addLabel: string
  placeholder: string
  onOpenConversation?: (conversationId: string) => void
}) {
  const query = `?category=${ALL_CATEGORIES.join(',')}`
  // 18s background poll — same refreshKey idiom EmergenceMonitor uses for its
  // manual "reanalyze" button, just on a timer too: Jarvis's log_research_note
  // tool writes rows here autonomously mid-session, so this panel needs to
  // notice on its own instead of only ever refreshing after a manual submit.
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useAdminFetch<NoteOut[]>(`/api/research/items${query}`, [query, refreshKey], 18000)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES[0])
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Client-side only — the list is already fully loaded (all 6 categories at
  // once) and both status and category have small closed vocabularies, so
  // there's no reason to round-trip to the backend for either filter.
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const list = data ?? []
  const filtered = list
    .filter(n => !statusFilter || n.status === statusFilter)
    .filter(n => !categoryFilter || n.category === categoryFilter)

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await adminFetch(`/api/research/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, title, body }),
      })
      setRefreshKey(k => k + 1)
      setTitle(''); setBody('')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (id: string, status: string) => {
    setUpdatingId(id)
    try {
      await adminFetch(`/api/research/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setRefreshKey(k => k + 1)
    } finally {
      setUpdatingId(null)
    }
  }

  // The backend does an unconditional hard delete (no soft-delete, no status
  // guard — see research::delete_item) and until now nothing in the frontend
  // ever called it (confirmed dead capability, not just unused UI). Same
  // window.confirm pattern as BlogDrafts.tsx and SimulationLab.tsx, adopted
  // after the incident that motivated both: a deliberate second step before
  // an unrecoverable action, since this codebase has no custom modal.
  const remove = async (id: string, title: string) => {
    if (!window.confirm(`„${title}" endgültig löschen?\n\nDas kann nicht rückgängig gemacht werden.`)) return
    setDeletingId(id)
    try {
      await adminFetch(`/api/research/items/${id}`, { method: 'DELETE' })
      setRefreshKey(k => k + 1)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="obs-panel">
      <div className="obs-card">
        <div className="obs-form" style={{ marginBottom: 0 }}>
          <input placeholder={placeholder} value={title} onChange={e => setTitle(e.target.value)} />
          <textarea placeholder="Inhalt" value={body} onChange={e => setBody(e.target.value)} />
          <select value={category} onChange={e => setCategory(e.target.value)}>
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{RESEARCH_CATEGORY_LABELS[c] ?? c}</option>)}
          </select>
          <button className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={submit} disabled={saving || !title.trim()}>
            {saving ? 'Speichert…' : addLabel}
          </button>
        </div>
      </div>

      {list.length > 0 && (
        <HudSectionHeader
          title="Notizen"
          actions={
            <>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ flex: '0 1 160px' }}>
                <option value="">Alle Kategorien</option>
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{RESEARCH_CATEGORY_LABELS[c] ?? c}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ flex: '0 1 160px' }}>
                <option value="">Alle Status</option>
                {Object.keys(STATUS_ACCENT).map(v => <option key={v} value={v}>{RESEARCH_NOTE_STATUS_LABELS[v] ?? v}</option>)}
              </select>
              <ExportButtons
                rows={filtered.map(n => ({
                  id: n.id,
                  category: n.category,
                  title: n.title,
                  body: n.body,
                  tags: n.tags,
                  status: n.status,
                  source: n.source,
                  created_at: n.created_at,
                  updated_at: n.updated_at,
                  source_conversation_id: n.source_conversation_id ?? '',
                }))}
                filenameBase="research-notes"
                title="Research Notes"
              />
            </>
          }
        />
      )}
      {loading && !data && <HudSkeleton variant="list" />}
      {error && <div className="obs-empty">Fehler beim Laden.</div>}
      {list.length === 0 && !loading && !error && <div className="obs-empty">Noch keine Einträge.</div>}
      {list.length > 0 && filtered.length === 0 && <div className="obs-empty">Keine Treffer.</div>}
      {filtered.map((n, i) => {
        const tags = parseTags(n.tags)
        return (
          <div className="obs-item-card" key={n.id} style={{ ...hudStagger(i), ['--obs-accent' as string]: CATEGORY_ACCENT[n.category] ?? '#3b6bf6' }}>
            <div className="obs-item-title">{n.title}</div>
            <div className="obs-item-meta">
              <span className="obs-pill" style={{ background: `${CATEGORY_ACCENT[n.category] ?? '#3b6bf6'}1a`, color: CATEGORY_ACCENT[n.category] ?? '#3b6bf6' }}>{RESEARCH_CATEGORY_LABELS[n.category] ?? n.category}</span>
              {' · '}
              <span className="obs-pill" style={{ background: `${STATUS_ACCENT[n.status] ?? '#3b6bf6'}1a`, color: STATUS_ACCENT[n.status] ?? '#3b6bf6' }}>{RESEARCH_NOTE_STATUS_LABELS[n.status] ?? n.status}</span>
              {' · '}{SOURCE_LABEL[n.source] ?? 'manuell'} · {n.updated_at}
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
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <select
                value={n.status}
                onChange={e => changeStatus(n.id, e.target.value)}
                disabled={updatingId === n.id}
                style={{ fontSize: 11, padding: '3px 6px' }}
              >
                {Object.keys(STATUS_ACCENT).map(v => <option key={v} value={v}>{RESEARCH_NOTE_STATUS_LABELS[v] ?? v}</option>)}
              </select>
              <button
                type="button"
                className="panel-delete-btn"
                style={{ fontSize: 11, padding: '4px 10px' }}
                disabled={deletingId === n.id}
                onClick={() => remove(n.id, n.title)}
              >
                {deletingId === n.id ? 'Löscht…' : 'Löschen'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
