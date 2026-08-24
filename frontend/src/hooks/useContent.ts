import { useState, useEffect, useCallback } from 'react'
import type { SiteContent } from '../types/content'
import { adminFetch } from '../lib/adminApi'
import type { Lang } from './useLang'

export function staticContentFilename(lang: Lang): string {
  return lang === 'en' ? 'content.json' : `content.${lang}.json`
}

export function useContent(lang: Lang) {
  const [content, setContent]   = useState<SiteContent | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  // ── LOAD ────────────────────────────────────────────────────────────────
  // Frontend and backend are deliberately decoupled for content (2026-08-07):
  // the backend's `/api/content` + persisted-volume + AdminPanel-publish path
  // required an authenticated login and a separate JSON-import step for
  // every single text change, on top of whatever deploy already shipped the
  // code - a five-week source of exactly this friction, flagged live and
  // repeatedly. Static content.{lang}.json (git-tracked, bundled into every
  // build) is now the ONLY source: a normal `fly deploy` or GH Pages build
  // already contains whatever text is in git, no extra publish step, ever.
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
      // English is the canonical content.json file; translated variants use
      // content.<lang>.json. Asking for content.en.json caused two guaranteed
      // 404s on every English page load because that file has never existed.
      const primary = await fetchJson(`${rawBase}${staticContentFilename(lang)}${bust}`)
      if (cancelled) return
      if (primary) { setContent(primary); setLoading(false); return }
      // 2) static EN fallback
      if (lang !== 'en') {
        const en = await fetchJson(`${rawBase}content.json${bust}`)
        if (cancelled) return
        if (en) { setContent(en); setLoading(false); return }
      }
      // 3) bundled default
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
