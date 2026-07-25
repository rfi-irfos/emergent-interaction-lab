import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/// Lets the currently-active app push its own filter/action controls up into
/// the ONE shared page header AdminPanel renders — mirrors Lighthouse's
/// PageHeader `right=` slot, which every route's own controls (filters,
/// search, the primary action button) flow into, rather than each panel
/// rendering a second header block of its own below the real one.
/// AdminPanel provides this; a panel calls `useHeaderActions(node, deps)`.
export const HeaderActionsContext = createContext<(node: ReactNode) => void>(() => {})

export function useHeaderActions(node: ReactNode, deps: React.DependencyList) {
  const setHeaderActions = useContext(HeaderActionsContext)
  useEffect(() => {
    setHeaderActions(node)
    return () => setHeaderActions(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/// The canonical shape of what goes INTO useHeaderActions — same fixed
/// left-to-right order every time (search, then filter(s), then the one
/// export action button), matching Lighthouse's own PageHeader convention.
/// Any slot that's omitted just doesn't render; this exists so the order
/// itself can't drift per-app the way it had before (every page composing
/// its own ad hoc actions row is exactly how the inconsistency crept in).
export function HudHeaderActions({ search, filters, action }: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  filters?: ReactNode
  action?: ReactNode
}) {
  return (
    <>
      {search && (
        <input
          type="search"
          value={search.value}
          onChange={e => search.onChange(e.target.value)}
          placeholder={search.placeholder ?? 'Suchen…'}
          style={{ fontSize: 12, padding: '5px 8px', flex: '0 1 200px' }}
        />
      )}
      {filters}
      {action}
    </>
  )
}

/// SHARED HUD CARD LANGUAGE — the single source of truth for how every
/// Observatory/Verwaltung panel and chart is framed. Previously each of the
/// ~20 surfaces hand-rolled its own `flex + justifyContent:'center'` block
/// inside a full-width `.obs-card`, which is exactly what made "one donut
/// own the whole screen": a 160px chart floating centred in a 1200px card of
/// empty space. Every chart/stat/list now lives inside a fixed-size `HudTile`
/// arranged by `HudGrid` (dense multi-column), so a screen reads like a real
/// Palantir/Gotham watch-floor: many small framed instruments, none stretched
/// to the viewport. This is the "refactor the shared card language instead of
/// fixing each view in isolation" step — do it once here.

export type HudTileSpan = 1 | 2 | 3 | 4

export interface HudTileProps {
  title?: string
  /** Short uppercase status caption rendered right of the title (e.g. "LIVE", "ANALYSIS"). */
  badge?: string
  /** Accent hue for the soft glow + LED. Defaults to the cyan telemetry accent. */
  accent?: string
  /** Column span inside the HudGrid (1–4 of 4). 2 = half-width on desktop. */
  span?: HudTileSpan
  /** Render as a tall tile (maps/large donuts) vs normal. Mostly affects min-height. */
  tall?: boolean
  className?: string
  children?: React.ReactNode
  /** A filter/export control cluster, pinned to this tile's own title bar —
      keeps a tile's own controls anchored to the thing they act on instead of
      floating in a separate row above/below the tile (the "8 loose control
      rows on one page" anti-pattern flagged in the app-by-app audit). */
  headerActions?: React.ReactNode
}

/// A framed instrument panel: hairline border with a soft accent glow,
/// a monospace title bar with a live LED, hairline inner grid. Sized by the
/// grid, never by its content, so a chart can't blow the layout out.
/// No corner brackets — the frame reads as a lit instrument, not a boxed
/// label (the corner-bracket decoration was removed app-wide per feedback).
export function HudTile({ title, badge, accent, span = 1, tall, className, children, headerActions }: HudTileProps) {
  const style = accent ? ({ ['--hud-accent' as string]: accent } as React.CSSProperties) : undefined
  return (
    <section
      className={`hud-tile${tall ? ' hud-tile--tall' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, ['--hud-span' as string]: String(span) }}
    >
      {(title || headerActions) && (
        <header className="hud-tile-head">
          {title && (
            <>
              <span className="hud-led" aria-hidden />
              <span className="hud-tile-title">{title}</span>
              {badge && <span className="hud-tile-badge">{badge}</span>}
            </>
          )}
          {headerActions && <span className="hud-tile-head-actions">{headerActions}</span>}
        </header>
      )}
      <div className="hud-tile-body">{children}</div>
    </section>
  )
}

export interface HudGridProps {
  /** Use the wider 4-col watch-floor grid (default), a 5-col strip (ForschungKpis' compact top row), a 3-col mid grid, or a tighter 2-col stack. */
  cols?: 2 | 3 | 4 | 5
  children?: React.ReactNode
}

/// Dense fixed-size panel grid. Tiles declare their own span; the grid never
/// lets a single tile consume the whole viewport. Auto-fits down on narrow
/// screens (see App.css .hud-grid media queries).
export function HudGrid({ cols = 4, children }: HudGridProps) {
  return <div className={`hud-grid hud-grid--${cols}`}>{children}</div>
}

/// Count-up animation for stat tiles — gives the "live instrument" feel
/// without faking data: it animates the real target value on mount/update.
/// Respects prefers-reduced-motion by snapping straight to the value.
export function useCountUp(target: number, durationMs = 900): number {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setDisplay(target); return }
    const from = fromRef.current
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (target - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, durationMs])
  return display
}

/// A consistent section header for every Observatory module: title, a soft
/// divider, and the plain-language description all on ONE line (title's own
/// weight/size carries the hierarchy, not a second row), tabs and the
/// right-aligned actions slot (search/filter/export) sharing that same
/// line and height. Replaces the per-module inline `flex + space-between`
/// header blocks that made the OS read like unrelated Lego bricks — one
/// header language, every surface. The description truncates with an
/// ellipsis rather than wrapping or pushing the actions off-row when it's
/// long — the full text is always still there on hover (`title` attribute).
export function HudSectionHeader({ title, sub, tabs, actions }: {
  title?: string
  sub?: string
  tabs?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="hud-section-header">
      <div className="hud-section-header-row1">
        {title && <h2 className="hud-section-title">{title}</h2>}
        {sub && (
          <>
            <span className="hud-section-divider" aria-hidden="true" />
            <p className="hud-section-sub" title={sub}>{sub}</p>
          </>
        )}
        {tabs && <div className="hud-section-tabs">{tabs}</div>}
        {actions && <div className="hud-section-actions">{actions}</div>}
      </div>
    </header>
  )
}
/// ONE filter control instead of N loose dropdowns crammed into the header
/// row. Born from EmergenceMonitor's toolbar ("what the hell is this filter?
/// can there be ONE single filter with dropdowns please?" — Laura's dad,
/// looking at 5 always-visible `<select>`s wrapping onto their own line).
/// A single trigger button (shows how many filters are actually active)
/// opens a popover holding every filter dimension, stacked — the dimensions
/// themselves are still whatever `children` the caller passes in (plain
/// `<label className="filter-panel-field">` + `<select>` pairs), this
/// component only owns the show/hide chrome and the "N active" affordance,
/// so it's reusable wherever a page has more than one or two filter
/// dropdowns (Simulation Center, Analytics, etc. can adopt it later without
/// inventing a second version of this pattern).
export function FilterPanel({ activeCount, onReset, resetLabel = 'Filter zurücksetzen', children }: {
  /** How many of the filters inside are currently non-default — drives the trigger's badge. */
  activeCount: number
  /** Clears every filter inside at once. Omit if the caller has nothing to reset (rare). */
  onReset?: () => void
  resetLabel?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="filter-panel" ref={rootRef}>
      <button
        type="button"
        className={`filter-panel-trigger${activeCount > 0 ? ' active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filter
        {activeCount > 0 && <span className="filter-panel-count">{activeCount}</span>}
      </button>
      {open && (
        <div className="filter-panel-popover" role="dialog" aria-label="Filter">
          <div className="filter-panel-fields">{children}</div>
          {onReset && activeCount > 0 && (
            <button type="button" className="filter-panel-reset" onClick={onReset}>{resetLabel}</button>
          )}
        </div>
      )}
    </div>
  )
}

export function HudStat({ value, label, format, accent }: {
  value: number
  label: string
  format?: (v: number) => string
  accent?: string
}) {
  const animated = useCountUp(value)
  const fmt = format ?? ((v: number) => String(Math.round(v)))
  const style = accent ? ({ ['--hud-accent' as string]: accent } as React.CSSProperties) : undefined
  return (
    <div className="hud-stat" style={style}>
      <div className="hud-stat-value">{fmt(animated)}</div>
      <div className="hud-stat-label">{label}</div>
    </div>
  )
}
