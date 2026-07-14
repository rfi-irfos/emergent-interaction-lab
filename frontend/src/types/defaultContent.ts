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
      { label: 'Über', href: '#about' },
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
    ctaSecLabel: 'Über das Projekt',
    ctaSecHref: '#about',
    image: '',
    bgX: 50,
    bgY: 40,
    minHeight: 680,
  },
  trust: { items: [] },
  categories: { title: '', items: [] },
  products: { title: '', tabs: [], items: [] },
  about: {
    eyebrow: 'Das Emergent Interaction Lab',
    headline: 'Mensch-KI-Interaktion, erforscht und gebaut',
    bio: 'Das Emergent Interaction Lab erforscht Mensch-KI-Interaktion: was wirklich passiert, wenn Menschen und KI-Systeme über längere Zeit zusammenarbeiten, und wie das beide Seiten verändert. Die Arbeit wird von Laura Serna Gaviria mit RFI-IRFOS geleitet.',
  },
  usp: {
    eyebrow: 'Kernkonzepte',
    title: 'Das Framework',
    pillars: [
      { id: 'p1', title: 'Mensch-KI-Interaktion', subtitle: 'Beobachten, verstehen, messen.' },
      { id: 'p2', title: 'Verhaltensanalyse', subtitle: 'Muster erkennen, Verhalten vorhersagen, Hypothesen validieren.' },
      { id: 'p3', title: 'Frameworks & Konzepte', subtitle: 'Strukturen ableiten, Prinzipien definieren, Systemlogik entwickeln.' },
    ],
    items: [
      { id: 'u4', pillar: 'p1', title: 'Interaction Field', description: 'Dasselbe Feld wie im Header oben (das Emergent Interaction Field): ein gemeinsamer dynamischer Raum, in dem Kognition und Inferenz Ergebnisse kontinuierlich mitgestalten - die Beobachtungsebene, die das Observatory in Echtzeit überwacht.', icon: 'field' },
      { id: 'u1', pillar: 'p1', title: 'Emergence', description: 'Stabile Muster, die aus wiederholten Interaktionsschleifen zwischen Mensch und Modell entstehen - das Hauptsignal, auf das der Emergence Monitor des Observatory ausgelegt ist.', icon: 'emergence' },
      { id: 'u2', pillar: 'p2', title: 'Behavior', description: 'Kontextabhängige Anpassung von Antworten über sich entwickelnde Interaktionszustände hinweg.', icon: 'behavior' },
      { id: 'u3', pillar: 'p2', title: 'Drift', description: 'Graduelle Transformation von Bedeutungsstrukturen über Zeit durch Rekursion - das Muster, aus dem Vorhersagemodelle abgeleitet werden, und eine der Kennzahlen, die das Observatory live verfolgt.', icon: 'drift' },
      { id: 'u5', pillar: 'p3', title: 'Representation Layers', description: 'Mehrere gleichzeitige semantische Schichten, die während der Dialogentwicklung entstehen - Rohmaterial für abgeleitete Strukturen.', icon: 'layers' },
      { id: 'u6', pillar: 'p3', title: 'Constraints', description: 'Strukturelle Grenzen, die bestimmen, was sich stabilisiert, emergiert oder kollabiert - daraus werden Prinzipien und Systemlogik.', icon: 'constraints' },
    ],
  },
  news: {
    eyebrow: 'Live-Signal',
    title: 'Live aus dem Interaction Field',
    items: [
      {
        id: 'n1', date: '2026-07-03',
        title: 'Willkommen im Blog',
        body: 'Hier teile ich Beobachtungen, Screenshots und Notizen aus laufenden Mensch-KI-Interaktionen - Rohmaterial für das Interaction Field Projekt.',
        image: '',
      },
    ],
  },
  contact: {
    title: 'Kontakt',
    subtitle: 'Fragen zum Projekt oder zur Methodik? Schreib mir.',
    email: '',
    phone: '',
    address: '',
    whatsapp: '',
    mapSrc: '',
    formEnabled: true,
  },
  whatsapp: {
    enabled: false,
    number: '',
    message: '',
  },
  footer: {
    brand: 'Emergent Interaction Lab',
    tagline: 'Human-AI Systems Research',
    description: 'Emergent Interaction-Based System Research.',
    cols: [],
    links: [
      { label: 'Datenschutz', href: '/datenschutz' },
      { label: 'Impressum', href: '/impressum' },
    ],
    copyright: '© 2026 Emergent Interaction Lab - made with <3 in Graz by RFI-IRFOS, for Laura',
  },
}
