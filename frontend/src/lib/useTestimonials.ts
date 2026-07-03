import { useState, useEffect } from 'react'
import type { Testimonial } from '../types/testimonials'
import { ghRead, ghWrite, b64Encode, b64Decode } from './github'

const PATH = 'frontend/public/testimonials.json'

export function useTestimonials() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([])
  const [sha, setSha] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ghRead(PATH)
      .then(f => {
        setSha(f.sha)
        setTestimonials(JSON.parse(b64Decode(f.content)))
      })
      .catch(() => setTestimonials([]))
  }, [])

  async function persist(next: Testimonial[], currentSha: string | null) {
    setSaving(true)
    try {
      const f = await ghWrite(PATH, b64Encode(JSON.stringify(next, null, 2)), currentSha, 'update testimonials')
      setSha((f as { sha: string }).sha)
    } finally {
      setSaving(false)
    }
  }

  function add(t: Omit<Testimonial, 'id'>) {
    const next = [...testimonials, { ...t, id: crypto.randomUUID() }]
    setTestimonials(next)
    persist(next, sha)
  }

  function update(t: Testimonial) {
    const next = testimonials.map(r => r.id === t.id ? t : r)
    setTestimonials(next)
    persist(next, sha)
  }

  function remove(id: string) {
    const next = testimonials.filter(r => r.id !== id)
    setTestimonials(next)
    persist(next, sha)
  }

  return { testimonials, saving, add, update, remove }
}
