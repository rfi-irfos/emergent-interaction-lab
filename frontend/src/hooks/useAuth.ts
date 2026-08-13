import { useState } from 'react'

export interface User { name: string; email: string; picture: string }

const SESSION_KEY = 'rfi_admin_ok'

export function useAuth() {
  const [user, setUser] = useState<User | null>(() =>
    localStorage.getItem(SESSION_KEY) ? { name: 'Admin', email: '', picture: '' } : null
  )

  const login = async (password: string): Promise<boolean> => {
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) return false
      const data = await res.json().catch(() => ({}))
      if (!data.ok) return false
      localStorage.setItem(SESSION_KEY, '1')
      setUser({ name: 'Admin', email: '', picture: '' })
      return true
    } catch {
      return false
    }
  }

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
    window.location.hash = ''
    window.location.href = import.meta.env.BASE_URL || '/'
  }

  return { user, loading: false, login, logout }
}
