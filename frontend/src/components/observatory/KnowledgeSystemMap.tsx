import { lazy, Suspense } from 'react'
import { GraphErrorBoundary } from './GraphErrorBoundary'

// Knowledge Graph and System Map used to be two separate sidebar apps, but
// both are the same kind of thing — a force-graph view over this platform's
// own records — and neither is big enough on its own to earn a whole
// top-level slot. Merged into one "Knowledge & System Map" app; both render
// stacked, always visible, no toggle — a toggle hid one graph behind a
// click every time, which read as "missing," not "consolidated."
const SystemMap = lazy(() => import('./SystemMap').then(m => ({ default: m.SystemMap })))
const KnowledgeGraph = lazy(() => import('./KnowledgeGraph').then(m => ({ default: m.KnowledgeGraph })))

const GraphFallback = () => <div className="obs-panel"><div className="obs-empty">Graph wird geladen…</div></div>

export function KnowledgeSystemMap({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  return (
    <div className="obs-stacked-views">
      <div className="obs-section-label">System Map</div>
      <Suspense fallback={<GraphFallback />}>
        <GraphErrorBoundary label="System Map">
          <SystemMap onOpenConversation={onOpenConversation} />
        </GraphErrorBoundary>
      </Suspense>

      <div className="obs-section-label">Knowledge Graph</div>
      <Suspense fallback={<GraphFallback />}>
        <GraphErrorBoundary label="Knowledge Graph">
          <KnowledgeGraph onOpenConversation={onOpenConversation} />
        </GraphErrorBoundary>
      </Suspense>
    </div>
  )
}
