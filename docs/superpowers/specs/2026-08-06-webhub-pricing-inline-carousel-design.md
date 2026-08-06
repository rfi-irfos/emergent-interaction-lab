# WebHub Pricing: from hidden modal to inline carousel

## Problem

The real WebHub offer ladder (20 priced tiers across Rekonstruktion / Analysen /
Systemaudit, plus the phase-chip tagline+bullet copy in `WebHubPricing.tsx`'s
`DETAIL` map) only renders when a visitor clicks the "Pricing" nav link, which
opens a full-screen dark modal. Inside that modal, each card only shows a
name, tagline, and price — the actual "what this is" / "you get" copy sits
behind a second "More" button that opens a further per-tier modal. Pricing is
effectively two clicks deep on a route most visitors never open. The
homepage's own `#pricing` section (`PublicSite.tsx`) currently renders only a
CMS text blurb (`content.pricing.title`/`.body`), no real prices at all.

`rfi-irfos-web`'s `Pricing.tsx` solves the "wall of N tiers" problem
differently: everything renders inline on the homepage under `#pricing`, no
modal. Each product line sits in its own bordered glass container holding a
`TierCarousel` (`shared.tsx`): one large featured-tier card (full copy, price,
delivery pill, buy/proposal button, all inline — no further click) plus a
horizontal filmstrip of that line's other tiers; clicking a tile swaps it
into the big card.

## Goal

Bring the WebHub ladder onto the EIL homepage the same way — inline,
no modal, no second click for the real copy — while keeping Laura's own
visual language (her `--primary`/`--accent`/`--price` tokens, the existing
`--glass-bg`/`--glass-border` panel treatment already used elsewhere on her
site, and her phase-chip copy from `DETAIL`), not a reskin of RFI's teal/mono
aesthetic. The three-theme requirement (light/dark/hc) must keep working,
since it already does today via CSS custom properties.

## Non-goals

- No change to `rfi-irfos-web` — that page already works the way we want.
- No change to the B2B/AGB legal consent-before-Stripe modal — orthogonal
  concern, stays exactly as is.
- No change to the admin panel / product data model / Stripe products.
- No copy rewrites to `DETAIL` taglines/points — reused verbatim.

## Design

### Component split

- **New: `WebHubPricingCarousel.tsx`** (frontend/src/components) — the
  fetch-products-and-render logic extracted from today's `WebHubPricing.tsx`,
  minus the page-modal chrome (`page-modal-overlay`/`page-modal-panel`) and
  minus the per-tier "More" detail modal. Takes `content: SiteContent` as a
  prop, same as today. Renders:
  - one group container per lens (`Rekonstruktion`, `Analysen`) and one per
    Systemaudit subgroup (`Reviews`, `System design & build`, `Ongoing`) — 5
    containers total, each wrapped in a glass panel (reusing
    `--glass-bg`/`--glass-border`/`--glass-blur`, the same treatment her nav
    and other panels already use) with a group/subgroup label above it,
    mirroring RFI's one-bordered-container-per-product-line pattern.
  - inside each container, a `TierCarousel`-equivalent: a featured card (the
    flagship product defaults to featured within its group, same
    `defaultIdx`-from-highlight pattern as RFI's carousel) showing name, phase
    chip (from `DETAIL[name].phase` — this is EIL's own differentiator, RFI
    has no equivalent), full tagline, the "You get" bullet list, price, and
    the Buy button — all inline, no further modal — plus a filmstrip of the
    other tiers in that group/subgroup below it, same swap-on-click
    interaction as RFI's carousel.
  - the existing "Agents from the method" strip (Call Laura / Jarvis /
    Laura's Team), unchanged, rendered after the 5 carousel containers.
  - the existing legal consent-before-checkout modal (`checkoutTarget` state,
    B2B/AGB checkboxes, `confirmCheckout`), unchanged.
- **`WebHubPricing.tsx`** (the full-page modal wrapper) gets deleted; its
  content is now `WebHubPricingCarousel`.
- **`PublicSite.tsx`**'s existing `#pricing` section keeps its CMS
  title/body intro (unchanged — that copy is Laura's, still useful as a lead-
  in), and renders `<WebHubPricingCarousel content={content} />` directly
  below it.
- **`App.tsx`**: drop the `WebHubPricing` import/mount and the `isPricingModal`
  branch. The nav's `#p/pricing` hash link still exists in CMS content, so
  `getRoute`/the hashchange handler treats `#p/pricing` as a no-op modal route
  (falls through to the plain homepage) and a small effect scrolls
  `#pricing` into view when that hash is present on load — same UX (nav link
  still "goes to pricing"), just scroll instead of modal-open.

### Data flow

Unchanged: `WebHubPricingCarousel` fetches `${API_BASE}/api/billing/public-products`
on mount, sorts by `lensRank`/price exactly as today, groups by
`lensRank`/`subgroupRank` exactly as today. No backend changes.

### Visual design

- Group containers: `background: var(--glass-bg)`, `border: 1px solid
  var(--glass-border)`, `backdrop-filter: var(--glass-blur)` — the panel
  treatment already defined in `App.css` and used by her nav/other panels,
  so this reads as "the same site," not a borrowed RFI component skin.
  Border-radius and padding scaled to match her existing `.site-section`
  rhythm (not copied from RFI's 20px/32px constants verbatim).
- Featured card: reuses `--price` for the price line, `--primary`/`--accent`
  for the recommended-tier highlight border/badge (in place of RFI's
  hardcoded teal `TEAL` constant), `--text`/`--text-soft` for copy — all
  already theme-aware (verified: distinct light/dark/hc values exist in
  `App.css`), so this works across all three themes without extra media
  queries.
- Phase chip on the featured card reuses the existing `.site-webhub-chip`
  style from today's detail modal — carried over as-is, it's already
  on-brand.
- Filmstrip tiles: same interaction model as RFI (permanent slot per tier,
  active tile highlighted, auto-scroll into view), styled with her card
  border/background tokens instead of RFI's rgba(0,245,196,...) constants.

### What gets removed

- The per-tier "More" button + its detail modal (`active` state and its
  render block) — redundant once the featured card already shows full copy
  inline, same as RFI never needing a second modal for tier detail.
- The full-page modal shell (`page-modal-overlay`, `page-modal-panel`,
  `page-modal-x`) for pricing specifically — `PageModal`/`CertificationPage`/
  `BlogPostPage` keep using it for their own routes, untouched.

### Error handling

Unchanged from today: loading state ("Loading the offer ladder…") and fetch-
error state ("Could not load pricing right now") render in place of the
carousels, same copy, same condition (`products === null` / `error`).

### Testing / verification

- `npm run build` (or the project's existing typecheck/lint command) in
  `frontend/` — no test suite currently covers `WebHubPricing.tsx`, so
  verification is: build succeeds, then a manual pass in the running dev
  server across all three themes (light/dark/hc) checking: carousel renders
  inline on scroll with no click needed, featured-card copy matches what the
  old detail modal showed, filmstrip swap works, Buy still opens the
  B2B/AGB consent modal and Stripe link, nav "Pricing" link scrolls to the
  section instead of opening a modal.

## Open questions

None — scope confirmed with Simeon: full rebuild (inline carousel, modal
removed entirely), not the lighter teaser-row alternative.
