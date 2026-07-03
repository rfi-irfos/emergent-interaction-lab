export interface Student {
  id: string
  name: string
  language: string
  level: string
  status: 'active' | 'paused' | 'completed'
  sessions: number
  next_session?: string
  goal: string
  notes: string
  since: string
}
