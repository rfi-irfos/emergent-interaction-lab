import { useState } from 'react'
import { catalogEntry, catalogFamily } from '../../lib/dashboardCatalog'
import type { DashboardWidget } from './types'

const SWATCHES = ['#34e1ff', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#ef4444']

/// Pencil popover — title override, an accent-color swatch, and (only when
/// the catalog entry declares a `family`) a data-source swap to a sibling
/// entry with the same shape. Deliberately does NOT offer a chart-kind
/// toggle (e.g. donut ⇄ bar-row): the catalog's `chartKind` is fixed per
/// entry, and no entry's data shape is actually interchangeable across
/// kinds (a radar's 8 axes aren't a gauge's single fraction) — adding a
/// toggle that only sometimes works is worse than not offering one. Right-
/// sized scope, same call the plan already made for `resolveOverlaps` vs. a
/// full masonry packer.
export function WidgetEditPopover({
  widget, onSave, onClose,
}: {
  widget: DashboardWidget
  onSave: (patch: { title?: string | null; color_key?: string | null; catalog_key?: string }) => void
  onClose: () => void
}) {
  const entry = catalogEntry(widget.catalog_key)
  const siblings = catalogFamily(entry?.family)
  const [title, setTitle] = useState(widget.title ?? '')
  const [color, setColor] = useState(widget.color_key ?? '')
  const [catalogKey, setCatalogKey] = useState(widget.catalog_key)

  const save = () => {
    onSave({
      title: title.trim() || null,
      color_key: color || null,
      catalog_key: catalogKey !== widget.catalog_key ? catalogKey : undefined,
    })
  }

  return (
    <div className="dash-modal-overlay" role="dialog" aria-modal="true" aria-label="Widget bearbeiten" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dash-modal dash-modal--narrow">
        <div className="dash-modal-head">
          <h3>Widget bearbeiten</h3>
          <button type="button" className="dash-widget-btn" aria-label="Schließen" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
          </button>
        </div>
        <div className="dash-modal-body">
          <label className="dash-field-label">Titel</label>
          <input
            placeholder={entry?.title ?? widget.catalog_key}
            value={title}
            onChange={e => setTitle(e.target.value)}
          />

          <label className="dash-field-label">Akzentfarbe</label>
          <div className="dash-swatches">
            {SWATCHES.map(s => (
              <button
                key={s} type="button" className={`dash-swatch ${color === s ? 'active' : ''}`}
                style={{ background: s }} onClick={() => setColor(color === s ? '' : s)}
                aria-label={`Farbe ${s}`}
              />
            ))}
          </div>

          {siblings.length > 1 && (
            <>
              <label className="dash-field-label">Datenquelle</label>
              <select value={catalogKey} onChange={e => setCatalogKey(e.target.value)}>
                {siblings.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}
              </select>
            </>
          )}

          <button type="button" className="panel-add-btn" style={{ marginTop: 16 }} onClick={save}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}
