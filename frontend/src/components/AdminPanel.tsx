import { useState, useRef, useEffect } from 'react'
import type { SiteContent, NewsItem, PageItem, SectionId } from '../types/content'
import { PublicSite } from './PublicSite'
import { ResearchChat } from './ResearchChat'
import { API_BASE } from '../lib/apiBase'

interface Props {
  content: SiteContent
  saving: boolean
  onSave: (c: SiteContent) => Promise<boolean>
  onUpload: (f: File) => Promise<string | null>
  onLogout: () => void
}

type PanelTab = 'hero' | 'contact' | 'style' | 'pages' | 'about'
type AdminSection = 'inbox' | 'forschung' | 'blog' | 'analytics'

interface AnalyticsData {
  total_views: number
  unique_visitors: number
  views_by_day: { day: string; views: number }[]
  top_sources: { label: string; count: number }[]
  top_paths: { label: string; count: number }[]
}

interface ContactInboxItem { name: string; email: string; phone: string; message: string; ts: string }
function loadInbox(): ContactInboxItem[] { try { return JSON.parse(localStorage.getItem('rfi_contact_inbox') || '[]') } catch { return [] } }
type DeviceView = 'edit' | 'desktop' | 'tablet' | 'mobile'

// ── Device preview switch (Edit / Desktop / Tablet / Mobile) ──────────────────

function IconEdit() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
}
function IconDesktop() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
}
function IconTablet() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
}
function IconMobile() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
}

const DEVICE_OPTS: { id: DeviceView; label: string; icon: React.ReactNode }[] = [
  { id: 'edit', label: 'Bearbeiten', icon: <IconEdit /> },
  { id: 'desktop', label: 'Web', icon: <IconDesktop /> },
  { id: 'tablet', label: 'Tablet', icon: <IconTablet /> },
  { id: 'mobile', label: 'Mobil', icon: <IconMobile /> },
]

