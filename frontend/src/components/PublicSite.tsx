import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react'
import type { SiteContent, SectionId, CanvasPos, ProductItem, CertificateItem, PaperItem } from '../types/content'
import { useTheme, type Theme } from '../hooks/useTheme'
import { useLang, type Lang } from '../hooks/useLang'
import { trackPageView } from '../lib/tracking'
import { API_BASE } from '../lib/apiBase'
import { CoEvolutionDiagram } from './CoEvolutionDiagram'
import { PdfViewerModal } from './PdfViewerModal'

// Generic single-card carousel: one item shown at a time, flip left/right,
// a slide-in transition each time the active item changes (direction-aware
// - forward advances slide in from the right, backward from the left).
// Originally built just for "what grew out of the loop"; generalized
// 2026-07-13 so the Framework/Verhaltensanalyse/Frameworks & Concepts card
// groups can all reuse the same component instead of three near-duplicates
// - `renderItem` is the only thing that differs between them.
function GenericCarousel<T>({
  items, renderItem, wrapClassName = 'site-born-carousel', getKey,
}: {
  items: T[]
  renderItem: (item: T, i: number) => React.ReactNode
  wrapClassName?: string
  getKey: (item: T, i: number) => string
}) {
  const { lang } = useLang()
  const [idx, setIdx] = useState(0)
  const [dir, setDir] = useState(1)
  const n = items.length
  if (n === 0) return null
  const go = (d: number) => { setDir(d); setIdx((i) => (i + d + n) % n) }
  const jump = (i: number) => { setDir(i >= idx ? 1 : -1); setIdx(i) }
  const prev = lang === 'de' ? 'Zurück' : 'Previous'
  const next = lang === 'de' ? 'Weiter' : 'Next'
  return (
    <div className={wrapClassName}>
      <div className="site-born-track">
        {/* key={idx} forces a remount on every change, which is what
            restarts the slide-in animation each time - a plain prop change
            wouldn't replay a CSS `animation`. */}
        <div key={idx} className={`site-born-slide site-born-slide--${dir > 0 ? 'fwd' : 'back'}`}>
          {renderItem(items[idx], idx)}
        </div>
      </div>
      <div className="site-born-controls">
        <button type="button" className="site-born-arrow" aria-label={prev} onClick={() => go(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="site-born-dots">
          {items.map((it, i) => (
            <button
              key={getKey(it, i)}
              type="button"
              className={`site-born-dot${i === idx ? ' active' : ''}`}
              aria-label={`${i + 1}`}
              onClick={() => jump(i)}
            />
          ))}
        </div>
        <button type="button" className="site-born-arrow" aria-label={next} onClick={() => go(1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </div>
  )
}

// "What grew out of the loop" — each card carries its builtBy label so
// attribution stays clear.
function BornCarousel({ items }: { items: Array<{ id: string; name: string; builtBy?: string; description: string }> }) {
  return (
    <GenericCarousel
      items={items}
      getKey={(item) => item.id}
      renderItem={(item) => (
        <article className="site-born-card site-born-card--active">
          <h3 className="site-born-name">{item.name}</h3>
          {item.builtBy && <span className="site-born-builtBy">{item.builtBy}</span>}
          <p className="site-born-desc" dangerouslySetInnerHTML={{ __html: item.description }} />
        </article>
      )}
    />
  )
}

// Convert server-side paths to hash routing so GitHub Pages never 404s on legal links
function safeHref(href: string): string {
  return href.startsWith('/') && !href.startsWith('//') ? `#p${href}` : href
}

// nav-jump suppressor: set true during anchor-link scroll → all Reveal elements snap to p=1
let _revealSuppressed = false

export function Reveal({
  children, delay = 0, from = 'bottom', style: extra,
}: {
  children: React.ReactNode
  delay?: number
  from?: 'bottom' | 'left' | 'right' | 'scale'
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    let rafId = 0
    const update = () => {
      if (_revealSuppressed) { el.style.opacity = '1'; el.style.transform = 'none'; return }
      const rect = el.getBoundingClientRect(), vh = window.innerHeight
      const startFrac = 0.96 - delay * 0.05
      // Window widened from an earlier 0.22*vh to 0.7*vh: at the old width,
      // the eased/accelerated wheel-scroll (see useFastScroll) covers the
      // whole transition in 2-3 animation frames on a normal scroll gesture
      // — technically animating, but too fast to ever actually see. This
      // spans most of a screen's height of scroll distance instead, so the
      // fade-and-slide is visible at any realistic scroll speed.
      const raw = (vh * startFrac - rect.top) / (vh * 0.7)
      const p = Math.max(0, Math.min(1, raw))
      el.style.opacity = String(p)
      const d = (1 - p) * 64
      el.style.transform = from === 'left'  ? `translateX(${-d}px)` :
                           from === 'right' ? `translateX(${d}px)`  :
                           from === 'scale' ? `scale(${0.82 + p * 0.18})` :
                           `translateY(${d}px)`
    }
    const onScroll = () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(update) }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(rafId) }
  }, [delay, from])
  return <div ref={ref} style={{ opacity: 0, willChange: 'transform, opacity', ...extra }}>{children}</div>
}

// Eased "super smooth" wheel-scroll accelerator — ported from rfi-irfos-web's
// own PublicSite.tsx (same technique, ~40 self-contained lines, no library).
// Intercepts wheel deltas, boosts them, and lerps toward the target scroll
// position every animation frame instead of jumping straight there — this is
// what makes the page-build/explode feel driven by Reveal above read as
// smooth scrubbing rather than a jittery native scroll. Respects
// prefers-reduced-motion (bails out entirely) and skips any element marked
// [data-native-scroll] (nested overflow-scroll panels) so the wheel hijack
// never fights an internal scrollable list.
function useFastScroll(enabled: boolean, mult = 1.55, ease = 0.16) {
  useEffect(() => {
    if (!enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let target = window.scrollY
    let current = window.scrollY
    let rafId = 0
    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight

    const tick = () => {
      current += (target - current) * ease
      if (Math.abs(target - current) < 0.5) { current = target; window.scrollTo(0, current); rafId = 0; return }
      window.scrollTo(0, current)
      rafId = requestAnimationFrame(tick)
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.deltaY === 0) return
      if ((e.target as HTMLElement)?.closest?.('[data-native-scroll]')) return
      e.preventDefault()
      if (!rafId) { target = window.scrollY; current = window.scrollY }
      target = Math.max(0, Math.min(maxScroll(), target + e.deltaY * mult))
      if (!rafId) rafId = requestAnimationFrame(tick)
    }
    const onResize = () => { target = Math.min(target, maxScroll()) }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(rafId)
    }
  }, [enabled, mult, ease])
}

// ── Edit context ─────────────────────────────────────────────────────────────

interface EditCtx {
  editMode: boolean
  onTextChange: (field: string, value: string) => void
  onImageClick: (field: string) => void
  onUpdate: (field: string, value: unknown) => void
  setFocusedEl: (el: HTMLElement | null) => void
}
const Ctx = createContext<EditCtx>({
  editMode: false,
  onTextChange: () => {},
  onImageClick: () => {},
  onUpdate: () => {},
  setFocusedEl: () => {},
})

// ── Inline-edit primitives ────────────────────────────────────────────────────

type TagName = keyof React.JSX.IntrinsicElements

interface EProps {
  field: string
  value: string
  as?: TagName
  className?: string
  style?: React.CSSProperties
  href?: string
  title?: string
}

function E({ field, value, as, className, style, href, title }: EProps) {
  const { editMode, onTextChange, setFocusedEl } = useContext(Ctx)
  const Tag = (as ?? 'span') as TagName

  if (!editMode) {
    const props: Record<string, unknown> = { className, style, dangerouslySetInnerHTML: { __html: value }, 'data-cid': field }
    if (href) props.href = href
    if (title) props.title = title
    return <Tag {...props} />
  }

  const editProps: Record<string, unknown> = {
    className: `${className ?? ''} editable-text`,
    style,
    'data-cid': field,
    contentEditable: true,
    suppressContentEditableWarning: true,
    dangerouslySetInnerHTML: { __html: value },
    onFocus: (e: React.FocusEvent<HTMLElement>) => setFocusedEl(e.currentTarget),
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      setFocusedEl(null)
      onTextChange(field, e.currentTarget.innerHTML)
    },
  }
  if (href) editProps.href = href
  return <Tag {...editProps} />
}

interface EImgProps {
  field: string
  src: string
  alt?: string
  className?: string
  style?: React.CSSProperties
}

function EImg({ field, src, alt = '', className, style }: EImgProps) {
  const { editMode, onImageClick } = useContext(Ctx)
  if (!src && !editMode) return null
  if (!editMode) return <img src={src} alt={alt} className={className} style={style} data-cid={field} />
  return (
    <div className="editable-img-wrap" style={{ display: 'contents' }} onClick={() => onImageClick(field)} data-cid={field}>
      {src
        ? <img src={src} alt={alt} className={`${className ?? ''} editable-img`} style={style} />
        : <div className={`editable-img-placeholder ${className ?? ''}`} style={style}>Bild hochladen</div>}
      <div className="editable-img-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      </div>
    </div>
  )
}

// ── Format toolbar ────────────────────────────────────────────────────────────

// Module-level saved range — survives re-renders between mousedown and click
let _fmtSavedRange: Range | null = null

