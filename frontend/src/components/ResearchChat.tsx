import React, { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { authHeaders } from '../lib/adminApi'
import { TOOL_LABELS } from '../lib/toolLabels'
import { TokenBreakdown, type TokenInfo } from './observatory/TokenBreakdown'

interface Conversation { id: string; title: string; created_at: string; updated_at: string }
interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; token_info: string | null; created_at: string }
interface DocumentItem { id: string; filename: string; created_at: string }

interface ToolCallEvent { tool: string; result: string }

async function streamChat(
  conversationId: string,
  message: string,
  siteContent: unknown,
  onDelta: (delta: string, tokens: TokenInfo[]) => void,
  onToolCall: (call: ToolCallEvent) => void,
  onDone: () => void,
  onError: (msg: string) => void,
) {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ conversation_id: conversationId, message, current_module: 'Forschung', site_content: siteContent }),
    })
  } catch {
    onError('Verbindung zum Server fehlgeschlagen.')
    return
  }
  if (!res.ok || !res.body) {
    onError('Der Chat konnte nicht gestartet werden.')
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let eventType = 'message'
      let data = ''
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (eventType === 'error') { onError(data); return }
      if (eventType === 'done') { onDone(); return }
      if (eventType === 'tool_call') {
        try { onToolCall(JSON.parse(data)) } catch { /* ignore malformed frame */ }
        continue
      }
      try {
        const parsed = JSON.parse(data)
        onDelta(parsed.delta || '', parsed.tokens || [])
      } catch { /* partial frame, ignore */ }
    }
  }
  onDone()
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Minimal, safe markdown rendering for model replies — bold, numbered/bulleted
// lists, paragraphs. Builds JSX directly (no dangerouslySetInnerHTML), so
// there's no HTML-injection surface even though the text is model-generated.
// Not a general-purpose parser: covers what these replies actually use.
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : part
  )
}

function renderMarkdown(text: string): React.ReactNode {
  return text.split(/\n{2,}/).map((block, bi) => {
    const lines = block.split('\n').filter(l => l.trim() !== '')
    if (lines.length === 0) return null
    const isNumbered = lines.every(l => /^\d+\.\s/.test(l.trim()))
    const isBulleted = lines.every(l => /^[-*]\s/.test(l.trim()))
    if (isNumbered) {
      return <ol key={bi}>{lines.map((l, li) => <li key={li}>{renderInline(l.trim().replace(/^\d+\.\s/, ''), `${bi}-${li}`)}</li>)}</ol>
    }
    if (isBulleted) {
      return <ul key={bi}>{lines.map((l, li) => <li key={li}>{renderInline(l.trim().replace(/^[-*]\s/, ''), `${bi}-${li}`)}</li>)}</ul>
    }
    return (
      <p key={bi}>
        {lines.map((l, li) => <React.Fragment key={li}>{renderInline(l, `${bi}-${li}`)}{li < lines.length - 1 && <br />}</React.Fragment>)}
      </p>
    )
  })
}

function ToolCallBadge({ call }: { call: ToolCallEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="chat-tool-call">
      <button type="button" className="chat-tool-call-toggle" onClick={() => setOpen(o => !o)}>
        🔧 {TOOL_LABELS[call.tool] ?? call.tool}
      </button>
      {open && <pre className="chat-tool-call-detail">{call.result}</pre>}
    </div>
  )
}

