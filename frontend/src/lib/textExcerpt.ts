// Shared word-boundary excerpt for any list-card body text that's
// realistically long-form (a blog draft's article body, a research note's
// paper/hypothesis writeup) — as opposed to short fields (a chat message, a
// changelog summary) that never needed this. Cuts at the last space before
// the limit rather than mid-word.
export function excerpt(text: string, length = 220): string {
  if (text.length <= length) return text
  const cut = text.slice(0, length)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : length)}…`
}
