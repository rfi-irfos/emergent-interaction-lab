import { useEffect, useState } from 'react'
import type { SiteContent, PageItem } from '../types/content'

function isAdminLoggedIn(): boolean {
  try { return localStorage.getItem('rfi_admin_ok') === '1' } catch { return false }
}

export function DynamicPage({ page, content }: { page: PageItem; content: SiteContent }) {
  const [adminMode] = useState(isAdminLoggedIn)

  useEffect(() => { window.scrollTo(0, 0) }, [page.id])
  useEffect(() => {
    const prev = document.title
    document.title = page.metaTitle ?? `${page.title} — ${content.meta?.title ?? ''}`
    return () => { document.title = prev }
  }, [page.id, page.metaTitle, page.title, content.meta?.title])

  return (
    <div className="static-page">
      <header className="static-page-nav">
        <a href="#" className="static-page-brand">{content.nav?.brand ?? 'Website'}</a>
        <a href="#" className="static-page-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Zur Startseite
        </a>
        {adminMode && (
          <a href="#admin" className="static-page-edit-btn" title="Seite bearbeiten">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            Bearbeiten
          </a>
        )}
      </header>
      <main className="static-page-main">
        <div className="static-page-content">
          <h1>{page.title}</h1>
          <div className="dynamic-page-body" dangerouslySetInnerHTML={{ __html: page.body }} />
        </div>
      </main>
    </div>
  )
}
