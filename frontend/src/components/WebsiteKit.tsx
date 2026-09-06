import { useState, useRef } from 'react'
import type { SiteContent, PageItem, SectionId } from '../types/content'
import type { AdminSection } from '../types/admin'
import { PublicSite } from './PublicSite'
import { InstitutionalSite } from './InstitutionalSite'

type PanelTab = 'pages' | 'contact' | 'archive'
type DeviceView = 'edit' | 'desktop' | 'tablet' | 'mobile'

// ── Device preview switch (Edit / Desktop / Tablet / Mobile) ──────────────────

function IconEdit() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
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

// Order + labels are honest about live effect now (see Task 5b report):
// Pages is fully live, Contact is partially live (see the note in that
// tab), Archiv is the former Hero/About/Style tabs plus the dead Contact
// sub-fields (WhatsApp/map/form) — none of it reaches the live site, but
// none of it is deleted either (Laura may have real typed content sitting
// in those fields already; see the banner on that tab).
const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'pages',   label: 'Pages' },
  { id: 'contact', label: 'Contact' },
  { id: 'archive', label: 'Archiv (nicht mehr live)' },
]

interface Props {
  draft: SiteContent
  onUpdate: (path: string, value: unknown) => void
  onImageClick: (field: string) => void
  uploading: boolean
  uploadTarget: string | null
  saving: boolean
  saved: boolean
  saveErr: boolean
  onSaveClick: () => void
  onNavigate: (s: AdminSection) => void
  onEditNews: (id: string) => void
}

