import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { useLang } from '../hooks/useLang'

// The real WebHub service ladder — Laura's own product line, sold through
// real Stripe Payment Links (see backend/src/billing.rs's
// seed_webhub_products). Deliberately separate from `.site-pcard` /
// content.products (unrelated portfolio catalog) and from
// CertificationPage. Rendered directly on the main site as a tight card
// wall + themed modal: the card shows only name + price + a basket link +
// a "more" button; the modal carries the full EN/DE narrative so the
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

// Phase chip + bilingual narrative, keyed by product name. Mirrors the
// canonical Desktop ladder copy (webhub-systemaudit-tiers.html). Falls back
// to the backend `description`/`description_de` if a name isn't listed.
// `phase` is the ladder position — it makes the interdisciplinary arc
// explicit so no one wonders where a tier sits.
const DETAIL: Record<string, { phase: string; en: string; de: string }> = {
  'Case Intake Scan': {
    phase: 'Intake',
    en: 'The first structured entry into a case or project — quick orientation without overhead: case description, rough thematic assignment, first defect hints, open questions, priorities for the next stage.',
    de: 'Erster strukturierter Einstieg in einen Fall oder ein Projekt – schnelle Einordnung ohne Overhead: Fallbeschreibung, grobe Themenzuordnung, erste Mängelhinweise, offene Fragen, Prioritäten für die nächste Stufe.',
  },
  'Mangelcluster Sprint': {
    phase: 'Cluster',
    en: 'Turning raw material into a clean defect and theme structure: defect list, theme areas, contradictions, gaps, prioritisation, next steps.',
    de: 'Aus Rohmaterial eine saubere Mängel- und Themenstruktur: Mängelliste, Themenbereiche, Widersprüche, Lücken, Priorisierung, nächste Schritte.',
  },
  'Market & Competitor Intelligence': {
    phase: 'Market',
    en: 'The same observational-analysis method turned outward: who else operates in this space, how they are positioned and priced, where the real gaps and openings are — a structured, evidence-based read of the actual competitive field, not a generic market report.',
    de: 'Dieselbe beobachtende Analysemethode nach außen gerichtet: wer sonst in diesem Feld agiert, wie positioniert und bepreist ist, wo die echten Lücken und Chancen liegen – eine strukturierte, evidenzbasierte Lesart des tatsächlichen Wettbewerbsfelds, kein generischer Marktbericht.',
  },
  'Framework Magnification': {
    phase: 'Derive',
    en: 'Deriving the underlying principles from the case: frameworks, terms, rules, decision logic, system principles.',
    de: 'Aus dem Fall die zugrundeliegenden Prinzipien ableiten: Frameworks, Begriffe, Regeln, Entscheidungslogik, Systemprinzipien.',
  },
  'Emergent Case Intelligence Sprint': {
    phase: 'Reconstruct',
    en: 'The core offer. A complex case, a set of documents, case-file access, or a conversation history is reconstructed into what it actually is — the defects, contradictions and gaps that are visible, the theme areas present, and the logic a framework or agent architecture gets built from. Not a vibe check. Structure.',
    de: 'Das Kernangebot: ein komplexer Fall, eine Dokumentation, Akteneinsicht oder ein Interaktionsverlauf wird rekonstruiert – was der Fall wirklich ist, welche Mängel, Widersprüche und Lücken sichtbar sind, welche Themenbereiche vorliegen und welche Logik sich daraus für Framework- und Agentenarchitektur ableiten lässt.',
  },
  'Multi-Agent System Design': {
    phase: 'Agent Design',
    en: 'Translating the case logic into an agent system: role model, agent tasks, runtime logic, state and memory, audit and drift, monitoring, control mechanisms — with explicit safety and alignment mechanisms.',
    de: 'Die Fall-Logik in ein Agentensystem übersetzen: Rollenmodell, Agentenaufgaben, Runtime-Logik, State und Memory, Audit und Drift, Monitoring, Kontrollmechanismen – mit expliziten Sicherheits- und Ausrichtungsmechanismen.',
  },
  'Implementation Build': {
    phase: 'Build',
    en: 'Setting up the architecture in practice: automations, workflows, intake, routing, analysis pipeline, delivery, monitoring, follow-up.',
    de: 'Die Architektur praktisch aufsetzen: Automationen, Workflows, Intake, Routing, Analysepipeline, Delivery, Monitoring, Follow-up.',
  },
  'Retainer / Monitoring': {
    phase: 'Operate',
    en: 'Ongoing care, evaluation and extension: new cases, review, drift checks, framework updates, system adjustments, continuous control.',
    de: 'Laufende Pflege, Auswertung und Erweiterung: neue Fälle, Review, Drift-Checks, Framework-Updates, Systemanpassungen, laufende Kontrolle.',
  },
  'Framework Update': {
    phase: 'Maintain',
    en: 'One-off update of frameworks, check routines and agent logic.',
    de: 'Einmaliges Update der Frameworks, Prüfroutinen und Agentenlogik.',
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
    enLabel: 'EN — what is being done & how',
    deLabel: 'DE — was gemacht wird & wie',
    buy: 'Buy',
    close: 'Close',
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
    enLabel: 'EN — what is being done & how',
    deLabel: 'DE — was gemacht wird & wie',
    buy: 'Kaufen',
    close: 'Schließen',
  },
} as const

export function WebHubPricing() {
  const { lang } = useLang()
  const c = COPY[lang]
  const [products, setProducts] = useState<PublicProduct[] | null>(null)
  const [error, setError] = useState(false)
  const [active, setActive] = useState<PublicProduct | null>(null)

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

  // Close modal on Escape.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActive(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

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
            const d = DETAIL[p.name]
            const phase = d?.phase ?? p.category
            const isFlagship = p.name === FLAGSHIP_NAME
            return (
              <div key={i} className={`site-webhub-card${isFlagship ? ' flagship' : ''}`}>
                {isFlagship && <div className="site-webhub-flag">{c.flagshipBadge}</div>}
                <span className="site-webhub-chip">{phase}</span>
                <h3>{p.name}</h3>
                <div className="site-webhub-price">
                  {formatPrice(p.price_cents, p.currency, lang)}
                  {p.mode === 'subscription' && <span className="site-webhub-per"> / {c.recurring}</span>}
                </div>
                <div className="site-webhub-row">
                  <a
                    href={p.payment_link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site-webhub-buy"
                    title={`${c.buy}: ${p.name}`}
                    aria-label={`${c.buy}: ${p.name}`}
                  >
                    {BASKET}
                  </a>
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
              <div className="site-webhub-lbl">{c.enLabel}</div>
              <div className="site-webhub-txt">{DETAIL[active.name]?.en ?? active.description}</div>
            </div>
            <div className="site-webhub-blk">
              <div className="site-webhub-lbl">{c.deLabel}</div>
              <div className="site-webhub-txt">{DETAIL[active.name]?.de ?? active.description_de ?? active.description}</div>
            </div>

            <a
              href={active.payment_link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="site-webhub-buy big"
            >
              {BASKET}<span>{c.buy}</span>
            </a>
          </div>
        </div>
      )}
    </section>
  )
}
