import { API_BASE } from './apiBase'

// Anonymous per-browser visitor id for the tracking pixel's `v` param —
// backend/src/analytics.rs's COUNT(DISTINCT visitor) has always existed but
// this id was never generated anywhere client-side, so every visit recorded
// the same empty-string default and "Unique Besucher" was always ~1
// regardless of real traffic. localStorage (not a cookie) on purpose: this
// site's own About copy states it stores "keine personenbezogenen Daten" —
// a random UUID that never leaves the browser except as an opaque counter
// token, never tied to identity, fits that. Generated once, reused on every
// subsequent page load so repeat visits count as one unique visitor.
const VISITOR_ID_KEY = 'rfi_visitor_id'
export function getOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(VISITOR_ID_KEY, id)
    return id
  } catch {
    // localStorage unavailable (private mode, disabled storage) — fall back
    // to a session-only id so the pixel call always carries *some* stable
    // value for this page load, rather than silently reusing "".
    return crypto.randomUUID()
  }
}

// Fires the 1x1 tracking pixel beacon (backend/src/track.rs's `pixel`
// handler, recorded into web_visits.path). Shared by PublicSite.tsx (whole
// site, one call per load) and BlogPostPage.tsx (one call per article route)
// — the latter passes its own hash-inclusive path so each published article
// gets its own row instead of every view sharing PublicSite's constant
// `window.location.pathname` (this app is a hash-routed SPA, so pathname
// alone never varies between routes).
export function trackPageView(path: string = window.location.pathname) {
  const px = new URL('/api/track/pixel.gif', API_BASE || window.location.origin)
  px.searchParams.set('p', path)
  px.searchParams.set('r', document.referrer)
  px.searchParams.set('v', getOrCreateVisitorId())
  const s = new URLSearchParams(window.location.search)
  if (s.get('utm_source'))   px.searchParams.set('utm_source',   s.get('utm_source')!)
  if (s.get('utm_medium'))   px.searchParams.set('utm_medium',   s.get('utm_medium')!)
  if (s.get('utm_campaign')) px.searchParams.set('utm_campaign', s.get('utm_campaign')!)
  new Image().src = px.toString()
}
