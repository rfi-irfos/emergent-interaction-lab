import { ResearchNotesPanel } from './ResearchNotesPanel'

export function InnovationLab() {
  return (
    <ResearchNotesPanel
      categories={['idea', 'concept', 'framework', 'prototype']}
      addLabel="Idee hinzufügen"
      placeholder="Titel (Idee, Konzept, Framework oder Prototyp)"
    />
  )
}
