import { useEffect, useRef, useState } from 'react'
import { exportCsv, exportMarkdown, exportYaml } from '../../lib/export'

const FORMATS: { key: 'csv' | 'markdown' | 'yaml'; label: string }[] = [
  { key: 'csv', label: 'CSV' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'yaml', label: 'YAML' },
]

/// ONE action button, not a row of one-per-format buttons — the canonical
/// "action button" slot in every app's shared page header (title top-left,
/// search/filter/action top-right, same shape as Lighthouse's own
/// PageHeader). Opens a small format menu on click instead of exposing every
/// format as its own always-visible button; every existing call site across
/// the app keeps working unchanged, since the external prop shape (rows/
/// filenameBase/title/disabled) hasn't changed, only what's rendered inside.
export function ExportButtons({ rows, filenameBase, title, disabled }: {
  rows: Record<string, unknown>[]
  filenameBase: string
  title?: string
  disabled?: boolean
}) {
  const isDisabled = disabled ?? rows.length === 0
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const stamp = new Date().toISOString().slice(0, 10)
  const runExport = (format: 'csv' | 'markdown' | 'yaml') => {
    setOpen(false)
    if (format === 'csv') exportCsv(`${filenameBase}-${stamp}.csv`, rows)
    else if (format === 'markdown') exportMarkdown(`${filenameBase}-${stamp}.md`, rows, title)
    else exportYaml(`${filenameBase}-${stamp}.yaml`, rows)
  }

  return (
    <div className="export-menu-wrap" ref={ref}>
      <button
        type="button"
        className="export-menu-btn"
        disabled={isDisabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 20h16" />
        </svg>
        <span>Export</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="export-menu-chevron">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="export-menu" role="menu">
          {FORMATS.map(f => (
            <button key={f.key} type="button" role="menuitem" className="export-menu-item" onClick={() => runExport(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
