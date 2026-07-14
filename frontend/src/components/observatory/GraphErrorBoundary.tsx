import React from 'react'

// Guard wrapper for the heavy force-graph modules (Knowledge Graph /
// System Map). If react-force-graph-2d throws on mount or during a node
// interaction (it is the one third-party canvas component in the OS that can
// take the whole React tree down with an uncaught error), this boundary
// contains the failure to the graph panel instead of white-screening the
// entire admin/OS surface. Per Simeon's "wenn i auf den knowledge graph
// klick crasht die seite" — clicking a node must never blank the app.
interface Props {
  children: React.ReactNode
  label?: string
}
interface State {
  error: Error | null
}

export class GraphErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Surfaced to console for diagnostics; the UI degrades to the panel below.
    // eslint-disable-next-line no-console
    console.error('[GraphErrorBoundary] graph render failed:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="obs-panel">
          <div className="obs-empty">
            {this.props.label ?? 'Graph'} konnte nicht geladen werden.
            <br />
            <span style={{ opacity: 0.7, fontSize: 12 }}>
              (Die Übersicht bleibt nutzbar — nur die Netzwerkdarstellung ist ausgefallen.)
            </span>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
