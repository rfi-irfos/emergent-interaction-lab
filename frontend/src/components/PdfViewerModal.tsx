import type { PaperItem } from '../types/content'
import { useLang } from '../hooks/useLang'

interface Props {
  paper: PaperItem
  onClose: () => void
}

const COPY = {
  en: { download: 'Download', openOsf: 'Open on OSF ↗', fallback: 'Can\'t view it inline? Use the links above.', close: 'Close' },
  de: { download: 'Herunterladen', openOsf: 'Auf OSF öffnen ↗', fallback: 'Wird es nicht eingebettet angezeigt? Nutze die Links oben.', close: 'Schließen' },
} as const

// In-page PDF viewer — reuses the exact .site-webhub-overlay/.site-webhub-modal
// pattern (escape + backdrop-click to close, self-contained dark panel so
// theme scope can't invert its text/background — see the gotcha documented
// right on .site-webhub-modal in App.css). The <iframe> embed is a best-effort
// inline view only: mobile Safari in particular often refuses to render a
// PDF inside an iframe, so the download/OSF links are never hidden behind it
// — they're the actual guarantee a visitor can read the paper, the iframe is
// a convenience on top.
export function PdfViewerModal({ paper, onClose }: Props) {
  const { lang } = useLang()
  const c = COPY[lang]
  // paper.file is a bare relative path ("papers/foo.pdf") specifically so this
  // works on both deployments: the Fly app serves from domain root, but the
  // GitHub Pages mirror serves from a repo subpath (import.meta.env.BASE_URL),
  // so a hardcoded leading "/papers/..." 404s there — same reason
  // AdminPanel.tsx's favicon reference goes through BASE_URL instead of a bare
  // "/favicon.svg".
  const fileUrl = `${import.meta.env.BASE_URL}${paper.file}`
  return (
    <div
      className="site-webhub-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={paper.title}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="site-webhub-modal site-pdf-modal">
        <button type="button" className="site-webhub-x" aria-label={c.close} onClick={onClose}>✕</button>
        <div className="site-webhub-modal-name">{paper.title}</div>
        <div className="site-pdf-links">
          <a href={fileUrl} download className="site-about-proof-badge">{c.download}</a>
          {paper.doi && <a href={paper.doi} target="_blank" rel="noopener noreferrer" className="site-about-proof-badge">{c.openOsf}</a>}
        </div>
        <div className="site-pdf-frame-wrap">
          <iframe src={fileUrl} title={paper.title} className="site-pdf-frame" />
        </div>
        <p className="site-pdf-fallback">{c.fallback}</p>
      </div>
    </div>
  )
}
