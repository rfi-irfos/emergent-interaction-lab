import { useEffect, type CSSProperties } from 'react'
import type { SiteContent, NewsItem } from '../types/content'
import { useLang } from '../hooks/useLang'
import { renderMarkdown } from '../lib/markdown'
import { trackPageView } from '../lib/tracking'

// Real, shareable, bookmarkable page for a single published article
// (#p/blog/<id>, see App.tsx's getRoute()) — previously a published post
// only ever opened in a PublicSite.tsx modal with no route/URL change, so it
// couldn't be linked, reloaded, or indexed. Reuses the exact visual
// presentation the modal used to have (the site-modal-article family of
// classes, see App.css) rather than redesigning it — only the page chrome
// (nav/back link instead of a scrim + close button) is new, following the
// same static-page shell CertificationPage.tsx/DynamicPage.tsx already use
// for dedicated routes. Like those sibling pages, this one renders in a
// fixed light presentation rather than the visitor's chosen site theme —
// same established trade-off, not a new one introduced here.
export function BlogPostPage({ item, content }: { item: NewsItem; content: SiteContent }) {
  const { t } = useLang()

  useEffect(() => { window.scrollTo(0, 0) }, [item.id])

  useEffect(() => {
    const prev = document.title
    const plainTitle = item.title.replace(/<[^>]+>/g, '')
    document.title = `${plainTitle} — ${content.meta?.title ?? ''}`
    return () => { document.title = prev }
  }, [item.id, item.title, content.meta?.title])

  // This component renders *instead of* PublicSite for this route, so
  // PublicSite's own tracking-pixel effect never fires here — fire our own,
  // with a path that includes the hash route so this article gets its own
  // row in web_visits instead of sharing PublicSite's constant pathname
  // (this is a hash-routed SPA: location.pathname alone never varies).
  useEffect(() => {
    trackPageView(`${window.location.pathname}${window.location.hash}`)
  }, [item.id])

  return (
    <div className="static-page">
      <header className="static-page-nav">
        <a href="#" className="static-page-brand">{content.nav?.brand ?? 'Website'}</a>
        <a href="#" className="static-page-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          {t.back}
        </a>
      </header>
      <main className="static-page-main">
        <article
          className="site-modal site-modal-article site-blogpost-card"
          style={{
            '--primary': content.meta?.primaryColor || '#C4956A',
            '--text': '#111111',
            '--text-soft': '#555555',
            '--surface': '#FFF9F4',
            '--surface-sunken': '#EDE3D9',
            '--shadow': 'rgba(0, 0, 0, .10)',
          } as CSSProperties}
        >
          {item.image && (
            <div className="site-modal-img"><img src={item.image} alt={item.title} /></div>
          )}
          <div className="site-modal-body">
            <div className="site-news-date">
              {new Date(item.date).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <h1 className="site-modal-title" dangerouslySetInnerHTML={{ __html: item.title }} />
            <div className="site-modal-article-body">{renderMarkdown(item.body)}</div>
          </div>
        </article>
      </main>
    </div>
  )
}
