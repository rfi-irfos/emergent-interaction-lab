import { ResearchNotesPanel } from './ResearchNotesPanel'

export function ResearchWorkspace() {
  return (
    <ResearchNotesPanel
      categories={['paper', 'hypothesis']}
      addLabel="Eintrag hinzufügen"
      placeholder="Titel (Paper oder Hypothese)"
    />
  )
}
