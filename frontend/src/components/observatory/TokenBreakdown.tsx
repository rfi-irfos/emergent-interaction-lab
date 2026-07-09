import { useState } from 'react'

export interface TokenAlt { token: string; probability: number }
export interface TokenInfo { token: string; probability: number; alternatives: TokenAlt[] }

/// Shared between ResearchChat's per-message "Token-Analyse" toggle and the
/// Human–AI Interaction Observatory module, which anchors around this same
/// visualization instead of just an averaged confidence number.
export function TokenBreakdown({ tokens }: { tokens: TokenInfo[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  if (!tokens.length) return null
  return (
    <div className="chat-inspector">
      {tokens.map((t, i) => (
        <span key={i} className="chat-inspector-wrap">
          <button
            type="button"
            className="chat-inspector-token"
            style={{ opacity: 0.35 + t.probability * 0.65 }}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            title={`${(t.probability * 100).toFixed(1)}%`}
          >
            {t.token}
          </button>
          {openIdx === i && (
            <span className="chat-inspector-pop">
              {t.alternatives.map((a, j) => (
                <span key={j} className="chat-inspector-alt">
                  <span>{a.token || '·'}</span>
                  <span>{(a.probability * 100).toFixed(1)}%</span>
                </span>
              ))}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
