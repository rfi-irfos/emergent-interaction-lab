import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { authHeaders } from '../lib/adminApi'
import { TOOL_LABELS } from '../lib/toolLabels'
import { renderMarkdown } from '../lib/markdown'
import { groupByDate, type DateGroup } from '../lib/dateGroups'
import { downloadText } from '../lib/export'
import { TokenBreakdown, type TokenInfo } from './observatory/TokenBreakdown'

// `kind` — 'chat' (a conversation Laura started), 'agent' (ambient Jarvis
// dock, never listed here — see backend/src/chat.rs's list_conversations),
// or 'digest' (Jarvis's own proactive weekly digest, see backend/src/
// digest.rs — merged into this same default `kind=chat` sidebar query so it
// shows up without a separate UI surface, but visually flagged below so it
// never reads as a conversation Laura started herself).
interface Conversation { id: string; title: string; created_at: string; updated_at: string; kind: string }
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
  // Hallucination Tracker v1 (see backend/src/hallucination.rs): the detail
  // text of a real, CERTAIN 'mismatch' between one of this message's own
  // linked tool calls and what this text claims about it — null/absent for
  // all three of "no tool call this turn," "every check came back
  // match/unverifiable," and "the background check hasn't run yet." Only
  // ever set on a message freshly loaded via GET .../conversations/:id (the
  // check runs after the SSE stream already finished) — a message still
  // streaming in this session never has it yet.
  hallucination_mismatch?: string | null
}
interface DocumentItem { id: string; filename: string; created_at: string }

interface ToolCallEvent { tool: string; result: string }

// One stored Hermes memory (mem0), as surfaced via the tool's own result
// JSON. mem0's actual field names aren't pinned down against a live
// deployment yet (this panel was built before eil-hermes' vector memory
// could be tested end to end) - every field optional and rendering falls
// back to the raw JSON string, so an unexpected shape degrades to "shows the
// data, just not prettied up" rather than a blank panel or a crash.
interface MemoryEntry {
  id?: string
  memory?: string
  text?: string
  content?: string
  created_at?: string
  raw: string
}

// Client-side date bucketing for the sidebar (no new backend endpoint
// needed — grouping is derived purely from each conversation's existing
// `updated_at`), via the shared groupByDate helper in lib/dateGroups.ts
// (also used by observatory/Inbox.tsx). `conversations` already arrives
// sorted newest-first (see list_conversations' `ORDER BY updated_at DESC`),
// which groupByDate relies on to avoid re-sorting.
type ConversationGroup = DateGroup<Conversation>
function groupConversationsByDate(conversations: Conversation[]): ConversationGroup[] {
  return groupByDate(conversations, c => c.updated_at)
}

// Stable reference for "no tool calls on this message" — a fresh `[]` at the
// call site would give ChatBubble a new array identity every render even
// when nothing changed, defeating its React.memo (see ChatBubble below).
const EMPTY_TOOL_CALLS: ToolCallEvent[] = []

/// Which agent engine answers a research turn. 'builtin' is Jarvis's own NVIDIA
/// tool loop and is always available; 'hermes' is a Hermes agent running as a
/// server-side service, offered only when the backend reports it configured
/// (GET /api/chat/engines). Both stream the same SSE dialect, so everything
/// below this line renders a Hermes turn with the code that renders a built-in
/// one — the engine choice changes who thinks, not how it's displayed.
type ChatEngine = 'builtin' | 'hermes'

async function streamChat(
  conversationId: string,
  message: string,
  siteContent: unknown,
  reasoningRequested: boolean,
  // Which agent answers this turn: the built-in NVIDIA loop, or a Hermes agent
  // running server-side (see backend/src/hermes.rs). The backend ignores
  // 'hermes' entirely when no Hermes is configured and answers with the
  // built-in engine instead, so a stale tab can never get stuck on an engine
  // that has gone away.
  engine: ChatEngine,
  // "LKS" kill-switch: lets send() cut the connection from a stable ref
  // (see ResearchChat's streamAbortControllerRef) without waiting for the
  // server to notice — see the two catch blocks below for why an aborted
  // fetch/read must NOT be treated as onError the way a real network
  // failure is: the caller (stopStreaming) already durably persists the
  // partial reply and resets UI state itself, so surfacing a second,
  // misleading "Verbindung fehlgeschlagen" error here would be wrong.
  signal: AbortSignal,
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
        engine,
      }),
      signal,
    })
  } catch {
    if (signal.aborted) return
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
  try {
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
  } catch {
    // A dropped connection can't distinguish "user clicked LKS" from "wifi
    // died" on its own — but the abort case is already fully handled by
    // stopStreaming (persists the accumulated text, resets `streaming`), so
    // only a genuine mid-stream failure should reach onError here.
    if (signal.aborted) return
    onError('Verbindung zum Chat unterbrochen.')
    return
  }
  onDone()
}

