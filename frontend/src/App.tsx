import { lazy, useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import './App.css'
import { useContent } from './hooks/useContent'
import { useAuth } from './hooks/useAuth'
import { useLang } from './hooks/useLang'
import { PublicSite } from './components/PublicSite'
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })))
const LoginPage = lazy(() => import('./components/LoginPage').then(m => ({ default: m.LoginPage })))
const LegalPage = lazy(() => import('./components/LegalPage').then(m => ({ default: m.LegalPage })))
const DynamicPage = lazy(() => import('./components/DynamicPage').then(m => ({ default: m.DynamicPage })))
const PageModal = lazy(() => import('./components/PageModal').then(m => ({ default: m.PageModal })))
const CertificationPage = lazy(() => import('./components/CertificationPage').then(m => ({ default: m.CertificationPage })))
const BlogPostPage = lazy(() => import('./components/BlogPostPage').then(m => ({ default: m.BlogPostPage })))

const LEGAL_SLUGS = ['impressum', 'datenschutz', 'agb']
const BLOG_PREFIX = '#p/blog/'
type Chapter = 'home' | 'about' | 'method' | 'research' | 'papers' | 'products' | 'pricing'

function getChapter(): Chapter {
  const base = import.meta.env.BASE_URL.replace(/^\/|\/$/g, '')
  const parts = window.location.pathname.split('/').filter(Boolean)
  const candidate = parts[base && parts[0] === base ? 1 : 0]
  return ['about', 'method', 'research', 'papers', 'products', 'pricing'].includes(candidate)
    ? candidate as Chapter
    : 'home'
}

function getRoute(hash: string) {
  if (hash === '#admin' || hash.startsWith('#admin/')) return { isAdmin: true, legalSlug: null, pageSlug: null, blogId: null }
  // A published article's own real, shareable route — checked before the
  // generic `#p/<slug>` branch below since `blog/<id>` would otherwise be
  // treated as a static page slug (see BlogPostPage.tsx / PublicSite.tsx's
  // news section, which links here instead of opening a modal).
  if (hash.startsWith(BLOG_PREFIX)) {
    const id = decodeURIComponent(hash.slice(BLOG_PREFIX.length))
    return { isAdmin: false, legalSlug: null, pageSlug: null, blogId: id || null }
  }
  if (hash.startsWith('#p/')) {
    const slug = hash.slice(3)
    if (LEGAL_SLUGS.includes(slug)) return { isAdmin: false, legalSlug: slug, pageSlug: null, blogId: null }
    return { isAdmin: false, legalSlug: null, pageSlug: slug, blogId: null }
  }
  return { isAdmin: false, legalSlug: null, pageSlug: null, blogId: null }
}

