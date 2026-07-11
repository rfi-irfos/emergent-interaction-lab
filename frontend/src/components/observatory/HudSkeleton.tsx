import { hudStagger } from '../../lib/hudStagger'

/// Real shimmering placeholder for an Observatory module's initial load —
/// replaces the old static "Lade…" text swap everywhere it appeared (see
/// the plan's Explore finding: zero skeleton/shimmer anywhere before this).
/// Deliberately reuses the shared .obs-stat/.obs-item-card shells so the
/// skeleton already inherits the HUD's corner-bracket frame, glow, and
/// hud-card-in entrance animation for free instead of a third visual
/// language — each shimmering bar stands in for the real content that's
/// about to render in the exact same shell. Honest about "still loading,"
/// never a fabricated delay: this renders for as long as `loading` is true
/// and no longer.
///
/// - `list`  — a handful of skeleton .obs-item-card rows (the dominant shape
///             across the Observatory's feed-style modules).
/// - `stats` — a skeleton .obs-stat grid (dashboards that lead with numbers).
/// - `chart` — a single skeleton bar shaped like ObsChart/bar-row content,
///             for call sites already nested inside their own .obs-card.
/// - `panel` — stats + list together, for modules whose loading gate covers
///             a whole page that mixes both (the common case).
export function HudSkeleton({ variant = 'list', rows = 3 }: { variant?: 'list' | 'stats' | 'chart' | 'panel'; rows?: number }) {
  if (variant === 'panel') {
    return (
      <div aria-busy="true" aria-label="Lädt…">
        <HudSkeleton variant="stats" rows={4} />
        <HudSkeleton variant="list" rows={rows} />
      </div>
    )
  }
  if (variant === 'stats') {
    return (
      <div className="obs-grid hud-skeleton-grid" aria-busy="true" aria-label="Lädt…">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="obs-stat" key={i} style={hudStagger(i)}>
            <div className="hud-skeleton-bar" style={{ width: '55%', height: 11, marginBottom: 10 }} />
            <div className="hud-skeleton-bar" style={{ width: '75%', height: 22 }} />
          </div>
        ))}
      </div>
    )
  }
  if (variant === 'chart') {
    return (
      <div className="hud-skeleton-wrap" aria-busy="true" aria-label="Lädt…">
        <div className="hud-skeleton-bar" style={{ width: '35%', height: 11, marginBottom: 12 }} />
        <div className="hud-skeleton-bar hud-skeleton-chart" />
      </div>
    )
  }
  return (
    <div className="hud-skeleton-wrap" aria-busy="true" aria-label="Lädt…">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="obs-item-card" key={i} style={hudStagger(i)}>
          <div className="hud-skeleton-bar" style={{ width: '32%', height: 9, marginBottom: 9 }} />
          <div className="hud-skeleton-bar" style={{ width: '88%', height: 13, marginBottom: 6 }} />
          <div className="hud-skeleton-bar" style={{ width: '58%', height: 13 }} />
        </div>
      ))}
    </div>
  )
}
