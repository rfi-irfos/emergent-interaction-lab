// Shared admin/agent request auth — the one auth mechanism the shipped admin
// UI actually round-trips through today (see backend/src/chat.rs is_authorized).
// Used by ResearchChat, the Observatory modules and AgentDock so the header
// logic exists in exactly one place instead of being copied into each caller.
const SECRET = import.meta.env.VITE_CHAT_API_SECRET as string | undefined

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(SECRET ? { 'x-chat-secret': SECRET } : {}), ...(extra ?? {}) }
}
