import { useState } from 'react'
import { API_BASE } from '../../lib/apiBase'
import { authHeaders, useAdminFetch } from '../../lib/adminApi'

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
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

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
  const [creating, setCreating] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const refresh = async () => {
    const res = await fetch(`${API_BASE}/api/billing/products`, { headers: authHeaders() })
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
      const res = await fetch(`${API_BASE}/api/billing/products`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name,
          description,
          price_cents: cents,
          currency,
          mode,
          recurring_interval: mode === 'subscription' ? interval : null,
        }),
      })
      if (!res.ok) {
        setFormError('Produkt konnte nicht angelegt werden.')
        return
      }
      await refresh()
      setName(''); setDescription(''); setPrice('')
    } finally {
      setCreating(false)
    }
  }

  const createPaymentLink = async (id: string) => {
    setLinkingId(id)
    try {
      const res = await fetch(`${API_BASE}/api/billing/products/${id}/payment-link`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) {
        setFormError('Zahlungslink konnte nicht erstellt werden - ist STRIPE_SECRET_KEY gesetzt?')
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
    await fetch(`${API_BASE}/api/billing/products/${id}`, { method: 'DELETE', headers: authHeaders() })
    await refresh()
  }

  return (
    <div className="obs-panel">
      <div className="obs-section-label">Neues Produkt</div>
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
          </div>
          {formError && <div className="obs-warning-note">{formError}</div>}
          <button className="panel-add-btn" style={{ alignSelf: 'flex-start' }} onClick={createProduct} disabled={creating || !name.trim()}>
            {creating ? 'Legt an…' : 'Produkt anlegen'}
          </button>
        </div>
      </div>

      <div className="obs-section-label" style={{ marginTop: 24 }}>Produkte</div>
      {loading && <div className="obs-empty">Lade…</div>}
      {error && <div className="obs-empty">Konnte nicht geladen werden.</div>}
      {!loading && list.length === 0 && <div className="obs-card"><div className="obs-empty">Noch keine Produkte angelegt.</div></div>}
      {list.map(p => (
        <div className="obs-item-card" key={p.id}>
          <div className="obs-item-title">{p.name}</div>
          <div className="obs-item-meta">
            <span className="obs-pill" style={{ background: 'rgba(59,107,246,.12)', color: 'var(--obs-blue, #3b6bf6)' }}>
              {formatPrice(p.price_cents, p.currency)}{p.mode === 'subscription' ? ` / ${p.recurring_interval === 'year' ? 'Jahr' : 'Monat'}` : ''}
            </span>
            {' · '}{p.created_at}
          </div>
          {p.description && <div className="obs-item-body">{p.description}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
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
        </div>
      ))}
      <p style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.6, marginTop: 16 }}>
        Jeder Zahlungslink ist ein echter Stripe Payment Link - keine Simulation. Löschen entfernt nur den lokalen Eintrag, ein bereits erstellter Zahlungslink bleibt bei Stripe aktiv, bis er dort separat deaktiviert wird.
      </p>
    </div>
  )
}
