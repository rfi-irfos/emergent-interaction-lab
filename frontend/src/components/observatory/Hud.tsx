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

/// Laura's own 40/40/20 research taxonomy (Human/Dyad/Machine) — an axis
/// ORTHOGONAL to every other classification already living in/around this
/// file (the `badge` prop's STATE/TRAIT/MACHINE/META stability-of-signal
/// axis; EmergenceMonitor's LEVEL_SECTIONS `human`/`ai`/`interaction`/
/// `system` emergence-layer keys — note its `ai` is NOT this `machine`;
/// SystemState's local `kind: 'signal' | 'technical'`; registry's
/// STATUS_ACCENT signal lifecycle). Before this, nothing in the UI reliably
/// told Laura which of her three buckets a given tile's number belongs to.
/// All three values get identical, symmetric treatment everywhere — there is
/// deliberately no disclosure/flagging mechanism for `machine`.
export type ObservatoryBucket = 'human' | 'dyad' | 'machine'

/// German, matching this file's own established convention (EmergenceMonitor
/// consumers already use German badge strings like "SIGNALE"/"VERLAUF"
/// alongside English ones like "STATE"/"TRAIT" — not a consistently-English
/// file, so no reason to introduce a new English-only label set here).
export const BUCKET_LABELS: Record<ObservatoryBucket, string> = {
  human: 'MENSCH',
  dyad: 'DYADE',
  machine: 'MASCHINE',
}

/// Three FIXED token references — deliberately NOT derived from
/// `--hud-accent` (see `.hud-tile-badge` in App.css, which colors the
/// existing `badge` prop from whatever accent hue the tile's author picked).
/// If this bucket badge also inherited `--hud-accent`, it would render in the
/// exact same color as a tile's existing `badge` span whenever both are
/// present, defeating the entire point of having two independent axes on one
/// tile. Picked from the already-theme-verified `--obs-*`/`--sem-*` tokens
/// (App.css `:root`, explicitly theme-invariant — see the block comment
/// above them) rather than inventing new custom properties:
/// Verified by grepping every `accent=` passed to `HudTile`/`Stat`/
/// `DirectionBar` in both files Task 2 retrofits: BehavioralLandscape.tsx
/// uses --obs-blue, --obs-amber, --obs-purple, --obs-teal, --obs-green (every
/// tile there sets an explicit accent). EmergenceMonitor.tsx uses --obs-blue,
/// --obs-purple, --obs-teal, --obs-amber, --sem-warning, --sem-danger,
/// --sem-success (also all explicit). That's 6 distinct rendered hues already
/// spoken for (amber/warning share a hex, as do green/success and red/
/// danger). Of the 9 distinct hues the whole `--obs-*`/`--sem-*` token set
/// actually contains, only 3 are untouched by that list: --obs-cyan,
/// --sem-info, --sem-neutral — and --obs-cyan renders pixel-identical to
/// --sem-info in the dark/gotham theme specifically (App.css redefines
/// `--obs-cyan: #38d9cc` under `.observatory-hud`/`.gotham`, same hex as
/// `--sem-info`'s fixed #38d9cc), so it can't be used alongside --sem-info
/// without breaking the "distinct from each other" requirement in that
/// theme. That leaves genuinely only TWO fully clean, mutually-distinct,
/// non-colliding hues in the whole design system today — not three. Rather
/// than invent a new token (explicitly disallowed) or leave one bucket
/// colliding with whichever of the 6 already-spoken-for hues is thematically
/// likeliest to land on the same tile, the third color below accepts the
/// least-risk collision:
///   - human   → --sem-info (cyan/turquoise): "neutral factual label,
///     category, or count" per its own App.css comment — a good semantic
///     fit, and confirmed absent from both files' accent lists above.
///   - machine → --sem-neutral (gray): also confirmed absent from both
///     accent lists; its desaturation additionally makes it trivially
///     distinguishable from every saturated `--obs-*` hue a tile might
///     already be using, which matters more than hue alone for at-a-glance
///     legibility.
///   - dyad    → --obs-blue: this IS already used as an accent (on
///     "Tippgeschwindigkeit"/"Status-Mix" in BehavioralLandscape and
///     "Status-Mix" in EmergenceMonitor), so it isn't perfectly clean — but
///     of the 6 already-used hues it's the one attached to the tiles least
///     likely to receive `bucket="dyad"` in Task 2 (typing-speed/status-mix
///     read as pure human-behavior or system metrics, not Human↔Machine
///     interaction). --obs-purple was rejected for this slot specifically:
///     it's the accent on "Entscheidungen" (accept/modify/reject an AI
///     suggestion) and "Einfluss-Richtung" (Laura→Jarvis/Jarvis→Laura
///     direction) — both textbook dyad-bucket candidates, which would make a
///     purple dyad badge collide with that same tile's own existing badge
///     outline almost as soon as Task 2 ships. The `.hud-tile-bucket-badge`
///     shape (solid filled pill + dot vs. `.hud-tile-badge`'s outlined
///     text-only pill, see App.css) is the deliberate backstop for this one
///     residual case — two badges of the same hue stay tellable-apart by
///     shape even if a future tile's accent lands on --obs-blue.
export const BUCKET_COLORS: Record<ObservatoryBucket, string> = {
  human: 'var(--sem-info)',
  dyad: 'var(--obs-blue)',
  machine: 'var(--sem-neutral)',
}

