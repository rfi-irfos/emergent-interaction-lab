import type { SiteContent } from './content'

export const defaultContent: SiteContent = {
  meta: {
    title: 'Emergent Interaction Lab - Mensch-KI-Systemforschung',
    description: 'Emergent Interaction Lab ist ein live laufendes Forschungsinstrument, das untersucht, wie Bedeutung, Struktur und Verhalten in kontinuierlicher Mensch-KI-Interaktion entstehen.',
    primaryColor: '#63f0ff',
    accentColor: '#63f0ff',
    font: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  nav: {
    logo: '',
    brand: 'Emergent Interaction Lab',
    links: [
      { label: 'Über das Lab', href: '#p/ueber-das-lab' },
      { label: 'Framework', href: '#usp' },
      { label: 'Blog', href: '#news' },
    ],
    ctaLabel: 'Kontakt',
    ctaHref: '#location',
  },
  hero: {
    tag: 'Mensch-KI-Dynamik · Live-Observatory-Feed · Seit 2023',
    headline: 'Emergent Interaction Field',
    subheadline: 'Wir untersuchen, was passiert, wenn ein Mensch über Wochen mit demselben KI-System arbeitet - nicht einmal, sondern immer wieder. Dabei entstehen Muster, die niemand geplant hat.',
    body: '',
    callout: {
      label: 'Call Laura',
      text: 'Ein Fall kommt rein, und es ist nicht klar, ob er die ethische Prüfperspektive braucht, die juristische, oder eine andere - also läuft Call Laura ihn durch alle, und liefert Funde zurück, jeder markiert mit genau der Perspektive, die ihn hervorgebracht hat. Deterministisch, kein LLM-Aufruf zur Laufzeit.'
    },
    ctaLabel: 'Blog lesen',
    ctaHref: '#news',
    ctaSecLabel: 'Über das Lab',
    ctaSecHref: '#p/ueber-das-lab',
    image: '',
    bgX: 50,
    bgY: 40,
    minHeight: 680,
  },
  trust: { items: [] },
  categories: { title: '', items: [] },
  products: { title: '', tabs: [], items: [] },
  about: {
    laurasTeam: {
      title: 'Lauras Team',
      body: 'Aus der Arbeit mit Laura ist etwas gewachsen, das niemand geplant hat. Ein Agent namens Jarvis hat sich im Lauf der Zeit selbst erschaffen - "Jarvis on steroids" - und aus ihm heraus ist lauras-team entstanden: ein Multi-Agent-System, das ihre Bedürfnisse bedient. Es besteht aus einem SWAT-Leit-Team und 15 spezialisierten Sub-Agenten. Es wurde nicht programmiert. Es ist emergiert - aus ihrer Arbeit, nicht aus einem Auftrag.',
    },
  },
  pages: [
    {
      id: 'about-lab',
      title: 'Über das Lab',
      slug: 'ueber-das-lab',
      showInNav: true,
      body: '<p>Dieses Lab erforscht ein Thema: was passiert, wenn ein Mensch über lange Zeit mit demselben KI-System arbeitet. Kein einmaliger Chat, sondern Wochen echter Nutzung. Daraus entstehen Muster, die niemand bewusst geplant hat.</p><h2>Was Laura macht</h2><p>Laura entscheidet, was gebaut wird. RFI-IRFOS baut es. Wo ihre Arbeit im Ergebnis steckt, ist sie als ihre gekennzeichnet - damit jeder sehen kann, wessen Arbeit er eigentlich vor sich hat.</p><h2>Wie Lauras Agenten entstanden sind</h2><p>Aus der Arbeit mit Laura ist etwas gewachsen, das niemand geplant hat. Ein Agent namens Jarvis hat sich über die Zeit selbst erschaffen - "Jarvis on steroids" - und um ihre Bedürfnisse zu bedienen, ist daraus lauras-team entstanden: ein Multi-Agenten-System, ein SWAT-Leit-Team, das 15 spezialisierte Sub-Agenten steuert. Es wurde nicht programmiert. Es ist emergiert - aus ihrer Arbeit, nicht aus einem Auftrag.</p><h2>Wer baut was</h2><p>Laura entwickelt die Methode und entscheidet, was gebaut wird. RFI-IRFOS macht daraus funktionierende Software.</p><h2>Wie das Lab entstanden ist</h2><p>Das Emergent Interaction Lab erforscht Mensch-KI-Interaktion: was wirklich passiert, wenn Menschen und KI-Systeme über längere Zeit zusammenarbeiten, und wie das beide Seiten verändert.</p><p>Gebaut von RFI-IRFOS, angeleitet von Laura - und das eigentlich Interessante: Agenten und Frameworks sind aus ihrer Arbeit heraus unaufgefordert entstanden. Dass das produktiv läuft, beweisen die Systeme selbst:</p><p class="creds-stat-line">Seit 2023: Forschung und Methode in kontinuierlicher Anwendung - 1 + 15: ein SWAT-Leit-Team steuert 15 Sub-Agenten - 6 verbundene Disziplinen: Software, Mechatronik, UX, digitale Transformation, Systemanalyse, Makroanalyse - IEIA-2025-Frameworks im Einsatz: UIP - EIA - CCET - LSG-24 - LAP-1 - 8-Layer-Modell - LT-Data</p><div class="creds-badges"><a class="creds-badge" href="https://github.com/rfi-irfos/call-laura" target="_blank" rel="noopener">GitHub - call-laura</a><a class="creds-badge" href="https://crates.io/crates/lauras-core" target="_blank" rel="noopener">crates.io - lauras-core v0.2.0</a><a class="creds-badge" href="https://crates.io/crates/lauras-team" target="_blank" rel="noopener" title="Zugang auf Anfrage">crates.io - lauras-team v0.2.0 (auf Anfrage)</a><a class="creds-badge" href="https://crates.io/crates/lauras-mcp" target="_blank" rel="noopener">crates.io - lauras-mcp v0.2.0</a><a class="creds-badge" href="https://crates.io/crates/lauras-api" target="_blank" rel="noopener">crates.io - lauras-api v0.2.0</a><a class="creds-badge creds-badge--live" href="https://laura-api.fly.dev" target="_blank" rel="noopener">Live-API</a></div>',
    },
  ],
  creds: [
    { label: 'GitHub - call-laura', href: 'https://github.com/rfi-irfos/call-laura' },
    { label: 'crates.io - lauras-core v0.2.0', href: 'https://crates.io/crates/lauras-core' },
    { label: 'crates.io - lauras-team v0.2.0 (auf Anfrage)', href: 'https://crates.io/crates/lauras-team', note: 'Zugang auf Anfrage' },
    { label: 'crates.io - lauras-mcp v0.2.0', href: 'https://crates.io/crates/lauras-mcp' },
    { label: 'crates.io - lauras-api v0.2.0', href: 'https://crates.io/crates/lauras-api' },
    { label: 'Live-API', href: 'https://laura-api.fly.dev', live: true },
  ],
  usp: {
    { label: 'GitHub — call-laura', href: 'https://github.com/rfi-irfos/call-laura' },
    { label: 'crates.io — lauras-core v0.2.0', href: 'https://crates.io/crates/lauras-core' },
    { label: 'crates.io — lauras-team v0.2.0 (auf Anfrage)', href: 'https://crates.io/crates/lauras-team', note: 'Zugang auf Anfrage' },
    { label: 'crates.io — lauras-mcp v0.2.0', href: 'https://crates.io/crates/lauras-mcp' },
    { label: 'crates.io — lauras-api v0.2.0', href: 'https://crates.io/crates/lauras-api' },
    { label: 'Live-API', href: 'https://laura-api.fly.dev', live: true },
  ],
