import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { useLang } from '../hooks/useLang'

// The real WebHub service ladder — Laura's own product line, sold through
// real Stripe Payment Links (see backend/src/billing.rs's
// seed_webhub_products). Deliberately separate from `.site-pcard` /
// content.products (unrelated portfolio catalog) and from
// CertificationPage. Rendered directly on the main site as a tight card
// wall + themed modal: the card shows only name + price + a basket link +
// a "more" button; the modal carries the single-language narrative for
// whichever language the site is currently in (see DETAIL below) so the
// ladder reads as ONE method scoped to layers (Intake → Cluster → Derive
// → Reconstruct → Design → Build → Operate) — never "mysterious option A
// vs Z".
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

// Core offer — called out visually; if renamed/removed upstream it simply
// stops matching and no card gets the badge. Nothing breaks.
const FLAGSHIP_NAME = 'Emergent Case Intelligence Sprint'

// Minimalist inline SVGs — never emojis.
const BASKET = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 9h14l-1.2 10.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 9z" />
    <path d="M9 9 10.5 4" /><path d="M15 9 13.5 4" />
    <path d="M9.5 13v3" /><path d="M14.5 13v3" />
  </svg>
)
const PLUS = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const CROSS = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

// Phase chip + single-language-at-a-time narrative, keyed by product name.
// Deliberately outcome-only: what changes for the client / what they get,
// never the internal mechanism (no "how it's built" language) — a client
// buys a result, not a methodology explainer. Falls back to the backend
// `description`/`description_de` if a name isn't listed. `phase` is the
// ladder position — it makes the interdisciplinary arc explicit so no one
// wonders where a tier sits.
const DETAIL: Record<string, { phase: string; en: string; de: string }> = {
  'Case Intake Scan': {
    phase: 'Intake',
    en: "A fast, honest read on where a case or project actually stands - the real starting point, the open questions, and what needs to happen next. No overhead, no premature conclusions.",
    de: 'Ein schneller, ehrlicher Blick darauf, wo ein Fall oder Projekt wirklich steht - der reale Ausgangspunkt, die offenen Fragen und was als Nächstes zu tun ist. Ohne Overhead, ohne vorschnelle Schlüsse.',
  },
  'Mangelcluster Sprint': {
    phase: 'Cluster',
    en: "Turns scattered raw material into a case you can actually act on - what's wrong, what's missing, what contradicts itself, and what to tackle first.",
    de: 'Macht aus verstreutem Rohmaterial einen Fall, mit dem sich arbeiten lässt - was falsch ist, was fehlt, was sich widerspricht, und was zuerst dran ist.',
  },
  'Market & Competitor Intelligence': {
    phase: 'Market',
    en: 'An honest, evidence-based read of where you actually stand against the field - not a generic market report, the real gaps and openings worth acting on.',
    de: 'Eine ehrliche, evidenzbasierte Einschätzung, wo du im Feld tatsächlich stehst - kein generischer Marktbericht, sondern die echten Lücken und Chancen, die es wert sind, verfolgt zu werden.',
  },
  'Framework Magnification': {
    phase: 'Derive',
    en: 'The underlying principles behind a case, made explicit - the rules and logic that were already there, now usable on purpose instead of by accident.',
    de: 'Die zugrunde liegenden Prinzipien eines Falls, sichtbar gemacht - die Regeln und die Logik, die längst da waren, jetzt bewusst nutzbar statt zufällig.',
  },
  'Emergent Case Intelligence Sprint': {
    phase: 'Reconstruct',
    en: 'The core offer. A complex case - documents, case-file access, or a conversation history - reconstructed into what it actually is: the real defects, contradictions and gaps, and the logic everything else gets built from. Not a vibe check. Structure.',
    de: 'Das Kernangebot: ein komplexer Fall - Dokumentation, Akteneinsicht oder ein Interaktionsverlauf - wird rekonstruiert zu dem, was er wirklich ist: die echten Mängel, Widersprüche und Lücken, und die Logik, aus der sich alles Weitere ableitet. Kein Bauchgefühl. Struktur.',
  },
  'Multi-Agent System Design': {
    phase: 'Agent Design',
    en: 'A working team of specialized agents built around your case, each with a clear job and a clear boundary - so the system does what it is supposed to, and nothing it is not.',
    de: 'Ein arbeitsfähiges Team spezialisierter Agenten, gebaut um deinen Fall herum, jeder mit klarer Aufgabe und klarer Grenze - damit das System genau das tut, was es soll, und nichts, was es nicht soll.',
  },
  'Implementation Build': {
    phase: 'Build',
    en: 'Your system, actually running - live, handling real cases end to end, not a design document waiting to be built.',
    de: 'Dein System, tatsächlich am Laufen - live, im echten Fallbetrieb, kein Konzeptpapier, das noch gebaut werden muss.',
  },
  'Retainer / Monitoring': {
    phase: 'Operate',
    en: 'Someone keeping watch after delivery - new cases handled, drift caught early, the system kept current instead of quietly going stale.',
    de: 'Jemand, der nach der Auslieferung weiter hinschaut - neue Fälle werden bearbeitet, Drift wird früh erkannt, das System bleibt aktuell statt still zu veralten.',
  },
  'Framework Update': {
    phase: 'Maintain',
    en: 'A refresh for a framework and its agents once the underlying case has moved on.',
    de: 'Eine Auffrischung für ein Framework und seine Agenten, wenn sich der zugrunde liegende Fall weiterentwickelt hat.',
  },
}