export default function App() {
  const [chapter, setChapter] = useState<Chapter>(() => getChapter())
  const { lang } = useLang()
  const { content, loading } = useContent(lang)
  // The admin always edits the German content, independent of whatever
  // language a visitor last had the public site in — Laura writes in German
  const admin = useContent('de')
  const { user, login, logout } = useAuth()
  const [route, setRoute] = useState(() => getRoute(window.location.hash))
  // Content pages (Research, About the Lab) open as an in-house dark modal,
  // never a separate browser tab. A #p/<slug> hash opens the modal in place;
  // the underlying page route is still rendered underneath for deep-links.
  const [pageModalSlug, setPageModalSlug] = useState<string | null>(
    window.location.hash.startsWith('#p/')
      ? (() => {
          const slug = window.location.hash.slice(3)
          return ['impressum', 'datenschutz', 'agb'].includes(slug) || slug === 'pricing' ? null : slug
        })()
      : null,
  )

  // Keep real static URLs and direct-entry documents, but make navigation
  // between them instant once React is running. This is progressive MPA
  // navigation: reload/share/back all work without turning routes into hashes.
  useEffect(() => {
    const navigate = (url: URL, replace = false) => {
      const update = () => {
        window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
        flushSync(() => setChapter(getChapter()))
        if (url.hash) {
          requestAnimationFrame(() => document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ behavior: 'smooth' }))
        } else {
          window.scrollTo(0, 0)
        }
      }
      if (document.startViewTransition) document.startViewTransition(update)
      else update()
    }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || !url.pathname.startsWith(import.meta.env.BASE_URL)) return
      const route = url.pathname.slice(import.meta.env.BASE_URL.length).split('/')[0]
      if (route && !['about', 'method', 'research', 'papers', 'products', 'pricing'].includes(route)) return
      event.preventDefault()
      navigate(url)
    }
    const onPopState = () => {
      setChapter(getChapter())
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    document.addEventListener('click', onClick)
    window.addEventListener('popstate', onPopState)
    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  useEffect(() => {
    const onHash = () => {
      const r = getRoute(window.location.hash)
      setRoute(r)
      // Opening a content page (#p/<slug>, not a legal slug / blog) opens the
      // in-house modal instead of navigating to a separate page.
      if (window.location.hash.startsWith('#p/')) {
        const slug = window.location.hash.slice(3)
        if (!['impressum', 'datenschutz', 'agb'].includes(slug)) {
          setPageModalSlug(slug)
        }
      } else if (window.location.hash === '' || window.location.hash === '#') {
        setPageModalSlug(null)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // '#p/pricing' used to open a full-page modal (WebHubPricing.tsx, removed
  // — see docs/superpowers/specs/2026-08-06-webhub-pricing-inline-carousel-design.md).
  // The real ladder now renders inline in the homepage's #pricing section,
  // so this hash just scrolls there instead. Guarded on `content` so a cold
  // page load on a #p/pricing deep link (content still fetching, PublicSite
  // not mounted yet) waits for content to arrive before trying to scroll.
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    )
  }

  if (!content) {
    return <div className="error-screen">Content could not be loaded.</div>
  }

  if (route.isAdmin) {
    if (admin.loading) {
      return (
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      )
    }
    if (!admin.content) {
      return <div className="error-screen">Content could not be loaded.</div>
    }
    if (!user) return <LoginPage onLogin={login} />
    return (
      <AdminPanel
        content={admin.content}
        saving={admin.saving}
        onSave={admin.save}
        onUpload={admin.uploadImage}
        onLogout={logout}
      />
    )
  }

  if (route.legalSlug) {
    return (
      <LegalPage
        slug={route.legalSlug}
        brand={content.nav?.brand}
        phone={content.contact?.phone}
        email={content.contact?.email}
        address={content.contact?.address}
      />
    )
  }

  // A content-page hash (#p/<slug>) opens the in-house dark modal over the
  // homepage — never a plain white page. The white DynamicPage route below
  // only applies when no modal is active. 'zertifizierung' used to be its
  // own separate full-page route (CertificationPage rendered standalone,
  // no PublicSite/modal at all) - flagged live as "still a white page that
  // leads somewhere, not a modal" alongside the original Research/About the
  // Lab complaint this file already fixed once. Folded into the same modal
  // system here instead of being a third, differently-behaved route.
  const isCertModal = pageModalSlug === 'zertifizierung'
  // Blog posts (#p/blog/<id>, tracked via route.blogId - a separate hash
  // prefix from the #p/<slug> pages above, see getRoute()) used to be their
  // own standalone light-themed page too ("leads to this external white
  // page", flagged live). Same fold-in. Falls through to the homepage below
  // if the id doesn't match anything (stale/removed link), same graceful
  // degradation the DynamicPage branch already has for an unknown slug.
  const blogItem = route.blogId ? (content.news?.items ?? []).find(n => n.id === route.blogId) : undefined
  const isBlogModal = !!blogItem
  const modalPage = !isCertModal && !isBlogModal && pageModalSlug && pageModalSlug !== 'pricing'
    ? (content.pages ?? []).find(p => p.slug === pageModalSlug)
    : undefined
  const modalActive = isCertModal || isBlogModal || !!modalPage

  if (!modalActive && route.pageSlug) {
    const page = (content.pages ?? []).find(p => p.slug === route.pageSlug)
    if (page) return <DynamicPage page={page} content={content} />
  }

  const closeModal = () => {
    setPageModalSlug(null)
    if (window.location.hash.startsWith('#p/')) {
      // pushState does NOT fire 'hashchange', so `route` (only kept in sync
      // by the hashchange listener below) was silently left stuck at
      // pageSlug='research' after this ran - the very next render then hit
      // the `if (route.pageSlug)` branch above and showed the old white
      // DynamicPage instead of the homepage. Clearing `route` here too, not
      // just the URL.
      window.history.pushState('', document.title, window.location.pathname + window.location.search)
      setRoute(getRoute(window.location.hash))
    }
  }

  // Single return, PublicSite always in the same position in the same
  // Fragment - only the modal mounts/unmounts alongside it. This used to be
  // two separate `return` statements (one Fragment-wrapped for the modal
  // case, one bare `<PublicSite/>` for the plain-homepage case) - different
  // tree shapes at the same position made React remount PublicSite (and
  // everything under it, including HeroFieldGraphic) every time the modal
  // closed, which was silently restarting any one-time mount animation
  // (confirmed: the hero's sunrise fade-in kept replaying, looking like a
  // recurring glow/shimmer). Keeping the shape stable fixes that at the
  // root instead of removing the animation.
  return (
    <>
      <PublicSite content={content} modalOpen={modalActive} chapter={chapter} />
      {isCertModal
        ? <CertificationPage content={content} onClose={closeModal} />
        : isBlogModal && blogItem
        ? <BlogPostPage item={blogItem} content={content} onClose={closeModal} />
        : modalPage && <PageModal page={modalPage} content={content} onClose={closeModal} />}
    </>
  )
}
