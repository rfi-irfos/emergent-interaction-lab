import { useState, useRef, useEffect } from 'react'
import { API_BASE } from '../lib/apiBase'
import { authHeaders } from '../lib/adminApi'
import type { SiteContent } from '../types/content'
import type { AdminSection } from '../types/admin'
import { SECTION_LABELS } from './observatory/registry'

interface DockMessage { role: 'user' | 'assistant'; content: string }

/// Ambient "Jarvis" assistant — mounted once inside the admin-mode tree
/// (see AdminPanel.tsx), present regardless of which of the 14 sections is
/// active, instead of being siloed inside the Forschung tab. Shares
/// conversation storage with ResearchChat via chat_conversations.kind='agent'
/// (same memory, two entry points) — see backend/src/agent.rs.
export function AgentDock({ currentModule, siteContent }: { currentModule: AdminSection; siteContent: SiteContent }) {
  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DockMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [messages, open])

  const ensureConversation = async (): Promise<string> => {
    if (conversationId) return conversationId
    const res = await fetch(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: 'Jarvis', kind: 'agent' }),
    })
    const data = await res.json()
    setConversationId(data.id)
    return data.id
  }

  const send = async () => {
    const message = input.trim()
    if (!message || sending) return
    setInput('')
    setMessages(m => [...m, { role: 'user', content: message }])
    setSending(true)
    try {
      const cid = await ensureConversation()
      const res = await fetch(`${API_BASE}/api/agent/message`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          conversation_id: cid,
          message,
          current_module: SECTION_LABELS[currentModule] ?? currentModule,
          site_content: siteContent,
        }),
      })
      if (!res.ok) {
        setMessages(m => [...m, { role: 'assistant', content: 'Jarvis ist gerade nicht erreichbar.' }])
        return
      }
      const data = await res.json()
      setMessages(m => [...m, { role: 'assistant', content: data.reply }])
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Verbindung fehlgeschlagen.' }])
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button className="agent-dock-fab" onClick={() => setOpen(o => !o)} aria-label="Jarvis öffnen">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        </svg>
      </button>
      {open && (
        <div className="agent-dock-panel">
          <div className="agent-dock-head">
            <span>Jarvis</span>
            <span className="agent-dock-context">{SECTION_LABELS[currentModule] ?? currentModule}</span>
            <button className="agent-dock-close" onClick={() => setOpen(false)} aria-label="Schließen">×</button>
          </div>
          <div className="agent-dock-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="agent-dock-empty">
                Frag mich etwas zum aktuellen Modul, oder bitte mich, einen Blogpost-Entwurf zu schreiben, eine Research Note zu loggen, oder eine Hypothese durchzuspielen.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`agent-dock-msg ${m.role}`}>{m.content}</div>
            ))}
            {sending && <div className="agent-dock-msg assistant agent-dock-typing">…</div>}
          </div>
          <div className="agent-dock-input-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Nachricht an Jarvis…"
            />
            <button onClick={send} disabled={sending || !input.trim()}>Senden</button>
          </div>
        </div>
      )}
    </>
  )
}
