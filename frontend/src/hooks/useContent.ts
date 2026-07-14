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
    // TEMP LOCAL PREVIEW PATCH (will be reverted): load content.json from the
    // local public/ dir instead of GitHub raw, so the dev server shows the
    // same content.json the user is editing.
    const bust = `?t=${Date.now()}`
    const rawBase = import.meta.env.BASE_URL
    // One retry after a short delay before giving up on the requested
    // language — raw.githubusercontent.com occasionally 404s/errors on a
    // brief propagation lag right after a push, which previously fell
    // straight through to the English file: a German visitor would see an
    // all-English page (nav labels, badges, buttons) with "DE" still
    // selected, with nothing prompting a re-fetch of the real German copy.
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
      const primary = await fetchJson(`${rawBase}${contentPathFor(lang)}${bust}`)
      if (cancelled) return
      if (primary) { setContent(primary); setLoading(false); return }
      // Requested language still unavailable after retry -> fall back to
      // EN raw file, then to the bundled default.
      if (lang !== 'en') {
        const en = await fetchJson(`${rawBase}${contentPathFor('en')}${bust}`)
        if (cancelled) return
        if (en) { setContent(en); setLoading(false); return }
      }
      const { defaultContent } = await import('../types/defaultContent')
      if (!cancelled) { setContent(defaultContent); setLoading(false) }
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