const COPY = {
  en: {
    eyebrow: 'Offer',
    title: "Your case isn't random. It has a logic. I find it.",
    intro: "Bring a complex case, a set of documents, case-file access, or a conversation history. I reconstruct what it actually is: the gaps, the contradictions, the recurring patterns - and the logic a framework or agent system gets built from. Not a vibe check. Structure.",
    flagshipBadge: 'Core offer',
    recurring: 'month',
    more: 'More',
    loading: 'Loading the offer ladder…',
    error: 'Could not load pricing right now - reach out directly instead.',
    whatLabel: 'What this is',
    buy: 'Buy',
    close: 'Close',
    consentTitle: 'Please confirm before checkout',
    consentB2b: 'I am acting as a business customer and confirm that this purchase is made in the course of my commercial or professional activity.',
    consentAgbBefore: 'I agree to the ',
    consentAgbLink: 'Terms of Service',
    consentAgbAfter: '. I understand that the service begins immediately upon payment and that no right of withdrawal applies. Refunds are excluded.',
    cancel: 'Cancel',
    continueToStripe: 'Continue to Stripe →',
  },
  de: {
    eyebrow: 'Angebot',
    title: 'Dein Fall ist kein Zufall - er hat eine Logik. Ich finde sie.',
    intro: 'Du bringst einen komplexen Fall, eine Dokumentation, Akteneinsicht oder einen Interaktionsverlauf. Ich rekonstruiere daraus, was er wirklich ist: Mängel, Widersprüche, Lücken - und die Logik, aus der sich ein Framework oder Agentensystem ableiten lässt. Kein Bauchgefühl. Struktur.',
    flagshipBadge: 'Kernangebot',
    recurring: 'Monat',
    more: 'Mehr',
    loading: 'Angebotsleiter wird geladen…',
    error: 'Preise konnten gerade nicht geladen werden - melde dich direkt.',
    whatLabel: 'Was das ist',
    buy: 'Kaufen',
    close: 'Schließen',
    consentTitle: 'Bitte vor dem Checkout bestätigen',
    consentB2b: 'Ich handle als Unternehmer und bestätige, dass dieser Kauf im Rahmen meiner gewerblichen oder beruflichen Tätigkeit erfolgt.',
    consentAgbBefore: 'Ich stimme den ',
    consentAgbLink: 'Allgemeinen Geschäftsbedingungen',
    consentAgbAfter: ' zu. Mir ist bewusst, dass die Leistung sofort nach Zahlung beginnt und daher kein Widerrufsrecht besteht. Rückerstattungen sind ausgeschlossen.',
    cancel: 'Abbrechen',
    continueToStripe: 'Weiter zu Stripe →',
  },
} as const

