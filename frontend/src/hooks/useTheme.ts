import { useEffect, useState } from 'react'

// EU accessibility mandate: every public page ships these three themes.
export type Theme = 'light' | 'dark' | 'hc'
export const THEMES: Theme[] = ['light', 'dark', 'hc']

const KEY = 'rfi-theme'

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  if (window.matchMedia('(prefers-contrast: more)').matches) return 'hc'
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

/**
 * Theme state with localStorage persistence and a one-time system-preference
 * default. Does NOT touch the DOM — the consumer applies `data-theme` on its
 * own root, so multiple instances (e.g. the builder device preview) stay
 * independent.
 */
export function useTheme(): {
  theme: Theme
  setTheme: (t: Theme) => void
  cycle: () => void
} {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof localStorage === 'undefined') return 'light'
    const saved = localStorage.getItem(KEY) as Theme | null
    return saved && THEMES.includes(saved) ? saved : systemTheme()
  })

  useEffect(() => {
    try { localStorage.setItem(KEY, theme) } catch { /* private mode */ }
  }, [theme])

  const setTheme = (t: Theme) => setThemeState(t)
  const cycle = () => setThemeState(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])

  return { theme, setTheme, cycle }
}
