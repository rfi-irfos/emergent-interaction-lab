export interface NavLink { label: string; href: string }
export interface FeatureItem { id: string; title: string; description: string; icon?: string; pillar?: string }
export interface FrameworkPillar { id: string; title: string; subtitle: string }

export interface ProductItem {
  id: string
  name: string
  description: string
  price: string
  regularPrice?: string   // crossed-out original price for sales/discounts
  image: string
  images?: string[]       // additional gallery images
  badge?: string
  category: string
  subcategory?: string
  specs?: string[]
  specsTable?: { label: string; value: string }[]
  details?: string        // long-form HTML detail text
  delivery?: string       // delivery/availability info
}

export interface SubCategoryItem {
  id: string
  name: string
  image: string
  description?: string
}

export interface CategoryItem {
  id: string
  name: string
  sub: string
  image: string
  href?: string
  tab?: string              // which Sessions filter tab this audience drills into
  subcategories?: SubCategoryItem[]
}

export interface NewsCategory { id: string; name: string }

export interface NewsItem {
  id: string
  date: string
  title: string
  body: string
  image?: string
  category?: string
}

export interface TrustItem {
  id: string
  icon: string
  bold: string
  text: string
}

export interface PageItem {
  id: string
  title: string
  slug: string          // used as `#p/:slug` hash route
  body: string          // HTML content
  showInNav?: boolean
  metaTitle?: string
}

export interface AboutStat { value: string; label: string }

export interface ProtocolNodeItem { id: string; label: string; description: string }

export interface CertificateItem {
  id: string
  title: string
  subtitle: string
  file: string
}

export interface PaperItem {
  id: string
  title: string
  description: string
  doi?: string    // full https://doi.org/... URL; omitted while a DOI isn't yet assigned
  file: string     // local static asset path, e.g. /papers/paper-1-osf-preprint.pdf
}

export type SectionId = 'trust' | 'categories' | 'products' | 'usp' | 'news' | 'location'
export const DEFAULT_SECTION_ORDER: SectionId[] = ['trust', 'categories', 'products', 'usp', 'news', 'location']

export interface CanvasPos { x: number; y: number }

export interface SiteContent {
  sectionOrder?: SectionId[]
  hiddenSections?: SectionId[]
  positions?: Record<string, CanvasPos>
  pages?: PageItem[]
  meta: {
    title: string
    description: string
    primaryColor: string
    accentColor: string
    font: string
    wko_member?: boolean
  }
  nav: {
    logo: string
    brand: string
    links: NavLink[]
    phone?: string
    ctaLabel?: string
    ctaHref?: string
  }
  hero: {
    tag?: string
    headline: string
    subheadline: string
    ctaLabel: string
    ctaHref: string
    ctaSecLabel?: string
    ctaSecHref?: string
    image: string
    bgX?: number
    bgY?: number
    minHeight?: number
  }
  trust: { items: TrustItem[] }
  categories: { eyebrow?: string; title: string; items: CategoryItem[] }
  products: { title: string; tabs: string[]; items: ProductItem[] }
  usp: { eyebrow?: string; title: string; pillars?: FrameworkPillar[]; items: FeatureItem[] }
  news: { eyebrow?: string; title: string; items: NewsItem[]; categories?: NewsCategory[] }
  contact: {
    title: string
    subtitle?: string
    photo?: string
    email: string
    phone: string
    address: string
    whatsapp?: string
    facebook?: string
    instagram?: string
    mapSrc?: string
    formEnabled?: boolean
  }
  whatsapp: { enabled: boolean; number: string; message: string }
  footer: {
    brand: string
    tagline: string
    description?: string
    cols: Array<{ title: string; links: NavLink[] }>
    links: NavLink[]
    copyright: string
  }
  ssp?: {
    badge?: string
    title?: string
    sub?: string
    button?: string
  }
  about?: {
    eyebrow?: string
    headline: string
    bio: string
    photo?: string
    stats?: AboutStat[]
    ctaLabel?: string
    ctaHref?: string
  }
  pricing?: {
    title: string
    body: string
  }
  jarvis?: {
    title: string
    body: string
    nextBadge?: string
  }
  protocol?: {
    eyebrow?: string
    title: string
    intro?: string
    nodes: ProtocolNodeItem[]
    closing?: string
  }
  certificates?: {
    title?: string
    items: CertificateItem[]
  }
  papers?: {
    title?: string
    intro?: string
    items: PaperItem[]
  }
}