// renderMarkdown/renderInline (bold, numbered/bulleted lists, paragraphs —
// no HTML-injection surface, builds JSX directly) now lives in
// ../lib/markdown, shared with published blog post bodies in PublicSite.tsx
// / BlogPostPage.tsx.

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

// Hallucination Tracker v1 badge (see backend/src/hallucination.rs and the
// .obs-badge-mismatch doc comment in App.css for the full family/color
// reasoning). Deliberately the mirror image of ToolCallBadge/WebSearchBadge
// above and ReasoningBlock below: those render whenever there's something
// TO show; this renders ONLY on a genuine problem (a 'mismatch' verdict)
// and stays entirely absent on 'match'/'unverifiable'/not-yet-checked —
// matching this codebase's "don't clutter with confirmations, only flag
// real problems" convention. `detail` is the comparison's own plain-language
// explanation (see hallucination.rs::compare), shown as the tooltip so
// Laura can see exactly what was compared, not just that something's off.
function HallucinationMismatchBadge({ detail }: { detail: string }) {
  return (
    <div className="obs-badge-mismatch" title={detail}>
      Unstimmige Angabe zum Werkzeug-Ergebnis
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

// Same hover-revealed convention as CopyMessageButton above, mirrored onto
// user bubbles instead of assistant ones — an edit affordance, not a copy
// one. Kept as its own tiny component (rather than inlined) for the same
// reason CopyMessageButton is: a stable, obviously-named unit the memoized
// ChatBubble below can render without pulling any edit-flow state into
// itself.
function EditMessageButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="chat-edit-btn" title="Nachricht bearbeiten" onClick={onClick}>
      ✎
    </button>
  )
}

