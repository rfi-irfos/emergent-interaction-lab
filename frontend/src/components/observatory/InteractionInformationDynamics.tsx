import { useState } from 'react'
import { InteractionDynamics } from './InteractionDynamics'
import { InformationDynamics } from './InformationDynamics'

// Interaction Dynamics and Information Dynamics merged into one app per
// feedback — same "two apps, one sidebar slot, in-panel toggle" treatment
// as Knowledge & System Map (KnowledgeSystemMap.tsx). Neither view is heavy
// (no lazy-loaded force-graph dependency here), so both are imported
// directly rather than lazily.
type View = 'interaction' | 'information'

export function InteractionInformationDynamics() {
  const [view, setView] = useState<View>('interaction')

  return (
    <div className="obs-toggle-view">
      <div className="obs-toggle-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'interaction'}
          className={`obs-toggle-tab ${view === 'interaction' ? 'active' : ''}`}
          onClick={() => setView('interaction')}
        >
          Interaction Dynamics
        </button>
        <button
          role="tab"
          aria-selected={view === 'information'}
          className={`obs-toggle-tab ${view === 'information' ? 'active' : ''}`}
          onClick={() => setView('information')}
        >
          Information Dynamics
        </button>
      </div>

      {view === 'interaction' ? <InteractionDynamics /> : <InformationDynamics />}
    </div>
  )
}
