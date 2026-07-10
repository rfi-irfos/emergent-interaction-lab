import { useState, useRef, useEffect } from 'react'
import type { SiteContent, NewsItem } from '../types/content'
import { BlogCoWriter } from './BlogCoWriter'
import type { AdminSection } from '../types/admin'
import { WebsiteKit } from './WebsiteKit'
import { ResearchChat } from './ResearchChat'
import { AgentDock } from './AgentDock'
import { OBSERVATORY_MODULES, SECTION_LABELS, TIER_LABELS, groupByTier, type ObservatoryTier } from './observatory/registry'
import { Analytics } from './observatory/Analytics'
import { Monetization } from './observatory/Monetization'
import { BlogDrafts } from './observatory/BlogDrafts'
import { LiveCards } from './observatory/LiveCards'
import { SystemMap } from './observatory/SystemMap'
import { EmergenceMonitor } from './observatory/EmergenceMonitor'
import { SystemState } from './observatory/SystemState'
import { InteractionDynamics } from './observatory/InteractionDynamics'
import { InformationDynamics } from './observatory/InformationDynamics'
import { BehavioralLandscape } from './observatory/BehavioralLandscape'
import { AgentActivity } from './observatory/AgentActivity'
import { ResearchPulse } from './observatory/ResearchPulse'
import { SimulationCenter } from './observatory/SimulationCenter'
import { KnowledgeGraph } from './observatory/KnowledgeGraph'

interface Props {
  content: SiteContent
  saving: boolean
  onSave: (c: SiteContent) => Promise<boolean>
  onUpload: (f: File) => Promise<string | null>
  onLogout: () => void
}

interface ContactInboxItem { name: string; email: string; phone: string; message: string; ts: string }
function loadInbox(): ContactInboxItem[] { try { return JSON.parse(localStorage.getItem('rfi_contact_inbox') || '[]') } catch { return [] } }

function loadSidebarCollapsed(): boolean { try { return localStorage.getItem('rfi_sidebar_collapsed') === '1' } catch { return false } }

// Defaults to dark: the Observatory HUD look is the direction the whole
// shell is meant to read in, not an opt-in for one section only.
function loadCrmTheme(): 'light' | 'dark' {
  try { return (localStorage.getItem('rfi_crm_theme') as 'light' | 'dark') || 'dark' } catch { return 'dark' }
}

// ── Topbar icons (minimal shell: theme, view-live-site, logout) ─────────────
function IconLogout() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
}
function IconViewSite() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
}
function IconCollapse() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
}
function IconSun() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
}
function IconMoon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
}

