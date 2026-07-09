/// Jarvis now lives in the Forschung tab itself (tool-calling merged into
/// the streaming chat, see backend/src/chat.rs) rather than a second,
/// disconnected chat surface. This is what's left of the old floating
/// AgentDock: an ambient "reachable from anywhere" affordance that jumps
/// straight into that one true chat instead of duplicating it.
export function AgentDock({ onJumpToForschung }: { onJumpToForschung: () => void }) {
  return (
    <button className="agent-dock-fab" onClick={onJumpToForschung} aria-label="Zu Jarvis (Forschung)" title="Zu Jarvis (Forschung)">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      </svg>
    </button>
  )
}
