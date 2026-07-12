import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders } from '../../lib/adminApi'
import { HudSkeleton } from '../observatory/HudSkeleton'
import { DashboardCanvas } from './DashboardCanvas'
import { AddWidgetModal } from './AddWidgetModal'
import { WidgetEditPopover } from './WidgetEditPopover'
import { layout } from '../../lib/dashboardLayout'
import { catalogEntry } from '../../lib/dashboardCatalog'
import type { DashboardDetail, DashboardSummary, DashboardWidget } from './types'

/// Track A Phase 6c — the customizable dashboard page. One dedicated
/// Verwaltung-tier surface (not a bolt-on to every existing module), reusing
/// the single canvas engine (Phase 6b) everywhere a movable-card grid is
/// needed, per the plan's own reasoning: "one canvas engine reused
/// everywhere beats bespoke drag/resize retrofits on N existing pages."
export function DashboardPage() {
  const [dashboards, setDashboards] = useState<DashboardSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DashboardDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const loadDashboards = async () => {
    const res = await fetch(`${API_BASE}/api/dashboards`, { headers: authHeaders() })
    if (!res.ok) return
    const list: DashboardSummary[] = await res.json()
    setDashboards(list)
    if (list.length > 0 && !selectedId) {
      setSelectedId(list.find(d => d.is_default)?.id ?? list[0].id)
    }
  }

  const loadDetail = async (id: string) => {
    setLoading(true)
    const res = await fetch(`${API_BASE}/api/dashboards/${id}`, { headers: authHeaders() })
    if (res.ok) setDetail(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadDashboards() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedId) loadDetail(selectedId) }, [selectedId])

  const createDashboard = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch(`${API_BASE}/api/dashboards`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ name }),
      })
      if (!res.ok) return
      const { id } = await res.json()
      setNewName('')
      await loadDashboards()
      setSelectedId(id)
    } finally {
      setCreating(false)
    }
  }

  const deleteDashboard = async () => {
    if (!selectedId) return
    if (!window.confirm('Dieses Dashboard und alle seine Widgets endgültig löschen?')) return
    await fetch(`${API_BASE}/api/dashboards/${selectedId}`, { method: 'DELETE', headers: authHeaders() })
    setSelectedId(null)
    setDetail(null)
    await loadDashboards()
  }

  const addWidget = async (catalogKey: string) => {
    if (!detail) return
    const entry = catalogEntry(catalogKey)
    if (!entry) return
    const existing = detail.widgets.map(w => ({ id: w.id, x: w.position_x, y: w.position_y, w: w.width, h: w.height }))
    const [placed] = layout(existing, [{ id: 'pending', w: entry.defaultSize.w, h: entry.defaultSize.h }]).slice(existing.length)
    const res = await fetch(`${API_BASE}/api/dashboards/${detail.id}/widgets`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ catalog_key: catalogKey, position_x: placed.x, position_y: placed.y, width: placed.w, height: placed.h }),
    })
    setShowAddModal(false)
    if (res.ok) await loadDetail(detail.id)
  }

  const persistPositions = (changed: { id: string; position_x: number; position_y: number; width: number; height: number }[]) => {
    for (const c of changed) {
      fetch(`${API_BASE}/api/dashboards/widgets/${c.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ position_x: c.position_x, position_y: c.position_y, width: c.width, height: c.height }),
      }).catch(() => {})
    }
  }

  const saveWidgetEdit = async (patch: { title?: string | null; color_key?: string | null; catalog_key?: string }) => {
    if (!editingWidget || !detail) return
    await fetch(`${API_BASE}/api/dashboards/widgets/${editingWidget.id}`, {
      method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(patch),
    })
    setEditingWidget(null)
    await loadDetail(detail.id)
  }

  const removeWidget = async (id: string) => {
    if (!detail) return
    await fetch(`${API_BASE}/api/dashboards/widgets/${id}`, { method: 'DELETE', headers: authHeaders() })
    setDetail({ ...detail, widgets: detail.widgets.filter(w => w.id !== id) })
  }

  return (
    <div className="obs-panel">
      <div className="dash-toolbar">
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(e.target.value || null)}
          disabled={!dashboards || dashboards.length === 0}
        >
          {(!dashboards || dashboards.length === 0) && <option value="">Kein Dashboard</option>}
          {dashboards?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="dash-toolbar-new">
          <input
            placeholder="Neues Dashboard…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createDashboard() }}
          />
          <button type="button" className="panel-add-btn" onClick={createDashboard} disabled={creating || !newName.trim()}>+</button>
        </div>
        <div style={{ flex: 1 }} />
        {detail && (
          <>
            <button type="button" className="panel-add-btn" onClick={() => setRefreshSignal(n => n + 1)}>Aktualisieren</button>
            <button type="button" className={`panel-add-btn ${editMode ? 'active' : ''}`} onClick={() => setEditMode(m => !m)}>
              {editMode ? 'Fertig' : 'Bearbeiten'}
            </button>
            {editMode && (
              <button type="button" className="panel-add-btn" onClick={() => setShowAddModal(true)}>+ Widget</button>
            )}
            {editMode && (
              <button type="button" className="panel-delete-btn" onClick={deleteDashboard}>Dashboard löschen</button>
            )}
          </>
        )}
      </div>

      {loading && <HudSkeleton variant="panel" />}
      {!loading && !detail && (
        <div className="obs-empty">Leg oben ein neues Dashboard an, um loszulegen.</div>
      )}
      {!loading && detail && (
        <DashboardCanvas
          widgets={detail.widgets}
          editMode={editMode}
          refreshSignal={refreshSignal}
          onWidgetsChange={widgets => setDetail({ ...detail, widgets })}
          onPersist={persistPositions}
          onEdit={setEditingWidget}
          onRemove={removeWidget}
        />
      )}

      {showAddModal && <AddWidgetModal onPick={addWidget} onClose={() => setShowAddModal(false)} />}
      {editingWidget && (
        <WidgetEditPopover widget={editingWidget} onSave={saveWidgetEdit} onClose={() => setEditingWidget(null)} />
      )}
    </div>
  )
}
