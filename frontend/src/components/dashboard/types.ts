// Mirrors backend/src/dashboards.rs's WidgetOut/DashboardDetail/
// DashboardSummary JSON shapes exactly — kept as a separate types module
// (not inlined per-component) since DashboardPage, DashboardCanvas,
// WidgetCard, WidgetEditPopover, and AddWidgetModal all need the same
// shapes.
export interface DashboardWidget {
  id: string
  dashboard_id: string
  catalog_key: string
  title: string | null
  color_key: string | null
  position_x: number
  position_y: number
  width: number
  height: number
  created_at: string
}

export interface DashboardDetail {
  id: string
  name: string
  is_default: boolean
  created_at: string
  updated_at: string
  widgets: DashboardWidget[]
}

export interface DashboardSummary {
  id: string
  name: string
  is_default: boolean
}
