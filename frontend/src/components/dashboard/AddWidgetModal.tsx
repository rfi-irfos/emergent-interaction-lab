import { DASHBOARD_CATALOG } from '../../lib/dashboardCatalog'

/// Catalog picker, grouped by category (checkbox-list style, same idea as
/// Lighthouse's own widget picker per the plan) — one click adds one widget
/// at the bottom of the canvas; `layout()` (Phase 6b math) places it, the
/// caller (DashboardPage) owns the actual POST + state update.
export function AddWidgetModal({ onPick, onClose }: { onPick: (catalogKey: string) => void; onClose: () => void }) {
  const categories = Array.from(new Set(DASHBOARD_CATALOG.map(e => e.category)))

  return (
    <div className="dash-modal-overlay" role="dialog" aria-modal="true" aria-label="Widget hinzufügen" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dash-modal">
        <div className="dash-modal-head">
          <h3>Widget hinzufügen</h3>
          <button type="button" className="dash-widget-btn" aria-label="Schließen" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="dash-modal-body">
          {categories.map(cat => (
            <div key={cat} className="dash-modal-group">
              <div className="dash-modal-group-label">{cat}</div>
              <div className="dash-modal-group-items">
                {DASHBOARD_CATALOG.filter(e => e.category === cat).map(e => (
                  <button key={e.key} type="button" className="dash-modal-item" onClick={() => onPick(e.key)}>
                    <span className="dash-modal-item-kind">{e.chartKind}</span>
                    <span>{e.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
