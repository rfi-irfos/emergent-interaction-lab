import { useState } from 'react'
import { API_BASE } from '../lib/apiBase'

export interface User { name: string; email: string; picture: string }

const SESSION_KEY = 'rfi_admin_ok'
const ADMIN_HASH = import.meta.env.VITE_ADMIN_HASH as string

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(() =>
    localStorage.getItem(SESSION_KEY) ? { name: 'Admin', email: '', picture: '' } : null
  )

  const login = async (password: string): Promise<boolean> => {
    if (!ADMIN_HASH) return false
    const hash = await sha256(password)
    if (hash !== ADMIN_HASH) return false

    // Frontend hash check passed — mint a backend session without Google OAuth.
    // This keeps the Pages -> Fly cross-origin case alive, because it no longer
    // depends on a fetch()-wrapped Google redirect chain that dies in CORS.
    try {
      const res = await fetch(`${API_BASE}/auth/admin-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password_hash: hash }),
      })
      if (!res.ok) {
        console.error('Failed to establish backend session:', res.status)
        return false
      }
    } catch (e) {
      console.error('Backend session request failed:', e)
      return false
    }

    localStorage.setItem(SESSION_KEY, '1')
    setUser({ name: 'Admin', email: '', picture: '' })
    return true
  }

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
    // Also clear backend session
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
    window.location.hash = ''
    window.location.href = import.meta.env.BASE_URL || '/'
  }

  return { user, loading: false, login, logout }
}
