import { InteractionDynamics } from './InteractionDynamics'
import { InformationDynamics } from './InformationDynamics'

// Interaction Dynamics and Information Dynamics merged into one app — same
// "two apps, one sidebar slot" treatment as Knowledge & System Map
// (KnowledgeSystemMap.tsx). Both stacked, always visible, no toggle.
export function InteractionInformationDynamics() {
  return (
    <div className="obs-stacked-views">
      <div className="obs-section-label">Interaction Dynamics</div>
      <InteractionDynamics />

      {/* Information Dynamics renders its own title + description via
          HudSectionHeader below — no extra obs-section-label needed here,
          unlike Interaction Dynamics above which has none of its own. */}
      <InformationDynamics />
    </div>
  )
}
