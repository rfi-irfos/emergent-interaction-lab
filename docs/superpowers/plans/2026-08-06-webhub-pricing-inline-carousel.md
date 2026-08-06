# WebHub Pricing Inline Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the real WebHub offer ladder out of its full-page modal and onto the homepage's existing `#pricing` section, rendered as a featured-card + filmstrip carousel per group (mirroring `rfi-irfos-web`'s `TierCarousel`), styled with Laura's own CSS tokens instead of a copy of RFI's look.

**Architecture:** Extract the ladder's pure grouping/ranking logic into a small testable lib module, build a presentational carousel component from it, then cut over from the old `WebHubPricing.tsx` modal to a new `WebHubPricingCarousel.tsx` rendered inline inside `PublicSite.tsx`, and stop `App.tsx` from opening it as a page-level modal.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (`node` environment, pure-logic tests only — no component/DOM test infra exists in this repo).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-webhub-pricing-inline-carousel-design.md` — full rebuild approach, approved 2026-08-06.
- No changes to `rfi-irfos-web` (reference only, not touched).
- No changes to the B2B/AGB legal consent-before-Stripe modal's copy or logic — carried over unchanged.
- No changes to `DETAIL`/`FLAGSHIP_NAME` copy content — moved verbatim, not rewritten.
- No changes to the backend or the product data model.
- `tsconfig.app.json` has `noUnusedLocals`/`noUnusedParameters: true` — every import must be used, or the build fails.
- Every public page ships three themes (light/dark/hc) via `data-theme`, driven entirely by CSS custom properties (`--primary`, `--accent`, `--price`, `--text`, `--text-soft`, `--border`, `--surface`, `--surface-alt`, `--glass-bg`, `--glass-border`, `--glass-blur`) — new styles must use these tokens, never hardcoded colors (the one deliberate exception, `.site-webhub-modal`'s pinned dark override for the fixed consent overlay, stays as-is and must not be copied into new inline styles).

---

### Task 1: Extract pricing grouping/ranking logic into a tested lib module

**Files:**
- Create: `frontend/src/lib/pricingTiers.ts`
- Create: `frontend/src/lib/pricingTiers.test.ts`

**Interfaces:**
- Produces: `LENS_ORDER: LensKey[]`, `lensRank(name: string): number`, `SUBGROUP_ORDER: SubgroupKey[]`, `subgroupRank(name: string): number`, `defaultTierIndex(tiers: { highlight: boolean }[]): number`, and the types `LensKey` (`'rekonstruktion' | 'analysen' | 'systemaudit'`) and `SubgroupKey` (`'reviews' | 'systemDesign' | 'ongoing'`). Task 2 and Task 3 both import from this module.

This is a straight extraction of existing, already-correct logic (today it lives inline in `frontend/src/components/WebHubPricing.tsx` lines 601-657) into its own file so it can be unit-tested without pulling in any component/DOM machinery — this repo's Vitest config (`frontend/vite.config.ts`) deliberately runs pure-`.ts` tests only, in a `node` environment.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/pricingTiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LENS_ORDER, SUBGROUP_ORDER, defaultTierIndex, lensRank, subgroupRank } from './pricingTiers'

describe('lensRank', () => {
  it('ranks a Rekonstruktion product first', () => {
    expect(lensRank('Case Intake Scan')).toBe(0)
  })
  it('ranks an Analysen product second', () => {
    expect(lensRank('Emergent Case Intelligence Sprint')).toBe(1)
  })
  it('ranks a Systemaudit product last', () => {
    expect(lensRank('Rollenreview')).toBe(2)
  })
  it('falls back an unrecognized product name to the last (Systemaudit) group', () => {
    expect(lensRank('Some Brand New Admin-Added Product')).toBe(LENS_ORDER.length - 1)
  })
})

describe('subgroupRank', () => {
  it('ranks a review product into the reviews subgroup', () => {
    expect(subgroupRank('Prozessreview')).toBe(0)
  })
  it('ranks a build product into the systemDesign subgroup', () => {
    expect(subgroupRank('Implementation Build')).toBe(1)
  })
  it('ranks a retainer product into the ongoing subgroup', () => {
    expect(subgroupRank('Watchtower Retainment')).toBe(2)
  })
  it('falls back an unrecognized product name to the last (ongoing) subgroup', () => {
    expect(subgroupRank('Some Brand New Admin-Added Product')).toBe(SUBGROUP_ORDER.length - 1)
  })
})

describe('defaultTierIndex', () => {
  it('returns the index of the highlighted tier', () => {
    const tiers = [{ highlight: false }, { highlight: true }, { highlight: false }]
    expect(defaultTierIndex(tiers)).toBe(1)
  })
  it('returns 0 when no tier is highlighted', () => {
    const tiers = [{ highlight: false }, { highlight: false }]
    expect(defaultTierIndex(tiers)).toBe(0)
  })
  it('returns 0 for an empty list', () => {
    expect(defaultTierIndex([])).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/pricingTiers.test.ts`
Expected: FAIL — `Cannot find module './pricingTiers'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/pricingTiers.ts`:

```ts
// Pure grouping/ranking logic for the WebHub offer ladder — extracted from
// the old WebHubPricing.tsx full-page modal (see
// docs/superpowers/specs/2026-08-06-webhub-pricing-inline-carousel-design.md)
// so it can be unit-tested without any rendering/DOM dependency.

export type LensKey = 'rekonstruktion' | 'analysen' | 'systemaudit'
export const LENS_ORDER: LensKey[] = ['rekonstruktion', 'analysen', 'systemaudit']

const REKONSTRUKTION_NAMES = new Set([
  'Case Intake Scan', 'Mangelcluster Sprint',
])
const ANALYSEN_NAMES = new Set([
  'Market & Competitor Intelligence', 'Framework Magnification', 'Emergent Case Intelligence Sprint',
])
const SYSTEMAUDIT_NAMES = new Set([
  'Multi-Agent System Design', 'Implementation Build', 'Retainer / Monitoring', 'Framework Update',
  'Systemaudit', 'Rollenreview', 'Prozessreview', 'Root Level Review', 'Schnittstellenreview',
  'Betriebsreview', 'Verhaltensreview', 'Organisationsreview', 'Produktreview',
  'Framework Design from Analysis', 'System Design & Deployment', 'Watchtower Retainment',
  'Multiagent System Coordination', 'Further Development',
])

const LENS_SETS: Record<LensKey, Set<string>> = {
  rekonstruktion: REKONSTRUKTION_NAMES,
  analysen: ANALYSEN_NAMES,
  systemaudit: SYSTEMAUDIT_NAMES,
}

// Ranks a product into its lens group (0..n-1); a product not in any lens
// set falls into the last group (Systemaudit) as a sensible default, so a
// freshly admin-added product still shows up somewhere instead of vanishing.
export function lensRank(name: string): number {
  for (let i = 0; i < LENS_ORDER.length; i++) {
    if (LENS_SETS[LENS_ORDER[i]].has(name)) return i
  }
  return LENS_ORDER.length - 1
}

export type SubgroupKey = 'reviews' | 'systemDesign' | 'ongoing'
export const SUBGROUP_ORDER: SubgroupKey[] = ['reviews', 'systemDesign', 'ongoing']

const SUBGROUP_SETS: Record<SubgroupKey, Set<string>> = {
  reviews: new Set([
    'Systemaudit', 'Rollenreview', 'Prozessreview', 'Root Level Review', 'Schnittstellenreview',
    'Betriebsreview', 'Verhaltensreview', 'Organisationsreview', 'Produktreview',
  ]),
  systemDesign: new Set([
    'Multi-Agent System Design', 'Framework Design from Analysis', 'Implementation Build', 'System Design & Deployment',
  ]),
  ongoing: new Set([
    'Retainer / Monitoring', 'Framework Update', 'Watchtower Retainment', 'Multiagent System Coordination', 'Further Development',
  ]),
}

export function subgroupRank(name: string): number {
  for (let i = 0; i < SUBGROUP_ORDER.length; i++) {
    if (SUBGROUP_SETS[SUBGROUP_ORDER[i]].has(name)) return i
  }
  return SUBGROUP_ORDER.length - 1
}

// The tier a carousel opens on by default: the group's flagship if one is
// marked highlighted, otherwise the first (cheapest, since callers sort by
// price) tier. Mirrors rfi-irfos-web's TierCarousel defaultIdx behaviour
// (frontend/src/components/sections/shared.tsx in rfi-irfos-web).
export function defaultTierIndex(tiers: { highlight: boolean }[]): number {
  const i = tiers.findIndex(t => t.highlight)
  return i === -1 ? 0 : i
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/pricingTiers.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/eri-irfos/projects/emergent-interaction-lab
git add frontend/src/lib/pricingTiers.ts frontend/src/lib/pricingTiers.test.ts
git commit -m "Extract WebHub pricing grouping logic into a tested lib module"
```

---

### Task 2: Build the presentational tier carousel component

**Files:**
- Create: `frontend/src/components/PricingTierCarousel.tsx`
- Modify: `frontend/src/App.css` (append new carousel/group-panel rules only — nothing removed yet, so the still-live `WebHubPricing.tsx` from Task 3 keeps rendering correctly until the cutover)

**Interfaces:**
- Consumes: `defaultTierIndex` from `../lib/pricingTiers` (Task 1).
- Produces: `PricingTier` type (`{ key, name, phase, tagline?, points, price, perLabel?, highlight, isFlagship }`) and `PricingTierCarousel({ tiers, whatLabel, youGetLabel, buyLabel, flagshipBadge, onBuy })` component. Task 3 imports both.

This is a pure UI component: one big featured-tier card (name, phase chip, price, tagline, "you get" bullets, Buy button — all inline, no further modal) plus a permanent-slot filmstrip of the group's other tiers below it; clicking a tile swaps it into the featured slot. No data fetching, no consent logic — that stays in `WebHubPricingCarousel` (Task 3). No unit test for this file: this repo has zero component/DOM tests for any `.tsx` file (confirmed via `vite.config.ts`'s `test.environment: 'node'` and its comment "no component/DOM tests exist yet") — verification for this task is a clean `tsc` build only, consistent with every other component in this codebase.

- [ ] **Step 1: Write the component**

Create `frontend/src/components/PricingTierCarousel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { defaultTierIndex } from '../lib/pricingTiers'

export type PricingTier = {
  key: string
  name: string
  phase: string
  tagline?: string
  points: string[]
  price: string
  perLabel?: string
  highlight: boolean
  isFlagship: boolean
}

// Featured-card + filmstrip carousel for one pricing group — mirrors
// rfi-irfos-web's TierCarousel (frontend/src/components/sections/shared.tsx
// in the rfi-irfos-web repo): one large card for the active tier with the
// full copy inline (no further click/modal needed to read it) plus a
// permanent-slot filmstrip of the group's other tiers underneath. See
// docs/superpowers/specs/2026-08-06-webhub-pricing-inline-carousel-design.md.
export function PricingTierCarousel({
  tiers, whatLabel, youGetLabel, buyLabel, flagshipBadge, onBuy,
}: {
  tiers: PricingTier[]
  whatLabel: string
  youGetLabel: string
  buyLabel: string
  flagshipBadge: string
  onBuy: (tier: PricingTier) => void
}) {
  const defaultIdx = defaultTierIndex(tiers)
  const [idx, setIdx] = useState(defaultIdx)
  const active = tiers[idx]
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    tileRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [idx])

  if (!active) return null

  return (
    <div className="site-webhub-carousel">
      <div className={`site-webhub-carousel-featured${idx === defaultIdx ? ' is-default' : ''}`}>
        {active.isFlagship && <div className="site-webhub-flag">{flagshipBadge}</div>}
        <span className="site-webhub-chip">{active.phase}</span>
        <h3 className="site-webhub-carousel-name">{active.name}</h3>
        <div className="site-webhub-price">
          {active.price}
          {active.perLabel && <span className="site-webhub-per"> {active.perLabel}</span>}
        </div>
        {active.tagline && (
          <div className="site-webhub-blk">
            <div className="site-webhub-lbl">{whatLabel}</div>
            <div className="site-webhub-txt">{active.tagline}</div>
          </div>
        )}
        {active.points.length > 0 && (
          <div className="site-webhub-blk">
            <div className="site-webhub-lbl">{youGetLabel}</div>
            <ul className="site-webhub-points">
              {active.points.map((pt, i) => <li key={i}>{pt}</li>)}
            </ul>
          </div>
        )}
        <button type="button" className="site-webhub-buy big" onClick={() => onBuy(active)}>
          <span>{buyLabel}</span>
        </button>
      </div>

      {tiers.length > 1 && (
        <div className="site-webhub-carousel-strip">
          {tiers.map((t, i) => (
            <button
              key={t.key}
              ref={el => { tileRefs.current[i] = el }}
              type="button"
              className={`site-webhub-carousel-tile${i === idx ? ' is-active' : ''}`}
              onClick={() => setIdx(i)}
            >
              <div className="site-webhub-carousel-tile-name">{t.name}</div>
              <div className="site-webhub-carousel-tile-price">
                {t.price}
                {t.perLabel && <span className="site-webhub-per"> {t.perLabel}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the carousel/group-panel CSS**

In `frontend/src/App.css`, right after the `.site-webhub-subgroup-label { ... }` rule (the block ending at what is currently line 1958), insert:

```css

/* ── inline pricing carousel — featured card + filmstrip per group,
   rendered directly on the homepage (see
   docs/superpowers/specs/2026-08-06-webhub-pricing-inline-carousel-design.md).
   Unlike .site-webhub-modal below, this is ordinary page content, so it
   must NOT pin a hardcoded dark surface — it inherits the page's active
   light/dark/hc theme via the plain --surface/--text tokens. ── */
.site-webhub-group-panel {
  max-width: 720px; margin: 0 auto 32px; padding: 28px 24px;
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border-radius: 18px;
}
.site-webhub-carousel-featured {
  position: relative;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 22px 22px 20px; margin-bottom: 16px;
}
.site-webhub-carousel-featured.is-default { border-color: var(--primary); }
.site-webhub-carousel-name { font-size: 19px; font-weight: 800; margin: 8px 0 2px; color: var(--text); line-height: 1.25; }
.site-webhub-carousel-strip {
  display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scroll-behavior: smooth;
}
.site-webhub-carousel-tile {
  flex-shrink: 0; min-width: 148px; text-align: left; cursor: pointer;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; transition: border-color .15s, background .15s;
}
.site-webhub-carousel-tile.is-active { border-color: var(--primary); background: var(--surface-alt); }
.site-webhub-carousel-tile-name { font-size: 12px; font-weight: 700; color: var(--text); }
.site-webhub-carousel-tile-price { font-size: 12px; font-weight: 800; color: var(--price); margin-top: 3px; }

@media (max-width: 640px) {
  .site-webhub-group-panel { padding: 20px 16px; }
}
```

- [ ] **Step 3: Verify the build**

Run: `cd frontend && npm run build`
Expected: succeeds (the new component isn't imported anywhere yet, but it must still type-check cleanly on its own).

- [ ] **Step 4: Commit**

```bash
cd /home/eri-irfos/projects/emergent-interaction-lab
git add frontend/src/components/PricingTierCarousel.tsx frontend/src/App.css
git commit -m "Add presentational pricing tier carousel component"
```

---

### Task 3: Cut over from the pricing modal to the inline carousel

**Files:**
- Create: `frontend/src/components/WebHubPricingCarousel.tsx`
- Delete: `frontend/src/components/WebHubPricing.tsx`
- Modify: `frontend/src/App.css` (remove now-dead rules from the old grid/modal layout)
- Modify: `frontend/src/components/PublicSite.tsx` (render the carousel inline in `#pricing`)
- Modify: `frontend/src/App.tsx` (stop opening pricing as a page-level modal; scroll to the section instead)

**Interfaces:**
- Consumes: `PricingTierCarousel`, `PricingTier` (Task 2); `lensRank`, `subgroupRank`, `LENS_ORDER`, `SUBGROUP_ORDER`, `SubgroupKey` (Task 1).
- Produces: `WebHubPricingCarousel({ content: SiteContent })` — no `onClose` prop (it's no longer a modal). `PublicSite.tsx` renders it directly.

This is one atomic task because deleting `WebHubPricing.tsx` and removing its last import from `App.tsx` must land together — a build with the file deleted but the old import still present (or vice versa) will not compile.

- [ ] **Step 1: Create `WebHubPricingCarousel.tsx`**

First, open the current `frontend/src/components/WebHubPricing.tsx` and copy these two pieces verbatim (content unchanged, no rewriting):
- The `FLAGSHIP_NAME` constant (currently around line 37: `const FLAGSHIP_NAME = 'Emergent Case Intelligence Sprint'`).
- The `DetailLang` interface and the `DETAIL` record together with the explanatory comment directly above it (currently lines ~60-577, starting at the comment block beginning "Phase chip + single-language-at-a-time narrative..." and ending at the `DETAIL` record's closing `}`). This is the large per-product tagline/points copy — move it unchanged.

Then create `frontend/src/components/WebHubPricingCarousel.tsx` with those two pieces pasted in where marked, plus the rest of the file below:

```tsx
import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { useLang } from '../hooks/useLang'
import type { SiteContent } from '../types/content'
import { LENS_ORDER, SUBGROUP_ORDER, lensRank, subgroupRank, type SubgroupKey } from '../lib/pricingTiers'
import { PricingTierCarousel, type PricingTier } from './PricingTierCarousel'

// ── PASTE FLAGSHIP_NAME HERE (verbatim, from the old WebHubPricing.tsx) ──

// ── PASTE DetailLang + DETAIL HERE (verbatim, from the old WebHubPricing.tsx) ──

interface PublicProduct {
  name: string
  description: string
  description_de: string | null
  price_cents: number
  currency: string
  mode: string
  recurring_interval: string | null
  payment_link_url: string
  category: string
}

function formatPrice(cents: number, currency: string, lang: 'en' | 'de'): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-AT' : 'en-IE', {
    style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0,
  }).format(cents / 100)
}

const COPY = {
  en: {
    flagshipBadge: 'Core offer',
    recurring: 'month',
    loading: 'Loading the offer ladder…',
    error: 'Could not load pricing right now - reach out directly instead.',
    whatLabel: 'What this is',
    youGetLabel: 'You get',
    buy: 'Buy',
    close: 'Close',
    groupRekonstruktion: 'Rekonstruktion',
    groupAnalysen: 'Analysen',
    groupSystemaudit: 'Systemaudit',
    subgroupReviews: 'Reviews',
    subgroupSystemDesign: 'System design & build',
    subgroupOngoing: 'Ongoing',
    agentsEyebrow: 'Agents from the method',
    agentsIntro: 'These are not services you book by the hour — they are what the review perspectives produce: working agents built from the same case-logic above.',
    consentTitle: 'Please confirm before checkout',
    consentB2b: 'I am acting as a business customer and confirm that this purchase is made in the course of my commercial or professional activity.',
    consentAgbBefore: 'I agree to the ',
    consentAgbLink: 'Terms of Service',
    consentAgbAfter: '. I understand that the service begins immediately upon payment and that no right of withdrawal applies. Refunds are excluded.',
    cancel: 'Cancel',
    continueToStripe: 'Continue to Stripe →',
  },
  de: {
    flagshipBadge: 'Kernangebot',
    recurring: 'Monat',
    loading: 'Angebotsleiter wird geladen…',
    error: 'Preise konnten gerade nicht geladen werden - melde dich direkt.',
    whatLabel: 'Was das ist',
    youGetLabel: 'Das bekommst du',
    buy: 'Kaufen',
    close: 'Schließen',
    groupRekonstruktion: 'Rekonstruktion',
    groupAnalysen: 'Analysen',
    groupSystemaudit: 'Systemaudit',
    subgroupReviews: 'Reviews',
    subgroupSystemDesign: 'Systemdesign & Aufbau',
    subgroupOngoing: 'Laufend',
    agentsEyebrow: 'Agenten aus der Methode',
    agentsIntro: 'Das sind keine Leistungen, die du stundenweise buchst - das ist, was die Prüfperspektiven hervorbringen: lauffähige Agenten, gebaut aus derselben Fall-Logik wie oben.',
    consentTitle: 'Bitte vor dem Checkout bestätigen',
    consentB2b: 'Ich handle als Unternehmer und bestätige, dass dieser Kauf im Rahmen meiner gewerblichen oder beruflichen Tätigkeit erfolgt.',
    consentAgbBefore: 'Ich stimme den ',
    consentAgbLink: 'Allgemeinen Geschäftsbedingungen',
    consentAgbAfter: ' zu. Mir ist bewusst, dass die Leistung sofort nach Zahlung beginnt und daher kein Widerrufsrecht besteht. Rückerstattungen sind ausgeschlossen.',
    cancel: 'Abbrechen',
    continueToStripe: 'Weiter zu Stripe →',
  },
} as const

export function WebHubPricingCarousel({ content }: { content: SiteContent }) {
  const { lang } = useLang()
  const c = COPY[lang]
  const [products, setProducts] = useState<PublicProduct[] | null>(null)
  const [error, setError] = useState(false)
  // Agents (Call Laura / Lauras Team / Jarvis) emerge from the method — shown
  // as a separate strip, not in the buyable price grid.
  const agents = (content.productsBorn?.items ?? []).filter(a =>
    ['born-jarvis', 'born-calllaura', 'born-laurateam'].includes(a.id),
  )

  // Legal consent gate before any Stripe redirect — mirrors rfi-irfos.com's
  // own B2B-checkout-confirmation modal. Unchanged from the old modal.
  const [checkoutTarget, setCheckoutTarget] = useState<PublicProduct | null>(null)
  const [b2bChecked, setB2bChecked] = useState(false)
  const [agbChecked, setAgbChecked] = useState(false)

  const openCheckout = (p: PublicProduct) => {
    setB2bChecked(false)
    setAgbChecked(false)
    setCheckoutTarget(p)
  }
  const confirmCheckout = () => {
    if (!checkoutTarget) return
    window.open(checkoutTarget.payment_link_url, '_blank', 'noopener,noreferrer')
    setCheckoutTarget(null)
  }

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/billing/public-products`)
      .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
      .then((data: PublicProduct[]) => {
        if (cancelled) return
        const sorted = [...data.filter(p => p.category !== 'certification')].sort((a, b) => {
          const ra = lensRank(a.name); const rb = lensRank(b.name)
          return ra !== rb ? ra - rb : a.price_cents - b.price_cents
        })
        setProducts(sorted)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  // Only the checkout consent overlay needs to lock body scroll and handle
  // Escape now — the old modal locked scroll unconditionally because the
  // whole component WAS a full-page overlay; as inline homepage content it
  // must let the page scroll normally except while the consent popup is
  // actually open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && checkoutTarget) setCheckoutTarget(null)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = checkoutTarget ? 'hidden' : ''
    return () => window.removeEventListener('keydown', onKey)
  }, [checkoutTarget])

  const buildTier = (p: PublicProduct): PricingTier => ({
    key: p.name,
    name: p.name,
    phase: DETAIL[p.name]?.phase ?? p.category,
    tagline: DETAIL[p.name]?.[lang]?.tagline ?? (lang === 'en' ? p.description : (p.description_de ?? p.description)),
    points: DETAIL[p.name]?.[lang]?.points ?? [],
    price: formatPrice(p.price_cents, p.currency, lang),
    perLabel: p.mode === 'subscription' ? `/ ${c.recurring}` : undefined,
    highlight: p.name === FLAGSHIP_NAME,
    isFlagship: p.name === FLAGSHIP_NAME,
  })

  if (!error && products !== null && products.length === 0) return null

  return (
    <div className="site-webhub-pricing">
      {products === null && !error && <p className="site-webhub-status">{c.loading}</p>}
      {error && <p className="site-webhub-status">{c.error}</p>}

      {products !== null && products.length > 0 && (() => {
        const renderGroup = (key: string, label: string, items: PublicProduct[]) => (
          <div key={key} className="site-webhub-group-panel">
            <div className="site-webhub-group-label">{label}</div>
            <PricingTierCarousel
              tiers={items.map(buildTier)}
              whatLabel={c.whatLabel}
              youGetLabel={c.youGetLabel}
              buyLabel={c.buy}
              flagshipBadge={c.flagshipBadge}
              onBuy={tier => {
                const p = items.find(p => p.name === tier.name)
                if (p) openCheckout(p)
              }}
            />
          </div>
        )

        return (
          <>
            {LENS_ORDER.map((lens, li) => {
              const group = products.filter(p => lensRank(p.name) === li)
              if (group.length === 0) return null
              const label = lens === 'rekonstruktion' ? c.groupRekonstruktion
                : lens === 'analysen' ? c.groupAnalysen
                : c.groupSystemaudit
              if (lens === 'systemaudit') {
                const subgroups = SUBGROUP_ORDER.map((sg, si) => ({
                  sg,
                  items: group.filter(p => subgroupRank(p.name) === si),
                })).filter(g => g.items.length > 0)
                const subLabel = (sg: SubgroupKey) =>
                  sg === 'reviews' ? c.subgroupReviews : sg === 'systemDesign' ? c.subgroupSystemDesign : c.subgroupOngoing
                return subgroups.map(({ sg, items }) =>
                  renderGroup(`${lens}-${sg}`, `${label} — ${subLabel(sg)}`, items),
                )
              }
              return renderGroup(lens, label, group)
            })}
            {agents.length > 0 && (
              <div className="site-webhub-agents">
                <div className="site-webhub-group-divider" />
                <div className="site-webhub-group-label site-webhub-agents-label">{c.agentsEyebrow}</div>
                <p className="site-webhub-agents-intro">{c.agentsIntro}</p>
                <div className="site-webhub-agents-row">
                  {agents.map(a => (
                    <div key={a.id} className="site-webhub-agent-card">
                      <span className="site-webhub-agent-builtby">{a.builtBy}</span>
                      <h4 className="site-webhub-agent-name">{a.name}</h4>
                      <p className="site-webhub-agent-desc">{a.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      })()}

      {checkoutTarget && (
        <div
          className="site-webhub-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={c.consentTitle}
          onClick={(e) => { if (e.target === e.currentTarget) setCheckoutTarget(null) }}
        >
          <div className="site-webhub-modal site-webhub-consent">
            <button type="button" className="site-webhub-x" aria-label={c.close} onClick={() => setCheckoutTarget(null)}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6 L18 18 M18 6 L6 18" />
              </svg>
            </button>
            <div className="site-webhub-lbl">{c.consentTitle}</div>
            <h3 className="site-webhub-modal-name">{checkoutTarget.name}</h3>
            <label className="site-webhub-consent-row">
              <input type="checkbox" checked={b2bChecked} onChange={e => setB2bChecked(e.target.checked)} />
              <span>{c.consentB2b}</span>
            </label>
            <label className="site-webhub-consent-row">
              <input type="checkbox" checked={agbChecked} onChange={e => setAgbChecked(e.target.checked)} />
              <span>
                {c.consentAgbBefore}
                <a href="#p/agb" target="_blank" rel="noopener noreferrer">{c.consentAgbLink}</a>
                {c.consentAgbAfter}
              </span>
            </label>
            <div className="site-webhub-consent-actions">
              <button type="button" className="site-webhub-consent-cancel" onClick={() => setCheckoutTarget(null)}>
                {c.cancel}
              </button>
              <button
                type="button"
                className="site-webhub-buy big"
                disabled={!b2bChecked || !agbChecked}
                onClick={confirmCheckout}
              >
                <span>{c.continueToStripe}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Delete the old modal file**

```bash
cd /home/eri-irfos/projects/emergent-interaction-lab
git rm frontend/src/components/WebHubPricing.tsx
```

- [ ] **Step 3: Remove now-dead CSS from `frontend/src/App.css`**

Remove these rules (they only styled the old dense card-wall + "More" button
+ the component's own now-dropped eyebrow/title/intro block — the carousel
added in Task 2 replaces all of it, and the CMS text intro in
`PublicSite.tsx` is the section's only intro now):

- `.site-webhub-head`, `.site-webhub-eyebrow`, `.site-webhub-intro` (the block starting `.site-webhub-head { max-width: 720px; ... }`)
- `.site-webhub-grid` and its rule body
- `.site-webhub-card`, `.site-webhub-card:hover`, the `@media (prefers-reduced-motion: reduce) { .site-webhub-card:hover { ... } }` override, `.site-webhub-card.flagship`, `.site-webhub-card.flagship h3`, `.site-webhub-flag` (redefine `.site-webhub-flag` is NOT needed again — it's still used by the new featured card, but its existing rule is compatible as-is since the new carousel provides its own `position: relative` parent, so this specific rule body does not need to change, only stays where it is; do not delete `.site-webhub-flag` itself, only the four `.site-webhub-card*` rules around it)
- `.site-webhub-card h3`, `.site-webhub-card-tagline`
- `.site-webhub-row`, `.site-webhub-buy` (the non-`.big` icon-button variant) and its `:hover`
- `.site-webhub-more`, `.site-webhub-more:hover`
- `.site-webhub-modal .site-webhub-chip { margin-bottom: 10px; }` (only used by the removed per-tier detail modal)
- the trailing `@media (max-width: 640px) { .site-webhub-grid { grid-template-columns: 1fr; } }` block at the end of the file's webhub section

Do **not** remove: `.site-webhub-status`, `.site-webhub-group-label`, `.site-webhub-group-divider`, `.site-webhub-subgroup*`, all `.site-webhub-agents*` rules, `.site-webhub-chip` (base rule), `.site-webhub-flag` (base rule — still used), `.site-webhub-overlay`, `.site-webhub-modal` (+ its dark override — still used by the consent popup), `.site-webhub-modal-name`, `.site-webhub-modal-price`, `.site-webhub-blk`, `.site-webhub-lbl`, `.site-webhub-txt`, `.site-webhub-points` (+ `li`), `.site-webhub-x` (+ `:hover`), `.site-webhub-buy.big` (+ `:hover`/`:disabled`), all `.site-webhub-consent*` rules, `.site-webhub-price`, `.site-webhub-per` — all of these are reused by the new carousel and/or the still-present consent modal.

- [ ] **Step 4: Wire the carousel into `PublicSite.tsx`**

In `frontend/src/components/PublicSite.tsx`, add the import near the other component imports (after `import { PdfViewerModal } from './PdfViewerModal'`):

```tsx
import { WebHubPricingCarousel } from './WebHubPricingCarousel'
```

Then replace the pricing section (currently):

```tsx
        {/* ── PRICING ──────────────────────────────────────────────────── */}
        {pricing?.body && (
          <section className={reveal("site-section site-pricing")} id="pricing" data-cid="pricing.title">
            <h2 className="site-section-title">{pricing.title}</h2>
            <div className="site-pricing-body">
              {pricing.body.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>
        )}

        {/* WebHub offer ladder moved off the homepage into its own modal
            (see App.tsx / WebHubPricing.tsx) - opened via the "Pricing" nav
            link (#p/pricing), not rendered inline here anymore. */}
```

with:

```tsx
        {/* ── PRICING ──────────────────────────────────────────────────── */}
        {/* Always renders (not gated behind pricing?.body like before) so
            the real offer ladder can never go silently missing just
            because the CMS intro text happens to be empty — see
            docs/superpowers/specs/2026-08-06-webhub-pricing-inline-carousel-design.md. */}
        <section className={reveal("site-section site-pricing")} id="pricing" data-cid="pricing.title">
          {pricing?.title && <h2 className="site-section-title">{pricing.title}</h2>}
          {pricing?.body && (
            <div className="site-pricing-body">
              {pricing.body.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}
          <WebHubPricingCarousel content={content} />
        </section>
```

- [ ] **Step 5: Stop `App.tsx` from opening pricing as a modal**

In `frontend/src/App.tsx`:

Remove the import (currently line 14):
```tsx
import { WebHubPricing } from './components/WebHubPricing'
```

Add a new effect among the other hooks, directly after the existing hashchange `useEffect` (the one that ends `}, [])` around line 74) and **before** the `if (loading) { ... }` early return — it must be declared unconditionally alongside the other hooks, not after any early return:

```tsx
  // '#p/pricing' used to open a full-page modal (WebHubPricing.tsx, removed
  // — see docs/superpowers/specs/2026-08-06-webhub-pricing-inline-carousel-design.md).
  // The real ladder now renders inline in the homepage's #pricing section,
  // so this hash just scrolls there instead. Guarded on `content` so a cold
  // page load on a #p/pricing deep link (content still fetching, PublicSite
  // not mounted yet) waits for content to arrive before trying to scroll.
  useEffect(() => {
    if (pageModalSlug !== 'pricing' || !content) return
    document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })
    setPageModalSlug(null)
    if (window.location.hash.startsWith('#p/')) {
      window.history.pushState('', document.title, window.location.pathname + window.location.search)
      setRoute(getRoute(window.location.hash))
    }
  }, [pageModalSlug, content])
```

Remove this comment + const (currently lines 132-135):
```tsx
  // Pricing moved off the homepage into its own modal too - was a wall of
  // 23 products scrolled past on every visit; now opt-in via the "Pricing"
  // nav link, same dark-modal pattern as everything else here.
  const isPricingModal = pageModalSlug === 'pricing'
```

Change (currently lines 144-147):
```tsx
  const modalPage = !isCertModal && !isPricingModal && !isBlogModal && pageModalSlug
    ? (content.pages ?? []).find(p => p.slug === pageModalSlug)
    : undefined
  const modalActive = isCertModal || isPricingModal || isBlogModal || !!modalPage
```
to:
```tsx
  const modalPage = !isCertModal && !isBlogModal && pageModalSlug && pageModalSlug !== 'pricing'
    ? (content.pages ?? []).find(p => p.slug === pageModalSlug)
    : undefined
  const modalActive = isCertModal || isBlogModal || !!modalPage
```

Change the final return (currently lines 178-189):
```tsx
  return (
    <>
      <PublicSite content={content} modalOpen={modalActive} />
      {isCertModal
        ? <CertificationPage content={content} onClose={closeModal} />
        : isPricingModal
        ? <WebHubPricing content={content} onClose={closeModal} />
        : isBlogModal && blogItem
        ? <BlogPostPage item={blogItem} content={content} onClose={closeModal} />
        : modalPage && <PageModal page={modalPage} content={content} onClose={closeModal} />}
    </>
  )
```
to:
```tsx
  return (
    <>
      <PublicSite content={content} modalOpen={modalActive} />
      {isCertModal
        ? <CertificationPage content={content} onClose={closeModal} />
        : isBlogModal && blogItem
        ? <BlogPostPage item={blogItem} content={content} onClose={closeModal} />
        : modalPage && <PageModal page={modalPage} content={content} onClose={closeModal} />}
    </>
  )
```

- [ ] **Step 6: Verify the build**

Run: `cd frontend && npm run build`
Expected: succeeds with no TypeScript errors and no unused-import errors.

Run: `cd frontend && npx vitest run`
Expected: all existing tests plus Task 1's new tests pass.

- [ ] **Step 7: Commit**

```bash
cd /home/eri-irfos/projects/emergent-interaction-lab
git add frontend/src/components/WebHubPricingCarousel.tsx frontend/src/App.css frontend/src/components/PublicSite.tsx frontend/src/App.tsx
git commit -m "Replace the WebHub pricing modal with an inline carousel on the homepage"
```

---

### Task 4: Manual verification across all three themes

**Files:** none (verification only — fix forward in the relevant file from Tasks 2/3 if something's broken, then re-commit).

- [ ] **Step 1: Start the dev server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Verify the checklist in a browser, once per theme (light / dark / hc)**

For each of the three themes (use the site's existing theme switcher):
- Scrolling the homepage down to `#pricing` shows the carousel directly — no click required.
- Each of the 5 groups (Rekonstruktion; Analysen; Systemaudit — Reviews / System design & build / Ongoing) renders in its own bordered panel with a label.
- The featured card in each group shows name, phase chip, price, tagline, and "You get" bullets all inline — clicking a filmstrip tile swaps its content into the featured card.
- The "Emergent Case Intelligence Sprint" tier shows the "Core offer" / "Kernangebot" badge.
- Clicking a featured card's Buy button opens the B2B/AGB consent modal; both checkboxes must be checked before "Continue to Stripe" enables; confirming opens the Stripe payment link in a new tab.
- Escape closes the consent modal; clicking outside it also closes it.
- The rest of the homepage still scrolls normally (body scroll is not locked) while no consent modal is open.
- The "Agents from the method" strip still renders below the groups.
- Text and colors are legible in all three themes (no invisible light-on-light or dark-on-dark text).
- Navigating to `#p/pricing` directly (paste it into the address bar and reload) smoothly scrolls to `#pricing` instead of opening any modal.

- [ ] **Step 3: Fix forward if anything in the checklist fails**

If a visual or behavioral issue turns up, fix it directly in `PricingTierCarousel.tsx`, `WebHubPricingCarousel.tsx`, `App.css`, or `App.tsx` (whichever owns it), then re-run Step 2 for the affected theme(s).

- [ ] **Step 4: Final commit (only if Step 3 required changes)**

```bash
cd /home/eri-irfos/projects/emergent-interaction-lab
git add -A
git commit -m "Fix issues found in manual pricing carousel verification"
```
