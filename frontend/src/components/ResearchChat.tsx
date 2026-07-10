import React, { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { authHeaders } from '../lib/adminApi'
import { TOOL_LABELS } from '../lib/toolLabels'
import { TokenBreakdown, type TokenInfo } from './observatory/TokenBreakdown'

interface Conversation { id: string; title: string; created_at: string; updated_at: string }
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  token_info: string | null
  created_at: string
  // Only ever set locally while a message is still streaming in (see
  // send()'s batched flush below): the live token array kept as an actual
  // array, not round-tripped through JSON.stringify/parse on every delta the
  // way `token_info` (mirroring the server's stored TEXT column) would need.
  // Cleared/superseded by `token_info` once streaming finishes.
  liveTokens?: TokenInfo[]
}
interface DocumentItem { id: string; filename: string; created_at: string }

interface ToolCallEvent { tool: string; result: string }

// Stable reference for "no tool calls on this message" — a fresh `[]` at the
// call site would give ChatBubble a new array identity every render even
// when nothing changed, defeating its React.memo (see ChatBubble below).
const EMPTY_TOOL_CALLS: ToolCallEvent[] = []

async function streamChat(
  conversationId: string,
  message: string,
  siteContent: unknown,
  reasoningRequested: boolean,
  onDelta: (delta: string, tokens: TokenInfo[]) => void,
  onReasoning: (delta: string) => void,
  onToolCall: (call: ToolCallEvent) => void,
  onDone: () => void,
  onError: (msg: string) => void,
) {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        conversation_id: conversationId,
        message,
        current_module: 'Forschung',
        site_content: siteContent,
        reasoning_requested: reasoningRequested,
      }),
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
      // Reasoning models (e.g. deepseek-ai/deepseek-r1, if it's the one
      // actually serving a given request — see backend/src/chat.rs's model
      // ladder) stream step-by-step reasoning as its own event type, kept
      // entirely separate from the visible reply text.
      if (eventType === 'reasoning') {
        try { onReasoning(JSON.parse(data).delta || '') } catch { /* ignore malformed frame */ }
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

interface WebSearchResultItem { title: string; url: string; snippet: string }
interface WebSearchResult {
  ok?: boolean
  query?: string
  results?: WebSearchResultItem[]
  note?: string
  error?: string
}

// Its own distinct badge (not the generic 🔧 one) — real live web results
// deserve to look and read differently from an internal tool's JSON dump,
// and the honesty framing (live results, thin coverage, no fabrication)
// belongs right next to the results themselves, not buried in raw JSON.
function WebSearchBadge({ call }: { call: ToolCallEvent }) {
  const [open, setOpen] = useState(false)
  let parsed: WebSearchResult = {}
  try { parsed = JSON.parse(call.result) } catch { /* malformed tool result */ }
  const results = parsed.results ?? []
  return (
    <div className="chat-tool-call chat-web-search">
      <button type="button" className="chat-tool-call-toggle chat-web-search-toggle" onClick={() => setOpen(o => !o)}>
        🔍 Web-Suche{parsed.query ? `: „${parsed.query}"` : ''}
      </button>
      {open && (
        <div className="chat-web-search-detail">
          {parsed.ok === false ? (
            <div className="chat-web-search-empty">{parsed.error ?? 'Websuche fehlgeschlagen.'}</div>
          ) : results.length === 0 ? (
            <div className="chat-web-search-empty">{parsed.note ?? 'Keine Treffer gefunden.'}</div>
          ) : (
            <ul className="chat-web-search-results">
              {results.map((r, i) => (
                <li key={i}>
                  {r.url
                    ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
                    : <strong>{r.title}</strong>}
                  {r.snippet && <span className="chat-web-search-snippet">{r.snippet}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="chat-web-search-footnote">
            Echte, live abgerufene DuckDuckGo-Ergebnisse — keine Erfindung, aber nicht zwangsläufig vollständig.
          </div>
        </div>
      )}
    </div>
  )
}

// Shown BEFORE the final answer, streamed live the same way the main reply
// is — only ever populated for a request an actual reasoning-capable model
// (e.g. deepseek-ai/deepseek-r1) served; for every other model this simply
// never mounts (see the `reasoning`/`unavailable` prop check at the call
// site). Expanded (`open`) by default — Simeon explicitly asked to SEE the
// thinking, not have it hidden behind a click.
function ReasoningBlock({ text, streaming, unavailable }: { text: string; streaming: boolean; unavailable?: boolean }) {
  const [open, setOpen] = useState(true)
  // Reasoning was explicitly requested (toggle ON) but this exchange's
  // response never carried any reasoning_content — the model that actually
  // served it isn't reasoning-capable (or isn't entitled on this account).
  // Say so plainly instead of silently doing nothing (which reads as a bug)
  // or fabricating a trace (this app's no-fabrication ethos applies here too).
  if (unavailable) {
    return (
      <div className="chat-reasoning chat-reasoning-unavailable">
        🧠 Kein Reasoning-Modell aktuell verfügbar.
      </div>
    )
  }
  return (
    <div className="chat-reasoning">
      <button type="button" className="chat-reasoning-toggle" onClick={() => setOpen(o => !o)}>
        🧠 {open ? 'Denkprozess ausblenden' : 'Denkprozess anzeigen'}
      </button>
      {open && (
        <div className="chat-reasoning-content">
          {text}
          {streaming ? ' …' : ''}
        </div>
      )}
    </div>
  )
}

// Copies the rendered markdown source (what the model actually said), not
// the rendered HTML/DOM — matches how "Exportieren" already treats message
// content elsewhere in this file.
function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`chat-copy-btn ${copied ? 'copied' : ''}`}
      title="In Zwischenablage kopieren"
      onClick={() => {
        navigator.clipboard.writeText(content).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }).catch(() => {})
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

// Memoized so a delta landing on the actively-streaming message doesn't
// force every OTHER bubble in the conversation to re-run renderMarkdown and
// re-parse its token_info — React bails out of re-rendering a bubble
// entirely whenever its own props are unchanged. The internal useMemo calls
// additionally protect against the one case React.memo can't: this
// component's OWN local state changing (opening "Token-Analyse") — without
// them, toggling the inspector would otherwise needlessly re-run
// renderMarkdown on unchanged text just because the component re-rendered.
const ChatBubble = React.memo(function ChatBubble({
  message, toolCalls, reasoning, reasoningUnavailable, streamingEmpty,
}: {
  message: ChatMessage
  toolCalls: ToolCallEvent[]
  reasoning?: string
  // True once streaming has finished for this message, reasoning was
  // explicitly requested (toggle was ON when it was sent), and no
  // reasoning_content ever arrived — see send()'s onDone handler.
  reasoningUnavailable?: boolean
  // True while this specific bubble is the one actively streaming in with
  // no visible content yet — doubles as "the reasoning block (if any) is
  // still live" since reasoning always finishes before the main answer
  // starts arriving.
  streamingEmpty: boolean
}) {
  const [showInspector, setShowInspector] = useState(false)
  const tokens = useMemo<TokenInfo[]>(
    () => message.liveTokens ?? (message.token_info ? JSON.parse(message.token_info) : []),
    [message.liveTokens, message.token_info],
  )
  const rendered = useMemo(
    () => (message.role === 'assistant' ? renderMarkdown(message.content) : message.content),
    [message.role, message.content],
  )
  return (
    <div className={`chat-bubble ${message.role}`}>
      {message.role === 'assistant' && toolCalls.length > 0 && (
        <div className="chat-tool-calls">
          {toolCalls.map((c, i) => (
            c.tool === 'web_search' ? <WebSearchBadge key={i} call={c} /> : <ToolCallBadge key={i} call={c} />
          ))}
        </div>
      )}
      {message.role === 'assistant' && (!!reasoning || reasoningUnavailable) && (
        <ReasoningBlock text={reasoning ?? ''} streaming={streamingEmpty} unavailable={!reasoning && !!reasoningUnavailable} />
      )}
      <div className="chat-bubble-content">
        {message.role === 'assistant' && message.content !== '' && <CopyMessageButton content={message.content} />}
        {rendered}
        {streamingEmpty ? '…' : ''}
      </div>
      {message.role === 'assistant' && tokens.length > 0 && (
        <div className="chat-bubble-tools">
          <button className="chat-inspect-toggle" onClick={() => setShowInspector(s => !s)}>
            {showInspector ? 'Token-Analyse ausblenden' : '🔍 Token-Analyse'}
          </button>
          {showInspector && <TokenBreakdown tokens={tokens} />}
        </div>
      )}
    </div>
  )
})

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
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallEvent[]>>({})
  const [reasoningById, setReasoningById] = useState<Record<string, string>>({})
  // Default OFF: most models on this account aren't reasoning-capable, so
  // forcing an attempt against deepseek-ai/deepseek-r1 on every message
  // would just cost a wasted failed round-trip (see build_model_ladder on
  // the backend). Explicitly opt in when you actually want to see the
  // step-by-step thinking.
  const [reasoningEnabled, setReasoningEnabled] = useState(false)
  // Per-message: true once a message that WAS sent with reasoning requested
  // finishes streaming without ever receiving any reasoning_content — see
  // send()'s onDone handler below. Drives the honest "kein Reasoning-Modell
  // verfügbar" note instead of silently showing nothing.
  const [reasoningUnavailableById, setReasoningUnavailableById] = useState<Record<string, boolean>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
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

      // Snapshot the toggle at send-time: if it flips mid-stream, this
      // exchange still honors whatever the user actually asked for when
      // they hit send.
      const reasoningWasRequested = reasoningEnabled

      let fullText = ''
      let reasoningText = ''
      const allTokens: TokenInfo[] = []

      // Deltas can arrive far faster than a screen repaints (the exact
      // complaint behind "the typewriter effect is buffering differently
      // than the actual model output speed"): without batching, every
      // single delta forced a full messages.map() PLUS a from-scratch
      // renderMarkdown() over the ever-growing reply text — work that grows
      // with the reply, so a long answer got slower to render per token as
      // it went. Coalescing every delta that lands within one animation
      // frame into a single state update caps re-render/re-parse cost at
      // the screen's own refresh rate, however fast tokens actually arrive.
      let rafId: number | null = null
      const flush = () => {
        rafId = null
        // A snapshot (`.slice()`), not the live `allTokens` reference itself:
        // ChatBubble's internal useMemo keys off `message.liveTokens`'
        // identity to decide whether to re-derive `tokens` — since
        // `allTokens` is mutated in place across the WHOLE round, reusing
        // that same reference here would mean every flush after the first
        // non-empty one gets treated as "unchanged" and silently stops
        // updating the Token-Analyse view. Copying only once per animation
        // frame (not once per delta) keeps this cheap.
        const tokensSnapshot = allTokens.slice()
        setMessages(m => m.map(msg => msg.id === assistantId ? { ...msg, content: fullText, liveTokens: tokensSnapshot } : msg))
        if (reasoningText) setReasoningById(r => ({ ...r, [assistantId]: reasoningText }))
      }
      const scheduleFlush = () => {
        if (rafId === null) rafId = requestAnimationFrame(flush)
      }
      const flushNow = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        flush()
      }

      await streamChat(
        convId,
        text,
        siteContent,
        reasoningWasRequested,
        (delta, tokens) => {
          fullText += delta
          if (tokens.length) allTokens.push(...tokens)
          scheduleFlush()
        },
        (delta) => {
          reasoningText += delta
          scheduleFlush()
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
          flushNow()
          // Fold the live array into `token_info` (a JSON string) exactly
          // like a server-loaded message carries it, dropping the transient
          // `liveTokens` — matches the shape historical messages arrive in
          // from GET /conversations/:id.
          setMessages(m => m.map(msg => msg.id === assistantId
            ? { ...msg, content: fullText, token_info: JSON.stringify(allTokens), liveTokens: undefined }
            : msg))
          // Reasoning was explicitly asked for but nothing ever arrived —
          // the model that actually served this exchange isn't
          // reasoning-capable (or isn't entitled on this account right now).
          // Say so honestly rather than leaving the toggle looking like it
          // silently did nothing.
          if (reasoningWasRequested && reasoningText.trim() === '') {
            setReasoningUnavailableById(u => ({ ...u, [assistantId]: true }))
          }
          setStreaming(false)
          refreshConversations()
          onMessageComplete?.()
          if (document.hidden) document.title = `💬 ${baseTitleRef.current}`
        },
        (msg) => { flushNow(); setStreaming(false); setError(msg) },
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

  async function uploadOne(file: File): Promise<boolean> {
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`${API_BASE}/api/chat/documents`, { method: 'POST', headers: authHeaders(), body: form })
      return res.ok
    } catch {
      return false
    }
  }

  // Uploads/embeds each file in sequence against the existing one-file-per-
  // request endpoint — simpler than teaching the backend a multi-file
  // request shape, and it's already a clean single-file POST. Sequential
  // (not Promise.all) so uploadProgress reflects real progress and one huge
  // PDF doesn't starve the others sharing the connection.
  async function uploadFiles(files: File[]) {
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    const failed: string[] = []
    for (let i = 0; i < files.length; i++) {
      setUploadProgress({ current: i + 1, total: files.length })
      const ok = await uploadOne(files[i])
      if (!ok) failed.push(files[i].name)
      refreshDocuments()
    }
    setUploadProgress(null)
    setUploading(false)
    if (failed.length > 0) {
      setError(`${failed.length} von ${files.length} Dateien konnten nicht verarbeitet werden: ${failed.join(', ')}`)
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
            multiple
            style={{ display: 'none' }}
            onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) uploadFiles(files); e.target.value = '' }}
          />
          <button className="chat-upload-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading
              ? (uploadProgress ? `Lädt hoch… (${uploadProgress.current}/${uploadProgress.total})` : 'Lädt hoch…')
              : '+ PDF / MD hochladen'}
          </button>
        </div>
      </aside>

      <div className="chat-main">
        <div className="chat-topbar">
          <span>{conversations.find(c => c.id === activeId)?.title ?? 'Neue Unterhaltung'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`chat-export-btn chat-reasoning-toggle-btn ${reasoningEnabled ? 'active' : ''}`}
              onClick={() => setReasoningEnabled(v => !v)}
              title={reasoningEnabled
                ? 'Reasoning an: versucht zuerst das Denkprozess-Modell, zeigt den Denkprozess an'
                : 'Reasoning aus: direkte Antworten ohne den Versuch, ein Reasoning-Modell zu erreichen'}
            >
              🧠 Reasoning {reasoningEnabled ? 'an' : 'aus'}
            </button>
            {messages.length > 0 && (
              <>
                <button
                  className="chat-export-btn"
                  disabled={streaming}
                  onClick={() => send('Fasse unser bisheriges Gespräch in einem Blogpost-Entwurf zusammen und leg ihn mit draft_blog_post an.')}
                >
                  Diesen Talk zum Blogpost machen
                </button>
                <button className="chat-export-btn" onClick={exportConversation}>Exportieren</button>
              </>
            )}
          </div>
        </div>

        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              Frag einfach los — Konversationen, hochgeladene Dokumente und frühere Gespräche bleiben im Gedächtnis.
            </div>
          )}
          {messages.map(m => (
            <ChatBubble
              key={m.id}
              message={m}
              toolCalls={toolCalls[m.id] ?? EMPTY_TOOL_CALLS}
              reasoning={reasoningById[m.id]}
              reasoningUnavailable={reasoningUnavailableById[m.id]}
              streamingEmpty={streaming && m.role === 'assistant' && m.content === ''}
            />
          ))}
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