export function ResearchChat({ siteContent, onMessageComplete, openConversationId, onOpenConversationHandled, onUpdate }: {
  siteContent?: unknown
  onMessageComplete?: () => void
  openConversationId?: string | null
  onOpenConversationHandled?: () => void
  onUpdate?: (field: string, value: unknown) => void
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInspector, setShowInspector] = useState<Record<string, boolean>>({})
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallEvent[]>>({})
  const [uploading, setUploading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const baseTitleRef = useRef(document.title)
  const sendingRef = useRef(false)
  const latestConvRequestRef = useRef<string | null>(null)

  // Backgrounded/inactive browser tabs don't get repainted until they're
  // focused again — the reply has already arrived and rendered into the DOM,
  // it just isn't visible yet. Flash the tab title as a cue instead of
  // leaving no indication at all.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) document.title = baseTitleRef.current }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const refreshConversations = () => {
    fetch(`${API_BASE}/api/chat/conversations`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setConversations)
      .catch(() => {})
  }
  const refreshDocuments = () => {
    fetch(`${API_BASE}/api/chat/documents`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setDocuments)
      .catch(() => {})
  }

  useEffect(() => { refreshConversations(); refreshDocuments() }, [])

  // Deliberately not a useEffect keyed on activeId: ensureConversation() below
  // also sets activeId for a brand-new (empty) conversation, and a reload
  // effect firing at that exact moment would race the optimistic message
  // bubbles send() adds right after — overwriting them mid-stream with the
  // (still empty) server state and silently dropping the whole reply.
  function openConversation(id: string) {
    setActiveId(id)
    // Guards against out-of-order resolution: click A then B quickly, and
    // if A's response happens to resolve after B's, this ref (updated
    // synchronously, unlike activeId which lags a render behind) makes A's
    // stale .then() a no-op instead of overwriting B's messages.
    latestConvRequestRef.current = id
    fetch(`${API_BASE}/api/chat/conversations/${id}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (latestConvRequestRef.current === id) setMessages(data) })
      .catch(() => { if (latestConvRequestRef.current === id) setMessages([]) })
  }

  function startNewConversation() {
    latestConvRequestRef.current = null
    setActiveId(null)
    setMessages([])
  }

  // Jump-back from a blog draft's "aus Gespräch: …" link (see BlogDrafts.tsx)
  // into the exact Forschung conversation it grew out of.
  useEffect(() => {
    if (!openConversationId) return
    openConversation(openConversationId)
    onOpenConversationHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConversationId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function ensureConversation(): Promise<string | null> {
    if (activeId) return activeId
    const res = await fetch(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    })
    if (!res.ok) return null
    const conv = await res.json()
    setActiveId(conv.id)
    refreshConversations()
    return conv.id
  }

  async function send(override?: string) {
    const text = (override ?? input).trim()
    // `sendingRef` (not just `streaming` state) closes the real race: two
    // rapid sends on a brand-new conversation both read `streaming === false`
    // from the same render, because `setStreaming(true)` only fires after
    // `await ensureConversation()` — a real network round-trip — resolves.
    // A synchronous ref has no such gap: it's set on the very first line,
    // before any await, so a second call in the same tick sees it immediately.
    if (!text || streaming || sendingRef.current) return
    sendingRef.current = true
    try {
      setError(null)
      const convId = await ensureConversation()
      if (!convId) { setError('Unterhaltung konnte nicht erstellt werden.'); return }

      if (!override) setInput('')
      const userMsg: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: text, token_info: null, created_at: '' }
      const assistantId = `local-assistant-${Date.now()}`
      const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', token_info: null, created_at: '' }
      setMessages(m => [...m, userMsg, assistantMsg])
      setStreaming(true)

      let fullText = ''
      const allTokens: TokenInfo[] = []
      await streamChat(
        convId,
        text,
        siteContent,
        (delta, tokens) => {
          fullText += delta
          allTokens.push(...tokens)
          setMessages(m => m.map(msg => msg.id === assistantId ? { ...msg, content: fullText, token_info: JSON.stringify(allTokens) } : msg))
        },
        (call) => {
          setToolCalls(t => ({ ...t, [assistantId]: [...(t[assistantId] ?? []), call] }))
          // "hey jarvis, lass uns diese karte umschreiben" — applies immediately
          // to the Website Kit draft, same as draft_blog_post/log_research_note
          // already apply immediately server-side. Still draft-only until
          // Laura clicks "Speichern" there, same as any other content edit.
          if (call.tool === 'update_content_field' && onUpdate) {
            try {
              const parsed = JSON.parse(call.result)
              if (parsed.ok && parsed.field) onUpdate(parsed.field, parsed.value)
            } catch { /* malformed tool result, ignore */ }
          }
        },
        () => {
          setStreaming(false)
          refreshConversations()
          onMessageComplete?.()
          if (document.hidden) document.title = `💬 ${baseTitleRef.current}`
        },
        (msg) => { setStreaming(false); setError(msg) },
      )
    } finally {
      sendingRef.current = false
    }
  }

  async function deleteConversation(id: string) {
    await fetch(`${API_BASE}/api/chat/conversations/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (activeId === id) startNewConversation()
    refreshConversations()
  }

  async function uploadFile(file: File) {
    setUploading(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`${API_BASE}/api/chat/documents`, { method: 'POST', headers: authHeaders(), body: form })
      if (!res.ok) setError('Datei konnte nicht verarbeitet werden.')
      refreshDocuments()
    } catch {
      setError('Upload fehlgeschlagen.')
    } finally {
      setUploading(false)
    }
  }

  async function deleteDocument(id: string) {
    await fetch(`${API_BASE}/api/chat/documents/${id}`, { method: 'DELETE', headers: authHeaders() })
    refreshDocuments()
  }

  function exportConversation() {
    const title = conversations.find(c => c.id === activeId)?.title ?? 'unterhaltung'
    const md = messages.map(m => `**${m.role === 'user' ? 'Du' : 'Assistent'}:**\n\n${m.content}\n`).join('\n---\n\n')
    downloadText(`${title.replace(/[^a-z0-9äöüß-]+/gi, '_')}.md`, md)
  }

  return (
    <div className="chat-panel">
      <aside className="chat-sidebar">
        <button className="chat-new-btn" onClick={startNewConversation}>+ Neue Unterhaltung</button>
        <div className="chat-conv-list">
          {conversations.map(c => (
            <div key={c.id} className={`chat-conv-item ${c.id === activeId ? 'active' : ''}`} onClick={() => openConversation(c.id)}>
              <span className="chat-conv-title">{c.title}</span>
              <button
                className="chat-conv-delete"
                title="Löschen"
                onClick={e => { e.stopPropagation(); deleteConversation(c.id) }}
              >×</button>
            </div>
          ))}
          {conversations.length === 0 && <div className="chat-conv-empty">Noch keine Unterhaltungen.</div>}
        </div>

        <div className="chat-docs">
          <div className="chat-docs-title">Dokumente (RAG)</div>
          {documents.map(d => (
            <div key={d.id} className="chat-doc-item">
              <span className="chat-doc-name" title={d.filename}>{d.filename}</span>
              <button className="chat-conv-delete" title="Löschen" onClick={() => deleteDocument(d.id)}>×</button>
            </div>
          ))}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.md,.markdown,.txt"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
          />
          <button className="chat-upload-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? 'Lädt hoch…' : '+ PDF / MD hochladen'}
          </button>
        </div>
      </aside>

      <div className="chat-main">
        <div className="chat-topbar">
          <span>{conversations.find(c => c.id === activeId)?.title ?? 'Neue Unterhaltung'}</span>
          {messages.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="chat-export-btn"
                disabled={streaming}
                onClick={() => send('Fasse unser bisheriges Gespräch in einem Blogpost-Entwurf zusammen und leg ihn mit draft_blog_post an.')}
              >
                Diesen Talk zum Blogpost machen
              </button>
              <button className="chat-export-btn" onClick={exportConversation}>Exportieren</button>
            </div>
          )}
        </div>

        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              Frag einfach los — Konversationen, hochgeladene Dokumente und frühere Gespräche bleiben im Gedächtnis.
            </div>
          )}
          {messages.map(m => {
            const tokens: TokenInfo[] = m.token_info ? JSON.parse(m.token_info) : []
            return (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                {m.role === 'assistant' && (toolCalls[m.id]?.length ?? 0) > 0 && (
                  <div className="chat-tool-calls">
                    {toolCalls[m.id].map((c, i) => <ToolCallBadge key={i} call={c} />)}
                  </div>
                )}
                <div className="chat-bubble-content">
                  {m.role === 'assistant' ? renderMarkdown(m.content) : m.content}
                  {streaming && m.role === 'assistant' && m.content === '' ? '…' : ''}
                </div>
                {m.role === 'assistant' && tokens.length > 0 && (
                  <div className="chat-bubble-tools">
                    <button
                      className="chat-inspect-toggle"
                      onClick={() => setShowInspector(s => ({ ...s, [m.id]: !s[m.id] }))}
                    >
                      {showInspector[m.id] ? 'Token-Analyse ausblenden' : '🔍 Token-Analyse'}
                    </button>
                    {showInspector[m.id] && <TokenBreakdown tokens={tokens} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && <div className="chat-error">{error}</div>}

        <div className="chat-composer">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Nachricht schreiben… (Enter zum Senden, Shift+Enter für Zeilenumbruch)"
            disabled={streaming}
          />
          <button className="chat-send-btn" onClick={() => send()} disabled={streaming || !input.trim()}>
            {streaming ? '…' : 'Senden'}
          </button>
        </div>
      </div>
    </div>
  )
}