/// The Verwaltung shell — collapsible sidebar + minimal topbar — is now the
/// single, permanent view of the admin panel. The old "Builder mode / Verwaltung
/// mode" dichotomy is gone: the website builder is "Website Kit," one more
/// sidebar app, not a separate top-level mode with its own topbar.
export function AdminPanel({ content, saving, onSave, onUpload, onLogout }: Props) {
  const [draft, setDraft] = useState<SiteContent>(content)
  const [adminSection, setAdminSection] = useState<AdminSection>('website-kit')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)
  const [crmTheme, setCrmTheme] = useState<'light' | 'dark'>(loadCrmTheme)

  const toggleCrmTheme = () => {
    setCrmTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      localStorage.setItem('rfi_crm_theme', next)
      return next
    })
  }

  useEffect(() => { setDraft(content) }, [content])
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [editingNews, setEditingNews] = useState<string | null>(null)
  const [contactInbox, setContactInbox] = useState<ContactInboxItem[]>(() => loadInbox())
  const [forschungRefresh, setForschungRefresh] = useState(0)
  const [openConversationId, setOpenConversationId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const toggleSidebar = () => {
    setSidebarCollapsed(c => {
      const next = !c
      localStorage.setItem('rfi_sidebar_collapsed', next ? '1' : '0')
      return next
    })
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

  const promoteBlogPostToSite = (title: string, body: string) => {
    const id = `n${Date.now()}`
    const today = new Date().toISOString().split('T')[0]
    const newItem: NewsItem = { id, date: today, title, body, image: '' }
    update('news.items', [...(draft.news?.items ?? []), newItem])
  }

  const deleteNews = (id: string) => {
    update('news.items', draft.news.items.filter(n => n.id !== id))
    if (editingNews === id) setEditingNews(null)
  }

  const updateNews = (id: string, field: keyof NewsItem, value: string) => {
    update('news.items', draft.news.items.map(n => n.id === id ? { ...n, [field]: value } : n))
  }

  // ── Blog categories (Themen) ────────────────────────────────────────────
  const [newCategoryName, setNewCategoryName] = useState('')
  const addCategory = () => {
    const name = newCategoryName.trim()
    if (!name) return
    const id = `cat${Date.now()}`
    update('news.categories', [...(draft.news?.categories ?? []), { id, name }])
    setNewCategoryName('')
  }
  const removeCategory = (id: string) => {
    update('news.categories', (draft.news?.categories ?? []).filter(c => c.id !== id))
    update('news.items', (draft.news?.items ?? []).map(n => n.category === id ? { ...n, category: undefined } : n))
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

  // ── Inbox helpers ─────────────────────────────────────────────────────────
  const dismissInboxItem = (ts: string) => {
    const next = contactInbox.filter(i => i.ts !== ts)
    setContactInbox(next)
    localStorage.setItem('rfi_contact_inbox', JSON.stringify(next))
  }

  const editingNewsItem = editingNews ? draft.news?.items?.find(n => n.id === editingNews) : null

  return (
    <div className="builder">
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChangeAll} />

      {/* ── MINIMAL TOPBAR ────────────────────────────────────────────────── */}
      <div className="builder-topbar builder-topbar-minimal">
        <div className="builder-brand">
          <span className="builder-brand-dot" />
          <strong>{draft.nav?.brand || 'My website'}</strong>
        </div>
        <div className="builder-topbar-right">
          <button className="topbar-icon-btn" onClick={toggleCrmTheme} title={crmTheme === 'dark' ? 'Helles Design' : 'Dunkles Design'}>
            {crmTheme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <a
            href={window.location.origin + window.location.pathname}
            target="_blank"
            rel="noopener noreferrer"
            className="topbar-icon-btn"
            title="Live-Seite ansehen"
          >
            <IconViewSite />
          </a>
          <button className="topbar-icon-btn topbar-icon-btn-danger" onClick={onLogout} title="Logout">
            <IconLogout />
          </button>
        </div>
      </div>

      {/* ── BODY: one permanent shell, no more Builder/Verwaltung mode split ── */}
      <div className="crm-layout">
        <aside className={`crm-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="crm-sidebar-brand">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="crm-sidebar-icon" />
            {!sidebarCollapsed && (
              <div className="crm-sidebar-brand-text">
                <div className="crm-sidebar-name">{draft.nav?.brand || 'Verwaltung'}</div>
                <div className="crm-sidebar-sub">Verwaltung</div>
              </div>
            )}
            <button className="crm-sidebar-collapse-icon-btn" onClick={toggleSidebar} title={sidebarCollapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}>
              <span style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', display: 'inline-flex' }}><IconCollapse /></span>
            </button>
          </div>
          <nav className="crm-nav">
            {!sidebarCollapsed && <div className="crm-nav-group-label">Verwaltung</div>}
            <button className={`crm-nav-item ${adminSection === 'website-kit' ? 'active' : ''}`} onClick={() => setAdminSection('website-kit')} title="Website Kit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              {!sidebarCollapsed && 'Website Kit'}
            </button>
            <button className={`crm-nav-item ${adminSection === 'inbox' ? 'active' : ''}`} onClick={() => setAdminSection('inbox')} title="Inbox">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              {!sidebarCollapsed && 'Inbox'}
              {contactInbox.length > 0 && <span className="crm-badge red">{contactInbox.length}</span>}
            </button>
            <button className={`crm-nav-item ${adminSection === 'forschung' ? 'active' : ''}`} onClick={() => setAdminSection('forschung')} title="Forschung">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {!sidebarCollapsed && 'Forschung'}
            </button>
            <button className={`crm-nav-item ${adminSection === 'blog' ? 'active' : ''}`} onClick={() => setAdminSection('blog')} title="Blog">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              {!sidebarCollapsed && 'Blog'}
            </button>
            <button className={`crm-nav-item ${adminSection === 'analytics' ? 'active' : ''}`} onClick={() => setAdminSection('analytics')} title="Analytics">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
              {!sidebarCollapsed && 'Analytics'}
            </button>
            <button className={`crm-nav-item ${adminSection === 'monetization' ? 'active' : ''}`} onClick={() => setAdminSection('monetization')} title="Monetarisierung">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              {!sidebarCollapsed && 'Monetarisierung'}
            </button>

            {!sidebarCollapsed && <div className="crm-nav-group-label">Observatory</div>}
            {(['research', 'system', 'technical'] as ObservatoryTier[]).map(tier => (
              <div key={tier}>
                {!sidebarCollapsed && <div className="crm-nav-group-label crm-nav-group-label--tier">{TIER_LABELS[tier]}</div>}
                {groupByTier()[tier].map(mod => (
                  <button key={mod.id} className={`crm-nav-item ${adminSection === mod.id ? 'active' : ''}`} onClick={() => setAdminSection(mod.id)} title={mod.label}>
                    {mod.icon}
                    {!sidebarCollapsed && mod.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className={`crm-main ${(crmTheme === 'dark' || OBSERVATORY_MODULES.some(m => m.id === adminSection)) ? 'observatory-hud' : ''}`}>
          <div className="crm-topbar">
            <div className="crm-topbar-title">{SECTION_LABELS[adminSection]}</div>
          </div>
          <div className="crm-body">
            {adminSection === 'website-kit' && (
              <WebsiteKit
                draft={draft}
                onUpdate={update}
                onImageClick={handleImageClick}
                uploading={uploading}
                uploadTarget={uploadTarget}
                saving={saving}
                saved={saved}
                saveErr={saveErr}
                onSaveClick={handleSave}
                onNavigate={setAdminSection}
                onEditNews={setEditingNews}
              />
            )}

            {/* ── BLOG TAB ──────────────────────────────────────────────── */}
            {adminSection === 'blog' && (
              <div className="panel-products">
                {/* Two entirely separate data models live in this tab and used
                    to look like one system: this section edits draft.news.items
                    (the manually-managed public news list), while "Jarvis-
                    Entwürfe" further down is the blog_posts table Jarvis writes
                    to via draft_blog_post/revise_blog_post. Labelled + boxed
                    off below so it's clear which button touches which data. */}
                <div className="obs-section-label">Manuell · Themen</div>
                <div className="pem-tags" style={{ marginBottom: 10 }}>
                  {(draft.news?.categories ?? []).map(c => (
                    <span className="pem-tag" key={c.id}>
                      {c.name}
                      <button type="button" onClick={() => removeCategory(c.id)} title="Thema löschen">×</button>
                    </span>
                  ))}
                  {(draft.news?.categories ?? []).length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--panel-text-dim, #aaa)' }}>Noch keine Themen — leg mindestens eines an, um Blogposts zu kategorisieren.</span>
                  )}
                </div>
                <div className="pem-tag-input-row" style={{ marginBottom: 22, maxWidth: 360 }}>
                  <input
                    placeholder="Neues Thema, z.B. Emergenz"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }}
                  />
                  <button className="pem-tag-add" onClick={addCategory} type="button">+</button>
                </div>
                <div className="panel-product-list">
                  {(draft.news?.items ?? []).map(n => (
                    <div key={n.id} className={`panel-product-row ${editingNews === n.id ? 'active' : ''}`} onClick={() => setEditingNews(n.id)}>
                      <div className="panel-product-info">
                        <div className="panel-product-name">{n.title}</div>
                        <div className="panel-product-meta">
                          {n.date}
                          {n.category && (draft.news?.categories ?? []).find(c => c.id === n.category) && (
                            <> · {(draft.news?.categories ?? []).find(c => c.id === n.category)?.name}</>
                          )}
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  ))}
                </div>
                <button className="panel-add-big-btn" onClick={addNews}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Blogbeitrag hinzufügen (manuell)
                </button>
                <div className="obs-section blog-jarvis-section">
                  <div className="obs-section-label">🤖 Von Jarvis generiert</div>
                  <BlogDrafts
                    onPromoteToSite={promoteBlogPostToSite}
                    onOpenConversation={(id) => { setOpenConversationId(id); setAdminSection('forschung') }}
                  />
                </div>
              </div>
            )}

            {/* ── INBOX TAB ─────────────────────────────────────────────── */}
            {adminSection === 'inbox' && (
              <div style={{ padding: 14 }}>
                {contactInbox.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--panel-text-dim, #aaa)', fontSize: 13 }}>
                    Keine neuen Anfragen.
                  </div>
                ) : (
                  contactInbox.map(item => (
                    <div key={item.ts} style={{ background: 'var(--panel-surface, #f8f8f8)', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid var(--panel-border, #e8e8e8)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                          <a href={`mailto:${item.email}`} style={{ fontSize: 12, color: 'var(--hud-cyan, #0099CC)' }}>{item.email}</a>
                          {item.phone && <div style={{ fontSize: 12, color: 'var(--panel-text-dim, #666)' }}>{item.phone}</div>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--panel-text-dim, #aaa)', whiteSpace: 'nowrap' }}>{new Date(item.ts).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                      {item.message && <p style={{ fontSize: 12, margin: '8px 0 10px', color: 'var(--panel-text, #444)', lineHeight: 1.5 }}>{item.message}</p>}
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
            {adminSection === 'analytics' && <Analytics />}

            {/* ── MONETIZATION TAB ───────────────────────────────────────── */}
            {adminSection === 'monetization' && <Monetization />}

            {adminSection === 'forschung' && (
              <div className="forschung-view">
                <LiveCards refreshSignal={forschungRefresh} onNavigate={setAdminSection} />
                <ResearchChat
                  siteContent={draft}
                  onMessageComplete={() => setForschungRefresh(n => n + 1)}
                  openConversationId={openConversationId}
                  onOpenConversationHandled={() => setOpenConversationId(null)}
                  onUpdate={update}
                />
              </div>
            )}

            {/* ── OBSERVATORY MODULES ──────────────────────────────────── */}
            {adminSection === 'systemmap' && (
              <SystemMap onOpenConversation={(id) => { setOpenConversationId(id); setAdminSection('forschung') }} />
            )}
            {adminSection === 'emergence' && (
              <EmergenceMonitor onOpenConversation={(id) => { setOpenConversationId(id); setAdminSection('forschung') }} />
            )}
            {adminSection === 'systemstate' && <SystemState />}
            {adminSection === 'agentactivity' && <AgentActivity />}
            {adminSection === 'interaction' && <InteractionDynamics />}
            {adminSection === 'information' && <InformationDynamics />}
            {adminSection === 'behavior' && (
              <BehavioralLandscape onOpenConversation={(id) => { setOpenConversationId(id); setAdminSection('forschung') }} />
            )}
            {adminSection === 'research' && (
              <ResearchPulse
                onNavigate={setAdminSection}
                onOpenConversation={(id) => { setOpenConversationId(id); setAdminSection('forschung') }}
              />
            )}
            {adminSection === 'simulationcenter' && <SimulationCenter />}
            {adminSection === 'knowledgegraph' && (
              <KnowledgeGraph onOpenConversation={(id) => { setOpenConversationId(id); setAdminSection('forschung') }} />
            )}
          </div>
        </div>
        <AgentDock onJumpToForschung={() => setAdminSection('forschung')} />
      </div>

      {/* ── BLOG EDIT MODAL ────────────────────────────────────────────── */}
      {editingNewsItem && (
        <div className={`pem-overlay ${crmTheme === 'dark' ? 'observatory-hud' : ''}`} onClick={() => setEditingNews(null)}>
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
                  <label>Thema</label>
                  <select value={editingNewsItem.category ?? ''} onChange={e => updateNews(editingNewsItem.id, 'category', e.target.value)}>
                    <option value="">Kein Thema</option>
                    {(draft.news?.categories ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="pem-field">
                  <label>Titel</label>
                  <input value={editingNewsItem.title} onChange={e => updateNews(editingNewsItem.id, 'title', e.target.value)} />
                </div>
                <div className="pem-field">
                  <label>Text</label>
                  <textarea rows={6} value={editingNewsItem.body} onChange={e => updateNews(editingNewsItem.id, 'body', e.target.value)} />
                </div>
                <BlogCoWriter
                  title={editingNewsItem.title}
                  body={editingNewsItem.body}
                  siteContent={draft}
                  onApplyTitle={(t) => updateNews(editingNewsItem.id, 'title', t)}
                  onApplyBody={(b) => updateNews(editingNewsItem.id, 'body', b)}
                />
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