export function WebHubPricing() {
  const { lang } = useLang()
  const c = COPY[lang]
  const [products, setProducts] = useState<PublicProduct[] | null>(null)
  const [error, setError] = useState(false)
  const [active, setActive] = useState<PublicProduct | null>(null)
  // Legal consent gate before any Stripe redirect — mirrors rfi-irfos.com's
  // own B2B-checkout-confirmation modal (Abmahnung-proofing: self-declared
  // commercial customer excludes the KSchG consumer-protection Widerrufsrecht
  // per §1(2) KSchG / §18(1)(1) FAGG, matched by AgbContent in LegalPage.tsx).
  // Holds the product pending checkout; both checkboxes reset whenever a new
  // checkout is opened so consent is given fresh per purchase, not carried
  // over from an earlier one.
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
        setProducts(data.filter(p => p.category !== 'certification').sort((a, b) => a.price_cents - b.price_cents))
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  // Close modal(s) on Escape — checkout consent takes priority since it
  // renders on top of the detail modal.
  useEffect(() => {
    if (!active && !checkoutTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (checkoutTarget) setCheckoutTarget(null)
      else setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, checkoutTarget])

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
            const isFlagship = p.name === FLAGSHIP_NAME
            return (
              <div key={i} className={`site-webhub-card${isFlagship ? ' flagship' : ''}`}>
                {isFlagship && <div className="site-webhub-flag">{c.flagshipBadge}</div>}
                <h3>{p.name}</h3>
                <div className="site-webhub-price">
                  {formatPrice(p.price_cents, p.currency, lang)}
                  {p.mode === 'subscription' && <span className="site-webhub-per"> / {c.recurring}</span>}
                </div>
                <div className="site-webhub-row">
                  <button
                    type="button"
                    className="site-webhub-buy"
                    title={`${c.buy}: ${p.name}`}
                    aria-label={`${c.buy}: ${p.name}`}
                    onClick={() => openCheckout(p)}
                  >
                    {BASKET}
                  </button>
                  <button
                    type="button"
                    className="site-webhub-more"
                    onClick={() => setActive(p)}
                    aria-haspopup="dialog"
                  >
                    {c.more} {PLUS}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {active && (
        <div
          className="site-webhub-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={active.name}
          onClick={(e) => { if (e.target === e.currentTarget) setActive(null) }}
        >
          <div className="site-webhub-modal">
            <button type="button" className="site-webhub-x" aria-label={c.close} onClick={() => setActive(null)}>
              {CROSS}
            </button>
            <span className="site-webhub-chip">{DETAIL[active.name]?.phase ?? active.category}</span>
            <h3 className="site-webhub-modal-name">{active.name}</h3>
            <div className="site-webhub-modal-price">
              {formatPrice(active.price_cents, active.currency, lang)}
              {active.mode === 'subscription' && <span className="site-webhub-per"> / {c.recurring}</span>}
            </div>

            <div className="site-webhub-blk">
              <div className="site-webhub-lbl">{c.whatLabel}</div>
              <div className="site-webhub-txt">
                {lang === 'en'
                  ? (DETAIL[active.name]?.en ?? active.description)
                  : (DETAIL[active.name]?.de ?? active.description_de ?? active.description)}
              </div>
            </div>

            <button type="button" className="site-webhub-buy big" onClick={() => openCheckout(active)}>
              {BASKET}<span>{c.buy}</span>
            </button>
          </div>
        </div>
      )}

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
              {CROSS}
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
    </section>
  )
}
