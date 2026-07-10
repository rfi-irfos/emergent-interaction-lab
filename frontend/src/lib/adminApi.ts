import { useEffect, useState, type DependencyList } from 'react'
import { API_BASE } from './apiBase'

// Shared admin/agent request auth — the one auth mechanism the shipped admin
// UI actually round-trips through today (see backend/src/chat.rs is_authorized).
// Used by ResearchChat, the Observatory modules and AgentDock so the header
// logic exists in exactly one place instead of being copied into each caller.
const SECRET = import.meta.env.VITE_CHAT_API_SECRET as string | undefined

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(SECRET ? { 'x-chat-secret': SECRET } : {}), ...(extra ?? {}) }
}

/// Shared fetch-on-mount pattern for the Observatory modules (10 near-identical
/// "load this endpoint, show loading/empty/data states" call sites) — mirrors
/// the analyticsData/analyticsLoading pattern already in AdminPanel.tsx, just
/// generic instead of copy-pasted per module.
///
/// `pollMs`, if given, additionally refetches in the background on that
/// interval for the life of the component — no loading flicker (existing
/// data stays on screen until the new response lands), cleared on unmount or
/// whenever `deps` change (the effect re-runs and re-arms its own timer).
/// Research Pulse is the first consumer: Jarvis writes notes/blog drafts
/// autonomously mid-session, and nobody should have to navigate away and
/// back to see them appear.
export function useAdminFetch<T>(path: string, deps: DependencyList = [], pollMs?: number): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    const load = (showLoading: boolean) => {
      if (showLoading) setLoading(true)
      setError(false)
      fetch(`${API_BASE}${path}`, { headers: authHeaders() })
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
        .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
        .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    }
    load(true)
    const intervalId = pollMs && pollMs > 0 ? setInterval(() => load(false), pollMs) : undefined
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, loading, error }
}
