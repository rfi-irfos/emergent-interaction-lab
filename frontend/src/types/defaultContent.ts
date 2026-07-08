import type { SiteContent } from './content'

export const defaultContent: SiteContent = {
  meta: {
    title: 'Emergent Interaction Lab — Human–AI Systems Research',
    description: 'Emergent Interaction Lab untersucht, wie Bedeutung, Struktur und Verhalten in kontinuierlicher Mensch-KI-Interaktion entstehen.',
    primaryColor: '#63f0ff',
    accentColor: '#63f0ff',
    font: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  nav: {
    logo: '',
    brand: 'Emergent Interaction Lab',
    links: [
      { label: 'About', href: '#about' },
      { label: 'Framework', href: '#usp' },
      { label: 'Blog', href: '#news' },
    ],
    ctaLabel: 'Kontakt',
    ctaHref: '#location',
  },
  hero: {
    tag: 'Human–AI Systems Research',
    headline: 'Emergent Interaction Field',
    subheadline: 'Dieses Projekt untersucht Emergenz als Eigenschaft von Interaktion — wie Bedeutung, Struktur und Verhalten in kontinuierlicher Mensch-KI-Interaktion entstehen.',
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
    eyebrow: 'System Definition',
    headline: 'Was ist das Interaction Field?',
    bio: 'Das Interaction Field ist ein gekoppeltes kognitiv-inferentielles System. Es überträgt Information nicht einseitig, sondern aktualisiert fortlaufend eine gemeinsame Bedeutungskonfiguration durch Interaktion — jeder Austausch verändert die Bedingungen des nächsten. Wichtig: dieses System ist kein Tracking-, Analytics- oder Verhaltensüberwachungs-Tool. Es speichert keine personenbezogenen Daten und bewertet keine Einzelpersonen, sondern modelliert Interaktion als strukturellen Prozess. Ziel der Forschung ist zu verstehen, wie intelligenzähnliche Eigenschaften aus wiederholten Interaktionszyklen entstehen, und wie sich semantische Stabilität, Drift und Neukonfiguration in gekoppelten Mensch-KI-Systemen über Zeit entwickeln.',
  },
  usp: {
    eyebrow: 'Key Concepts',
    title: 'Das Framework',
    pillars: [
      { id: 'p1', title: 'Mensch-KI-Interaktion', subtitle: 'Beobachten, verstehen, messen.' },
      { id: 'p2', title: 'Verhaltensanalyse', subtitle: 'Muster erkennen, Verhalten vorhersagen, Hypothesen validieren.' },
      { id: 'p3', title: 'Frameworks & Konzepte', subtitle: 'Strukturen ableiten, Prinzipien definieren, Systemlogik entwickeln.' },
    ],
    items: [
      { id: 'u4', pillar: 'p1', title: 'Interaction Field', description: 'Ein gemeinsamer dynamischer Raum, in dem Kognition und Inferenz Ergebnisse kontinuierlich mitgestalten — die Beobachtungsebene für Mensch-KI-Interaktion.', icon: 'field' },
      { id: 'u1', pillar: 'p1', title: 'Emergence', description: 'Stabile Muster, die aus wiederholten Interaktionsschleifen zwischen Mensch und Modell entstehen — das, was innerhalb dieses Feldes gemessen wird.', icon: 'emergence' },
      { id: 'u2', pillar: 'p2', title: 'Behavior', description: 'Kontextabhängige Anpassung von Antworten über sich entwickelnde Interaktionszustände hinweg.', icon: 'behavior' },
      { id: 'u3', pillar: 'p2', title: 'Drift', description: 'Graduelle Transformation von Bedeutungsstrukturen über Zeit durch Rekursion — das Muster, aus dem Vorhersagemodelle abgeleitet werden.', icon: 'drift' },
      { id: 'u5', pillar: 'p3', title: 'Representation Layers', description: 'Mehrere gleichzeitige semantische Schichten, die während der Dialogentwicklung entstehen — Rohmaterial für abgeleitete Strukturen.', icon: 'layers' },
      { id: 'u6', pillar: 'p3', title: 'Constraints', description: 'Strukturelle Grenzen, die bestimmen, was sich stabilisiert, emergiert oder kollabiert — daraus werden Prinzipien und Systemlogik.', icon: 'constraints' },
    ],
  },
  news: {
    eyebrow: 'Blog',
    title: 'Beobachtungen aus dem Interaction Field',
    items: [
      {
        id: 'n1', date: '2026-07-03',
        title: 'Willkommen im Blog',
        body: 'Hier teile ich Beobachtungen, Screenshots und Notizen aus laufenden Mensch-KI-Interaktionen — Rohmaterial für das Interaction Field Projekt.',
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
    tagline: 'Human–AI Systems Research',
    description: 'Emergent Interaction-Based System Research.',
    cols: [],
    links: [
      { label: 'Datenschutz', href: '/datenschutz' },
      { label: 'Impressum', href: '/impressum' },
    ],
    copyright: '© 2026 Emergent Interaction Lab — built by RFI-IRFOS',
  },
}
