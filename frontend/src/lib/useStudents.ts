import { useState, useEffect } from 'react'
import { ghRead, ghWrite, b64Encode, b64Decode, isConfigured } from './github'
import type { Student } from '../types/students'

const STUDENTS_PATH = 'frontend/public/students.json'

export function useStudents() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [sha, setSha] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      if (isConfigured()) {
        const file = await ghRead(STUDENTS_PATH)
        setSha(file.sha)
        setStudents(JSON.parse(b64Decode(file.content)))
      } else {
        const res = await fetch('students.json')
        if (res.ok) setStudents(await res.json())
      }
    } catch {
      setStudents([])
    } finally {
      setLoading(false)
    }
  }

  async function save(next: Student[]) {
    setSaving(true)
    setSaveError(false)
    try {
      const encoded = b64Encode(JSON.stringify(next, null, 2))
      const file = await ghWrite(STUDENTS_PATH, encoded, sha, 'update: student list')
      setSha(file.sha)
      setStudents(next)
    } catch (e) {
      console.error('Student save failed:', e)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  function add(s: Omit<Student, 'id' | 'since'>) {
    const next = [...students, { ...s, id: Date.now().toString(), since: new Date().toISOString().slice(0, 10) }]
    save(next)
  }

  function update(id: string, patch: Partial<Student>) {
    const next = students.map(s => s.id === id ? { ...s, ...patch } : s)
    save(next)
  }

  function remove(id: string) {
    save(students.filter(s => s.id !== id))
  }

  return { students, loading, saving, saveError, add, update, remove }
}