export function AdminPanel({ content, saving, onSave, onUpload, onLogout }: Props) {
  const [draft, setDraft] = useState<SiteContent>(content)
  const [activeTab, setActiveTab] = useState<PanelTab>('hero')
  const [adminMode, setAdminMode] = useState(false)
  const [adminSection, setAdminSection] = useState<AdminSection>('inbox')

  useEffect(() => { setDraft(content) }, [content])
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [editingNews, setEditingNews] = useState<string | null>(null)
  const [editingPage, setEditingPage] = useState<string | null>(null)
  const [contactInbox, setContactInbox] = useState<ContactInboxItem[]>(() => loadInbox())
  const [panelWidth, setPanelWidth] = useState(380)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  useEffect(() => {
    if (!(adminMode && adminSection === 'analytics')) return
    setAnalyticsLoading(true)
    fetch(`${API_BASE}/api/analytics`)
      .then(r => r.json())
      .then(d => { setAnalyticsData(d); setAnalyticsLoading(false) })
      .catch(() => setAnalyticsLoading(false))
  }, [adminMode, adminSection])
  const [device, setDevice] = useState<DeviceView>('edit')
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // drag-resize the right settings panel (380–620px)
  const startPanelResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX, startW = panelWidth
    const onMove = (ev: MouseEvent) => setPanelWidth(Math.max(320, Math.min(640, startW + (startX - ev.clientX))))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  // ── Init positions snapshot for canvas ────────────────────────────────────

  const [initPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    if (!previewRef.current) return {}
    return {}
  })

  // ── Canvas click → sidebar auto-navigate ─────────────────────────────────

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.isContentEditable || target.closest('.editable-text')) return
    const el = target.closest('[data-cid]') as HTMLElement | null
    if (!el) return
    const cid = el.dataset.cid ?? ''
    if (cid.startsWith('hero.') || cid.startsWith('nav.')) {
      setActiveTab('hero')
    } else if (cid.startsWith('news.items.')) {
      const idx = parseInt(cid.split('.')[2])
      const item = draft.news?.items?.[idx]
      if (item) { setAdminMode(true); setAdminSection('blog'); setEditingNews(item.id) }
    } else if (cid.startsWith('contact.') || cid.startsWith('whatsapp.')) {
      setActiveTab('contact')
    } else if (cid.startsWith('meta.') || cid.startsWith('footer.')) {
      setActiveTab('style')
    }
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  const update = (path: string, value: unknown) => {
    const keys = path.split('.')
    setDraft(prev => {
      const next = structuredClone(prev) as unknown as Record<string, unknown>
      let cur = next
      for (let i = 0; i < keys.length - 1; i++) {
        cur = cur[keys[i]] as Record<string, unknown>
      }
      cur[keys[keys.length - 1]] = value
      return next as unknown as SiteContent
    })
  }

  const handleSave = async () => {
    const ok = await onSave(draft)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else { setSaveErr(true); setTimeout(() => setSaveErr(false), 5000) }
  }

  const handleImageClick = (field: string) => {
    setUploadTarget(field)
    fileRef.current?.click()
  }

  // ── News helpers ──────────────────────────────────────────────────────────

  const addNews = () => {
    const id = `n${Date.now()}`
    const today = new Date().toISOString().split('T')[0]
    const tmpl = {
      title: 'Neuer Blogbeitrag',
      body: 'Schreib hier deine Beobachtung. Was ist in der Interaktion aufgefallen, welches Muster oder welche Verschiebung hast du bemerkt?',
    }
    const newItem: NewsItem = { id, date: today, title: tmpl.title, body: tmpl.body, image: '' }
    update('news.items', [...(draft.news?.items ?? []), newItem])
    setEditingNews(id)
  }

  const deleteNews = (id: string) => {
    update('news.items', draft.news.items.filter(n => n.id !== id))
    if (editingNews === id) setEditingNews(null)
  }

  const updateNews = (id: string, field: keyof NewsItem, value: string) => {
    update('news.items', draft.news.items.map(n => n.id === id ? { ...n, [field]: value } : n))
  }

  const handleFileChangeAll = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uploadTarget) return
    setUploading(true)
    const url = await onUpload(file)
    if (url) {
      if (uploadTarget.startsWith('news:')) {
        const nid = uploadTarget.replace('news:', '')
        updateNews(nid, 'image', url)
      } else {
        update(uploadTarget, url)
      }
    }
    setUploading(false)
    e.target.value = ''
    setUploadTarget(null)
  }

  const uploadNewsImage = async (id: string) => {
    setUploadTarget(`news:${id}`)
    fileRef.current?.click()
  }

  // ── Page helpers ──────────────────────────────────────────────────────────
  const addPage = () => {
    const id = `pg${Date.now()}`
    const newPage: PageItem = { id, title: 'Neue Seite', slug: `neue-seite-${id.slice(-4)}`, body: '<p>Seiteninhalt hier eingeben.</p>', showInNav: false }
    update('pages', [...(draft.pages ?? []), newPage])
    setEditingPage(id)
    setActiveTab('pages')
  }
  const deletePage = (id: string) => {
    update('pages', (draft.pages ?? []).filter(p => p.id !== id))
    if (editingPage === id) setEditingPage(null)
  }
  const updatePage = (id: string, field: keyof PageItem, value: unknown) => {
    update('pages', (draft.pages ?? []).map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  // ── Inbox helpers ─────────────────────────────────────────────────────────
  const dismissInboxItem = (ts: string) => {
    const next = contactInbox.filter(i => i.ts !== ts)
    setContactInbox(next)
    localStorage.setItem('rfi_contact_inbox', JSON.stringify(next))
  }

  const tabs: Array<{ id: PanelTab; label: string; badge?: number }> = [
    { id: 'hero',     label: 'Hero' },
    { id: 'about',    label: 'About' },
    { id: 'pages',    label: 'Pages' },
    { id: 'contact',  label: 'Contact' },
    { id: 'style',    label: 'Style' },
  ]

  const editingNewsItem = editingNews ? draft.news?.items?.find(n => n.id === editingNews) : null

  return (
    <div className="builder">
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChangeAll} />

      {/* ── TOPBAR ──────────────────────────────────────────────────────── */}
      <div className="builder-topbar">
        <div className="builder-brand">
          <span className="builder-brand-dot" />
          <strong>{draft.nav?.brand || 'My website'}</strong>
        </div>
        <div className="builder-device-switch" role="group" aria-label="Ansicht wählen">
          {DEVICE_OPTS.map(d => (
            <button
              key={d.id}
              type="button"
              className={`builder-device-btn ${device === d.id ? 'active' : ''}`}
              aria-pressed={device === d.id}
              title={d.id === 'edit' ? 'Canvas bearbeiten' : `${d.label}-Vorschau`}
              onClick={() => setDevice(d.id)}
            >
              {d.icon}
              {d.label}
            </button>
          ))}
        </div>
        <div className="builder-topbar-right">
          <button
            className="builder-btn-ghost"
            onClick={() => { setAdminMode(true); setAdminSection('forschung') }}
            title="Forschungsseite bearbeiten"
          >
            Forschung
          </button>
          <button
            className={`builder-btn-ghost ${adminMode ? 'active' : ''}`}
            onClick={() => setAdminMode(m => !m)}
            title="Verwaltung: Inbox, Forschung, Blog, Analytics"
            style={{ position: 'relative' }}
          >
            Verwaltung
            {contactInbox.length > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: '#e53e3e', color: '#fff', borderRadius: '50%', fontSize: 10, fontWeight: 700, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                {contactInbox.length}
              </span>
            )}
          </button>
          <a
            href={window.location.origin + window.location.pathname}
            target="_blank"
            rel="noopener noreferrer"
            className="builder-btn-ghost"
            title="Live-Seite in neuem Tab öffnen"
          >
            Live ansehen
          </a>
          <button
            className={`builder-save-btn-top ${saving ? 'loading' : ''} ${saved ? 'done' : ''} ${saveErr ? 'err' : ''}`}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Speichern…' : saved ? 'Gespeichert' : saveErr ? 'Fehler beim Speichern' : 'Speichern'}
          </button>
          {saveErr && (
            <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#c53030', color: '#fff', borderRadius: 10, padding: '12px 18px', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,.25)', zIndex: 9999, maxWidth: 320, lineHeight: 1.5 }}>
              Speichern fehlgeschlagen. Bitte prüfe, ob der GitHub-Token noch gültig ist.
            </div>
          )}
          <button className="builder-btn-ghost" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      {!adminMode && (
      <div className="builder-body">

        {/* LEFT: Canvas editor OR device preview */}
        {device === 'edit' ? (
          <div className="builder-canvas-pane" ref={previewRef} onClick={handleCanvasClick}>
            {/* 1:1 edit layer: the REAL public site, inline-editable (no separate
                draggable-box canvas). Click any text to edit, images to swap. */}
            <PublicSite
              content={draft}
              editMode={true}
              initPositions={initPositions}
              onTextChange={(field, value) => update(field, value)}
              onImageClick={handleImageClick}
              onUpdate={(field, value) => update(field, value)}
            />
          </div>
        ) : (
          <div className="builder-device-stage">
            <div className="device-frame-wrap">
              <div className={`device-frame device-${device}`}>
                <PublicSite content={draft} />
              </div>
              <div className="device-frame-label">
                {device === 'desktop' ? 'Web · 1280 px' : device === 'tablet' ? 'Tablet · 834 px' : 'Mobil · 390 px'}
              </div>
            </div>
          </div>
        )}

        {/* RIGHT: Panel (drag the left edge to resize) */}
        <aside className="builder-panel" style={{ width: panelWidth }}>
          <div className="builder-panel-resize" onMouseDown={startPanelResize} title="Breite ziehen" />
          {/* Tab bar */}
          <div className="builder-tabs">
            {tabs.map(t => (
              <button key={t.id} className={`builder-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)} style={{ position: 'relative' }}>
                {t.label}
                {(t.badge ?? 0) > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, background: '#c53030', color: '#fff', borderRadius: '50%', fontSize: 9, fontWeight: 700, minWidth: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px' }}>{t.badge}</span>
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="builder-panel-body">

            {/* ── HERO TAB ──────────────────────────────────────────────── */}
            {activeTab === 'hero' && (
              <>
                <PanelSection title="Hintergrundbild">
                  <UploadRow src={draft.hero?.image ?? ''} onUpload={() => handleImageClick('hero.image')} uploading={uploading && uploadTarget === 'hero.image'} />
                </PanelSection>
                <PanelSection title="Tag (oben)">
                  <Field label="Tag-Text">
                    <input value={draft.hero?.tag ?? ''} onChange={e => update('hero.tag', e.target.value)} placeholder="Direktimporteur · Graz · Österreich" />
                  </Field>
                </PanelSection>
                <PanelSection title="Überschrift">
                  <Field label="H1">
                    <input value={draft.hero?.headline ?? ''} onChange={e => update('hero.headline', e.target.value)} placeholder="Elektromobilität. Jetzt." />
                  </Field>
                  <Field label="Unterzeile">
                    <textarea rows={2} value={draft.hero?.subheadline ?? ''} onChange={e => update('hero.subheadline', e.target.value)} />
                  </Field>
                </PanelSection>
                <PanelSection title="Buttons">
                  <Field label="Button 1 Text">
                    <input value={draft.hero?.ctaLabel ?? ''} onChange={e => update('hero.ctaLabel', e.target.value)} />
                  </Field>
                  <Field label="Button 1 Link">
                    <input value={draft.hero?.ctaHref ?? ''} onChange={e => update('hero.ctaHref', e.target.value)} placeholder="#products" />
                  </Field>
                  <Field label="Button 2 Text">
                    <input value={draft.hero?.ctaSecLabel ?? ''} onChange={e => update('hero.ctaSecLabel', e.target.value)} placeholder="optional" />
                  </Field>
                </PanelSection>
                <PanelSection title="Logo">
                  <UploadRow src={draft.nav?.logo ?? ''} onUpload={() => handleImageClick('nav.logo')} uploading={uploading && uploadTarget === 'nav.logo'} />
                </PanelSection>
                <PanelSection title="Telefon (Nav)">
                  <Field label="Nummer">
                    <input value={draft.nav?.phone ?? ''} onChange={e => update('nav.phone', e.target.value)} />
                  </Field>
                </PanelSection>
              </>
            )}


            {/* ── CONTACT TAB ───────────────────────────────────────────── */}
            {activeTab === 'contact' && (
              <>
                <PanelSection title="Kontaktdaten">
                  <Field label="Titel">
                    <input value={draft.contact?.title ?? ''} onChange={e => update('contact.title', e.target.value)} />
                  </Field>
                  <Field label="E-Mail">
                    <input type="email" value={draft.contact?.email ?? ''} onChange={e => update('contact.email', e.target.value)} />
                  </Field>
                  <Field label="Telefon">
                    <input value={draft.contact?.phone ?? ''} onChange={e => update('contact.phone', e.target.value)} />
                  </Field>
                  <Field label="Adresse">
                    <textarea rows={2} value={draft.contact?.address ?? ''} onChange={e => update('contact.address', e.target.value)} />
                  </Field>
                </PanelSection>
                <PanelSection title="WhatsApp">
                  <Field label="Nummer (int. Format)">
                    <input value={draft.whatsapp?.number ?? ''} onChange={e => update('whatsapp.number', e.target.value)} placeholder="+436641234567" />
                  </Field>
                  <Field label="Vorausgefüllte Nachricht">
                    <textarea rows={2} value={draft.whatsapp?.message ?? ''} onChange={e => update('whatsapp.message', e.target.value)} />
                  </Field>
                  <Field label="">
                    <label className="panel-checkbox">
                      <input type="checkbox" checked={draft.whatsapp?.enabled ?? false} onChange={e => update('whatsapp.enabled', e.target.checked)} />
                      WhatsApp-Button anzeigen
                    </label>
                  </Field>
                </PanelSection>
                <PanelSection title="Karte">
                  <Field label="Google Maps Embed-URL">
                    <textarea rows={2} value={draft.contact?.mapSrc ?? ''} onChange={e => update('contact.mapSrc', e.target.value)} placeholder="https://maps.google.com/maps?q=…&output=embed" />
                  </Field>
                  <Field label="">
                    <label className="panel-checkbox">
                      <input type="checkbox" checked={draft.contact?.formEnabled ?? false} onChange={e => update('contact.formEnabled', e.target.checked)} />
                      Kontaktformular anzeigen
                    </label>
                  </Field>
                </PanelSection>
              </>
            )}

            {/* ── STYLE TAB ─────────────────────────────────────────────── */}
            {activeTab === 'style' && (
              <>
                <PanelSection title="Farben">
                  <ColorRow label="Primärfarbe" value={draft.meta?.primaryColor ?? '#0099CC'} onChange={v => update('meta.primaryColor', v)} />
                  <ColorRow label="Akzentfarbe" value={draft.meta?.accentColor ?? '#B3E600'} onChange={v => update('meta.accentColor', v)} />
                </PanelSection>
                <PanelSection title="Schrift">
                  <div className="panel-field">
                    <select value={draft.meta?.font ?? ''} onChange={e => update('meta.font', e.target.value)}>
                      <option value="system-ui, -apple-system, sans-serif">System Standard</option>
                      <option value="'Inter', sans-serif">Inter</option>
                      <option value="'Georgia', serif">Georgia</option>
                      <option value="'Roboto', sans-serif">Roboto</option>
                      <option value="'Helvetica Neue', Helvetica, sans-serif">Helvetica Neue</option>
                    </select>
                  </div>
                </PanelSection>
                <PanelSection title="Sektionen ein-/ausblenden">
                  {([
                    { id: 'trust' as SectionId, label: 'Vertrauensleiste' },
                    { id: 'categories' as SectionId, label: 'Kategorien' },
                    { id: 'products' as SectionId, label: 'Produkte' },
                    { id: 'usp' as SectionId, label: 'Vorteile (USPs)' },
                    { id: 'news' as SectionId, label: 'Blog / News' },
                    { id: 'location' as SectionId, label: 'Standort & Kontakt' },
                  ]).map(s => {
                    const hidden = (draft.hiddenSections ?? []).includes(s.id)
                    return (
                      <label key={s.id} className="panel-checkbox" style={{ justifyContent: 'space-between' }}>
                        <span>{s.label}</span>
                        <input
                          type="checkbox"
                          checked={!hidden}
                          onChange={e => {
                            const cur = draft.hiddenSections ?? []
                            update('hiddenSections', e.target.checked ? cur.filter(x => x !== s.id) : [...cur, s.id])
                          }}
                        />
                      </label>
                    )
                  })}
                </PanelSection>
                <PanelSection title="SEO / Meta">
                  <Field label="Seitentitel">
                    <input value={draft.meta?.title ?? ''} onChange={e => update('meta.title', e.target.value)} />
                  </Field>
                  <Field label="Beschreibung">
                    <textarea rows={2} value={draft.meta?.description ?? ''} onChange={e => update('meta.description', e.target.value)} />
                  </Field>
                </PanelSection>
                <PanelSection title="Footer">
                  <Field label="Copyright">
                    <input value={draft.footer?.copyright ?? ''} onChange={e => update('footer.copyright', e.target.value)} />
                  </Field>
                  <Field label="Tagline">
                    <input value={draft.footer?.tagline ?? ''} onChange={e => update('footer.tagline', e.target.value)} />
                  </Field>
                </PanelSection>
              </>
            )}

            {/* ── PAGES TAB ─────────────────────────────────────────────── */}
            {activeTab === 'pages' && (() => {
              const editingPageItem = editingPage ? (draft.pages ?? []).find(p => p.id === editingPage) : null
              return (
                <div className="panel-products">
                  <div style={{ padding: '8px 14px' }}>
                    <button className="panel-add-btn" onClick={addPage}>+ Neue Seite</button>
                  </div>
                  {editingPageItem ? (
                    <div className="panel-product-form" style={{ padding: 14 }}>
                      <button className="panel-back-btn" onClick={() => setEditingPage(null)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                        Zur Liste
                      </button>
                      <Field label="Titel">
                        <input value={editingPageItem.title} onChange={e => updatePage(editingPageItem.id, 'title', e.target.value)} />
                      </Field>
                      <Field label="URL (nach #p/)">
                        <input value={editingPageItem.slug} onChange={e => updatePage(editingPageItem.id, 'slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="meine-seite" />
                      </Field>
                      <Field label="">
                        <div style={{ padding: '6px 10px', background: '#f0f7ff', borderRadius: 6, fontSize: 12, color: '#0099CC', fontFamily: 'monospace' }}>
                          Link: <strong>#p/{editingPageItem.slug}</strong>
                        </div>
                      </Field>
                      <Field label="">
                        <label className="panel-checkbox">
                          <input type="checkbox" checked={editingPageItem.showInNav ?? false} onChange={e => updatePage(editingPageItem.id, 'showInNav', e.target.checked)} />
                          In Navigation anzeigen
                        </label>
                      </Field>
                      <Field label="Seiteninhalt">
                        <div className="rte-wrap">
                          <div className="rte-toolbar">
                            {[{ cmd: 'bold', label: 'B' }, { cmd: 'italic', label: 'I' }, { cmd: 'insertUnorderedList', label: '• Liste' }].map(({ cmd, label }) => (
                              <button key={cmd} type="button" onMouseDown={e => { e.preventDefault(); document.execCommand(cmd, false) }}>{label}</button>
                            ))}
                          </div>
                          <div
                            className="rte-body"
                            contentEditable
                            suppressContentEditableWarning
                            dangerouslySetInnerHTML={{ __html: editingPageItem.body }}
                            onBlur={e => updatePage(editingPageItem.id, 'body', e.currentTarget.innerHTML)}
                          />
                        </div>
                      </Field>
                      <button className="panel-delete-btn" style={{ marginTop: 12 }} onClick={() => deletePage(editingPageItem.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        Seite löschen
                      </button>
                    </div>
                  ) : (
                    <div className="panel-product-list">
                      {(draft.pages ?? []).length === 0 && (
                        <div style={{ padding: '20px 16px', color: '#aaa', fontSize: 13, textAlign: 'center' }}>
                          Noch keine Seiten. Klicke auf "+ Neue Seite".
                        </div>
                      )}
                      {(draft.pages ?? []).map(p => (
                        <div key={p.id} className="panel-product-row" onClick={() => setEditingPage(p.id)}>
                          <div style={{ flex: 1, padding: '8px 12px' }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{p.title}</div>
                            <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>#p/{p.slug}</div>
                          </div>
                          {p.showInNav && <span style={{ fontSize: 10, background: '#e8f4ff', color: '#0099CC', borderRadius: 4, padding: '2px 6px', margin: '0 8px', fontWeight: 700 }}>NAV</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}


            {/* ── ABOUT TAB ──────────────────────────────────────────────── */}
            {activeTab === 'about' && (
              <>
                <PanelSection title="Text">
                  <Field label="Eyebrow (small, top)">
                    <input value={draft.about?.eyebrow ?? ''} onChange={e => update('about.eyebrow', e.target.value)} placeholder="About us" />
                  </Field>
                  <Field label="Headline">
                    <input value={draft.about?.headline ?? ''} onChange={e => update('about.headline', e.target.value)} placeholder="Hello, we're..." />
                  </Field>
                  <Field label="Bio text">
                    <textarea rows={5} value={draft.about?.bio ?? ''} onChange={e => update('about.bio', e.target.value)} placeholder="A few warm sentences about who you are..." />
                  </Field>
                </PanelSection>
                <PanelSection title="Photo">
                  <UploadRow
                    src={draft.about?.photo ?? ''}
                    onUpload={() => handleImageClick('about.photo')}
                    uploading={uploading && uploadTarget === 'about.photo'}
                  />
                </PanelSection>
                <PanelSection title="Stats">
                  {(draft.about?.stats ?? []).map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input style={{ width: 80, flexShrink: 0 }} value={s.value} placeholder="10+" onChange={e => {
                        const stats = [...(draft.about?.stats ?? [])]
                        stats[i] = { ...stats[i], value: e.target.value }
                        update('about.stats', stats)
                      }} />
                      <input style={{ flex: 1 }} value={s.label} placeholder="years active" onChange={e => {
                        const stats = [...(draft.about?.stats ?? [])]
                        stats[i] = { ...stats[i], label: e.target.value }
                        update('about.stats', stats)
                      }} />
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d44', padding: '0 4px', fontSize: 18, lineHeight: 1 }}
                        onClick={() => update('about.stats', (draft.about?.stats ?? []).filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                  <button className="panel-add-big-btn" onClick={() => update('about.stats', [...(draft.about?.stats ?? []), { value: '', label: '' }])}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add stat
                  </button>
                </PanelSection>
              </>
            )}

          </div>

          {/* SAVE FOOTER */}
          <div className="builder-panel-foot">
            <button
              className={`builder-save-btn ${saving ? 'loading' : ''} ${saved ? 'done' : ''}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Speichern…' : saved ? 'Gespeichert!' : 'Speichern'}
            </button>
          </div>
        </aside>
      </div>
      )}

      {adminMode && (
        <div className="crm-layout">
          <aside className="crm-sidebar">
            <div className="crm-sidebar-brand">
              <span className="crm-sidebar-icon">E</span>
              <div>
                <div className="crm-sidebar-name">{draft.nav?.brand || 'Verwaltung'}</div>
                <div className="crm-sidebar-sub">Verwaltung</div>
              </div>
            </div>
            <nav className="crm-nav">
              <button className={`crm-nav-item ${adminSection === 'inbox' ? 'active' : ''}`} onClick={() => setAdminSection('inbox')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Inbox
                {contactInbox.length > 0 && <span className="crm-badge red">{contactInbox.length}</span>}
              </button>
              <button className={`crm-nav-item ${adminSection === 'forschung' ? 'active' : ''}`} onClick={() => setAdminSection('forschung')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                Forschung
              </button>
              <button className={`crm-nav-item ${adminSection === 'blog' ? 'active' : ''}`} onClick={() => setAdminSection('blog')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                Blog
              </button>
              <button className={`crm-nav-item ${adminSection === 'analytics' ? 'active' : ''}`} onClick={() => setAdminSection('analytics')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
                Analytics
              </button>
            </nav>
          </aside>

          <div className="crm-main">
            <div className="crm-topbar">
              <div className="crm-topbar-title">
                {adminSection === 'inbox' ? 'Inbox' : adminSection === 'forschung' ? 'Forschung' : adminSection === 'blog' ? 'Blog' : 'Analytics'}
              </div>
            </div>
            <div className="crm-body">
            {/* ── NEWS TAB ──────────────────────────────────────────────── */}
            {adminSection === 'blog' && (
              <div className="panel-products">
                <div className="panel-product-list">
                  {(draft.news?.items ?? []).map(n => (
                    <div key={n.id} className={`panel-product-row ${editingNews === n.id ? 'active' : ''}`} onClick={() => setEditingNews(n.id)}>
                      <div className="panel-product-info">
                        <div className="panel-product-name">{n.title}</div>
                        <div className="panel-product-meta">{n.date}</div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  ))}
                </div>
                <button className="panel-add-big-btn" onClick={addNews}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Blogbeitrag hinzufügen
                </button>
              </div>
            )}
            {/* ── INBOX TAB ─────────────────────────────────────────────── */}
            {adminSection === 'inbox' && (
              <div style={{ padding: 14 }}>
                {contactInbox.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
                    Keine neuen Anfragen.
                  </div>
                ) : (
                  contactInbox.map(item => (
                    <div key={item.ts} style={{ background: 'var(--panel-surface, #f8f8f8)', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid var(--panel-border, #e8e8e8)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                          <a href={`mailto:${item.email}`} style={{ fontSize: 12, color: '#0099CC' }}>{item.email}</a>
                          {item.phone && <div style={{ fontSize: 12, color: '#666' }}>{item.phone}</div>}
                        </div>
                        <div style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>{new Date(item.ts).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                      {item.message && <p style={{ fontSize: 12, margin: '8px 0 10px', color: '#444', lineHeight: 1.5 }}>{item.message}</p>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <a href={`mailto:${item.email}?subject=Re: Ihre Anfrage`} className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>Antworten</a>
                        <button className="panel-delete-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => dismissInboxItem(item.ts)}>Erledigt</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {/* ── ANALYTICS TAB ──────────────────────────────────────────── */}
            {adminSection === 'analytics' && (
              <div style={{ padding: 14 }}>
                {analyticsLoading && (
                  <div style={{ textAlign: 'center', color: '#aaa', padding: '40px 0', fontSize: 13 }}>Lade Daten…</div>
                )}
                {!analyticsLoading && !analyticsData && (
                  <div style={{ textAlign: 'center', color: '#aaa', padding: '40px 0', fontSize: 13 }}>Noch keine Besucher-Daten.</div>
                )}
                {analyticsData && (() => {
                  const maxDay = Math.max(...analyticsData.views_by_day.map(d => d.views), 1)
                  const maxSrc = Math.max(...analyticsData.top_sources.map(s => s.count), 1)
                  return (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                        <div style={{ background: 'var(--panel-surface,#f8f8f8)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--panel-border,#e8e8e8)', textAlign: 'center' }}>
                          <div style={{ fontSize: 28, fontWeight: 800, color: '#0099CC' }}>{analyticsData.total_views}</div>
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Seitenaufrufe (30 T.)</div>
                        </div>
                        <div style={{ background: 'var(--panel-surface,#f8f8f8)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--panel-border,#e8e8e8)', textAlign: 'center' }}>
                          <div style={{ fontSize: 28, fontWeight: 800, color: '#38A169' }}>{analyticsData.unique_visitors}</div>
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Unique Besucher (30 T.)</div>
                        </div>
                      </div>
                      {analyticsData.views_by_day.length > 0 && (
                        <div style={{ marginBottom: 18 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Letzte 14 Tage</div>
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
                            {analyticsData.views_by_day.map(d => (
                              <div key={d.day} title={`${d.day}: ${d.views}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}>
                                <div style={{ width: '100%', height: `${Math.max((d.views / maxDay) * 50, 2)}px`, background: '#0099CC', borderRadius: '3px 3px 0 0' }} />
                                <span style={{ fontSize: 7, color: '#aaa' }}>{d.day.slice(5)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {analyticsData.top_sources.length > 0 && (
                        <div style={{ marginBottom: 18 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quellen (30 T.)</div>
                          {analyticsData.top_sources.map(s => (
                            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                              <span style={{ width: 68, fontSize: 11, color: '#555', fontWeight: 500, flexShrink: 0 }}>{s.label}</span>
                              <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 4, height: 8 }}>
                                <div style={{ width: `${(s.count / maxSrc) * 100}%`, height: '100%', background: '#0099CC', borderRadius: 4 }} />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#0099CC', minWidth: 24, textAlign: 'right' }}>{s.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {analyticsData.top_paths.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Beliebteste Seiten</div>
                          {analyticsData.top_paths.map((p, i) => (
                            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                              <span style={{ width: 18, fontSize: 10, color: '#aaa', fontWeight: 700 }}>#{i + 1}</span>
                              <span style={{ flex: 1, fontSize: 11, color: '#444', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label || '/'}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#555', flexShrink: 0 }}>{p.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

              {adminSection === 'forschung' && <ResearchChat />}
            </div>
          </div>
        </div>
      )}

      {/* ── BLOG EDIT MODAL ────────────────────────────────────────────── */}
      {editingNewsItem && (
        <div className="pem-overlay" onClick={() => setEditingNews(null)}>
          <div className="pem" onClick={e => e.stopPropagation()}>
            <div className="pem-header">
              <span className="pem-title">Blogbeitrag bearbeiten</span>
              <button className="pem-close" onClick={() => setEditingNews(null)} title="Schließen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="pem-body">
              <div className="pem-img-area">
                {editingNewsItem.image
                  ? <img src={editingNewsItem.image} alt={editingNewsItem.title} className="pem-img" />
                  : <div className="pem-img-placeholder">Kein Bild</div>}
                <button className="pem-img-btn" onClick={() => uploadNewsImage(editingNewsItem.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Bild (optional)
                </button>
              </div>
              <div className="pem-fields">
                <div className="pem-row" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="pem-field">
                    <label>Datum</label>
                    <input type="date" value={editingNewsItem.date} onChange={e => updateNews(editingNewsItem.id, 'date', e.target.value)} />
                  </div>
                </div>
                <div className="pem-field">
                  <label>Titel</label>
                  <input value={editingNewsItem.title} onChange={e => updateNews(editingNewsItem.id, 'title', e.target.value)} />
                </div>
                <div className="pem-field">
                  <label>Text</label>
                  <textarea rows={6} value={editingNewsItem.body} onChange={e => updateNews(editingNewsItem.id, 'body', e.target.value)} />
                </div>
              </div>
            </div>
            <div className="pem-footer">
              <button className="panel-delete-btn" onClick={() => deleteNews(editingNewsItem.id)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Löschen
              </button>
              <div className="pem-footer-right">
                <button className="builder-save-btn-top done" onClick={() => setEditingNews(null)}>Fertig</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-section">
      {title && <div className="panel-section-title">{title}</div>}
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel-field">
      {label && <label>{label}</label>}
      {children}
    </div>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="panel-color-row">
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
      <span className="panel-color-label">{label}</span>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} className="panel-color-hex" />
    </div>
  )
}

function UploadRow({ src, onUpload, uploading }: { src: string; onUpload: () => void; uploading: boolean }) {
  return (
    <div className="panel-upload-row">
      {src && <img src={src} alt="" className="panel-upload-thumb" />}
      <button className="panel-upload-btn" onClick={onUpload} disabled={uploading}>
        {uploading ? 'Hochladen…' : src ? 'Ändern' : 'Hochladen'}
      </button>
    </div>
  )
}
