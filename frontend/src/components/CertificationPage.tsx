import { useEffect, useState } from 'react'
import type { SiteContent } from '../types/content'
import { useLang } from '../hooks/useLang'
import { API_BASE } from '../lib/apiBase'

// Shape returned by the public, unauthenticated GET /api/billing/public-products
// — deliberately narrower than the admin ProductOut (see Monetization.tsx):
// no stripe_product_id/stripe_price_id, and only rows that already have a
// real payment_link_url (Monetarisierung filters drafts out server-side).
interface PublicProduct {
  name: string
  description: string
  price_cents: number
  currency: string
  mode: string
  recurring_interval: string | null
  payment_link_url: string
  category: string
}

function formatPrice(cents: number, currency: string, lang: 'en' | 'de'): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-AT' : 'en-IE', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

const COPY = {
  en: {
    eyebrow: 'Certification',
    title: 'Certified Emergence Interaction Analyst',
    intro: 'Learn the Emergent Interaction methodology itself, as a course and a credential: a self-paced curriculum, a certification exam, and a digital badge — with a team option for groups who want to learn it together.',
    back: 'Back to home',
    loading: 'Loading offerings…',
    errorBody: 'Offerings could not be loaded right now. Please try again shortly, or get in touch directly.',
    comingSoonTitle: 'Coming soon',
    comingSoonBody: "This certification isn't purchasable yet — no product has been published for it. Check back soon, or reach out and we'll let you know the moment it's live.",
    perMonth: 'month',
    perYear: 'year',
    cta: 'Buy now',
  },
  de: {
    eyebrow: 'Zertifizierung',
    title: 'Certified Emergence Interaction Analyst',
    intro: 'Die Emergent-Interaction-Methodik selbst lernen, als Kurs und Nachweis: Selbstlernkurs, Zertifizierungsprüfung und digitales Badge — mit einer Team-Option für Gruppen, die gemeinsam lernen wollen.',
    back: 'Zur Startseite',
    loading: 'Angebote werden geladen…',
    errorBody: 'Angebote konnten gerade nicht geladen werden. Bitte versuch es in Kürze erneut oder melde dich direkt bei uns.',
    comingSoonTitle: 'Kommt bald',
    comingSoonBody: 'Diese Zertifizierung ist noch nicht käuflich — es wurde noch kein Produkt dafür veröffentlicht. Schau bald wieder vorbei oder melde dich bei uns, wir informieren dich, sobald es live ist.',
    perMonth: 'Monat',
    perYear: 'Jahr',
    cta: 'Jetzt kaufen',
  },
} as const

export function CertificationPage({ content }: { content: SiteContent }) {
  const { lang } = useLang()
  const c = COPY[lang]

  const [products, setProducts] = useState<PublicProduct[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => { window.scrollTo(0, 0) }, [])

  useEffect(() => {
    const prev = document.title
    document.title = `${c.title} — ${content.meta?.title ?? ''}`
    return () => { document.title = prev }
  }, [c.title, content.meta?.title])

  useEffect(() => {
    let cancelled = false
    setProducts(null)
    setError(false)
    fetch(`${API_BASE}/api/billing/public-products`)
      .then(res => {
        if (!res.ok) throw new Error(`status ${res.status}`)
        return res.json()
      })
      .then((data: PublicProduct[]) => {
        // The public-products feed now also carries the WebHub service
        // ladder (category: 'service') alongside certification products —
        // this page shows only the latter, or a pre-category row (category
        // defaults to 'certification' server-side; see billing.rs).
        if (!cancelled) setProducts(data.filter(p => p.category === 'certification'))
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="static-page">
      <header className="static-page-nav">
        <a href="#" className="static-page-brand">{content.nav?.brand ?? 'Website'}</a>
        <a href="#" className="static-page-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          {c.back}
        </a>
      </header>
      <main className="static-page-main">
        <div className="static-page-content">
          <div className="cert-eyebrow">{c.eyebrow}</div>
          <h1>{c.title}</h1>
          <p className="cert-intro">{c.intro}</p>

          {products === null && !error && (
            <p className="cert-page-status">{c.loading}</p>
          )}

          {error && (
            <p className="cert-page-status">{c.errorBody}</p>
          )}

          {products !== null && !error && products.length === 0 && (
            <div className="cert-coming-soon">
              <h2>{c.comingSoonTitle}</h2>
              <p>{c.comingSoonBody}</p>
            </div>
          )}

          {products !== null && products.length > 0 && (
            <div className="cert-pricing-grid">
              {products.map((p, i) => (
                <div className="cert-pricing-card" key={i}>
                  <h2>{p.name}</h2>
                  {p.description && <p className="cert-pricing-desc">{p.description}</p>}
                  <div className="cert-pricing-price">
                    {formatPrice(p.price_cents, p.currency, lang)}
                    {p.mode === 'subscription' && p.recurring_interval && (
                      <span> / {p.recurring_interval === 'year' ? c.perYear : c.perMonth}</span>
                    )}
                  </div>
                  <a
                    href={p.payment_link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cert-pricing-cta"
                  >
                    {c.cta}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
