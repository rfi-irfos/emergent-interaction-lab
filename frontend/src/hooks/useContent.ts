import { useState, useEffect, useCallback, useRef } from 'react'
import type { SiteContent } from '../types/content'
import { ghRead, ghWrite, b64Encode, contentPathFor, UPLOADS_DIR, OWNER, REPO } from '../lib/github'
import type { Lang } from './useLang'

export function useContent(lang: Lang) {
  const [content, setContent]   = useState<SiteContent | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const shaRef = useRef<string | null>(null)

  // Fetch the active language's content. Swaps in place on language change
  // (no full-screen spinner after the first load).
  useEffect(() => {
    let cancelled = false
    shaRef.current = null
    // Fetch directly from GitHub raw content so admin saves are reflected
    // immediately without requiring a full GitHub Pages rebuild.
    const bust = `?t=${Date.now()}`
    const rawBase = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/`
    ;(async () => {
      try {
        const rawUrl = `${rawBase}${contentPathFor(lang)}${bust}`
        const res = await fetch(rawUrl, { cache: 'no-store' })
        if (!res.ok) throw new Error('missing')
        const data = await res.json()
        if (!cancelled) setContent(data)
      } catch {
        // Non-EN missing -> fall back to EN raw file, then to bundled default
        if (lang !== 'en') {
          try {
            const res = await fetch(`${rawBase}${contentPathFor('en')}${bust}`, { cache: 'no-store' })
            if (res.ok) { const d = await res.json(); if (!cancelled) setContent(d); return }
          } catch { /* fall through */ }
        }
        const { defaultContent } = await import('../types/defaultContent')
        if (!cancelled) setContent(defaultContent)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [lang])

  // Lazily prime the SHA for the active language so we can update (not just create)
  const ensureSha = useCallback(async () => {
    if (shaRef.current) return shaRef.current
    try {
      const file = await ghRead(contentPathFor(lang))
      shaRef.current = file.sha
    } catch {
      shaRef.current = null  // file doesn't exist yet — first save creates it
    }
    return shaRef.current
  }, [lang])

  const save = useCallback(async (updated: SiteContent): Promise<boolean> => {
    setSaving(true)
    try {
      const sha = await ensureSha()
      const b64 = b64Encode(JSON.stringify(updated, null, 2))
      const file = await ghWrite(contentPathFor(lang), b64, sha, `content: update ${lang} via admin panel`)
      shaRef.current = file?.sha ?? null
      setContent(updated)
      return true
    } catch (e) {
      console.error('Save failed:', e)
      return false
    } finally {
      setSaving(false)
    }
  }, [ensureSha, lang])

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const b64 = (reader.result as string).split(',')[1]
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
          const filename = `${Date.now()}-${safe}`
          const path = `${UPLOADS_DIR}/${filename}`
          await ghWrite(path, b64, null, `upload: ${filename}`)
          resolve(`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${path}`)
        } catch (e) {
          console.error('Upload failed:', e)
          resolve(null)
        }
      }
      reader.readAsDataURL(file)
    })
  }, [])

  return { content, loading, saving, save, uploadImage }
}