function FormatToolbar({ anchorEl }: { anchorEl: HTMLElement | null }) {
  if (!anchorEl) return null
  const rect = anchorEl.getBoundingClientRect()
  const tbW = 330
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - tbW / 2, window.innerWidth - tbW - 8))
  const top = rect.top < 56 ? rect.bottom + 6 : rect.top - 48

  const exec = (cmd: string, val?: string) => {
    anchorEl.focus()
    if (_fmtSavedRange) {
      const sel = window.getSelection()
      if (sel) { sel.removeAllRanges(); sel.addRange(_fmtSavedRange) }
    }
    if (cmd === 'foreColor' || cmd === 'fontSize') { try { document.execCommand('styleWithCSS', false, 'true') } catch { /* noop */ } }
    document.execCommand(cmd, false, val)
  }

  const onTbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) _fmtSavedRange = sel.getRangeAt(0).cloneRange()
  }

  return (
    <div className="format-toolbar" style={{ position: 'fixed', top, left, width: tbW, zIndex: 9999 }} onMouseDown={onTbMouseDown}>
      <button type="button" className="fmt-btn fmt-b" onClick={() => exec('bold')}>B</button>
      <button type="button" className="fmt-btn fmt-i" onClick={() => exec('italic')}>I</button>
      <button type="button" className="fmt-btn fmt-u" onClick={() => exec('underline')}>U</button>
      <button type="button" className="fmt-btn fmt-s" onClick={() => exec('strikeThrough')}>S</button>
      <div className="fmt-sep" />
      <button type="button" className="fmt-btn" onClick={() => exec('justifyLeft')}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg></button>
      <button type="button" className="fmt-btn" onClick={() => exec('justifyCenter')}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg></button>
      <div className="fmt-sep" />
      <button type="button" className="fmt-btn fmt-size-s" onClick={() => exec('fontSize', '2')}>S</button>
      <button type="button" className="fmt-btn" onClick={() => exec('fontSize', '4')}>M</button>
      <button type="button" className="fmt-btn fmt-size-l" onClick={() => exec('fontSize', '5')}>L</button>
      <div className="fmt-sep" />
      <label className="fmt-color-btn" onMouseDown={e => e.stopPropagation()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
        <input type="color" defaultValue="#111111" onChange={e => exec('foreColor', e.target.value)} className="fmt-color-input" />
      </label>
    </div>
  )
}

// ── Canvas element (drag wrapper) ─────────────────────────────────────────────

interface CanvasElProps {
  id: string
  pos: CanvasPos
  onMove: (p: CanvasPos) => void
  children: React.ReactNode
  minWidth?: number
  noPad?: boolean
  label?: string
}

function CanvasEl({ id, pos, onMove, children, minWidth = 160, noPad, label }: CanvasElProps) {
  const elRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ mx: number; my: number; sx: number; sy: number } | null>(null)

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragState.current = { mx: e.clientX, my: e.clientY, sx: pos.x, sy: pos.y }

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current || !elRef.current) return
      elRef.current.style.left = `${dragState.current.sx + ev.clientX - dragState.current.mx}px`
      elRef.current.style.top  = `${dragState.current.sy + ev.clientY - dragState.current.my}px`
    }
    const onMouseUp = (ev: MouseEvent) => {
      if (!dragState.current) return
      const nx = dragState.current.sx + ev.clientX - dragState.current.mx
      const ny = dragState.current.sy + ev.clientY - dragState.current.my
      dragState.current = null
      onMove({ x: nx, y: ny })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      ref={elRef}
      data-cid={id}
      className={`canvas-el${noPad ? ' canvas-el-nopad' : ''}`}
      style={{ position: 'absolute', left: pos.x, top: pos.y, minWidth }}
    >
      {label && <div className="canvas-el-label">{label}</div>}
      <div className="canvas-el-grip" onMouseDown={startDrag} title="Ziehen zum Verschieben">
        <svg width="10" height="16" viewBox="0 0 10 24" fill="currentColor">
          <circle cx="3" cy="4"  r="1.8"/><circle cx="7" cy="4"  r="1.8"/>
          <circle cx="3" cy="12" r="1.8"/><circle cx="7" cy="12" r="1.8"/>
          <circle cx="3" cy="20" r="1.8"/><circle cx="7" cy="20" r="1.8"/>
        </svg>
      </div>
      {children}
    </div>
  )
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconDelivery() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
}
function IconShield() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
}
function IconTag() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="2.5"/></svg>
}
function IconLocation() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
}
function IconPhone() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6.29 6.29l.95-.96a2 2 0 0 1 2.1-.45c.908.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
}
function IconMail() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
}

// Geometric "E" monogram (Bauhaus-style stacked bars) + a small node/ring
// accent standing in for the "Interaction Field" concept — inline SVG using
// `currentColor` (set via .site-logo-mark's `color: var(--primary)`, the
// same token .site-logo-text already uses) rather than a baked data-URI
// image with fixed hex colors. A raster/data-URI logo can't see the page's
// CSS custom properties at all (it renders in an isolated nested context),
// so it stays one fixed color across every theme — exactly the light/hc
// bug the HUD corner-frame had before PR #65, and the WCAG AAA hc theme's
// own "one color, max contrast" rule this would otherwise violate with a
// stray cyan. Inline SVG in the live DOM inherits theme color correctly in
// all three themes for free.
function BrandMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 40 40" className="site-logo-mark" aria-hidden="true">
      <rect x="7" y="6" width="6" height="28" rx="1.2" fill="currentColor" />
      <rect x="7" y="6" width="23" height="6" rx="1.2" fill="currentColor" />
      <rect x="7" y="17" width="17" height="6" rx="1.2" fill="currentColor" />
      <rect x="7" y="28" width="23" height="6" rx="1.2" fill="currentColor" />
      <circle cx="33" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" opacity=".55" />
      <circle cx="33" cy="8" r="2.6" fill="currentColor" />
    </svg>
  )
}

// ── Framework concept icons ───────────────────────────────────────────────────

function IconEmergence() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5.5" opacity=".7"/><circle cx="12" cy="12" r="10" opacity=".35"/></svg>
}
function IconBehavior() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 12 8 12 10 6 14 18 16 12 21 12"/></svg>
}
function IconDrift() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="15" y2="12" strokeDasharray="2.2 3.4"/><polyline points="13 6.5 20 12 13 17.5"/></svg>
}
function IconPrediction() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 4 3 8-9"/><polyline points="15 6 21 6 21 12"/></svg>
}
function IconField() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9.5" cy="12" r="6.5" opacity=".8"/><circle cx="14.5" cy="12" r="6.5" opacity=".8"/></svg>
}
function IconLayers() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2.5 2.5 7.5 12 12.5 21.5 7.5 12 2.5"/><polyline points="2.5 12.5 12 17.5 21.5 12.5"/><polyline points="2.5 17.5 12 22.5 21.5 17.5"/></svg>
}
function IconConstraints() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3.5H5.5a2 2 0 0 0-2 2V8"/><path d="M16 3.5h2.5a2 2 0 0 1 2 2V8"/><path d="M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M16 20.5h2.5a2 2 0 0 0 2-2V16"/></svg>
}
function IconSystemAnalysis() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.3" y1="15.3" x2="21" y2="21"/></svg>
}
function IconMonitoring() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>
}
function IconAgents() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="7" r="2.3"/><circle cx="12" cy="18" r="2.3"/><line x1="7.8" y1="8.6" x2="10.3" y2="16.2"/><line x1="16.2" y1="8.6" x2="13.7" y2="16.2"/><line x1="8.3" y1="7" x2="15.7" y2="7"/></svg>
}

function UspIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case 'emergence':   return <IconEmergence />
    case 'behavior':     return <IconBehavior />
    case 'drift':        return <IconDrift />
    case 'prediction':   return <IconPrediction />
    case 'field':        return <IconField />
    case 'layers':        return <IconLayers />
    case 'constraints':  return <IconConstraints />
    case 'system-analysis': return <IconSystemAnalysis />
    case 'monitoring':   return <IconMonitoring />
    case 'agents':       return <IconAgents />
    default: return null
  }
}

function TrustIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'delivery': return <IconDelivery />
    case 'shield':   return <IconShield />
    case 'tag':      return <IconTag />
    case 'location': return <IconLocation />
    default:         return <IconShield />
  }
}

// ── Hero graphic: Earth's limb at sunrise, as seen from orbit - a sun that
// rises very slowly over 60s, aurora drifting on the dark side of the sky, a
// few quietly twinkling stars, the planet's curve filled dark below. The
// sunrise fade-in previously looked like a recurring shimmer because
// HeroFieldGraphic used to remount every time the Research/About-the-Lab
// modal closed (App.tsx returned a different tree shape open vs closed) -
// fixed at the root now (single stable return, PublicSite never remounts),
// so the animation genuinely only plays once per real page load, same as
// intended. No bright glow-line stroke on the earth curve itself though -
// that one really was just an unwanted diagonal shimmer, stays removed.
function HeroFieldGraphic() {
  const W = 720, H = 640
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  const stars = useMemo(() => {
    const n = 16
    const arr: { x: number; y: number; r: number; o: number; twinkle: boolean; dur: number }[] = []
    for (let i = 0; i < n; i++) {
      arr.push({
        x: Math.random() * W * 0.7,
        y: Math.random() * H * 0.5,
        r: 0.6 + Math.random() * 1.3,
        o: 0.25 + Math.random() * 0.45,
        twinkle: i % 4 === 0,
        dur: 4 + Math.random() * 3,
      })
    }
    return arr
  }, [])

  return (
    <svg className="site-hero-graphic" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="hero-sunrise-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6e0" stopOpacity="0.95" />
          <stop offset="26%" stopColor="#ffd88a" stopOpacity="0.55" />
          <stop offset="58%" stopColor="var(--brand-cyan)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--brand-cyan)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-earth-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d1f2e" />
          <stop offset="100%" stopColor="#050a12" />
        </linearGradient>
        <radialGradient id="hero-aurora-a" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--brand-cyan)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--brand-cyan)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hero-aurora-b" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8b7bf0" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#8b7bf0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hero-aurora-c" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2fd9c4" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#2fd9c4" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* soft aurora, drifting on the dark side of the sky */}
      <g style={{ mixBlendMode: 'screen' }}>
        <ellipse cx="70" cy="160" rx="55" ry="230" fill="url(#hero-aurora-a)">
          {!reducedMotion && <animate attributeName="cx" values="70;95;70" dur="16s" repeatCount="indefinite" />}
        </ellipse>
        <ellipse cx="160" cy="260" rx="45" ry="210" fill="url(#hero-aurora-b)">
          {!reducedMotion && <animate attributeName="cx" values="160;130;160" dur="19s" repeatCount="indefinite" />}
        </ellipse>
        <ellipse cx="30" cy="340" rx="40" ry="190" fill="url(#hero-aurora-c)">
          {!reducedMotion && <animate attributeName="cy" values="340;300;340" dur="22s" repeatCount="indefinite" />}
        </ellipse>
      </g>

      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#e9fbff" opacity={s.o}>
          {!reducedMotion && s.twinkle && (
            <animate attributeName="opacity" values={`${s.o};${s.o * 0.2};${s.o}`} dur={`${s.dur}s`} repeatCount="indefinite" />
          )}
        </circle>
      ))}

      {/* sun, rising very slowly (60s) from behind the horizon - the Earth
          fill below occludes whatever hasn't "risen" above the curve yet.
          Plays once per real mount now that the remount bug is fixed. */}
      <circle cx="630" cy={reducedMotion ? 255 : 440} r="230" fill="url(#hero-sunrise-glow)" opacity={reducedMotion ? 1 : 0}>
        {!reducedMotion && (
          <>
            <animate attributeName="cy" values="440;255" dur="60s" fill="freeze" calcMode="spline" keySplines="0.22 0.1 0.2 1" />
            <animate attributeName="opacity" values="0;1" dur="20s" fill="freeze" />
          </>
        )}
      </circle>

      {/* Earth's limb: a gentle curve, the planet filled dark below it -
          fill only, no stroke (see comment above the function). */}
      <path d="M -40,640 Q 340,430 760,190 L 760,680 L -40,680 Z" fill="url(#hero-earth-fill)" />
    </svg>
  )
}

