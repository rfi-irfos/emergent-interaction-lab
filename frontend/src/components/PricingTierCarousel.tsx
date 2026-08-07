import { useEffect, useRef, useState } from 'react'
import { defaultTierIndex } from '../lib/pricingTiers'
import { useLang } from '../hooks/useLang'

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
  const { lang } = useLang()
  const defaultIdx = defaultTierIndex(tiers)
  const [idx, setIdx] = useState(defaultIdx)
  const active = tiers[idx]
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([])
  const n = tiers.length
  const go = (d: 1 | -1) => setIdx(i => (i + d + n) % n)
  const prevLabel = lang === 'de' ? 'Zurück' : 'Previous'
  const nextLabel = lang === 'de' ? 'Weiter' : 'Next'

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
        <div className="site-webhub-carousel-controls">
          <button type="button" className="site-born-arrow" aria-label={prevLabel} onClick={() => go(-1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
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
          <button type="button" className="site-born-arrow" aria-label={nextLabel} onClick={() => go(1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}
