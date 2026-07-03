import { useState } from 'react'

interface Props { onLogin: (pw: string) => Promise<boolean> }

export function LoginPage({ onLogin }: Props) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const ok = await onLogin(pw)
    setBusy(false)
    if (!ok) {
      setError(true)
      setPw('')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="12" fill="#0099CC"/>
            <path d="M11 20h18M20 11v18" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="login-title">Website Admin</h1>
        <p className="login-sub">Geben Sie Ihr Passwort ein.</p>
        <form onSubmit={submit} className="login-form">
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(false) }}
            placeholder="Passwort"
            autoFocus
            className="login-pw-input"
          />
          {error && <p className="login-error">Falsches Passwort. Bitte nochmal.</p>}
          <button type="submit" disabled={busy} className="login-submit-btn">
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  )
}
