import { useEffect } from 'react'
import type { SiteContent, PageItem } from '../types/content'
import {
  CurrentFocusBadge,
  LiveStatsSection,
  SignalLevelsSection,
  CcetTrendSection,
  SimulationStatusSection,
  ShippingFeedSection,
} from './PublicLiveActivity'

// Dark, in-house modal overlay for content pages (Research, About the Lab).
// Opens in place — never a separate browser tab. X top-right, Esc / backdrop
// close. Body renders via dangerouslySetInnerHTML (CMS-authored HTML).
export function PageModal({
  page,
  content,
  onClose,
}: {
  page: PageItem
  content: SiteContent
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const reveal = (cls: string) => cls

  return (
    <div
      className="page-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={page.title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="page-modal-panel">
        <button type="button" className="page-modal-x" aria-label="Schließen" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
        </button>
        {/* data-native-scroll: opts this out of PublicSite's global
            fast-scroll wheel hijack (useFastScroll) as defense-in-depth on
            top of the modalOpen prop that suspends it entirely - belt and
            suspenders, since the hijack listens on `window` regardless of
            target and previously ate every wheel event over this modal. */}
        <div className="page-modal-scroll" data-native-scroll>
          <h1 className="page-modal-title">{page.title}</h1>
          <div
            className="page-modal-body"
            dangerouslySetInnerHTML={{ __html: page.body }}
          />
          {page.slug === 'research' && (
            <>
              <div className="page-modal-live">
                <CurrentFocusBadge editMode={false} reveal={reveal} />
                <LiveStatsSection editMode={false} reveal={reveal} />
                <SignalLevelsSection editMode={false} reveal={reveal} />
                <CcetTrendSection editMode={false} reveal={reveal} />
                <SimulationStatusSection editMode={false} reveal={reveal} />
                <ShippingFeedSection editMode={false} reveal={reveal} />
              </div>
              <p className="page-modal-footnote">
                {content.meta?.title ?? ''}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
