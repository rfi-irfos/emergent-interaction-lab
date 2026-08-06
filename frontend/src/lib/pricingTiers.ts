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
