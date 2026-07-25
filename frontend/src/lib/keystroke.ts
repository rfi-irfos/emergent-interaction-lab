import { API_BASE } from './apiBase'
import { authHeaders } from './adminApi'

// Wave 2 Task 10 — client-side keystroke / idle / scroll capture for Laura's
// typing-behavior analysis (Deep Self-Analysis framework v2.1: Dimension 1
// Attention + Dimension 3 Cognitive Load behavioral proxies).
//
// This is a best-effort telemetry sidecar: it attaches native listeners to
// the chat composer (keydown/keyup), the document (visibility), the window
// (blur/focus → idle), and the message scroll container, buffers the events
// in a queue, and flushes them in a single batched POST every 2 seconds to
// the backend ingest endpoint (POST /api/human-behavior/:conversation_id,
// which accepts a JSON array of {event_type, payload?, ts} and returns 204).
//
// Design rules (do not relax without cause):
//   - NEVER break the chat UX. Every flush failure is swallowed silently.
//   - No key CONTENT is ever captured — only that a key/backspace occurred
//     and when. Scroll captures position only. This is behavioral timing,
//     not keylogging.
//   - Dependency-free: native EventTarget + fetch, no new npm packages.
//   - Reuses the authed fetch convention from adminApi (credentials:'include'
//     + authHeaders()) rather than inventing a new HTTP client.

export type HumanBehaviorEventType =
  | 'keydown'
  | 'keyup'
  | 'backspace'
  | 'visibility'
  | 'idle_start'
  | 'idle_end'
  | 'scroll'

export interface HumanBehaviorEvent {
  event_type: HumanBehaviorEventType
  payload?: Record<string, unknown>
  ts: number
}

const FLUSH_INTERVAL_MS = 2000
const SCROLL_THROTTLE_MS = 500
// Safety cap so a long idle tab (nothing flushing successfully) can't grow
// the queue without bound.
const MAX_QUEUE = 2000

export class KeystrokeCapture {
  private queue: HumanBehaviorEvent[] = []
  private conversationId: string | null = null
  private target: HTMLElement | null = null
  private scrollContainer: HTMLElement | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private lastScrollTs = 0
  // Tracks whether we've already emitted an idle_start for the current
  // blurred/hidden period, so focus/blur and visibility changes don't emit
  // duplicate idle_start/idle_end pairs.
  private idle = false

  /// Begin capturing on `el` (the composer textarea). `scrollContainer`, if
  /// given, is the message list the scroll listener attaches to; when omitted
  /// scroll capture is skipped. Calling start() again first tears down any
  /// previous session so it's safe to re-arm on prop changes.
  start(el: HTMLElement, conversationId: string, scrollContainer?: HTMLElement | null): void {
    this.stop()
    this.target = el
    this.conversationId = conversationId
    this.scrollContainer = scrollContainer ?? null

    el.addEventListener('keydown', this.onKeyDown)
    el.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('focus', this.onFocus)
    document.addEventListener('visibilitychange', this.onVisibility)
    if (this.scrollContainer) this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true })

    this.flushTimer = setInterval(this.flush, FLUSH_INTERVAL_MS)
  }

  /// Detach every listener, flush any remaining buffered events one last time,
  /// and reset state. Safe to call when never started.
  stop(): void {
    if (this.flushTimer !== null) { clearInterval(this.flushTimer); this.flushTimer = null }
    if (this.target) {
      this.target.removeEventListener('keydown', this.onKeyDown)
      this.target.removeEventListener('keyup', this.onKeyUp)
    }
    if (this.scrollContainer) this.scrollContainer.removeEventListener('scroll', this.onScroll)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('focus', this.onFocus)
    document.removeEventListener('visibilitychange', this.onVisibility)
    // Best-effort final flush of whatever's still queued.
    this.flush()
    this.target = null
    this.scrollContainer = null
    this.conversationId = null
    this.idle = false
  }

  private push(event_type: HumanBehaviorEventType, payload?: Record<string, unknown>): void {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift()
    this.queue.push({ event_type, payload, ts: Date.now() })
  }

  // Arrow-function fields so `this` is bound for add/removeEventListener
  // (a plain method loses `this` when passed as a listener, and would also
  // fail to remove cleanly since the bound wrapper identity would differ).
  private onKeyDown = (e: KeyboardEvent): void => {
    this.push(e.key === 'Backspace' ? 'backspace' : 'keydown')
  }

  private onKeyUp = (): void => {
    this.push('keyup')
  }

  private onBlur = (): void => {
    if (this.idle) return
    this.idle = true
    this.push('idle_start')
  }

  private onFocus = (): void => {
    if (!this.idle) return
    this.idle = false
    this.push('idle_end')
  }

  private onVisibility = (): void => {
    const hidden = document.visibilityState === 'hidden'
    this.push('visibility', { hidden })
    // A tab hidden/shown is also an idle boundary — fold it into the same
    // idle_start/idle_end stream as window blur/focus so downstream analysis
    // sees one consistent attention signal.
    if (hidden && !this.idle) { this.idle = true; this.push('idle_start') }
    else if (!hidden && this.idle) { this.idle = false; this.push('idle_end') }
  }

  private onScroll = (): void => {
    const now = Date.now()
    if (now - this.lastScrollTs < SCROLL_THROTTLE_MS) return
    this.lastScrollTs = now
    const el = this.scrollContainer
    if (!el) return
    this.push('scroll', { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight })
  }

  // Drain the queue in one batched POST. Best-effort: on any failure the
  // batch is dropped (not re-queued) so a persistently failing endpoint can
  // never accumulate an unbounded backlog or spam retries — the chat UX must
  // never be affected by telemetry.
  private flush = (): void => {
    if (this.queue.length === 0 || !this.conversationId) return
    const batch = this.queue
    this.queue = []
    const path = `/api/human-behavior/${encodeURIComponent(this.conversationId)}`
    try {
      fetch(`${API_BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(batch),
        keepalive: true,
      }).catch(() => { /* best-effort: swallow */ })
    } catch { /* best-effort: swallow */ }
  }
}
