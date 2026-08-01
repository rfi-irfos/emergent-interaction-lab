import { useEffect, useState } from 'react'
import { adminFetch, useAdminFetch } from '../../lib/adminApi'
import { parseServerTimestamp } from '../../lib/dateGroups'
import { hudStagger } from '../../lib/hudStagger'
import { ExportButtons } from './ExportButtons'
import { HudGrid, HudTile, HudStat, HudSectionHeader, useHeaderActions, HudHeaderActions } from './Hud'
import { HudSkeleton } from './HudSkeleton'
import { ObsDonut } from './ObsDonut'

// Same 7d/30d/all vocabulary as Behavioral Landscape/System State/
// Interaction Dynamics' range selectors, but purely client-side — see the
// filter comment below the orders list for why this one can't be a real
// backend `?range=` param the way those are.
const ORDER_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: 'Letzte 7 Tage' },
  { value: '30d', label: 'Letzte 30 Tage' },
  { value: 'all', label: 'Alle' },
]

function withinOrderRange(createdAt: string, range: string): boolean {
  if (range === 'all') return true
  const days = range === '7d' ? 7 : 30
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000
  return parseServerTimestamp(createdAt).getTime() >= cutoffMs
}

interface ProductOut {
  id: string
  name: string
  description: string
  price_cents: number
  currency: string
  mode: string
  recurring_interval: string | null
  stripe_product_id: string | null
  stripe_price_id: string | null
  payment_link_url: string | null
  created_at: string
  /// 'service' | 'certification' — see backend/src/billing.rs's category
  /// column comment. Determines which public storefront (CertificationPage
  /// vs the main site's WebHub pricing section) shows this product.
  category: string
}

