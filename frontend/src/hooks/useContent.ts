import { useState, useEffect, useCallback } from 'react'
import type { SiteContent } from '../types/content'
import { API_BASE } from '../lib/apiBase'
import { adminFetch } from '../lib/adminApi'
import type { Lang } from './useLang'

export function useContent(lang: Lang) {
  const [content, setContent]   = useState<SiteContent | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  // ── LOAD ────────────────────────────────────────────────────────────────
  // Try the backend first (`/api/content?lang=`), which is the single source
  // of truth once anything has been saved there (it lives on the persistent
  // volume). GET is open (no auth needed) so the public site works too.
  // Fall back to the static content.{lang}.json (served by the SPA / raw
  // GitHub) for the GitHub Pages mirror where there is no backend at all.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const bust = `?t=${Date.now()}`
    const rawBase = import.meta.env.BASE_URL

    const fetchJson = async (url: string): Promise<SiteContent | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(url, { cache: 'no-store' })
          if (res.ok) return await res.json()
        } catch { /* try again / fall through */ }
        if (attempt === 0) await new Promise(r => setTimeout(r, 400))
      }
      return null
    }

    ;(async () => {
      // 1) backend (works on fly.dev; 404/error on the GH Pages mirror)
      const fromBackend = await fetchJson(`${API_BASE}/api/content?lang=${lang}`)
      if (cancelled) return
      if (fromBackend && Object.keys(fromBackend).length > 0) {
        setContent(fromBackend); setLoading(false); return
      }
      // 2) static content.{lang}.json (SPA root / raw GitHub)
      const primary = await fetchJson(`${rawBase}content.${lang}.json${bust}`)
      if (cancelled) return
      if (primary) { setContent(primary); setLoading(false); return }
      // 3) static EN fallback
      if (lang !== 'en') {
        const en = await fetchJson(`${rawBase}content.json${bust}`)
        if (cancelled) return
        if (en) { setContent(en); setLoading(false); return }
      }
      // 4) bundled default
      const { defaultContent } = await import('../types/defaultContent')
      if (!cancelled) { setContent(defaultContent); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [lang])

  // ── SAVE ────────────────────────────────────────────────────────────────
  // Persist to the backend (authenticated PUT). Replaces the old GitHub
  // Contents-API write, which required a build-time VITE_GH_TOKEN that the
  // Fly build didn't have — so saving silently 401'd on fly.dev. The backend
  // endpoint authenticates via the Google OAuth session cookie instead,
  // which same-origin fetch sends automatically with credentials:'include'.
  const save = useCallback(async (updated: SiteContent): Promise<boolean> => {
    setSaving(true)
    try {
      const res = await adminFetch(`/api/content?lang=${lang}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (!res.ok) {
        console.error('Save failed:', res.status, await res.text().catch(() => ''))
        return false
      }
      setContent(updated)
      return true
    } catch (e) {
      console.error('Save failed:', e)
      return false
    } finally {
      setSaving(false)
    }
  }, [lang])

  // ── UPLOAD ──────────────────────────────────────────────────────────────
  // POST the image to the backend's /api/upload (require_admin / x-chat-secret,
  // same auth as every other admin surface) and return the served /uploads/*
  // URL. Replaces the old GitHub-write upload path.
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await adminFetch(`/api/upload`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        console.error('Upload failed:', res.status)
        return null
      }
      const data = await res.json() as { url: string }
      return data.url
    } catch (e) {
      console.error('Upload failed:', e)
      return null
    }
  }, [])

  return { content, loading, saving, save, uploadImage }
}
