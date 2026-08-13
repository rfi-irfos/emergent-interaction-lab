import { useState } from 'react'
import { API_BASE } from '../lib/apiBase'

export interface User { name: string; email: string; picture: string }

const SESSION_KEY = 'rfi_admin_token'

export function useAuth() {
  const [user, setUser] = useState<User | null>(() =>
    sessionStorage.getItem(SESSION_KEY) ? { name: 'Admin', email: '', picture: '' } : null
  )

  const login = async (password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) return false
      const data = await res.json().catch(() => ({}))
      if (!data.ok) return false
      if (!data.token) return false
      sessionStorage.setItem(SESSION_KEY, data.token)
      setUser({ name: 'Admin', email: '', picture: '' })
      return true
    } catch {
      return false
    }
  }

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setUser(null)
    window.location.hash = ''
    window.location.href = import.meta.env.BASE_URL || '/'
  }

  return { user, loading: false, login, logout }
}
