import { useState } from 'react'

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
    localStorage.setItem(SESSION_KEY, '1')
    setUser({ name: 'Admin', email: '', picture: '' })
    return true
  }

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
    window.location.hash = ''
    window.location.href = import.meta.env.BASE_URL || '/'
  }

  return { user, loading: false, login, logout }
}
