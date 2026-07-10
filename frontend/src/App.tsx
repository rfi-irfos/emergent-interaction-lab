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
import { CertificationPage } from './components/CertificationPage'

const LEGAL_SLUGS = ['impressum', 'datenschutz', 'agb']

function getRoute(hash: string) {
  if (hash === '#admin' || hash.startsWith('#admin/')) return { isAdmin: true, legalSlug: null, pageSlug: null }
  if (hash.startsWith('#p/')) {
    const slug = hash.slice(3)
    if (LEGAL_SLUGS.includes(slug)) return { isAdmin: false, legalSlug: slug, pageSlug: null }
    return { isAdmin: false, legalSlug: null, pageSlug: slug }
  }
  return { isAdmin: false, legalSlug: null, pageSlug: null }
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

  useEffect(() => {
    const onHash = () => setRoute(getRoute(window.location.hash))
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

  if (route.pageSlug === 'zertifizierung') {
    return <CertificationPage content={content} />
  }

  if (route.pageSlug) {
    const page = (content.pages ?? []).find(p => p.slug === route.pageSlug)
    if (page) return <DynamicPage page={page} content={content} />
  }

  return <PublicSite content={content} />
}
