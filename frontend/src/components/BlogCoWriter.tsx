import { useState } from 'react'
import { adminFetch } from '../lib/adminApi'

/// Real co-authoring, inline: "schreib mit Jarvis direkt im Modal" — no
/// jumping to Forschung and back. Reuses the same /api/chat/stream pipeline
/// (same personality, same tool-calling convention) but scopes the message
/// with the post's current title/body as context and asks for prose only,
/// since here we want text to drop into the fields, not a tool call.
export function BlogCoWriter({ title, body, siteContent, onApplyTitle, onApplyBody }: {
  title: string
  body: string
  siteContent?: unknown
  onApplyTitle: (t: string) => void
  onApplyBody: (b: string) => void
}) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId
    const res = await adminFetch(`/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) return null
    const conv = await res.json()
    setConversationId(conv.id)
    return conv.id
  }

  function splitTitleAndBody(text: string): { title: string | null; body: string } {
    const parts = text.split(/\n\s*\n/)
    if (parts.length > 1 && parts[0].trim().length > 0 && parts[0].trim().length < 120 && !parts[0].includes('\n')) {
      return { title: parts[0].trim(), body: parts.slice(1).join('\n\n').trim() }
    }
    return { title: null, body: text.trim() }
  }

  async function send() {
    const text = prompt.trim()
    if (!text || streaming) return
    setError(null)
    const convId = await ensureConversation()
    if (!convId) { setError('Unterhaltung konnte nicht gestartet werden.'); return }
    setStreaming(true)
    setResponse('')
    setSuggestedTitle(null)

    const message = [
      'Ich schreibe gerade direkt an einem Blogpost-Entwurf im Editor, zusammen mit dir.',
      `Aktueller Titel: "${title || '(noch kein Titel)'}"`,
      `Aktueller Text: "${body || '(noch leer)'}"`,
      `Meine Anweisung: ${text}`,
      'Antworte AUSSCHLIESSLICH mit dem (überarbeiteten oder neuen) Text, kein Werkzeugaufruf, keine Erklärung drumherum. Wenn du auch einen neuen Titel vorschlagen willst, schreib ihn als allererste Zeile, dann eine Leerzeile, dann den Text.',
    ].join(' ')

    let full = ''
    let res: Response
    try {
      res = await adminFetch(`/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId, message, current_module: 'Blog (Redaktion)', site_content: siteContent }),
      })
    } catch {
      setError('Verbindung fehlgeschlagen.')
      setStreaming(false)
      return
    }
    if (!res.ok || !res.body) {
      setError('Jarvis konnte nicht antworten.')
      setStreaming(false)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let toolDraft: { title?: string; body?: string } | null = null
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
        if (eventType === 'error') { setError(data); break }
        if (eventType === 'done') break
        if (eventType === 'tool_call') {
          try {
            const call = JSON.parse(data)
            if (call.tool === 'draft_blog_post') {
              // Jarvis reached for the tool instead of replying in prose —
              // still usable, just recovered from the tool call's own args
              // rather than the streamed text (which gets suppressed for calls).
              toolDraft = { title: undefined, body: undefined }
            }
          } catch { /* ignore */ }
          continue
        }
        try {
          const parsed = JSON.parse(data)
          full += parsed.delta || ''
          setResponse(full)
        } catch { /* partial frame */ }
      }
    }
    setStreaming(false)
    if (toolDraft && !full.trim()) {
      setResponse('Jarvis hat stattdessen einen eigenen Entwurf angelegt (siehe „Jarvis-Entwürfe" unten) statt hier direkt zu antworten — frag nochmal gezielter, z.B. "schreib den Text hier im Feld".')
      return
    }
    const { title: t, body: b } = splitTitleAndBody(full)
    setSuggestedTitle(t)
    setResponse(b)
  }

  return (
    <div className="cowriter">
      <button type="button" className="cowriter-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Mit Jarvis schreiben
      </button>
      {open && (
        <div className="cowriter-body">
          <textarea
            className="cowriter-prompt"
            placeholder='z.B. "schreib eine Einleitung über unser letztes Experiment" oder "mach den Text prägnanter"'
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            disabled={streaming}
          />
          <button type="button" className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px', alignSelf: 'flex-start' }} onClick={send} disabled={streaming || !prompt.trim()}>
            {streaming ? 'Jarvis schreibt…' : 'Fragen'}
          </button>
          {error && <div className="chat-error" style={{ marginTop: 8 }}>{error}</div>}
          {(response || streaming) && (
            <div className="cowriter-response">
              {suggestedTitle && <div className="cowriter-suggested-title">Vorschlag Titel: {suggestedTitle}</div>}
              <div className="cowriter-response-text">{response}{streaming && '…'}</div>
              {!streaming && response && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {suggestedTitle && (
                    <button type="button" className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => onApplyTitle(suggestedTitle)}>
                      Titel übernehmen
                    </button>
                  )}
                  <button type="button" className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => onApplyBody(response)}>
                    Text ersetzen
                  </button>
                  <button type="button" className="panel-delete-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => onApplyBody(body ? `${body}\n\n${response}` : response)}>
                    Anhängen
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