export interface HudTileProps {
  title?: string
  /** Short uppercase status caption rendered right of the title (e.g. "LIVE", "ANALYSIS"). */
  badge?: string
  /** Accent hue for the soft glow + LED. Defaults to the cyan telemetry accent. */
  accent?: string
  /** Which of Laura's Human/Dyad/Machine buckets this tile's metric belongs
      to. Renders as a SECOND badge span, alongside (never replacing) `badge`
      — a tile may have zero, one, or both. Colored from the fixed
      `BUCKET_COLORS` map, independent of `accent`/`--hud-accent`, so it
      reads as a visually distinct axis even when both badges are present. */
  bucket?: ObservatoryBucket
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

/// The bucket pill itself, shared by `HudTile` (embedded in the tile header)
/// and this file's standalone `BucketBadge` export (for section-header/prose
/// contexts, e.g. next to EmergenceMonitor's "Geteiltes Feld" header). Solid
/// filled background rather than the existing `.hud-tile-badge`'s outlined
/// text-only treatment — a deliberate SHAPE difference on top of the color
/// difference, so the two badges stay tellable-apart at a glance even in the
/// rare case a future tile's own `accent` happens to land near a bucket hue.
function BucketBadgeSpan({ bucket }: { bucket: ObservatoryBucket }) {
  const color = BUCKET_COLORS[bucket]
  return (
    <span className="hud-tile-bucket-badge" style={{ ['--bucket-color' as string]: color }}>
      <span className="hud-tile-bucket-dot" aria-hidden />
      {BUCKET_LABELS[bucket]}
    </span>
  )
}

/// Standalone export of the same pill for placement outside a `HudTile`'s own
/// header — e.g. next to a `HudSectionHeader` or in prose that currently only
/// names its bucket in plain text. Not wired into any consumer yet (that's a
/// later task); this just makes the piece available.
export function BucketBadge({ bucket }: { bucket: ObservatoryBucket }) {
  return <BucketBadgeSpan bucket={bucket} />
}

/// A framed instrument panel: hairline border with a soft accent glow,
/// a monospace title bar with a live LED, hairline inner grid. Sized by the
/// grid, never by its content, so a chart can't blow the layout out.
/// No corner brackets — the frame reads as a lit instrument, not a boxed
/// label (the corner-bracket decoration was removed app-wide per feedback).
export function HudTile({ title, badge, accent, bucket, span = 1, tall, className, children, headerActions }: HudTileProps) {
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
              {bucket && <BucketBadgeSpan bucket={bucket} />}
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