// ── Contact form ──────────────────────────────────────────────────────────────

function ContactForm({ email }: { email: string }) {
  const { t } = useLang()
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const to = email || ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    try {
      // Source of truth: persist server-side so the admin's Inbox (a
      // separate browser, possibly a separate device) can actually see it —
      // this used to only ever land in THIS browser's localStorage, which
      // never syncs across devices, so a real visitor's submission could
      // never reach the admin. See backend/src/contact.rs.
      const res = await fetch(`${API_BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(String(res.status))

      // Best-effort email notification, unchanged from before this fix —
      // but no longer the only place a submission lands, so a missing or
      // failed web3forms key no longer means the inquiry is lost.
      const key = import.meta.env.VITE_WEB3FORMS_KEY as string | undefined
      if (key) {
        fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: key,
            subject: `${t.mailSubject} ${form.name}`,
            ...form,
          }),
        }).catch(() => { /* non-critical: already persisted server-side above */ })
      }

      setStatus('ok')
    } catch {
      // Backend unreachable — last-resort fallback so the message isn't
      // just dropped: open a pre-filled mailto to the admin's address.
      const body = encodeURIComponent(`Name: ${form.name}\nPhone: ${form.phone}\n\n${form.message}`)
      window.location.href = `mailto:${to}?subject=${encodeURIComponent(`${t.mailSubject} ${form.name}`)}&body=${body}`
      setStatus('err')
    }
  }

  if (status === 'ok') {
    return (
      <div className="site-contact-form-success">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>{t.success}</p>
      </div>
    )
  }

  return (
    <form className="site-contact-form" onSubmit={submit}>
      <div className="site-contact-form-row">
        <input placeholder={t.namePlaceholder} required value={form.name} onChange={e => set('name', e.target.value)} />
        <input placeholder={t.emailPlaceholder} type="email" required value={form.email} onChange={e => set('email', e.target.value)} />
      </div>
      <input placeholder={t.phonePlaceholder} value={form.phone} onChange={e => set('phone', e.target.value)} />
      <textarea placeholder={t.messagePlaceholder} rows={4} required value={form.message} onChange={e => set('message', e.target.value)} />
      <button type="submit" disabled={status === 'sending'} className="site-contact-form-btn">
        {status === 'sending' ? `${t.sending}…` : t.send}
      </button>
      {status === 'err' && <p className="site-contact-form-err">{t.error}</p>}
    </form>
  )
}

// ── WhatsApp button ───────────────────────────────────────────────────────────

function WhatsAppButton({ number, message }: { number: string; message: string }) {
  const href = `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
  return (
    <a className="site-whatsapp-btn" href={href} target="_blank" rel="noopener noreferrer" title="WhatsApp">
      <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.118 1.533 5.851L0 24l6.335-1.513A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.843 0-3.57-.49-5.062-1.346L2.5 21.5l.854-3.375A9.944 9.944 0 0 1 2 12c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10z"/>
      </svg>
    </a>
  )
}

// ── Theme toggle (light / dark / high-contrast) ───────────────────────────────

function IconSun() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
}
function IconMoon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
}
function IconContrast() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18z" fill="currentColor"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>
}
function IconMenu() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
}
function IconClose() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}

