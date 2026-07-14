import { useEffect } from 'react'
import type { SiteContent, NewsItem } from '../types/content'
import { renderMarkdown } from '../lib/markdown'
import { trackPageView } from '../lib/tracking'

// A published article, opened in place as the same dark in-house modal as
// Research/About the Lab/Certification/Pricing - previously its own
// standalone light-themed page (#p/blog/<id> navigated away entirely,
// flagged live as "leads to this external white page"). Folded into the
// same modal system as everything else instead of being a fifth,
// differently-behaved route.
export function BlogPostPage({ item, content, onClose }: { item: NewsItem; content: SiteContent; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

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
    <div
      className="page-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={item.title.replace(/<[^>]+>/g, '')}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="page-modal-panel">
        <button type="button" className="page-modal-x" aria-label="Schließen" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
        </button>
        <div className="page-modal-scroll" data-native-scroll>
          {item.image && (
            <div className="site-modal-img"><img src={item.image} alt={item.title} /></div>
          )}
          <div className="site-news-date">
            {new Date(item.date).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <h1 className="page-modal-title" dangerouslySetInnerHTML={{ __html: item.title }} />
          <div className="page-modal-body site-modal-article-body">{renderMarkdown(item.body)}</div>
        </div>
      </div>
    </div>
  )
}
