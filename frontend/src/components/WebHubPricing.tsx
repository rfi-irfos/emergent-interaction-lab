import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { useLang } from '../hooks/useLang'

// The real WebHub service ladder (Case Intake Scan through Retainer/
// Monitoring) — Laura's own product line, sold through real Stripe Payment
// Links (see backend/src/billing.rs's seed_webhub_products). Deliberately
// separate from `.site-pcard`/`content.products` (that's the unrelated
// portfolio-item catalog with an image slot this data doesn't have) and from
// CertificationPage (that page now filters to category: 'certification'
// only — this component is its `category: 'service'` counterpart, rendered
// directly on the main site instead of a standalone page, since Simeon
// wants the funnel visible without an extra click).
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

// The one product this ladder is built around — called out visually (not
// just the cheapest or most expensive entry) if the admin panel ever
// renames or removes it, this simply stops matching and no card gets the
// badge; nothing breaks.
const FLAGSHIP_NAME = 'Emergent Case Intelligence Sprint'

const COPY = {
  en: {
    eyebrow: 'Offer',
    title: "Your case isn't random. It has a logic. I find it.",
    intro: "Bring a complex case, a set of documents, case-file access, or a conversation history. I reconstruct what it actually is: the gaps, the contradictions, the recurring patterns - and the logic a framework or agent system gets built from. Not a vibe check. Structure.",
    flagshipBadge: 'Core offer',
    recurring: 'month',
    cta: 'Buy now',
    loading: 'Loading the offer ladder…',
    error: 'Could not load pricing right now - reach out directly instead.',
  },
  de: {
    eyebrow: 'Angebot',
    title: 'Dein Fall ist kein Zufall - er hat eine Logik. Ich finde sie.',
    intro: 'Du bringst einen komplexen Fall, eine Dokumentation, Akteneinsicht oder einen Interaktionsverlauf. Ich rekonstruiere daraus, was er wirklich ist: Mängel, Widersprüche, Lücken - und die Logik, aus der sich ein Framework oder Agentensystem ableiten lässt. Kein Bauchgefühl. Struktur.',
    flagshipBadge: 'Kernangebot',
    recurring: 'Monat',
    cta: 'Jetzt kaufen',
    loading: 'Angebotsleiter wird geladen…',
    error: 'Preise konnten gerade nicht geladen werden - melde dich direkt.',
  },
} as const

export function WebHubPricing() {
  const { lang } = useLang()
  const c = COPY[lang]
  const [products, setProducts] = useState<PublicProduct[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/billing/public-products`)
      .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
      .then((data: PublicProduct[]) => {
        if (cancelled) return
        setProducts(data.filter(p => p.category !== 'certification').sort((a, b) => a.price_cents - b.price_cents))
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  // Nothing to sell yet (fresh deploy before the seed runs, or every
  // service product got deleted) — an honest gap beats an empty section
  // with a heading and no content under it.
  if (!error && products !== null && products.length === 0) return null

  return (
    <section className="site-section site-webhub-pricing" id="webhub-pricing" data-cid="webhub-pricing.title">
      <div className="site-webhub-head">
        <div className="site-webhub-eyebrow">{c.eyebrow}</div>
        <h2 className="site-section-title">{c.title}</h2>
        <p className="site-webhub-intro">{c.intro}</p>
      </div>

      {products === null && !error && <p className="site-webhub-status">{c.loading}</p>}
      {error && <p className="site-webhub-status">{c.error}</p>}

      {products !== null && products.length > 0 && (
        <div className="site-webhub-grid">
          {products.map((p, i) => {
            const desc = lang === 'de' ? (p.description_de || p.description) : p.description
            return (
            <div key={i} className={`site-webhub-card${p.name === FLAGSHIP_NAME ? ' flagship' : ''}`}>
              {p.name === FLAGSHIP_NAME && <div className="site-webhub-flag">{c.flagshipBadge}</div>}
              <h3>{p.name}</h3>
              {desc && <p className="site-webhub-desc">{desc}</p>}
              <div className="site-webhub-foot">
                <div className="site-webhub-price">
                  {formatPrice(p.price_cents, p.currency, lang)}
                  {p.mode === 'subscription' && <span className="site-webhub-per"> / {c.recurring}</span>}
                </div>
                <a href={p.payment_link_url} target="_blank" rel="noopener noreferrer" className="site-webhub-cta">
                  {c.cta}
                </a>
              </div>
            </div>
          )})}
        </div>
      )}
    </section>
  )
}