// Mirrors backend/src/billing.rs's OrderOut — one row per real, verified
// `checkout.session.completed` Stripe webhook event (see
// billing::stripe_webhook). `customer_email` carries the same sensitivity as
// contact_messages.email: admin-only, never rendered anywhere outside this
// authenticated view.
interface OrderOut {
  id: string
  stripe_event_id: string
  stripe_session_id: string
  product_id: string | null
  product_name: string | null
  amount_cents: number
  currency: string
  customer_email: string | null
  created_at: string
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

// Backend default page size for GET /api/billing/orders (see
// billing.rs::DEFAULT_ORDERS_LIMIT) — kept in sync here the same way
// EmergenceMonitor.tsx's PAGE_SIZE mirrors emergence.rs's own default.
const ORDERS_PAGE_SIZE = 50

/// Verwaltung's business-model view, not an Observatory concern — a generic
/// "define something sellable, get a real Stripe Payment Link" mechanism,
/// the shared foundation behind the framework-license, research-report, and
/// certification revenue streams (see lauras_business/ for the full plan).
/// Deliberately generic: this component knows nothing about which specific
/// products get sold, only how to create and price one.
export function Monetization() {
  const { data, loading, error } = useAdminFetch<ProductOut[]>('/api/billing/products')
  const [products, setProducts] = useState<ProductOut[] | null>(null)
  const list = products ?? data ?? []

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('eur')
  const [mode, setMode] = useState<'payment' | 'subscription'>('payment')
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  const [category, setCategory] = useState<'service' | 'certification'>('service')
  const [existingLink, setExistingLink] = useState('')
  const [creating, setCreating] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [showProductForm, setShowProductForm] = useState(false)

  const refresh = async () => {
    const res = await adminFetch(`/api/billing/products`, {})
    if (res.ok) setProducts(await res.json())
  }

  const createProduct = async () => {
    const cents = Math.round(parseFloat(price) * 100)
    if (!name.trim() || !price.trim() || Number.isNaN(cents) || cents <= 0) {
      setFormError('Name und ein positiver Preis sind erforderlich.')
      return
    }
    setFormError(null)
    setCreating(true)
    try {
      const res = await adminFetch(`/api/billing/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          price_cents: cents,
          currency,
          mode,
          recurring_interval: mode === 'subscription' ? interval : null,
          category,
          payment_link_url: existingLink.trim() || null,
        }),
      })
      if (!res.ok) {
        setFormError('Produkt konnte nicht angelegt werden.')
        return
      }
      await refresh()
      setName(''); setDescription(''); setPrice(''); setExistingLink('')
    } finally {
      setCreating(false)
    }
  }

  const createPaymentLink = async (id: string) => {
    setLinkingId(id)
    try {
      const res = await adminFetch(`/api/billing/products/${id}/payment-link`, {
        method: 'POST',
      })
      if (!res.ok) {
        setFormError('Zahlungslink konnte nicht erstellt werden — die Stripe-Anbindung ist vermutlich nicht eingerichtet. Bitte bei der technischen Betreuung melden.')
        return
      }
      await refresh()
    } finally {
      setLinkingId(null)
    }
  }

  // Same window.confirm pattern as BlogDrafts.tsx / SimulationLab.tsx / the
  // research notes panel: the backend does an unconditional hard delete of
  // the local row (no soft-delete, no status guard — see
  // backend/src/billing.rs::delete_product), and there was nothing at all in
  // front of it here. Deleting only removes the local record; an
  // already-created Stripe payment link stays live until deactivated at
  // Stripe directly (see the note below the product list) — the confirm
  // copy says so explicitly since that's easy to assume otherwise.
  const deleteProduct = async (id: string, name: string) => {
    if (!window.confirm(`„${name}" endgültig löschen?\n\nDas entfernt nur den lokalen Eintrag - ein bereits erstellter Zahlungslink bleibt bei Stripe aktiv, bis er dort separat deaktiviert wird. Das kann hier nicht rückgängig gemacht werden.`)) return
    await adminFetch(`/api/billing/products/${id}`, { method: 'DELETE' })
    await refresh()
  }

  // Real sales/orders visibility (see backend/src/billing.rs::stripe_webhook
  // + list_orders): before this, a completed Stripe purchase left zero
  // trace anywhere in this admin panel — payment links existed, but nobody
  // could see whether one had actually been paid. Same
  // accumulated-set-plus-total pagination shape as EmergenceMonitor.tsx's
  // signals list: `orders` grows via "Weitere laden", `ordersTotal` is the
  // true count from the X-Total-Count header, not just what's loaded so far.
  const [orders, setOrders] = useState<OrderOut[]>([])
  const [ordersTotal, setOrdersTotal] = useState<number | null>(null)
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false)
  const [ordersError, setOrdersError] = useState(false)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  const loadOrders = async (offset: number, append: boolean) => {
    if (append) setOrdersLoadingMore(true); else setOrdersLoading(true)
    setOrdersError(false)
    try {
      const params = new URLSearchParams({ limit: String(ORDERS_PAGE_SIZE), offset: String(offset) })
      const res = await adminFetch(`/api/billing/orders?${params}`, {})
      if (!res.ok) throw new Error(String(res.status))
      const totalHeader = res.headers.get('X-Total-Count')
      const page: OrderOut[] = await res.json()
      setOrders(prev => (append ? [...prev, ...page] : page))
      setOrdersTotal(totalHeader !== null ? Number(totalHeader) : null)
    } catch {
      setOrdersError(true)
    } finally {
      setOrdersLoading(false)
      setOrdersLoadingMore(false)
    }
  }

  useEffect(() => {
    loadOrders(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadMoreOrders = () => loadOrders(orders.length, true)

  // Client-side, matching BlogDrafts/Inbox's own filter pattern: billing.rs
  // (backend/src/billing.rs::list_orders) is deliberately untouched by this
  // change — no `?currency=`/`?range=` query param exists there — so this
  // narrows whatever page(s) of `orders` "Weitere laden" has already
  // accumulated, the same "currently loaded, not currently existing" scope
  // BlogDrafts/Inbox's own client-side filters have. `OrderOut` has no
  // status field (every row is already a completed, verified Stripe
  // webhook event — see the interface comment above), so currency + date
  // range are the two meaningful narrowing axes here, not status.
  const [orderCurrencyFilter, setOrderCurrencyFilter] = useState('')
  const [orderRange, setOrderRange] = useState('all')
  const orderCurrencies = Array.from(new Set(orders.map(o => o.currency))).sort()
  const filteredOrders = orders.filter(o =>
    (!orderCurrencyFilter || o.currency === orderCurrencyFilter) && withinOrderRange(o.created_at, orderRange)
  )

  const totalRevenueByCurrency = filteredOrders.reduce<Record<string, number>>((acc, o) => {
    acc[o.currency] = (acc[o.currency] ?? 0) + o.amount_cents
    return acc
  }, {})

  // Revenue-by-product donut — client-aggregated, same as
  // totalRevenueByCurrency above: billing.rs (list_orders) is deliberately
  // untouched, no `GROUP BY product_name` exists there, so this is built
  // from `filteredOrders` (the same already-loaded, currency/range-narrowed
  // set the stat tiles above already use — keeping the donut in sync with
  // whatever the two selectors above it currently show, rather than a
  // second, differently-scoped aggregate). Cents are only safely additive
  // within ONE currency (a EUR-cent isn't a USD-cent) — filtering to a
  // single currency above makes this exact; left on "Alle Währungen" with
  // genuinely mixed currencies present, the values are still summed (each
  // slice is one product, not a blended grand total) but the caption below
  // says so explicitly and drops the currency symbol rather than asserting
  // a false single-currency total.
  const revenueByProduct = filteredOrders.reduce<Record<string, number>>((acc, o) => {
    const key = o.product_name ?? 'Unbekanntes Produkt'
    acc[key] = (acc[key] ?? 0) + o.amount_cents
    return acc
  }, {})
  const revenueCurrencies = Array.from(new Set(filteredOrders.map(o => o.currency)))
  const revenueCurrency = revenueCurrencies.length === 1 ? revenueCurrencies[0] : null

  useHeaderActions(
    orders.length > 0 ? (
      <HudHeaderActions
        filters={
          <>
            <select value={orderCurrencyFilter} onChange={e => setOrderCurrencyFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
              <option value="">Alle Währungen</option>
              {orderCurrencies.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
            <select value={orderRange} onChange={e => setOrderRange(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
              {ORDER_RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </>
        }
        action={
          <ExportButtons
            rows={filteredOrders.map(o => ({ ...o }))}
            filenameBase={`billing-orders-${orderRange}`}
            title="Bestellungen"
          />
        }
      />
    ) : null,
    [orders, orderCurrencyFilter, orderRange, filteredOrders],
  )

  return (
    <div className="obs-panel monetization">
      {/* Real sales, not just the mechanism to sell — every row here comes
          from a verified Stripe webhook event (checkout.session.completed),
          never a manual entry. Same "Übersicht" + accumulated-list pattern
          as EmergenceMonitor.tsx. Moved above product management: revenue
          visibility is the thing worth seeing first on open, product CRUD
          is comparatively rare admin housekeeping. Filter/range/export now
          live in the shared page header (useHeaderActions) — this label is
          just the in-page section marker. */}
      <HudSectionHeader title="Bestellungen" sub="Echte, verifizierte Stripe-Zahlungen — keine manuellen Einträge." />
      {/* Order KPIs + product KPIs together at the top — Simeon's 2026-07-25
          layout call: "Bestellungen und Produkte" as one KPI block first,
          then revenue-per-product + latest order, then the (scroll-capped)
          product table. The product tiles keep their meaningful mapping
          (total = info, has link = success, missing link = warning).
          Shared HudTile/HudStat primitives now, not a hand-rolled
          .obs-grid/.obs-stat block (that was this module's own bespoke KPI
          markup — same anti-pattern the migration recipe calls out). */}
      {ordersTotal !== null && (
        <HudGrid cols={3}>
          {/* Real meaning now drives each tile's color instead of a
              green/purple/blue rotation: a plain count and a filter-scope
              ratio are both just informational (--sem-info); revenue is
              the one figure here that's genuinely good news, so it earns
              --sem-success rather than sharing an arbitrary blue with the
              other two. */}
          <HudTile accent="var(--sem-info)"><HudStat value={ordersTotal} label="Bestellungen gesamt" accent="var(--sem-info)" /></HudTile>
          <HudTile accent="var(--sem-info)">
            <HudStat value={filteredOrders.length} label="sichtbar von geladen (Filter)" accent="var(--sem-info)" format={v => `${Math.round(v)} / ${orders.length}`} />
          </HudTile>
          {Object.entries(totalRevenueByCurrency).length > 0 ? (
            Object.entries(totalRevenueByCurrency).map(([cur, cents]) => (
              <HudTile accent="var(--sem-success)" key={cur}>
                <HudStat value={cents} label={`Umsatz, sichtbar (${cur.toUpperCase()})`} accent="var(--sem-success)" format={v => formatPrice(v, cur)} />
              </HudTile>
            ))
          ) : (
            <HudTile accent="var(--sem-success)">
              <HudStat value={0} label="Umsatz, sichtbar (EUR)" accent="var(--sem-success)" format={v => formatPrice(v, 'eur')} />
            </HudTile>
          )}
        </HudGrid>
      )}
      {!loading && list.length > 0 && (
        <HudGrid cols={3}>
          <HudTile accent="var(--sem-info)"><HudStat value={list.length} label="Produkte gesamt" accent="var(--sem-info)" /></HudTile>
          <HudTile accent="var(--sem-success)"><HudStat value={list.filter(p => p.payment_link_url).length} label="mit Zahlungslink" accent="var(--sem-success)" /></HudTile>
          <HudTile accent="var(--sem-warning)"><HudStat value={list.filter(p => !p.payment_link_url).length} label="ohne Zahlungslink" accent="var(--sem-warning)" /></HudTile>
        </HudGrid>
      )}
      {ordersTotal !== null && (
        <HudGrid cols={2}>
          <HudTile title="Umsatz nach Produkt" accent="var(--obs-green)" span={1}>
            <ObsDonut
              data={Object.entries(revenueByProduct).map(([label, value]) => ({ label, value }))}
              valueFormat={(v, _t, pct) =>
                revenueCurrency ? `${formatPrice(v, revenueCurrency)} · ${Math.round(pct * 100)}%` : `${v.toLocaleString('de-AT')} Cent · ${Math.round(pct * 100)}%`
              }
              gradientIdPrefix="monetization-revenue-by-product"
            />
            <p style={{ fontSize: 11, color: 'var(--gotham-text-dim, #6b7280)', lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>
              Basis: die {filteredOrders.length} aktuell sichtbaren Bestellungen (von {orders.length} geladen{ordersTotal !== null ? `, ${ordersTotal} gesamt` : ''}) — kein serverseitiges
              Gesamt-Grouping nach Produkt, siehe „Weitere laden" oben.
              {!revenueCurrency && revenueCurrencies.length > 1 && ` Enthält mehrere Währungen (${revenueCurrencies.map(c => c.toUpperCase()).join(', ')}) ohne Umrechnung summiert — kein einheitlicher Gesamtbetrag.`}
            </p>
          </HudTile>
          {/* Same .obs-item-card language the orders list below already uses
              — this used to be a bespoke dark-glass card with its own
              colors/radius/shadow, sitting next to a HudTile and above a
              plain-list .obs-item-card further down: three different card
              languages on one screen ("total chaos", confirmed by audit). */}
          <HudTile title="Letzte Bestellung" accent="var(--obs-green)" span={1}>
            {filteredOrders.length > 0 ? (
              (() => {
                const o = filteredOrders[filteredOrders.length - 1]
                return (
                  <div className="obs-item-card">
                    <div className="obs-item-title">{o.product_name ?? 'Unbekanntes Produkt'}</div>
                    <div className="obs-stat-value" style={{ color: 'var(--obs-green)', fontSize: 22, margin: '6px 0' }}>{formatPrice(o.amount_cents, o.currency)}</div>
                    <div className="obs-item-meta">
                      {o.created_at}
                      {o.customer_email ? ` · ${o.customer_email}` : ' · keine E-Mail übermittelt'}
                    </div>
                  </div>
                )
              })()
            ) : (
              <div className="obs-empty">Noch keine Bestellung im Filter.</div>
            )}
          </HudTile>
        </HudGrid>
      )}
      {ordersLoading && orders.length === 0 && <div className="obs-card"><HudSkeleton variant="list" rows={2} /></div>}
      {ordersError && orders.length === 0 && <div className="obs-card"><div className="obs-empty">Bestellungen konnten nicht geladen werden.</div></div>}
      {!ordersLoading && !ordersError && orders.length === 0 && (
        <div className="obs-card" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <div className="obs-empty" style={{ padding: '6px 0' }}>Noch keine Bestellungen — sie erscheinen hier automatisch, sobald jemand über einen Zahlungslink zahlt.</div>
        </div>
      )}
      {orders.length > 0 && filteredOrders.length === 0 && (
        <div className="obs-card"><div className="obs-empty">Keine Treffer für diesen Filter unter den geladenen Bestellungen.</div></div>
      )}
      {filteredOrders.map((o, i) => (
        <div className="obs-item-card" key={o.id} style={hudStagger(i)}>
          <div className="obs-item-title">{o.product_name ?? 'Unbekanntes Produkt'}</div>
          <div className="obs-item-meta">
            <span className="obs-pill" style={{ background: 'color-mix(in srgb, var(--obs-green, #10b981) 12%, transparent)', color: 'var(--obs-green, #10b981)' }}>
              {formatPrice(o.amount_cents, o.currency)}
            </span>
            {' · '}{o.customer_email ?? 'keine E-Mail übermittelt'}
            {' · '}{o.created_at}
          </div>
          <div className="obs-item-body" style={{ fontSize: 11, color: 'var(--gotham-text-dim, #6b7280)' }}>
            <button
              className="chat-inspect-toggle"
              style={{ fontSize: 11, padding: 0 }}
              onClick={() => setExpandedOrderId(id => id === o.id ? null : o.id)}
            >
              {expandedOrderId === o.id ? 'Details ausblenden' : 'Details anzeigen'}
            </button>
            {expandedOrderId === o.id && (
              <div style={{ marginTop: 4 }}>Stripe Session {o.stripe_session_id} · Event {o.stripe_event_id}</div>
            )}
          </div>
        </div>
      ))}
      {ordersError && orders.length > 0 && (
        <div className="obs-empty" style={{ padding: '8px 0' }}>Fehler beim Nachladen.</div>
      )}
      {ordersTotal !== null && orders.length < ordersTotal && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button className="panel-add-btn" onClick={loadMoreOrders} disabled={ordersLoadingMore}>
            {ordersLoadingMore ? 'Lädt…' : `Weitere laden (${orders.length} / ${ordersTotal})`}
          </button>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <HudSectionHeader
          title="Produkte"
          actions={
            <button className="panel-add-btn" onClick={() => setShowProductForm(s => !s)}>
              {showProductForm ? 'Abbrechen' : '+ Produkt'}
            </button>
          }
        />
      </div>
      {showProductForm && (
        <div className="obs-card">
          <div className="obs-form" style={{ marginBottom: 0 }}>
            <input placeholder="Name, z.B. „State of Emergent Interaction - Q1“" value={name} onChange={e => setName(e.target.value)} />
            <textarea placeholder="Beschreibung" value={description} onChange={e => setDescription(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="Preis, z.B. 49.00" value={price} onChange={e => setPrice(e.target.value)} style={{ flex: 1 }} />
              <select value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="eur">EUR</option>
                <option value="usd">USD</option>
              </select>
              <select value={mode} onChange={e => setMode(e.target.value as 'payment' | 'subscription')}>
                <option value="payment">Einmalig</option>
                <option value="subscription">Abo</option>
              </select>
              {mode === 'subscription' && (
                <select value={interval} onChange={e => setInterval(e.target.value as 'month' | 'year')}>
                  <option value="month">monatlich</option>
                  <option value="year">jährlich</option>
                </select>
              )}
              <select value={category} onChange={e => setCategory(e.target.value as 'service' | 'certification')}>
                <option value="service">Service (Hauptseite)</option>
                <option value="certification">Zertifizierung</option>
              </select>
            </div>
            {/* Optional: attach an already-existing Stripe Payment Link (created
                directly in the Stripe dashboard) instead of using "Zahlungslink
                erstellen" below, which mints a brand new Stripe product/price/
                link via the API — wrong when the link already exists. */}
            <input
              placeholder="Bereits vorhandener Zahlungslink (optional, z.B. https://buy.stripe.com/...)"
              value={existingLink}
              onChange={e => setExistingLink(e.target.value)}
            />
            {formError && <div className="obs-warning-note">{formError}</div>}
            <button className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={createProduct} disabled={creating || !name.trim()}>
              {creating ? 'Legt an…' : 'Produkt anlegen'}
            </button>
          </div>
        </div>
      )}
      {loading && <HudSkeleton variant="list" rows={2} />}
      {error && <div className="obs-empty">Konnte nicht geladen werden.</div>}
      {!loading && list.length === 0 && <div className="obs-card"><div className="obs-empty">Noch keine Produkte angelegt.</div></div>}
      {/* A real table, not 23 stacked full-height cards — confirmed live via
          screenshot that the old .obs-item-card-per-product rendering meant
          15+ screens of scrolling for what is fundamentally a price list.
          .obs-item-card stays the right shape for the orders feed above
          (timestamped events, variable body text) — this is genuinely
          tabular data (name/price/type), so it gets .obs-table instead.
          Height-capped to ~5 rows (Simeon, 2026-07-25): beyond that the
          wrap scrolls internally instead of growing the page. */}
      {list.length > 0 && (
        <div className="obs-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="obs-table">
            <thead>
              <tr>
                <th>Produkt</th>
                <th>Preis</th>
                <th>Typ</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {list.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="obs-table-name">{p.name}</div>
                    {p.description && <div className="obs-table-desc" title={p.description}>{p.description}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatPrice(p.price_cents, p.currency)}{p.mode === 'subscription' ? ` / ${p.recurring_interval === 'year' ? 'Jahr' : 'Monat'}` : ''}
                  </td>
                  <td>
                    <span className="obs-pill" style={{ background: 'color-mix(in srgb, var(--gotham-text-dim, #6b7280) 14%, transparent)', color: 'var(--gotham-text-dim, #6b7280)' }}>
                      {p.category === 'certification' ? 'Zertifizierung' : 'Service'}
                    </span>
                  </td>
                  <td>
                    <div className="obs-table-actions">
                      {p.payment_link_url ? (
                        <a href={p.payment_link_url} target="_blank" rel="noreferrer" className="panel-add-btn" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>
                          Zahlungslink öffnen ↗
                        </a>
                      ) : (
                        <button
                          className="panel-add-btn"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => createPaymentLink(p.id)}
                          disabled={linkingId === p.id}
                        >
                          {linkingId === p.id ? 'Erstellt…' : 'Zahlungslink erstellen'}
                        </button>
                      )}
                      <button className="panel-delete-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => deleteProduct(p.id, p.name)}>Löschen</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
