import { lazy, Suspense, useState } from 'react'
import { GraphErrorBoundary } from './GraphErrorBoundary'

// Knowledge Graph and System Map used to be two separate sidebar apps, but
// both are the same kind of thing — a force-graph view over this platform's
// own records — and neither is big enough on its own to earn a whole
// top-level slot. Merged per feedback into one "Knowledge & System Map" app
// with an in-panel toggle, rather than stacking two full-height canvases on
// one screen (that reads as clutter, not consolidation).
const SystemMap = lazy(() => import('./SystemMap').then(m => ({ default: m.SystemMap })))
const KnowledgeGraph = lazy(() => import('./KnowledgeGraph').then(m => ({ default: m.KnowledgeGraph })))

const GraphFallback = () => <div className="obs-panel"><div className="obs-empty">Graph wird geladen…</div></div>

type View = 'system' | 'knowledge'

export function KnowledgeSystemMap({ onOpenConversation }: { onOpenConversation?: (conversationId: string) => void } = {}) {
  const [view, setView] = useState<View>('system')

  return (
    <div className="obs-toggle-view">
      <div className="obs-toggle-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'system'}
          className={`obs-toggle-tab ${view === 'system' ? 'active' : ''}`}
          onClick={() => setView('system')}
        >
          System Map
        </button>
        <button
          role="tab"
          aria-selected={view === 'knowledge'}
          className={`obs-toggle-tab ${view === 'knowledge' ? 'active' : ''}`}
          onClick={() => setView('knowledge')}
        >
          Knowledge Graph
        </button>
      </div>

      {view === 'system' ? (
        <Suspense fallback={<GraphFallback />}>
          <GraphErrorBoundary label="System Map">
            <SystemMap onOpenConversation={onOpenConversation} />
          </GraphErrorBoundary>
        </Suspense>
      ) : (
        <Suspense fallback={<GraphFallback />}>
          <GraphErrorBoundary label="Knowledge Graph">
            <KnowledgeGraph onOpenConversation={onOpenConversation} />
          </GraphErrorBoundary>
        </Suspense>
      )}
    </div>
  )
}
