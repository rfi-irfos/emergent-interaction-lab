import { useEffect, useRef, useState } from 'react'

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
}

/// A framed instrument panel: hairline border with a soft accent glow,
/// a monospace title bar with a live LED, hairline inner grid. Sized by the
/// grid, never by its content, so a chart can't blow the layout out.
/// No corner brackets — the frame reads as a lit instrument, not a boxed
/// label (the corner-bracket decoration was removed app-wide per feedback).
export function HudTile({ title, badge, accent, span = 1, tall, className, children }: HudTileProps) {
  const style = accent ? ({ ['--hud-accent' as string]: accent } as React.CSSProperties) : undefined
  return (
    <section
      className={`hud-tile${tall ? ' hud-tile--tall' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, ['--hud-span' as string]: String(span) }}
    >
      {title && (
        <header className="hud-tile-head">
          <span className="hud-led" aria-hidden />
          <span className="hud-tile-title">{title}</span>
          {badge && <span className="hud-tile-badge">{badge}</span>}
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

/// A consistent section header for every Observatory module: a monospace
/// title with a live accent, an optional plain-language sub-line, and an
/// optional actions slot (range selector, export, …) pinned right. Replaces
/// the per-module inline `flex + space-between` header blocks that made the
/// OS read like unrelated Lego bricks — one header language, every surface.
export function HudSectionHeader({ title, sub, actions }: {
  title?: string
  sub?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="hud-section-header">
      {title && (
        <div className="hud-section-header-text">
          <h2 className="hud-section-title">{title}</h2>
          {sub && <p className="hud-section-sub">{sub}</p>}
        </div>
      )}
      {actions && <div className="hud-section-actions">{actions}</div>}
    </header>
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