const THEME_OPTS: { id: Theme; icon: React.ReactNode }[] = [
  { id: 'light', icon: <IconSun /> },
  { id: 'dark', icon: <IconMoon /> },
  { id: 'hc', icon: <IconContrast /> },
]

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const { t } = useLang()
  const labels: Record<Theme, string> = { light: t.themeLight, dark: t.themeDark, hc: t.themeContrast }
  return (
    <div className="theme-toggle" role="group" aria-label={t.colorScheme}>
      {THEME_OPTS.map(o => (
        <button
          key={o.id}
          type="button"
          className={`theme-toggle-btn ${theme === o.id ? 'active' : ''}`}
          aria-pressed={theme === o.id}
          aria-label={labels[o.id]}
          title={labels[o.id]}
          onClick={() => setTheme(o.id)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}

// ── Language toggle (EN / DE) ─────────────────────────────────────────────────

const LANG_OPTS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'de', label: 'DE' },
]

function LanguageToggle() {
  const { lang, setLang, t } = useLang()
  return (
    <div className="lang-toggle" role="group" aria-label={t.language}>
      {LANG_OPTS.map(o => (
        <button
          key={o.id}
          type="button"
          className={`lang-toggle-btn ${lang === o.id ? 'active' : ''}`}
          aria-pressed={lang === o.id}
          onClick={() => setLang(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Category icons ────────────────────────────────────────────────────────────

function CategoryIcon({ category }: { category: string }) {
  const c = (category ?? '').toLowerCase()
  const cls = "site-cat-icon"
  if (c === 'english')
    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  if (c === 'german' || c === 'deutsch')
    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  if (c === 'exam prep' || c === 'prüfung' || c === 'vizsga')
    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  if (c === 'hungarian' || c === 'ungarisch' || c === 'magyar' || c === 'gyerekek')
    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  if (c === 'kids' || c === 'kinder' || c === 'kinder & jugendliche')
    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
}


// ── Public Site ───────────────────────────────────────────────────────────────

interface Props {
  content: SiteContent
  editMode?: boolean
  rearrangeMode?: boolean
  initPositions?: Record<string, CanvasPos>
  onTextChange?: (field: string, value: string) => void
  onImageClick?: (field: string) => void
  onUpdate?: (field: string, value: unknown) => void
  onSectionReorder?: (order: SectionId[]) => void
  // The Research/About-the-Lab modal renders as a sibling of this component
  // (see App.tsx), not a child - it can't just stop propagation on its own
  // wheel events to pause the background's fast-scroll hijack, since that
  // hijack listens on `window` regardless of target. This flag is how App
  // tells PublicSite to suspend it while a modal is open.
  modalOpen?: boolean
}

// call-laura — a real, deployed instrument built on two of Laura's own
// UIP/8-Layer lenses (eight_layer, uip_check) plus two RFI-IRFOS additions
// (resonance, ecocentric); fully deterministic, no LLM call, no network
// dependency at inference time (see the project's own README for the full
// attribution table). Shipped 2026-07-12. Linked here as concrete proof the
// framework runs in production, not just on this site's own Observatory —
// Smithery listing is a still-open step (per the ship email) and
// deliberately not linked yet, to avoid a dead/premature link.
const CALL_LAURA_COPY = {
  en: {
    proofCaption: 'Engineered by RFI-IRFOS, directed by Laura — proof it runs in production:',
    github: 'GitHub',
    coreCrate: 'crates.io (core) v0.2.0',
    teamCrate: 'crates.io (team) v0.2.0 — on request',
    mcpCrate: 'crates.io (mcp) v0.2.0',
    apiCrate: 'crates.io (api) v0.2.0',
    api: 'Live API',
  },
  de: {
    proofCaption: 'Von RFI-IRFOS gebaut, von Laura angeleitet — Beweis, dass es produktiv läuft:',
    github: 'GitHub',
    coreCrate: 'crates.io (Core) v0.2.0',
    teamCrate: 'crates.io (Team) v0.2.0 — auf Anfrage',
    mcpCrate: 'crates.io (MCP) v0.2.0',
    apiCrate: 'crates.io (API) v0.2.0',
    api: 'Live-API',
  },
} as const

export function PublicSite({
  content, editMode = false, rearrangeMode = false, initPositions = {},
  onTextChange, onImageClick, onUpdate, modalOpen = false,
}: Props) {
  const { meta, nav, hero, trust, categories, products, usp, news, contact, whatsapp, footer, pricing, certificates, papers } = content
  const hiddenSections = content.hiddenSections ?? []

  const [focusedEl, setFocusedEl] = useState<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalProduct, setModalProduct] = useState<ProductItem | null>(null)
  const [modalGalleryIdx, setModalGalleryIdx] = useState(0)
  const [activePaper, setActivePaper] = useState<PaperItem | null>(null)
  const [browseCatIdx, setBrowseCatIdx] = useState<number | null>(null)
  const [activeNewsCategory, setActiveNewsCategory] = useState<string | null>(null)
  const { theme, setTheme } = useTheme()
  const { t, lang } = useLang()
  // Only on the live public page — an editor dragging/rearranging sections
  // in the builder shouldn't have their scroll wheel hijacked mid-edit.
  // Also suspended while a content-page modal is open (modalOpen prop) - the
  // hijack listens on `window` and calls preventDefault() on every wheel
  // event regardless of target, which was silently swallowing scroll
  // attempts over the modal (body is scroll-locked while it's open, so the
  // hijacked scroll had nothing to actually move) instead of letting the
  // modal's own native internal scroll handle it.
  useFastScroll(!editMode && !modalOpen)

  // Tracking pixel — fires once per page load in production (skipped in edit
  // mode). Published articles now navigate to their own #p/blog/<id> route
  // (see BlogPostPage.tsx) instead of a modal here, so this component's own
  // load only ever represents the main site, not an individual article.
  useEffect(() => {
    if (editMode) return
    trackPageView()
  }, [editMode])

  // The home route is the one page in this app that never set its own
  // document.title — CertificationPage/BlogPostPage/DynamicPage all do (see
  // their own `document.title = ...` effects), but nothing here ever
  // overrode index.html's placeholder <title>frontend</title>, so every
  // visitor to the actual homepage saw a literal "frontend" browser tab
  // forever. Same effect shape as those pages: set on mount from the site's
  // own meta.title, restore whatever was there on unmount.
  useEffect(() => {
    if (editMode || !content.meta?.title) return
    const prev = document.title
    document.title = content.meta.title
    return () => { document.title = prev }
  }, [editMode, content.meta?.title])

  // Soft scroll-reveal for sections (dark theme only, see .site-reveal in App.css) —
  // sections fade + rise into place the first time they cross into view.
  const reveal = (cls: string) => editMode ? cls : `${cls} site-reveal`
  useEffect(() => {
    if (editMode) return
    const els = document.querySelectorAll('.site-reveal')
    if (!els.length) return
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target) }
      })
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [editMode])

  // Keep the product filter valid when the language (and its tab labels) changes
  useEffect(() => {
    const tabs = content.products?.tabs ?? []
    if (tabs.length && !tabs.includes(activeTab)) setActiveTab(tabs[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.products?.tabs])

  // Close the session detail modal on Escape; reset gallery index on open
  useEffect(() => {
    setModalGalleryIdx(0)
    if (!modalProduct) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalProduct(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modalProduct])

  // Close the paper PDF viewer on Escape
  useEffect(() => {
    if (!activePaper) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActivePaper(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [activePaper])
  const [heroBgPos, setHeroBgPos] = useState({ x: hero.bgX ?? 50, y: hero.bgY ?? 50 })
  const [heroHeight, setHeroHeight] = useState(hero.minHeight ?? 680)
  const heroBgPosRef = useRef(heroBgPos)
  const heroHeightRef = useRef(heroHeight)
  const heroDragRef  = useRef<{ startX: number; startY: number; startBgX: number; startBgY: number } | null>(null)
  const heightDragRef = useRef<{ startY: number; startH: number } | null>(null)
  const heroRef = useRef<HTMLElement | null>(null)

  // Nav goes from a flat transparent bar to a glass panel with an accent line
  // once the visitor scrolls past the hero — a state-aware header instead of
  // a static one.
  const [navScrolled, setNavScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const vars = { '--primary': meta.primaryColor, '--accent': meta.accentColor, fontFamily: meta.font } as React.CSSProperties

  const ctx: EditCtx = {
    editMode,
    onTextChange: onTextChange ?? (() => {}),
    onImageClick: onImageClick ?? (() => {}),
    onUpdate:     onUpdate     ?? (() => {}),
    setFocusedEl,
  }

  // Hero bg drag
  useEffect(() => {
    if (rearrangeMode) return
    const onMove = (e: MouseEvent) => {
      if (!heroDragRef.current || !heroRef.current) return
      const rect = heroRef.current.getBoundingClientRect()
      const next = {
        x: Math.max(0, Math.min(100, heroDragRef.current.startBgX - (e.clientX - heroDragRef.current.startX) / rect.width * 100)),
        y: Math.max(0, Math.min(100, heroDragRef.current.startBgY - (e.clientY - heroDragRef.current.startY) / rect.height * 100)),
      }
      heroBgPosRef.current = next
      setHeroBgPos(next)
    }
    const onUp = () => {
      if (!heroDragRef.current) return
      heroDragRef.current = null
      onUpdate?.('hero.bgX', heroBgPosRef.current.x)
      onUpdate?.('hero.bgY', heroBgPosRef.current.y)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [rearrangeMode, onUpdate])

  // Hero height drag
  useEffect(() => {
    if (!heightDragRef.current) return
    const onMove = (e: MouseEvent) => {
      if (!heightDragRef.current) return
      const next = Math.max(300, heightDragRef.current.startH + e.clientY - heightDragRef.current.startY)
      heroHeightRef.current = next
      setHeroHeight(next)
    }
    const onUp = () => {
      if (!heightDragRef.current) return
      heightDragRef.current = null
      onUpdate?.('hero.minHeight', heroHeightRef.current)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  })

  // ── Canvas position helpers ─────────────────────────────────────────────────

  const savedPos = (content.positions ?? {}) as Record<string, CanvasPos>
  const pos = (id: string, fallback: CanvasPos): CanvasPos => savedPos[id] ?? initPositions[id] ?? fallback
  const moveEl = (id: string, p: CanvasPos) => onUpdate?.('positions', { ...savedPos, [id]: p })

  // ── Canvas render ────────────────────────────────────────────────────────────

  if (rearrangeMode) {
    const H = heroHeight
    const canvasBg: React.CSSProperties = {
      position: 'absolute', inset: 0, top: 0, left: 0, right: 0, height: H,
      background: hero.image
        ? `url(${hero.image}) ${heroBgPos.x}% ${heroBgPos.y}% / cover no-repeat`
        : meta.primaryColor,
      zIndex: 0,
    }

    // Section zone markers
    const zone = (label: string, y: number, h: number, color: string) => (
      <div style={{
        position: 'absolute', left: 0, right: 0, top: y, height: h,
        background: color, borderTop: '1px dashed #d0d0d0', pointerEvents: 'none',
        display: 'flex', alignItems: 'flex-start', paddingLeft: 8, paddingTop: 4,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#aaa', background: '#f8f9fa', padding: '2px 6px', borderRadius: 4 }}>{label}</span>
      </div>
    )

    return (
      <div style={vars} className="site-canvas">
        {/* Hero bg */}
        <div className="canvas-bg-band" style={canvasBg}
          onMouseDown={e => {
            e.preventDefault()
            heroDragRef.current = { startX: e.clientX, startY: e.clientY, startBgX: heroBgPos.x, startBgY: heroBgPos.y }
          }}
        >
          <div className="canvas-bg-hint">Hero-Bild ziehen um Position anzupassen</div>
        </div>

        {/* Zone markers */}
        {zone('Hero', 0, H, 'transparent')}
        {zone('Trust Strip', H, 90, 'rgba(17,17,17,.04)')}
        {zone('Kategorien', H + 90, 720, 'rgba(0,153,204,.02)')}
        {zone('Produkte', H + 810, 830, 'rgba(179,230,0,.03)')}
        {zone('Vorteile', H + 1640, 740, 'rgba(0,153,204,.02)')}
        {zone('Neuigkeiten', H + 2380, 580, 'rgba(179,230,0,.03)')}
        {zone('Standort', H + 2960, 500, 'rgba(0,0,0,.02)')}
        {zone('Footer', H + 3460, 250, 'rgba(17,17,17,.04)')}

        {/* NAV */}
        <header className="site-nav" style={{ position: 'sticky', top: 0, zIndex: 200 }}>
          <div className="site-nav-inner">
            <span className="site-logo-lockup">
              {nav.logo ? <img src={nav.logo} alt="" className="site-logo-img" /> : <BrandMark />}
            </span>
            <nav className="site-main-nav">{nav.links.map((l, i) => <a key={i} href={l.href}>{l.label}</a>)}</nav>
            <div className="site-nav-right">
              {nav.phone && <span className="site-nav-phone">{nav.phone}</span>}
              <a
                href="https://github.com/rfi-irfos/emergent-interaction-lab"
                target="_blank" rel="noopener noreferrer"
                className="site-nav-icon-btn" aria-label="Source on GitHub" title="Source on GitHub"
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
              </a>
              {nav.ctaLabel && (
                <a href={nav.ctaHref ?? '#'} className="site-nav-cta" aria-label={nav.ctaLabel} title={nav.ctaLabel}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2.5" y="4.5" width="15" height="11" rx="1.6" />
                    <path d="m3 5.5 7 6 7-6" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </header>

        {/* HERO ELEMENTS */}
        {hero.tag && (
          <CanvasEl id="hero.tag" pos={pos('hero.tag', { x: 80, y: 200 })} onMove={p => moveEl('hero.tag', p)} minWidth={300} noPad label="Hero Tag">
            <div className="site-hero-tag" dangerouslySetInnerHTML={{ __html: hero.tag }} />
          </CanvasEl>
        )}
        <CanvasEl id="hero.headline" pos={pos('hero.headline', { x: 80, y: 260 })} onMove={p => moveEl('hero.headline', p)} minWidth={400} noPad label="Überschrift">
          <h1 className="site-hero-h1" dangerouslySetInnerHTML={{ __html: hero.headline }} />
        </CanvasEl>
        <CanvasEl id="hero.subheadline" pos={pos('hero.subheadline', { x: 80, y: 390 })} onMove={p => moveEl('hero.subheadline', p)} minWidth={400} noPad label="Unterüberschrift">
          <p className="site-hero-sub" dangerouslySetInnerHTML={{ __html: hero.subheadline }} />
        </CanvasEl>
        {hero.body && (
          <CanvasEl id="hero.body" pos={pos('hero.body', { x: 80, y: 470 })} onMove={p => moveEl('hero.body', p)} minWidth={400} noPad label="Body">
            <p className="site-hero-body" dangerouslySetInnerHTML={{ __html: hero.body }} />
          </CanvasEl>
        )}
        {hero.callout && (
          <CanvasEl id="hero.callout" pos={pos('hero.callout', { x: 80, y: 560 })} onMove={p => moveEl('hero.callout', p)} minWidth={400} noPad label="Callout">
            <div className="site-hero-callout">
              <span className="site-hero-callout-label">{hero.callout.label}</span>
              <p className="site-hero-callout-text" dangerouslySetInnerHTML={{ __html: hero.callout.text }} />
            </div>
          </CanvasEl>
        )}
        <CanvasEl id="hero.cta" pos={pos('hero.cta', { x: 80, y: 490 })} onMove={p => moveEl('hero.cta', p)} minWidth={280} label="Buttons">
          <div className="site-hero-btns">
            <a className="site-btn-lime-lg" dangerouslySetInnerHTML={{ __html: hero.ctaLabel }} />
            {hero.ctaSecLabel && <a className="site-btn-ghost-lg" dangerouslySetInnerHTML={{ __html: hero.ctaSecLabel }} />}
          </div>
        </CanvasEl>

        {/* TRUST ITEMS */}
        {(trust?.items ?? []).map((t, i) => (
          <CanvasEl key={t.id} id={`trust.items.${i}`} pos={pos(`trust.items.${i}`, { x: 60 + i * 290, y: H + 20 })} onMove={p => moveEl(`trust.items.${i}`, p)} minWidth={240} label={`Trust ${i+1}`}>
            <div className="canvas-trust-item">
              <TrustIcon icon={t.icon} />
              <span><strong>{t.bold}</strong> {t.text}</span>
            </div>
          </CanvasEl>
        ))}

        {/* CATEGORIES TITLE */}
        <CanvasEl id="categories.title" pos={pos('categories.title', { x: 80, y: H + 140 })} onMove={p => moveEl('categories.title', p)} minWidth={300} noPad label="Kategorien Titel">
          <h2 className="canvas-section-h2" dangerouslySetInnerHTML={{ __html: categories?.title ?? '' }} />
        </CanvasEl>

        {/* CATEGORY CARDS */}
        {(categories?.items ?? []).map((c, i) => (
          <CanvasEl key={c.id} id={`categories.items.${i}`} pos={pos(`categories.items.${i}`, { x: 40 + (i % 3) * 388, y: H + 230 + Math.floor(i / 3) * 270 })} onMove={p => moveEl(`categories.items.${i}`, p)} minWidth={360} label={c.name}>
            <div className="canvas-cat-card">
              {c.image && <img src={c.image} alt={c.name} style={{ width: '100%', height: 120, objectFit: 'contain', background: '#f0f4f0', borderRadius: 6, padding: 8 }} />}
              <div style={{ padding: '8px 12px' }}>
                <div className="canvas-cat-name">{c.name}</div>
                <div className="canvas-cat-sub">{c.sub}</div>
              </div>
            </div>
          </CanvasEl>
        ))}

        {/* PRODUCTS TITLE */}
        <CanvasEl id="products.title" pos={pos('products.title', { x: 80, y: H + 870 })} onMove={p => moveEl('products.title', p)} minWidth={300} noPad label="Produkte Titel">
          <h2 className="canvas-section-h2" dangerouslySetInnerHTML={{ __html: products?.title ?? '' }} />
        </CanvasEl>

        {/* PRODUCT CARDS */}
        {(products?.items ?? []).map((p, i) => (
          <CanvasEl key={p.id} id={`products.items.${i}`} pos={pos(`products.items.${i}`, { x: 40 + (i % 3) * 388, y: H + 960 + Math.floor(i / 3) * 390 })} onMove={pp => moveEl(`products.items.${i}`, pp)} minWidth={360} label={p.name}>
            <div className="canvas-product-card">
              {p.image ? <img src={p.image} alt={p.name} style={{ width: '100%', height: 140, objectFit: 'contain', background: '#f7f7f7', borderRadius: 6, padding: 12 }} /> : <div style={{ height: 80, background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 12 }}>Kein Bild</div>}
              <div style={{ padding: '10px 12px' }}>
                {p.badge && <div className="canvas-pcard-badge">{p.badge}</div>}
                <div className="canvas-pcard-brand">{p.category}</div>
                <div className="canvas-pcard-name">{p.name}</div>
                <div className="canvas-pcard-price">{p.price}</div>
              </div>
            </div>
          </CanvasEl>
        ))}

        {/* USP TITLE */}
        <CanvasEl id="usp.title" pos={pos('usp.title', { x: 80, y: H + 1700 })} onMove={p => moveEl('usp.title', p)} minWidth={300} noPad label="Vorteile Titel">
          <h2 className="canvas-section-h2" dangerouslySetInnerHTML={{ __html: usp?.title ?? '' }} />
        </CanvasEl>

        {/* USP CARDS */}
        {(usp?.items ?? []).map((u, i) => (
          <CanvasEl key={u.id} id={`usp.items.${i}`} pos={pos(`usp.items.${i}`, { x: 40 + (i % 3) * 388, y: H + 1780 + Math.floor(i / 3) * 190 })} onMove={p => moveEl(`usp.items.${i}`, p)} minWidth={360} label={u.title}>
            <div className="canvas-usp-card">
              <h3>{u.title}</h3>
              <p>{u.description}</p>
            </div>
          </CanvasEl>
        ))}

        {/* NEWS TITLE */}
        <CanvasEl id="news.title" pos={pos('news.title', { x: 80, y: H + 2440 })} onMove={p => moveEl('news.title', p)} minWidth={300} noPad label="Neuigkeiten Titel">
          <h2 className="canvas-section-h2" dangerouslySetInnerHTML={{ __html: news?.title ?? '' }} />
        </CanvasEl>

        {/* NEWS CARDS */}
        {(news?.items ?? []).map((n, i) => (
          <CanvasEl key={n.id} id={`news.items.${i}`} pos={pos(`news.items.${i}`, { x: 40 + i * 388, y: H + 2520 })} onMove={p => moveEl(`news.items.${i}`, p)} minWidth={360} label={n.title}>
            <div className="canvas-news-card">
              <div className="canvas-news-date">{n.date}</div>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
            </div>
          </CanvasEl>
        ))}

        {/* CONTACT BLOCK */}
        <CanvasEl id="contact.block" pos={pos('contact.block', { x: 640, y: H + 3010 })} onMove={p => moveEl('contact.block', p)} minWidth={520} label="Kontakt">
          <div className="canvas-contact-block">
            <h2>{contact?.title}</h2>
            {contact?.phone && <div className="canvas-citem"><IconPhone /> <a href={`tel:${contact.phone}`}>{contact.phone}</a></div>}
            {contact?.email && <div className="canvas-citem"><IconMail /> <a href={`mailto:${contact.email}`}>{contact.email}</a></div>}
            {contact?.address && <div className="canvas-citem"><IconLocation /> <span>{contact.address}</span></div>}
          </div>
        </CanvasEl>

        {/* FOOTER */}
        <CanvasEl id="footer.block" pos={pos('footer.block', { x: 0, y: H + 3520 })} onMove={p => moveEl('footer.block', p)} minWidth={900} noPad label="Footer">
          <footer className="site-footer" style={{ position: 'static', borderRadius: 8 }}>
            <div className="site-footer-bottom">
              <span>{footer?.brand} - {footer?.tagline}</span>
              <div className="site-footer-links">
                {(footer?.links ?? []).map((l, i) => <a key={i} href={safeHref(l.href)}>{l.label}</a>)}
              </div>
              <span>{footer?.copyright}</span>
            </div>
          </footer>
        </CanvasEl>
      </div>
    )
  }

  // ── Normal / Edit render ─────────────────────────────────────────────────────

  // First tab is always the "show all" tab, whatever its localized label is.
  const allTab = products?.tabs?.[0] ?? ''
  const filteredProducts = (activeTab === '' || activeTab === allTab)
    ? (products?.items ?? [])
    : (products?.items ?? []).filter(p => p.category === activeTab)

  const heroStyle: React.CSSProperties = {
    minHeight: heroHeight,
    ...(hero.image ? { backgroundImage: `url(${hero.image})`, backgroundPosition: `${heroBgPos.x}% ${heroBgPos.y}%` } : {}),
  }

  return (
    <Ctx.Provider value={ctx}>
      <div style={vars} className="site" data-theme={theme}>
        <div className="site-emergence-field" aria-hidden="true">
          <div className="ef-blob ef-blob-1" />
          <div className="ef-blob ef-blob-2" />
          <div className="ef-blob ef-blob-3" />
          <div className="ef-ripple ef-ripple-1" />
          <div className="ef-ripple ef-ripple-2" />
          <div className="ef-ripple ef-ripple-3" />
        </div>
        {editMode && <FormatToolbar anchorEl={focusedEl} />}

        {/* ── NAV ──────────────────────────────────────────────────────── */}
        <header className={`site-nav ${navScrolled ? 'scrolled' : ''}`}>
          <div className="site-nav-inner">
            {nav.logo
              ? <EImg field="nav.logo" src={nav.logo} alt={nav.brand} className="site-logo-img" />
              : <BrandMark />
            }
            <nav className="site-main-nav">
              {nav.links.map((l, i) => (
                <E key={i} field={`nav.links.${i}.label`} value={l.label} as="a" href={l.href} />
              ))}
            </nav>
            <div className="site-nav-right">
              <div className="site-nav-desktop">
                <LanguageToggle />
                <ThemeToggle theme={theme} setTheme={setTheme} />
                {nav.phone && (
                  <a href={`tel:${nav.phone}`} className="site-nav-phone">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6.29 6.29l.95-.96a2 2 0 0 1 2.1-.45c.908.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <E field="nav.phone" value={nav.phone} as="span" />
                  </a>
                )}
                <a
                  href="https://github.com/rfi-irfos/emergent-interaction-lab"
                  target="_blank" rel="noopener noreferrer"
                  className="site-nav-icon-btn" aria-label="Source on GitHub" title="Source on GitHub"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                </a>
                {nav.ctaLabel && (
                  <E field="nav.ctaLabel" value={nav.ctaLabel} as="a" href={nav.ctaHref ?? '#'} className="site-nav-cta site-nav-cta-label" />
                )}
              </div>
              {/* compact lang toggle — always visible on mobile, hidden on desktop */}
              <div className="site-nav-lang-topbar">
                <LanguageToggle />
              </div>
              <button className="site-nav-burger" aria-label={t.openMenu} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
                <IconMenu />
              </button>
            </div>
          </div>
        </header>

        {/* ── MOBILE DRAWER (hamburger menu) ───────────────────────────── */}
        <div className={`site-mobile-scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
        <aside className={`site-mobile-drawer ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
          <div className="site-mobile-drawer-top">
            <span className="site-mobile-drawer-brand">{nav.brand}</span>
            <button className="site-mobile-close" aria-label={t.closeMenu} onClick={() => setMenuOpen(false)}>
              <IconClose />
            </button>
          </div>
          <nav className="site-mobile-links">
            {nav.links.map((l, i) => (
              <a key={i} href={l.href} onClick={() => setMenuOpen(false)}>{l.label}</a>
            ))}
          </nav>
          <div className="site-mobile-actions">
            <div>
              <div className="site-mobile-theme-label">{t.colorScheme}</div>
              <div className="site-mobile-theme-row">
                <ThemeToggle theme={theme} setTheme={setTheme} />
              </div>
            </div>
            {nav.phone && (
              <a href={`tel:${nav.phone}`} className="site-mobile-phone" onClick={() => setMenuOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6.29 6.29l.95-.96a2 2 0 0 1 2.1-.45c.908.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                {nav.phone}
              </a>
            )}
            {nav.ctaLabel && (
              <a href={nav.ctaHref ?? '#'} className="site-mobile-cta" onClick={() => setMenuOpen(false)}>{nav.ctaLabel}</a>
            )}
          </div>
        </aside>

        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <section
          className="site-hero"
          style={heroStyle}
          ref={heroRef as React.RefObject<HTMLElement>}
          onMouseDown={e => {
            if (!editMode) return
            // don't hijack the drag when the user is selecting/clicking editable
            // text, buttons or links — only drag from the bare hero background
            const el = e.target as HTMLElement
            if (el.isContentEditable || el.closest('.editable-text, .editable-img-wrap, button, a')) return
            heroDragRef.current = { startX: e.clientX, startY: e.clientY, startBgX: heroBgPos.x, startBgY: heroBgPos.y }
          }}
        >
          {!hero.image && <HeroFieldGraphic />}
          {editMode && (
            <div className="site-hero-controls">
              <button className="site-hero-swap-btn" onClick={() => onImageClick?.('hero.image')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Bild ändern
              </button>
            </div>
          )}
          <div className="site-hero-inner">
            {hero.tag && (
              <div className="site-hero-tag-wrap">
                <E field="hero.tag" value={hero.tag} as="div" className="site-hero-tag" />
              </div>
            )}
            <E field="hero.headline" value={hero.headline} as="h1" className="site-hero-h1" />
            <E field="hero.subheadline" value={hero.subheadline} as="p" className="site-hero-sub" />
            {hero.body && <E field="hero.body" value={hero.body} as="p" className="site-hero-body" />}
            {hero.callout && (
              <div className="site-hero-callout">
                <span className="site-hero-callout-label">{hero.callout.label}</span>
                <E field="hero.callout.text" value={hero.callout.text} as="p" className="site-hero-callout-text" />
              </div>
            )}
            <div className="site-hero-btns">
              <E field="hero.ctaLabel" value={hero.ctaLabel} as="a" href={hero.ctaHref} className="site-btn-lime-lg" />
              {hero.ctaSecLabel && <E field="hero.ctaSecLabel" value={hero.ctaSecLabel} as="a" href={hero.ctaSecHref ?? '#'} className="site-btn-ghost-lg" />}
            </div>
          </div>
          {editMode && (
            <div className="hero-resize-handle" onMouseDown={e => { e.preventDefault(); heightDragRef.current = { startY: e.clientY, startH: heroHeight } }} />
          )}
        </section>

        {/* ── TRUST STRIP ──────────────────────────────────────────────── */}
        {!hiddenSections.includes('trust') && (trust?.items?.length ?? 0) > 0 && (
          <div className="site-trust" id="trust">
            {trust.items.map((t, ti) => (
              <div key={t.id} className="site-trust-item">
                <TrustIcon icon={t.icon} />
                <span>
                  <E field={`trust.items.${ti}.bold`} value={t.bold} as="strong" />
                  {' '}<E field={`trust.items.${ti}.text`} value={t.text} as="span" />
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── ABOUT ────────────────────────────────────────────────────── */}
        {content.about && (
          <section className={reveal("site-about")} id="about">
            <div className={`site-about-inner${content.about.photo ? '' : ' site-about-inner--no-photo'}`}>
              {content.about.photo && (
                <div className="site-about-photo-wrap">
                  <EImg field="about.photo" src={content.about.photo} alt={content.about.headline} className="site-about-photo" />
                </div>
              )}
              <div className="site-about-content">
                {content.about.eyebrow && <div className="site-about-eyebrow" data-cid="about.eyebrow">{content.about.eyebrow}</div>}
                <Reveal from="bottom"><E field="about.headline" value={content.about.headline} as="h2" className="site-about-headline" /></Reveal>
                {(content.about.stats?.length ?? 0) > 0 && (
                  <div className="site-about-stats-row">
                    {content.about.stats!.map((s, i) => (
                      <Reveal key={i} from="bottom" delay={i}>
                        <div className="site-about-stat">
                          <strong data-cid={`about.stats.${i}.value`}>{s.value}</strong>
                          <span data-cid={`about.stats.${i}.label`}>{s.label}</span>
                        </div>
                      </Reveal>
                    ))}
                  </div>
                )}
                {content.about.frameworksLine && (
                  <Reveal from="bottom" delay={1}>
                    <div className="site-about-frameworks-line" data-cid="about.frameworksLine">{content.about.frameworksLine}</div>
                  </Reveal>
                )}
                <Reveal from="bottom" delay={1}><E field="about.bio" value={content.about.bio} as="p" className="site-about-bio" /></Reveal>
                {!editMode && (
                  <Reveal from="bottom" delay={2}>
                  <div className="site-about-proof-caption">{CALL_LAURA_COPY[lang].proofCaption}</div>
                  <div className="site-about-badges-row">
                    <a href="https://github.com/rfi-irfos/call-laura" target="_blank" rel="noopener noreferrer" className="site-about-proof-badge">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                      </svg>
                      <span>{CALL_LAURA_COPY[lang].github}</span>
                    </a>
                    <a href="https://crates.io/crates/lauras-core" target="_blank" rel="noopener noreferrer" className="site-about-proof-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 8v8a2 2 0 0 1-1 1.73l-6 3.46a2 2 0 0 1-2 0l-6-3.46A2 2 0 0 1 5 16V8" />
                        <path d="m3.27 6.96 8.73 5.05 8.73-5.05" /><path d="M12 22.08V12" />
                        <path d="M17.5 4.63 12 2 6.5 4.63v4.74L12 12l5.5-2.63z" />
                      </svg>
                      <span>{CALL_LAURA_COPY[lang].coreCrate}</span>
                    </a>
                    <a href="https://crates.io/crates/lauras-team" target="_blank" rel="noopener noreferrer" className="site-about-proof-badge" title={lang === 'de' ? 'Zugang nur auf Anfrage' : 'Access on request only'}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 8v8a2 2 0 0 1-1 1.73l-6 3.46a2 2 0 0 1-2 0l-6-3.46A2 2 0 0 1 5 16V8" />
                        <path d="m3.27 6.96 8.73 5.05 8.73-5.05" /><path d="M12 22.08V12" />
                        <path d="M17.5 4.63 12 2 6.5 4.63v4.74L12 12l5.5-2.63z" />
                      </svg>
                      <span>{CALL_LAURA_COPY[lang].teamCrate}</span>
                    </a>
                    <a href="https://crates.io/crates/lauras-mcp" target="_blank" rel="noopener noreferrer" className="site-about-proof-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 8v8a2 2 0 0 1-1 1.73l-6 3.46a2 2 0 0 1-2 0l-6-3.46A2 2 0 0 1 5 16V8" />
                        <path d="m3.27 6.96 8.73 5.05 8.73-5.05" /><path d="M12 22.08V12" />
                        <path d="M17.5 4.63 12 2 6.5 4.63v4.74L12 12l5.5-2.63z" />
                      </svg>
                      <span>{CALL_LAURA_COPY[lang].mcpCrate}</span>
                    </a>
                    <a href="https://crates.io/crates/lauras-api" target="_blank" rel="noopener noreferrer" className="site-about-proof-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 8v8a2 2 0 0 1-1 1.73l-6 3.46a2 2 0 0 1-2 0l-6-3.46A2 2 0 0 1 5 16V8" />
                        <path d="m3.27 6.96 8.73 5.05 8.73-5.05" /><path d="M12 22.08V12" />
                        <path d="M17.5 4.63 12 2 6.5 4.63v4.74L12 12l5.5-2.63z" />
                      </svg>
                      <span>{CALL_LAURA_COPY[lang].apiCrate}</span>
                    </a>
                    <a href="https://laura-api.fly.dev" target="_blank" rel="noopener noreferrer" className="site-about-proof-badge site-about-proof-badge--live">
                      <span className="site-about-proof-dot" aria-hidden="true" />
                      <span>{CALL_LAURA_COPY[lang].api}</span>
                    </a>
                  </div>
                  </Reveal>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── CO-EVOLUTION PROTOCOL ────────────────────────────────────── */}
        {content.protocol?.nodes?.length ? (
          <section className={reveal("site-section site-section-alt site-protocol")} id="protocol" data-cid="protocol.title">
            {content.protocol.eyebrow && <div className="site-eyebrow">{content.protocol.eyebrow}</div>}
            <Reveal from="bottom"><h2 className="site-section-title">{content.protocol.title}</h2></Reveal>
            <Reveal from="scale" delay={2}><CoEvolutionDiagram nodes={content.protocol.nodes} intro={content.protocol.intro} /></Reveal>
            {content.protocol.closing && <Reveal from="bottom" delay={3}><p className="site-protocol-closing">{content.protocol.closing}</p></Reveal>}
          </section>
        ) : null}

        {/* ── PRODUCTS BORN FROM EMERGENT INTERACTION (replaces standalone Jarvis) ── */}
        {content.productsBorn?.items?.length ? (
          <section className={reveal("site-section site-productsborn")} id="products-born" data-cid="productsBorn.title">
            {content.productsBorn.eyebrow && <div className="site-eyebrow">{content.productsBorn.eyebrow}</div>}
            <Reveal from="bottom"><h2 className="site-section-title">{content.productsBorn.title}</h2></Reveal>
            {content.productsBorn.intro && <Reveal from="bottom" delay={1}><p className="site-productsborn-intro">{content.productsBorn.intro}</p></Reveal>}
            <BornCarousel items={content.productsBorn.items} />
          </section>
        ) : null}

        {/* ── CATEGORIES / DRILL-DOWN BROWSER ──────────────────────────── */}
        {!hiddenSections.includes('categories') && (categories?.items?.length ?? 0) > 0 && (() => {
          // editMode: plain editable grid. Live: tier1 audiences -> tier2 that
          // audience's sessions (back + breadcrumb) -> tier3 detail modal.
          const browseCat = browseCatIdx != null ? categories.items[browseCatIdx] : null
          const browseSessions = browseCat
            ? (products?.items ?? []).filter(p => !browseCat.tab || p.category === browseCat.tab)
            : []
          return (
            <section className={reveal("site-section site-categories site-browser")} id="categories">
              {(editMode || browseCatIdx == null) ? (
                <>
                  {categories.eyebrow && <div className="site-eyebrow">{categories.eyebrow}</div>}
                  <E field="categories.title" value={categories.title} as="h2" className="site-section-title" />
                  <div className="site-cat-grid">
                    {categories.items.map((c, i) => (
                      <div
                        key={c.id}
                        className={`site-cat-card ${!editMode ? 'clickable' : ''}`}
                        {...(!editMode ? {
                          role: 'button',
                          tabIndex: 0,
                          onClick: () => setBrowseCatIdx(i),
                          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBrowseCatIdx(i) } },
                        } : {})}
                      >
                        <EImg field={`categories.items.${i}.image`} src={c.image} alt={c.name} className="site-cat-img" />
                        <div className="site-cat-overlay">
                          <E field={`categories.items.${i}.name`} value={c.name} as="div" className="site-cat-name" />
                          <E field={`categories.items.${i}.sub`} value={c.sub} as="div" className="site-cat-sub" />
                          {!editMode && <span className="site-cat-arrow" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="site-browser-header">
                    <button className="site-browser-back" onClick={() => setBrowseCatIdx(null)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                      {t.back}
                    </button>
                    <h2 className="site-browser-title">{browseCat?.name}</h2>
                    <nav className="site-browser-breadcrumb" aria-label="Breadcrumb">
                      <button onClick={() => setBrowseCatIdx(null)}>{categories.title}</button>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      <span>{browseCat?.name}</span>
                    </nav>
                  </div>
                  <div className="site-product-grid">
                    {browseSessions.map(p => (
                      <div key={p.id} className="site-pcard clickable" role="button" tabIndex={0}
                        onClick={() => setModalProduct(p)}
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModalProduct(p) } }}>
                        <div className="site-pcard-img">
                          {p.badge && <div className="site-pcard-badge">{p.badge}</div>}
                          {p.image ? <img src={p.image} alt={p.name} className="site-pcard-photo" /> : null}
                        </div>
                        <div className="site-pcard-body">
                          <div className="site-pcard-brand">{!editMode && <CategoryIcon category={p.category} />}{p.category}</div>
                          <div className="site-pcard-name" dangerouslySetInnerHTML={{ __html: p.name }} />
                          {(p.specs?.length ?? 0) > 0 && (
                            <div className="site-pcard-specs">{p.specs!.slice(0, 3).map((s, si) => <span key={si} className="site-spec">{s}</span>)}</div>
                          )}
                          <div className="site-pcard-desc" dangerouslySetInnerHTML={{ __html: p.description }} />
                          <div className="site-pcard-foot">
                            <div className="site-pcard-price" dangerouslySetInnerHTML={{ __html: p.price }} />
                            <a href={`mailto:${contact?.email ?? ''}`} className="site-pcard-cta" onClick={e => e.stopPropagation()}>{t.book}</a>
                          </div>
                        </div>
                      </div>
                    ))}
                    {browseSessions.length === 0 && <p className="site-browser-empty">-</p>}
                  </div>
                </>
              )}
            </section>
          )
        })()}

        {/* ── PRODUCTS ─────────────────────────────────────────────────── */}
        {!hiddenSections.includes('products') && (products?.items?.length ?? 0) > 0 && (
          <section className={reveal("site-section site-products")} id="products">
            <div className="site-products-top">
              <E field="products.title" value={products.title} as="h2" className="site-products-h2" />
              {!editMode && (products?.tabs?.length ?? 0) > 1 && (
                <div className="site-tabs">
                  {products.tabs.map((tab, ti) => (
                    <button
                      key={tab}
                      className={`site-tab-btn ${activeTab === tab || (activeTab === '' && ti === 0) ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab)}
                    >{tab}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="site-product-grid">
              {(editMode ? products.items : filteredProducts).map((p, i) => (
                <div
                  key={p.id}
                  className={`site-pcard ${!editMode ? 'clickable' : ''}`}
                  {...(!editMode ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => setModalProduct(p),
                    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModalProduct(p) } },
                  } : {})}
                >
                  <div className="site-pcard-img">
                    {p.badge && <div className="site-pcard-badge">{p.badge}</div>}
                    <EImg field={`products.items.${i}.image`} src={p.image} alt={p.name} className="site-pcard-photo" />
                  </div>
                  <div className="site-pcard-body">
                    <div className="site-pcard-brand">{!editMode && <CategoryIcon category={p.category} />}{p.category}</div>
                    <E field={`products.items.${i}.name`} value={p.name} as="div" className="site-pcard-name" />
                    {(p.specs?.length ?? 0) > 0 && (
                      <div className="site-pcard-specs">
                        {p.specs!.map((s, si) => <span key={si} className="site-spec">{s}</span>)}
                      </div>
                    )}
                    <E field={`products.items.${i}.description`} value={p.description} as="div" className="site-pcard-desc" />
                    <div className="site-pcard-foot">
                      <E field={`products.items.${i}.price`} value={p.price} as="div" className="site-pcard-price" />
                      <a href={`mailto:${contact?.email ?? ''}`} className="site-pcard-cta" onClick={e => e.stopPropagation()}>{t.book}</a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── USP ──────────────────────────────────────────────────────── */}
        {!hiddenSections.includes('usp') && (usp?.items?.length ?? 0) > 0 && (
          <section className={reveal("site-section site-section-alt site-usp")} id="usp">
            {usp.eyebrow && <div className="site-eyebrow">{usp.eyebrow}</div>}
            <E field="usp.title" value={usp.title} as="h2" className="site-section-title" />
            <div className="site-usp-pillars">
              {(usp.pillars ?? [{ id: '', title: '', subtitle: '' }]).map((pillar, pi) => {
                const groupItems = usp.items
                  .map((u, i) => ({ u, i }))
                  .filter(({ u }) => (usp.pillars ? u.pillar === pillar.id : true))
                if (groupItems.length === 0) return null
                return (
                  <div key={pillar.id || 'all'} className="site-usp-pillar">
                    {pillar.title && (
                      <div className="site-usp-pillar-head">
                        <span className="site-usp-pillar-index">{String(pi + 1).padStart(2, '0')}</span>
                        <div>
                          <h3 className="site-usp-pillar-title">{pillar.title}</h3>
                          <p className="site-usp-pillar-subtitle">{pillar.subtitle}</p>
                        </div>
                      </div>
                    )}
                    {editMode ? (
                      <div className="site-usp-grid">
                        {groupItems.map(({ u, i }, gi) => (
                          <Reveal key={u.id} from={gi % 2 === 1 ? 'right' : 'left'} delay={gi}>
                          <div className={`site-usp-card ${i % 2 === 1 ? 'accent' : ''}`}>
                            {u.icon && <div className="site-usp-icon"><UspIcon icon={u.icon} /></div>}
                            <E field={`usp.items.${i}.title`} value={u.title} as="h3" />
                            <E field={`usp.items.${i}.description`} value={u.description} as="p" />
                          </div>
                          </Reveal>
                        ))}
                      </div>
                    ) : (
                      // Carousel instead of a static grid - was a wall of
                      // side-by-side cards with uneven lengths ("karte links
                      // hat drei Sätze, karte rechts hat sieben") reading as
                      // messy; one card at a time sidesteps that entirely
                      // and doubles as the "let this be a carousel too" ask.
                      <GenericCarousel
                        wrapClassName="site-born-carousel site-usp-carousel"
                        items={groupItems}
                        getKey={({ u }) => u.id}
                        renderItem={({ u, i }) => (
                          <div className={`site-usp-card site-usp-card--carousel ${i % 2 === 1 ? 'accent' : ''}`}>
                            {u.icon && <div className="site-usp-icon"><UspIcon icon={u.icon} /></div>}
                            <h3 dangerouslySetInnerHTML={{ __html: u.title }} />
                            <p dangerouslySetInnerHTML={{ __html: u.description }} />
                          </div>
                        )}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── NEWS ─────────────────────────────────────────────────────── */}
        {!hiddenSections.includes('news') && (news?.items?.length ?? 0) > 0 && (
          <section className={reveal("site-section site-news")} id="news">
            {news.eyebrow && <div className="site-eyebrow">{news.eyebrow}</div>}
            <E field="news.title" value={news.title} as="h2" className="site-section-title" />
            {(news.categories?.length ?? 0) > 0 && (
              <div className="site-news-filters">
                <button
                  type="button"
                  className={`site-news-filter-chip ${activeNewsCategory === null ? 'active' : ''}`}
                  onClick={() => setActiveNewsCategory(null)}
                >
                  Alle
                </button>
                {news.categories!.map(c => (
                  <button
                    type="button"
                    key={c.id}
                    className={`site-news-filter-chip ${activeNewsCategory === c.id ? 'active' : ''}`}
                    onClick={() => setActiveNewsCategory(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <div className="site-news-grid">
              {news.items.map((n, i) => {
                if (activeNewsCategory && n.category !== activeNewsCategory) return null
                const catName = news.categories?.find(c => c.id === n.category)?.name
                // Real, shareable, bookmarkable per-article route (#p/blog/<id>,
                // see App.tsx's getRoute()/BlogPostPage.tsx) instead of the old
                // modal-only view — a plain <a> in view mode so it's a genuine
                // link (crawlable, ctrl/cmd-clickable, no JS required to work),
                // while edit mode keeps a non-navigating <div> so the canvas's
                // contentEditable fields below stay editable in place.
                const CardTag = (editMode ? 'div' : 'a') as TagName
                const cardProps: Record<string, unknown> = { className: `site-news-card ${!editMode ? 'clickable' : ''}` }
                if (!editMode) cardProps.href = `#p/blog/${n.id}`
                return (
                <CardTag key={n.id} {...cardProps}>
                  {n.image && <img src={n.image} alt={n.title} className="site-news-img" />}
                  <div className="site-news-body">
                    <div className="site-news-date">
                      {new Date(n.date).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}
                      {catName && <span className="site-news-cat-tag">{catName}</span>}
                    </div>
                    <E field={`news.items.${i}.title`} value={n.title} as="h3" className="site-news-title" />
                    <E field={`news.items.${i}.body`} value={n.body} as="p" className="site-news-text" />
                    {!editMode && <span className="site-news-read-more">{t.readMore} →</span>}
                  </div>
                </CardTag>
                )
              })}
            </div>
          </section>
        )}

        {/* ── PRICING ──────────────────────────────────────────────────── */}
        {pricing?.body && (
          <section className={reveal("site-section site-pricing")} id="pricing" data-cid="pricing.title">
            <h2 className="site-section-title">{pricing.title}</h2>
            <div className="site-pricing-body">
              {pricing.body.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>
        )}

        {/* WebHub offer ladder moved off the homepage into its own modal
            (see App.tsx / WebHubPricing.tsx) - opened via the "Pricing" nav
            link (#p/pricing), not rendered inline here anymore. */}

        {/* ── PAPERS ───────────────────────────────────────────────────── */}
        {(papers?.items?.length ?? 0) > 0 && (
          <section className={reveal("site-section site-papers")} id="papers">
            {papers!.eyebrow && <div className="site-eyebrow">{papers!.eyebrow}</div>}
            {papers!.title && <Reveal from="bottom"><h2 className="site-section-title">{papers!.title}</h2></Reveal>}
            {papers!.intro && <Reveal from="bottom" delay={1}><p className="site-protocol-intro">{papers!.intro}</p></Reveal>}
            <div className="site-cert-grid">
              {papers!.items.map((paper: PaperItem, i) => (
                <Reveal key={paper.id} from="bottom" delay={i + 2}>
                <div className="site-cert-card">
                  <div className="site-cert-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <line x1="10" y1="9" x2="8" y2="9"/>
                    </svg>
                  </div>
                  <div className="site-cert-info">
                    <strong className="site-cert-title">{paper.title}</strong>
                    <span className="site-cert-subtitle">{paper.description}</span>
                    <button type="button" className="site-about-proof-badge site-paper-read-btn" onClick={() => setActivePaper(paper)}>
                      {lang === 'de' ? 'Paper lesen' : 'Read the paper'}
                    </button>
                  </div>
                </div>
                </Reveal>
              ))}
            </div>
          </section>
        )}
        {activePaper && !editMode && <PdfViewerModal paper={activePaper} onClose={() => setActivePaper(null)} />}

        {/* ── CERTIFICATES ─────────────────────────────────────────────── */}
        {(certificates?.items?.length ?? 0) > 0 && (
          <section className={reveal("site-section site-certificates")} id="certificates">
            {certificates!.title && <Reveal from="bottom"><h2 className="site-section-title">{certificates!.title}</h2></Reveal>}
            <div className="site-cert-grid">
              {certificates!.items.map((cert: CertificateItem, i) => (
                <Reveal key={cert.id} from="bottom" delay={i + 1}>
                <div className="site-cert-card">
                  <div className="site-cert-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <circle cx="12" cy="14" r="3"/>
                      <path d="M9.5 17.5 9 20l3-1 3 1-.5-2.5"/>
                    </svg>
                  </div>
                  <div className="site-cert-info">
                    <strong className="site-cert-title">{cert.title}</strong>
                    {cert.subtitle && <span className="site-cert-subtitle">{cert.subtitle}</span>}
                  </div>
                </div>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {/* ── LOCATION / CONTACT ───────────────────────────────────────── */}
        {/* Moved below Pricing/WebHub/Certificates per feedback: contact
            belongs at the bottom of the page, after someone has seen what's
            on offer, not ahead of it. */}
        {!hiddenSections.includes('location') && (
        <section className={reveal("site-location")} id="location">
          {contact?.mapSrc && (
            <div className="site-map">
              <iframe src={contact.mapSrc} allowFullScreen loading="lazy" title="Standort" />
            </div>
          )}
          <div className="site-location-info">
            {contact?.photo && (
              <div className="site-contact-photo">
                <EImg field="contact.photo" src={contact.photo} alt="Niki" />
              </div>
            )}
            <Reveal from="bottom"><E field="contact.title" value={contact?.title ?? ''} as="h2" className="site-location-h2" /></Reveal>
            {contact?.subtitle && <Reveal from="bottom" delay={1}><E field="contact.subtitle" value={contact.subtitle} as="p" className="site-location-sub" /></Reveal>}
            <div className="site-cinfo-list">
              {contact?.phone && (
                <div className="site-cinfo-item">
                  <IconPhone />
                  <E field="contact.phone" value={contact.phone} as="a" href={`tel:${contact.phone}`} />
                </div>
              )}
              {contact?.email && (
                <div className="site-cinfo-item">
                  <IconMail />
                  <E field="contact.email" value={contact.email} as="a" href={`mailto:${contact.email}`} />
                </div>
              )}
              {contact?.address && (
                <div className="site-cinfo-item">
                  <IconLocation />
                  <E field="contact.address" value={contact.address} as="span" />
                </div>
              )}
            </div>
            {contact?.formEnabled && !editMode ? (
              <ContactForm email={contact?.email ?? ''} />
            ) : (
              <a href={`mailto:${contact?.email ?? ''}`} className="site-btn-lime-solid">{t.send}</a>
            )}
          </div>
        </section>
        )}

        {/* ── FOOTER ───────────────────────────────────────────────────── */}
        {/* ── MEMBER PORTAL / SSP CTA (optional section) ──────────────── */}
        {content.ssp?.title && (
          <section className="site-ssp-cta" id="ssp" data-cid="ssp.title">
            <div className="site-ssp-inner">
              {content.ssp.badge && <span className="site-ssp-badge" data-cid="ssp.badge">{content.ssp.badge}</span>}
              <h2 className="site-ssp-title" data-cid="ssp.title">{content.ssp.title}</h2>
              {content.ssp.sub && <p className="site-ssp-sub" data-cid="ssp.sub">{content.ssp.sub}</p>}
              {content.ssp.button && (
                <button className="site-btn-ssp" data-cid="ssp.button" onClick={() => {}}>
                  {content.ssp.button}
                </button>
              )}
            </div>
          </section>
        )}

        <footer className="site-footer">
          {meta?.wko_member && (
            <div className="site-footer-wko">
              <a href="https://www.wko.at" target="_blank" rel="noopener" title="WKO Mitglied - Wirtschaftskammer Osterreich" style={{ display: 'inline-block', opacity: 0.85 }}>
                <svg viewBox="0 0 420 100" width="168" height="40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="WKO - Wirtschaftskammer Osterreich" style={{ display: 'block' }}>
                  <rect x="0"   y="0" width="100" height="100" fill="#CC0000"/>
                  <text x="50"  y="78" fontFamily="Arial Black,sans-serif" fontSize="74" fontWeight="900" fill="#fff" textAnchor="middle">W</text>
                  <rect x="105" y="0" width="100" height="100" fill="#CC0000"/>
                  <text x="155" y="78" fontFamily="Arial Black,sans-serif" fontSize="74" fontWeight="900" fill="#fff" textAnchor="middle">K</text>
                  <rect x="210" y="0" width="100" height="100" fill="#CC0000"/>
                  <text x="260" y="78" fontFamily="Arial Black,sans-serif" fontSize="74" fontWeight="900" fill="#fff" textAnchor="middle">O</text>
                  <rect x="320" y="0"  width="100" height="33" fill="#CC0000"/>
                  <rect x="320" y="33" width="100" height="34" fill="#fff"/>
                  <rect x="320" y="67" width="100" height="33" fill="#CC0000"/>
                </svg>
              </a>
            </div>
          )}
          {(footer?.cols?.length ?? 0) > 0 && (
            <div className="site-footer-grid">
              <div className="site-footer-brand">
                {nav.logo && <img src={nav.logo} alt={footer?.brand} className="site-footer-logo" />}
                <E field="footer.brand" value={footer?.brand ?? ''} as="strong" className="site-footer-brand-name" />
                {footer?.description && <E field="footer.description" value={footer.description} as="p" className="site-footer-brand-desc" />}
              </div>
              {footer.cols.map((col, ci) => (
                <div key={ci} className="site-footer-col">
                  <h4>{col.title}</h4>
                  {col.links.map((l, li) => <a key={li} href={safeHref(l.href)}>{l.label}</a>)}
                </div>
              ))}
            </div>
          )}
          <div className="site-footer-bottom">
            <E field="footer.copyright" value={footer?.copyright ?? ''} as="span" />
            <div className="site-footer-links">
              {(footer?.links ?? []).map((l, i) => (
                <E key={i} field={`footer.links.${i}.label`} value={l.label} as="a" href={safeHref(l.href)} />
              ))}
            </div>
          </div>
        </footer>

        {/* ── SESSION DETAIL MODAL (tier 3) ────────────────────────────── */}
        {modalProduct && !editMode && (
          <div className="site-modal-scrim" onClick={() => setModalProduct(null)} role="dialog" aria-modal="true" aria-label={modalProduct.name}>
            <div className="site-modal" onClick={e => e.stopPropagation()}>
              <button className="site-modal-close" aria-label={t.close} onClick={() => setModalProduct(null)}><IconClose /></button>
              {(() => {
                const allImages = [modalProduct.image, ...(modalProduct.images ?? [])].filter(Boolean) as string[]
                const idx = Math.min(modalGalleryIdx, allImages.length - 1)
                return allImages.length > 0 ? (
                  <div className="site-modal-gallery">
                    <div className="site-modal-img"><img src={allImages[idx]} alt={modalProduct.name} /></div>
                    {allImages.length > 1 && (
                      <div className="site-modal-thumbs">
                        {allImages.map((src, gi) => (
                          <button key={gi} className={`site-modal-thumb ${idx === gi ? 'active' : ''}`} onClick={() => setModalGalleryIdx(gi)}>
                            <img src={src} alt="" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null
              })()}
              <div className="site-modal-body">
                {modalProduct.category && <div className="site-modal-brand">{modalProduct.category}</div>}
                <h3 className="site-modal-title" dangerouslySetInnerHTML={{ __html: modalProduct.name }} />
                {(modalProduct.specs?.length ?? 0) > 0 && (
                  <>
                    <div className="site-modal-label">{t.whatsIncluded}</div>
                    <div className="site-modal-specs">
                      {modalProduct.specs!.map((s, si) => <span key={si} className="site-spec">{s}</span>)}
                    </div>
                  </>
                )}
                <p className="site-modal-desc" dangerouslySetInnerHTML={{ __html: modalProduct.description }} />
                <div className="site-modal-foot">
                  <div className="site-modal-price" dangerouslySetInnerHTML={{ __html: modalProduct.price }} />
                  <a href={`mailto:${contact?.email ?? ''}?subject=${encodeURIComponent(`${t.mailSubject}`)}`} className="site-btn-lime-lg" onClick={() => setModalProduct(null)}>{t.bookTrial}</a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Published articles now live at their own #p/blog/<id> route (see
            App.tsx + BlogPostPage.tsx) instead of an in-page modal here. */}

        {/* ── WHATSAPP FLOAT ───────────────────────────────────────────── */}
        {whatsapp?.enabled && !editMode && (
          <WhatsAppButton number={whatsapp.number} message={whatsapp.message} />
        )}
      </div>
    </Ctx.Provider>
  )
}
