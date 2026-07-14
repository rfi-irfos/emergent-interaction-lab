import { useState, useEffect } from 'react'
import './App.css'
import { useContent } from './hooks/useContent'
import { useAuth } from './hooks/useAuth'
import { useLang } from './hooks/useLang'
import { PublicSite } from './components/PublicSite'
import { AdminPanel } from './components/AdminPanel'
import { LoginPage } from './components/LoginPage'
import { LegalPage } from './components/LegalPage'
import { DynamicPage } from './components/DynamicPage'
import { PageModal } from './components/PageModal'
import { CertificationPage } from './components/CertificationPage'
import { BlogPostPage } from './components/BlogPostPage'
import { WebHubPricing } from './components/WebHubPricing'

const LEGAL_SLUGS = ['impressum', 'datenschutz', 'agb']
const BLOG_PREFIX = '#p/blog/'

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
          return ['impressum', 'datenschutz', 'agb'].includes(slug) ? null : slug
        })()
      : null,
  )

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
  // Pricing moved off the homepage into its own modal too - was a wall of
  // 23 products scrolled past on every visit; now opt-in via the "Pricing"
  // nav link, same dark-modal pattern as everything else here.
  const isPricingModal = pageModalSlug === 'pricing'
  // Blog posts (#p/blog/<id>, tracked via route.blogId - a separate hash
  // prefix from the #p/<slug> pages above, see getRoute()) used to be their
  // own standalone light-themed page too ("leads to this external white
  // page", flagged live). Same fold-in. Falls through to the homepage below
  // if the id doesn't match anything (stale/removed link), same graceful
  // degradation the DynamicPage branch already has for an unknown slug.
  const blogItem = route.blogId ? (content.news?.items ?? []).find(n => n.id === route.blogId) : undefined
  const isBlogModal = !!blogItem
  const modalPage = !isCertModal && !isPricingModal && !isBlogModal && pageModalSlug
    ? (content.pages ?? []).find(p => p.slug === pageModalSlug)
    : undefined
  const modalActive = isCertModal || isPricingModal || isBlogModal || !!modalPage

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
      <PublicSite content={content} modalOpen={modalActive} />
      {isCertModal
        ? <CertificationPage content={content} onClose={closeModal} />
        : isPricingModal
        ? <WebHubPricing content={content} onClose={closeModal} />
        : isBlogModal && blogItem
        ? <BlogPostPage item={blogItem} content={content} onClose={closeModal} />
        : modalPage && <PageModal page={modalPage} content={content} onClose={closeModal} />}
    </>
  )
}
