// SQLite's `datetime('now')` (see e.g. backend/src/chat.rs's
// chat_conversations schema, backend/src/contact.rs's contact_messages
// schema) stores UTC as "YYYY-MM-DD HH:MM:SS" — no 'T', no timezone marker.
// Handing that straight to `new Date(...)` is parsed inconsistently across
// browsers (some treat it as local time, not UTC). Reformatting into a
// proper ISO-8601 UTC string first makes the grouping below reliable
// regardless of caller.
export function parseServerTimestamp(ts: string): Date {
  return new Date(`${ts.replace(' ', 'T')}Z`)
}

export interface DateGroup<T> { label: string; items: T[] }

// Generic client-side date bucketing, newest-first within each bucket:
// "Heute" (today, local calendar day), "Diese Woche" (the 7 days before
// today), "Älter" (everything before that). Originally built only for the
// Forschung conversation sidebar (see ResearchChat.tsx); generalized here so
// any timestamped list — e.g. the contact Inbox (observatory/Inbox.tsx) —
// gets the same "unfilterable flat list at scale" fix instead of a second
// hand-rolled copy.
//
// `items` is assumed already sorted newest-first by the caller (every
// current caller's backend query already does `ORDER BY ... DESC`), so a
// single pass preserves that order within each bucket without re-sorting.
export function groupByDate<T>(items: T[], getTimestamp: (item: T) => string): DateGroup<T>[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000)

  const today: T[] = []
  const week: T[] = []
  const older: T[] = []
  for (const item of items) {
    const ts = parseServerTimestamp(getTimestamp(item))
    if (ts >= startOfToday) today.push(item)
    else if (ts >= weekStart) week.push(item)
    else older.push(item)
  }

  const groups: DateGroup<T>[] = []
  if (today.length) groups.push({ label: 'Heute', items: today })
  if (week.length) groups.push({ label: 'Diese Woche', items: week })
  if (older.length) groups.push({ label: 'Älter', items: older })
  return groups
}
