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