// Replaces a user bubble's normal read-only content while that specific
// message is being edited. Owns its OWN local textarea state (seeded once
// from `initialText`) rather than lifting every keystroke up into
// ResearchChat's state — editing is a single-message, user-driven
// interaction, so there's no reason a keystroke here should risk touching
// ChatBubble's memoization for every OTHER bubble the way a delta does (see
// ChatBubble's own doc comment below).
function UserMessageEditForm({ initialText, onCancel, onConfirm }: {
  initialText: string
  onCancel: () => void
  onConfirm: (text: string) => void
}) {
  const [text, setText] = useState(initialText)
  const trimmed = text.trim()
  return (
    <div className="chat-edit-form">
      <textarea
        className="chat-edit-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (trimmed) onConfirm(text) }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        autoFocus
      />
      <div className="chat-edit-actions">
        <button type="button" className="chat-edit-cancel" onClick={onCancel}>Abbrechen</button>
        <button type="button" className="chat-edit-confirm" disabled={!trimmed} onClick={() => onConfirm(text)}>Senden</button>
      </div>
    </div>
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
  isEditing, editAllowed, onStartEdit, onCancelEdit, onConfirmEdit,
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
  // True while THIS message is the one currently being edited — swaps its
  // content for UserMessageEditForm instead of the normal read-only view.
  isEditing: boolean
  // False while a reply is actively streaming (editing an earlier message
  // mid-stream would race the in-flight exchange — see editAndResend's own
  // doc comment in ResearchChat below) — hides the edit affordance
  // entirely rather than showing it disabled, matching how the composer's
  // upload button etc. simply don't invite an action that can't work right now.
  editAllowed: boolean
  // Stable (useCallback, empty deps) across every render — see
  // ResearchChat's own comment above these three for why that matters: a
  // fresh closure identity here on every render would defeat this
  // component's React.memo on every single streaming flush, not just when
  // an edit is actually happening.
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onConfirmEdit: (id: string, text: string) => void
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
      {message.role === 'assistant' && message.hallucination_mismatch && (
        <HallucinationMismatchBadge detail={message.hallucination_mismatch} />
      )}
      {message.role === 'assistant' && (!!reasoning || reasoningUnavailable) && (
        <ReasoningBlock text={reasoning ?? ''} streaming={streamingEmpty} unavailable={!reasoning && !!reasoningUnavailable} />
      )}
      <div className="chat-bubble-content">
        {message.role === 'assistant' && message.content !== '' && <CopyMessageButton content={message.content} />}
        {message.role === 'user' && editAllowed && !isEditing && (
          <EditMessageButton onClick={() => onStartEdit(message.id)} />
        )}
        {message.role === 'user' && isEditing ? (
          <UserMessageEditForm
            initialText={message.content}
            onCancel={onCancelEdit}
            onConfirm={text => onConfirmEdit(message.id, text)}
          />
        ) : (
          <>
            {rendered}
            {streamingEmpty ? '…' : ''}
          </>
        )}
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

// This is Laura's primary hours-long-conversation surface — on anything
// narrower than a normal desktop the 240px conversation list ate most of the
// room actually meant for chatting, with no way to get it back (unlike
// .crm-sidebar, which has had a collapse toggle all along). Same
// localStorage-persisted pattern as AdminPanel's loadSidebarCollapsed, but
// defaulting to collapsed on a narrow viewport's very first visit (no stored
// preference yet) instead of always starting expanded — a first-time visit
// on a small screen shouldn't have to discover the toggle before it can chat.
function loadChatSidebarCollapsed(): boolean {
  try {
    const stored = localStorage.getItem('rfi_chat_sidebar_collapsed')
    if (stored !== null) return stored === '1'
  } catch { /* localStorage unavailable */ }
  return typeof window !== 'undefined' && window.innerWidth < 900
}

export function ResearchChat({ siteContent, onMessageComplete, openConversationId, onOpenConversationHandled, onUpdate }: {
  siteContent?: unknown
  onMessageComplete?: () => void
  openConversationId?: string | null
  onOpenConversationHandled?: () => void
  onUpdate?: (field: string, value: unknown) => void
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(loadChatSidebarCollapsed)
  const toggleChatSidebar = () => {
    setChatSidebarCollapsed(c => {
      const next = !c
      try { localStorage.setItem('rfi_chat_sidebar_collapsed', next ? '1' : '0') } catch { /* localStorage unavailable */ }
      return next
    })
  }
  // Raw input value (updates on every keystroke, for a responsive-feeling
  // textbox) vs. the debounced value that actually drives the backend query
  // — see the debounce effect below. Kept separate so the input never feels
  // laggy even though the network request behind it is throttled.
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [memoryLoaded, setMemoryLoaded] = useState(false)
  // A dedicated conversation Hermes's memory queries run in, created once and
  // reused — kind: 'memory-browser' (not 'chat') so list_conversations'
  // default filter (chat.rs's `kind.unwrap_or("chat")`) never surfaces it in
  // the ordinary sidebar list. Cached in a ref, not state: creating it is a
  // one-time side effect the panel shouldn't re-trigger on every render.
  const memoryConversationIdRef = useRef<string | null>(null)
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
  // Engine selection is automatic, not a user choice (2026-07-13: dropped the
  // manual picker — Hermes is the one brain behind Forschung now, not an
  // option someone flips). `hermesAvailable` stays false unless the backend
  // says otherwise, in which case every turn silently routes to Hermes; a
  // deployment without Hermes configured (or a Hermes host that's briefly
  // down) falls back to the built-in engine as a reliability backstop, never
  // as something a visitor picks.
  const [hermesAvailable, setHermesAvailable] = useState(false)
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
  // "LKS" kill-switch: the AbortController for whichever streamChat() call
  // is currently in flight (null when nothing is streaming), plus a live
  // snapshot of what's been accumulated so far — both read synchronously by
  // stopStreaming() below, entirely outside React state so clicking LKS
  // never has to wait on a render to know what to POST.
  const streamAbortControllerRef = useRef<AbortController | null>(null)
  const streamingSnapshotRef = useRef<{ conversationId: string; text: string } | null>(null)
  // Edit-and-resend: which user message (if any) is currently showing its
  // inline edit form in place of normal read-only content.
  const [editingId, setEditingId] = useState<string | null>(null)
  // Same out-of-order guard as latestConvRequestRef below, but for the
  // sidebar list itself: refreshConversations() is fired from 5+
  // independent triggers (mount, debounced search, after delete, after
  // ensureConversation, after every send() completes) that can land close
  // together, so a monotonically increasing token — captured at call time,
  // compared at resolution time — makes every but-the-latest response's
  // .then() a no-op instead of whichever happens to resolve last winning.
  const latestListRequestRef = useRef(0)

  // Grouped once per conversations-list change, not on every render — cheap
  // either way at realistic list sizes, but avoids re-walking the (already
  // sorted) list on unrelated re-renders like a streaming delta landing.
  const conversationGroups = useMemo(() => groupConversationsByDate(conversations), [conversations])

  // Backgrounded/inactive browser tabs don't get repainted until they're
  // focused again — the reply has already arrived and rendered into the DOM,
  // it just isn't visible yet. Flash the tab title as a cue instead of
  // leaving no indication at all.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) document.title = baseTitleRef.current }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Reads the CURRENT debouncedSearch at call time (this whole function is
  // re-created every render, so a call from any handler — delete, send's
  // onDone, etc. — always sees the latest search term, never a stale one).
  const refreshConversations = () => {
    const q = debouncedSearch.trim()
    const url = `${API_BASE}/api/chat/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`
    const reqToken = ++latestListRequestRef.current
    fetch(url, { headers: authHeaders() })
      .then(r => {
        if (reqToken !== latestListRequestRef.current) return // superseded by a newer refresh
        // A non-200 (e.g. a transient 500 from SQLite lock contention, see
        // list_conversations in chat.rs) must NOT be treated as "there are
        // no conversations" — keep showing whatever the sidebar already has
        // instead of wiping it down to empty on a failure that has nothing
        // to do with the actual conversation list.
        if (!r.ok) return
        return r.json().then(data => { if (reqToken === latestListRequestRef.current) setConversations(data) })
      })
      .catch(() => {})
  }
  const refreshDocuments = () => {
    fetch(`${API_BASE}/api/chat/documents`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setDocuments)
      .catch(() => {})
  }

  // Parses whatever shape mem0_search's tool result comes back as into a flat
  // list — mem0's actual API commonly returns either a bare array or an
  // object with a `results`/`memories` wrapper key, so both are tried before
  // falling back to "one raw entry, unprettied" rather than dropping data an
  // unexpected shape happens to carry.
  function parseMemoryResult(raw: string): MemoryEntry[] {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return [{ raw }] }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.results) ? (parsed as Record<string, unknown>).results
      : Array.isArray((parsed as Record<string, unknown>)?.memories) ? (parsed as Record<string, unknown>).memories
      : null
    if (!Array.isArray(list)) return [{ raw }]
    return (list as Record<string, unknown>[]).map(e => ({
      id: typeof e.id === 'string' ? e.id : undefined,
      memory: typeof e.memory === 'string' ? e.memory : undefined,
      text: typeof e.text === 'string' ? e.text : undefined,
      content: typeof e.content === 'string' ? e.content : undefined,
      created_at: typeof e.created_at === 'string' ? e.created_at : undefined,
      raw: JSON.stringify(e),
    }))
  }

  // Runs a fixed, hidden turn against Hermes asking it to search its own
  // memory broadly, then reads the resulting mem0_search tool_call event(s)
  // straight off the SSE stream — no new backend endpoint, Hermes's gateway
  // has no dedicated "list memories" HTTP route (checked 2026-07-13), so this
  // reuses the exact same /api/chat/stream path an ordinary chat turn takes.
  // Runs in its own conversation (kind: 'memory-browser', never shown in the
  // sidebar) so opening this panel never pollutes real conversation history.
  const loadMemories = async () => {
    setMemoryLoading(true)
    setMemoryError(null)
    try {
      if (!memoryConversationIdRef.current) {
        const res = await fetch(`${API_BASE}/api/chat/conversations`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ title: '🧠 Memory-Browser', kind: 'memory-browser' }),
        })
        if (!res.ok) throw new Error('conversation')
        const data = await res.json()
        memoryConversationIdRef.current = data.id
      }
      const collected: MemoryEntry[] = []
      let gotAnyToolCall = false
      await streamChat(
        memoryConversationIdRef.current!,
        'Durchsuche dein Gedächtnis (mem0) nach allen gespeicherten Erinnerungen und gib die Rohergebnisse zurück - keine Zusammenfassung in Prosa, nur der Werkzeugaufruf.',
        undefined,
        false,
        'hermes',
        new AbortController().signal,
        () => {},
        () => {},
        call => {
          if (call.tool === 'mem0_search' || call.tool === 'mem0_add' || call.tool.startsWith('mem0')) {
            gotAnyToolCall = true
            collected.push(...parseMemoryResult(call.result))
          }
        },
        () => {},
        () => {},
      )
      setMemoryEntries(collected)
      if (!gotAnyToolCall) setMemoryError('Hermes hat kein Gedächtnis-Werkzeug aufgerufen — Memory ist auf diesem Deployment evtl. noch nicht aktiv.')
    } catch {
      setMemoryError('Erinnerungen konnten nicht geladen werden.')
    } finally {
      setMemoryLoading(false)
      setMemoryLoaded(true)
    }
  }

  // Debounce: only re-query the backend once typing pauses for ~280ms,
  // instead of firing a request (LIKE + JOIN across every conversation's
  // messages) on every single keystroke — matters once there are hundreds
  // or thousands of conversations to search across.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 280)
    return () => clearTimeout(t)
  }, [searchInput])

  // Ask once, on mount, which engines this deployment can actually run. Any
  // failure here leaves `hermesAvailable` false, which is the safe answer: the
  // picker stays hidden and every turn takes the built-in path, exactly as it
  // did before the engine fork existed.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/chat/engines`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data) return
        setHermesAvailable(Array.isArray(data.engines) && data.engines.includes('hermes'))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => { refreshDocuments() }, [])
  // Fires on mount (debouncedSearch starts at '', fetching the unfiltered
  // list) and again every time the debounced search term settles.
  useEffect(() => {
    refreshConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

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

  // Fires on every `messages` update — during streaming that's every single
  // RAF-batched flush (see send()'s scheduleFlush), not just once per
  // finished reply. `behavior: 'smooth'` unconditionally was fine at the old
  // ~100-200ms/token 70b pace: flushes landed far enough apart for the
  // browser's own smooth-scroll animation to finish (or nearly finish)
  // before the next one fired. A faster model (see CHAT_MODEL_CANDIDATES —
  // mistral-nemo-12b/mixtral-8x7b ahead of 70b) streams fast enough that
  // this now fires on nearly every animation frame for the whole reply —
  // measured with Playwright against a real mock NVIDIA endpoint: ~150ms
  // between scrollTo calls at a 150ms/token pace vs ~17ms (i.e. every frame)
  // at a 15ms/token pace, with 63/65 of those gaps under 50ms. Restarting a
  // 'smooth' scroll roughly every frame never lets it settle — the browser's
  // scroll animation is perpetually interrupted mid-flight, which is exactly
  // the newly-reported "ruckelig" streaming stutter (confirmed NOT a dropped
  // frame/render-cost problem: rAF frame timing stayed clean in both the
  // slow and fast measurements). Only 'auto' (instant, nothing to interrupt)
  // during active streaming; the nicer animated scroll still applies once
  // streaming is done — the stream just finished, or switching conversations.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: streaming ? 'auto' : 'smooth' })
  }, [messages, streaming])

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
      // Automatic, not user-selected: Hermes whenever the backend reports it
      // configured and reachable, the built-in engine only as a silent
      // fallback. Snapshotted at send-time so a Hermes host that drops mid-
      // stream doesn't retarget the exchange already in flight.
      const engineForThisTurn: ChatEngine = hermesAvailable ? 'hermes' : 'builtin'

      let fullText = ''
      let reasoningText = ''
      const allTokens: TokenInfo[] = []

      // "LKS" kill-switch setup: a fresh controller for THIS exchange, plus
      // a live snapshot stopStreaming() can read synchronously — see the
      // two refs' own doc comments above.
      const abortController = new AbortController()
      streamAbortControllerRef.current = abortController
      streamingSnapshotRef.current = { conversationId: convId, text: '' }

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
        engineForThisTurn,
        abortController.signal,
        (delta, tokens) => {
          fullText += delta
          if (streamingSnapshotRef.current) streamingSnapshotRef.current.text = fullText
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
      streamAbortControllerRef.current = null
      streamingSnapshotRef.current = null
    }
  }

  // "LKS" kill-switch: stops the model's current streaming response without
  // ending/deleting the conversation — the partial response stays. Aborting
  // the fetch alone can't be trusted as the durable signal (a dropped
  // connection can't distinguish "user clicked stop" from "wifi died"), so
  // this ALSO explicitly POSTs whatever's been accumulated so far to a
  // dedicated backend endpoint that inserts it as a normal assistant turn
  // marked `interrupted = 1` — see save_interrupted_message in
  // backend/src/chat.rs, and the synthetic note stream_chat's own history
  // load injects for it on the NEXT turn.
  async function stopStreaming() {
    const controller = streamAbortControllerRef.current
    const snapshot = streamingSnapshotRef.current
    if (!controller || !snapshot) return
    controller.abort()
    const text = snapshot.text.trim()
    if (text) {
      try {
        await fetch(`${API_BASE}/api/chat/conversations/${snapshot.conversationId}/interrupted-message`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ content: text }),
        })
      } catch { /* best effort — the abort itself already stopped the stream either way */ }
    }
    // Neither onDone nor onError fires for an aborted stream (see
    // streamChat's `if (signal.aborted) return` guards) — this is the one
    // place that resets UI state for the LKS path specifically.
    setStreaming(false)
    refreshConversations()
  }

  // Edit-and-resend: deletes the edited message and everything
  // chronologically after it (server-side, via delete_message_and_after —
  // reuses delete_conversation's per-message chat_chunks/RAG cleanup so no
  // stale memory survives for the removed turns), truncates the local
  // `messages` state to match, then continues the conversation from the
  // edited text via the already-existing send(override) path — same
  // mechanism the "Diesen Talk zum Blogpost machen" button already uses to
  // send a message that isn't literally the composer's current input.
  // Deliberately not offered while `streaming` (see ChatBubble's
  // `editAllowed` prop): send() below would silently no-op via its own
  // `sendingRef`/`streaming` guard if fired mid-exchange, which would leave
  // the conversation truncated with nothing sent to replace it.
  async function editAndResend(id: string, newText: string) {
    const text = newText.trim()
    if (!text || !activeId) return
    const convId = activeId
    setMessages(m => {
      const idx = m.findIndex(msg => msg.id === id)
      return idx === -1 ? m : m.slice(0, idx)
    })
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${convId}/messages/${id}`, { method: 'DELETE', headers: authHeaders() })
    } catch { /* best effort — send() below still continues the conversation even if the server-side cleanup failed */ }
    refreshConversations()
    send(text)
  }

  // Stable across every render (empty dep arrays) so passing them into the
  // memoized ChatBubble never defeats its React.memo — see ChatBubble's own
  // doc comments on these three props. `editAndResendRef` is the escape
  // hatch: it's updated on every render (cheap, doesn't trigger anything)
  // so confirmEdit always calls the CURRENT editAndResend (closing over
  // this render's activeId etc.) without confirmEdit itself needing to
  // change identity — same "ref holds the latest, stable wrapper reads it
  // at call time" pattern as sendingRef/latestConvRequestRef above.
  const editAndResendRef = useRef(editAndResend)
  editAndResendRef.current = editAndResend

  const startEdit = useCallback((id: string) => setEditingId(id), [])
  const cancelEdit = useCallback(() => setEditingId(null), [])
  const confirmEdit = useCallback((id: string, text: string) => {
    setEditingId(null)
    editAndResendRef.current(id, text)
  }, [])

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
      <aside className={`chat-sidebar ${chatSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="chat-sidebar-header">
          {!chatSidebarCollapsed && <button className="chat-new-btn" onClick={startNewConversation}>+ Neue Unterhaltung</button>}
          <button
            type="button"
            className="chat-sidebar-collapse-btn"
            onClick={toggleChatSidebar}
            title={chatSidebarCollapsed ? 'Unterhaltungen einblenden' : 'Unterhaltungen ausblenden — mehr Platz zum Chatten'}
          >
            {chatSidebarCollapsed ? '»' : '«'}
          </button>
        </div>
        {chatSidebarCollapsed ? (
          <button className="chat-new-btn chat-new-btn-collapsed" onClick={startNewConversation} title="Neue Unterhaltung">+</button>
        ) : (
          <>
            <input
              type="text"
              className="chat-conv-search"
              placeholder="Unterhaltungen durchsuchen…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            <div className="chat-conv-list">
              {conversationGroups.map(group => (
                <div key={group.label} className="chat-conv-group">
                  <div className="chat-conv-group-label">{group.label}</div>
                  {group.items.map(c => (
                    <div key={c.id} className={`chat-conv-item ${c.id === activeId ? 'active' : ''} ${c.kind === 'digest' ? 'chat-conv-item-digest' : ''}`} onClick={() => openConversation(c.id)}>
                      {c.kind === 'digest' && <span className="chat-conv-digest-badge" title="Proaktiver Wochenrückblick von Jarvis, nicht von dir gestartet">🗞️</span>}
                      <span className="chat-conv-title">{c.title}</span>
                      <button
                        className="chat-conv-delete"
                        title="Löschen"
                        onClick={e => { e.stopPropagation(); deleteConversation(c.id) }}
                      >×</button>
                    </div>
                  ))}
                </div>
              ))}
              {conversations.length === 0 && (
                <div className="chat-conv-empty">
                  {debouncedSearch.trim() ? 'Keine Treffer.' : 'Noch keine Unterhaltungen.'}
                </div>
              )}
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

            <div className="chat-memory-panel">
              <div className="chat-docs-title">
                🧠 Erinnerungen (mem0)
                <button
                  className="chat-memory-refresh"
                  disabled={memoryLoading}
                  onClick={loadMemories}
                  title="Erinnerungen von Hermes abrufen"
                >
                  {memoryLoading ? '…' : '↻'}
                </button>
              </div>
              {!memoryLoaded && !memoryLoading && (
                <div className="chat-memory-empty">Noch nicht geladen — ↻ zum Abrufen.</div>
              )}
              {memoryError && <div className="chat-memory-empty">{memoryError}</div>}
              {memoryEntries.length > 0 && (
                <div className="chat-memory-list">
                  {memoryEntries.map((m, i) => (
                    <div key={m.id ?? i} className="chat-memory-item">
                      <span className="chat-memory-text">{m.memory ?? m.text ?? m.content ?? m.raw}</span>
                      {m.created_at && <span className="chat-memory-date">{m.created_at}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      <div className="chat-main">
        <div className="chat-topbar">
          <span className="chat-topbar-title">{conversations.find(c => c.id === activeId)?.title ?? 'Neue Unterhaltung'}</span>
          <div className="chat-topbar-actions">
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
            {hermesAvailable && (
              <span
                className="chat-export-btn chat-engine-indicator"
                title="Hermes: ein eigenständiger Agent mit eigenem Werkzeug-Loop und eigenem Langzeitgedächtnis, das über Gespräche hinweg wächst — die Basis-Intelligenz hinter Jarvis, kein Umschalter."
              >
                🜂 Jarvis, auf Hermes
              </span>
            )}
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
              isEditing={editingId === m.id}
              editAllowed={!streaming}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onConfirmEdit={confirmEdit}
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
          <button
            type="button"
            className="chat-lks-btn"
            onClick={() => stopStreaming()}
            disabled={!streaming}
            title="Antwort sofort stoppen — der bisherige Text bleibt erhalten"
          >
            LKS
          </button>
        </div>
      </div>
    </div>
  )
}