/// The website builder — folded in as one sidebar app ("Website Kit") rather
/// than a separate top-level mode with its own topbar. Prop-drilling the
/// draft/update/upload handlers down from AdminPanel is acceptable for v1
/// (they're shared with Blog tab edits and Jarvis's get_content_section tool,
/// so they have to live at the AdminPanel level regardless).
export function WebsiteKit({ draft, onUpdate: update, onImageClick, uploading, uploadTarget, saving, saved, saveErr, onSaveClick, onNavigate, onEditNews }: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>('pages')
  const [device, setDevice] = useState<DeviceView>('desktop')
  const [editingPage, setEditingPage] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(380)
  const previewRef = useRef<HTMLDivElement>(null)

  const startPanelResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX, startW = panelWidth
    const onMove = (ev: MouseEvent) => setPanelWidth(Math.max(320, Math.min(640, startW + (startX - ev.clientX))))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.isContentEditable || target.closest('.editable-text')) return
    const el = target.closest('[data-cid]') as HTMLElement | null
    if (!el) return
    const cid = el.dataset.cid ?? ''
    // Canvas fields routed here are all in PublicSite (the retired editor
    // surface, out of scope for Task 5b) — hero/nav/meta/footer/whatsapp
    // now live under the Archiv tab, not their old dedicated tabs.
    if (cid.startsWith('hero.') || cid.startsWith('nav.') || cid.startsWith('meta.') || cid.startsWith('footer.') || cid.startsWith('whatsapp.')) {
      setActiveTab('archive')
    } else if (cid.startsWith('news.items.')) {
      const idx = parseInt(cid.split('.')[2])
      const item = draft.news?.items?.[idx]
      if (item) { onNavigate('blog'); onEditNews(item.id) }
    } else if (cid.startsWith('contact.')) {
      setActiveTab('contact')
    }
  }

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

  return (
    <div className="website-kit">
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

      <div className="builder-body">
        {/* LEFT: Canvas editor OR device preview */}
        {device === 'edit' ? (
          // Click-to-edit canvas — still PublicSite (the retired homepage
          // component), NOT the real live public component. InstitutionalSite
          // has no inline-edit affordances at all (no onTextChange/onImageClick/
          // onUpdate props, no data-cid click-routing) — it's plain
          // `{ route, content }` with everything but papers/news hardcoded
          // bilingual literals. Reimplementing click-to-edit against it would
          // be a real feature build, not a preview swap, so it's out of scope
          // here (see task-5a-report.md). The device-preview stage below is
          // the one that was actively lying about what visitors see, so that's
          // the one this task fixes.
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <div className="obs-warning-note" style={{ margin: '10px 14px 4px' }}>
              Diese Ansicht zeigt eine veraltete Vorschau und wirkt sich nicht auf die aktuelle Website aus. Nutze die Desktop/Tablet/Mobile-Vorschau oben für ein realistisches Bild.
            </div>
            <div className="builder-canvas-pane" ref={previewRef} onClick={handleCanvasClick}>
              <PublicSite
                content={draft}
                editMode={true}
                initPositions={{}}
                onTextChange={(field, value) => update(field, value)}
                onImageClick={onImageClick}
                onUpdate={(field, value) => update(field, value)}
              />
            </div>
          </div>
        ) : (
          <div className="builder-device-stage">
            <div className="device-frame-wrap">
              <div className={`device-frame device-${device}`}>
                {/* Read-only device preview — now renders the SAME component
                    App.tsx mounts for real visitors (InstitutionalSite), with
                    the same draft content, instead of the retired PublicSite.
                    'home' is the sane fixed route for this preview: it's the
                    actual landing page real visitors land on. Verified live:
                    InstitutionalSite's Home reads only two fields off the
                    whole SiteContent — content.papers?.items and
                    content.news?.items — neither shown on Home; everything
                    else on this panel (hero/about/style) is hardcoded
                    bilingual copy in InstitutionalSite itself, so edits there
                    correctly show NO visible change here. That's not a bug in
                    this swap — it's this task's whole point: the preview now
                    tells the truth about what those fields do on the real
                    site (nothing), instead of lying via the retired
                    PublicSite. See task-5a-report.md. */}
                <InstitutionalSite content={draft} route="home" />
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
          <div className="builder-tabs">
            {TABS.map(t => (
              <button key={t.id} className={`builder-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="builder-panel-body">
            {activeTab === 'contact' && (
              <>
                <PanelSection title="Kontaktdaten">
                  <div className="obs-provenance-note" style={{ marginBottom: 12 }}>
                    Wirkt sich auf Datenschutz/Impressum aus, nicht auf die Startseite.
                  </div>
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
              </>
            )}

            {activeTab === 'archive' && (
              <>
                <div className="obs-warning-note" style={{ margin: '10px 14px 4px' }}>
                  Diese Felder wirken sich nicht auf die aktuelle Website aus. Änderungen bitte per Code/PR. Nichts hier wird gelöscht — die Werte bleiben gespeichert.
                </div>
                <PanelSection title="Hintergrundbild">
                  <UploadRow src={draft.hero?.image ?? ''} onUpload={() => onImageClick('hero.image')} uploading={uploading && uploadTarget === 'hero.image'} />
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
                  <UploadRow src={draft.nav?.logo ?? ''} onUpload={() => onImageClick('nav.logo')} uploading={uploading && uploadTarget === 'nav.logo'} />
                </PanelSection>
                <PanelSection title="Telefon (Nav)">
                  <Field label="Nummer">
                    <input value={draft.nav?.phone ?? ''} onChange={e => update('nav.phone', e.target.value)} />
                  </Field>
                </PanelSection>
                <PanelSection title="About: Text">
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
                <PanelSection title="About: Photo">
                  <UploadRow
                    src={draft.about?.photo ?? ''}
                    onUpload={() => onImageClick('about.photo')}
                    uploading={uploading && uploadTarget === 'about.photo'}
                  />
                </PanelSection>
                <PanelSection title="About: Stats">
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
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sem-danger)', padding: '0 4px', fontSize: 18, lineHeight: 1 }}
                        onClick={() => update('about.stats', (draft.about?.stats ?? []).filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                  <button className="panel-add-big-btn" onClick={() => update('about.stats', [...(draft.about?.stats ?? []), { value: '', label: '' }])}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add stat
                  </button>
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
                <PanelSection title="Karte & Formular (Kontakt)">
                  <Field label="Titel (Kontaktblock)">
                    <input value={draft.contact?.title ?? ''} onChange={e => update('contact.title', e.target.value)} />
                  </Field>
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
                  <div className="obs-provenance-note" style={{ marginTop: -4, marginBottom: 12, fontSize: 11.5 }}>
                    Ausnahme: erscheint als sichtbarer Fußnotentext im Forschungs-Modal und dient zusätzlich als Browser-Tab-Titel-Fallback auf Unterseiten, Blog-Beiträgen und der Zertifizierungsseite — nicht auf der Startseite.
                  </div>
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
                        <div style={{ padding: '6px 10px', background: 'var(--panel-surface, #f0f7ff)', borderRadius: 6, fontSize: 12, color: 'var(--hud-cyan, #0099CC)', fontFamily: 'monospace' }}>
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
                        <div style={{ padding: '20px 16px', color: 'var(--panel-text-dim, #aaa)', fontSize: 13, textAlign: 'center' }}>
                          Noch keine Seiten. Klicke auf "+ Neue Seite".
                        </div>
                      )}
                      {(draft.pages ?? []).map(p => (
                        <div key={p.id} className="panel-product-row" onClick={() => setEditingPage(p.id)}>
                          <div style={{ flex: 1, padding: '8px 12px' }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{p.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--panel-text-dim, #888)', fontFamily: 'monospace' }}>#p/{p.slug}</div>
                          </div>
                          {p.showInNav && <span style={{ fontSize: 10, background: 'var(--panel-surface, #e8f4ff)', color: 'var(--hud-cyan, #0099CC)', borderRadius: 4, padding: '2px 6px', margin: '0 8px', fontWeight: 700 }}>NAV</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          <div className="builder-panel-foot">
            <button
              className={`builder-save-btn ${saving ? 'loading' : ''} ${saved ? 'done' : ''}`}
              onClick={onSaveClick}
              disabled={saving}
            >
              {saving ? 'Speichern…' : saved ? 'Gespeichert!' : 'Speichern'}
            </button>
            {saveErr && (
              <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--sem-danger)', color: '#fff', borderRadius: 10, padding: '12px 18px', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,.25)', zIndex: 9999, maxWidth: 320, lineHeight: 1.5 }}>
                Speichern fehlgeschlagen. Bitte versuche es erneut.
              </div>
            )}
          </div>
        </aside>
      </div>
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
