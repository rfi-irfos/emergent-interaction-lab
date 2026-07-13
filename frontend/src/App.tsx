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
  // and never needs an editing-language switch.
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

  if (route.blogId) {
    const item = (content.news?.items ?? []).find(n => n.id === route.blogId)
    // Found → its own dedicated page. Not found (stale/removed link, or a
    // draft id that was never promoted to content.news.items) → fall through
    // to the normal homepage below, same graceful-degradation the pageSlug
    // branch already uses for an unknown static page.
    if (item) return <BlogPostPage item={item} content={content} />
  }

  if (route.pageSlug === 'zertifizierung') {
    return <CertificationPage content={content} />
  }

  // A content-page hash (#p/<slug>) opens the in-house dark modal over the
  // homepage — never the plain white DynamicPage. So when the modal is active,
  // skip the white-page route below and render PublicSite + the modal instead.
  if (pageModalSlug) {
    const modalPage = (content.pages ?? []).find(p => p.slug === pageModalSlug)
    if (modalPage) {
      return (
        <>
          <PublicSite content={content} />
          <PageModal page={modalPage} content={content} onClose={() => { setPageModalSlug(null); if (window.location.hash.startsWith('#p/')) window.history.pushState('', document.title, window.location.pathname + window.location.search) }} />
        </>
      )
    }
  }

  if (route.pageSlug) {
    const page = (content.pages ?? []).find(p => p.slug === route.pageSlug)
    if (page) return <DynamicPage page={page} content={content} />
  }

  // Default: plain homepage, no modal, no page/legal/blog route matched
  // above. This was accidentally deleted in 912a8f8 (which added the
  // pageModalSlug branch above but removed the function's only fallback
  // return without replacing it) - every plain visit to the homepage since
  // then rendered nothing, because a component returning undefined renders
  // blank. The #p/... modal routes still worked, which is why that fix's
  // own verification (which only reloaded #p/research and #p/ueber-das-lab)
  // didn't catch this - the plain homepage was never re-checked.
  return <PublicSite content={content} />
}
