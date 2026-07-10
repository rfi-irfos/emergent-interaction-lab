import React from 'react'

// Minimal, safe markdown rendering — bold, numbered/bulleted lists,
// paragraphs. Builds JSX directly (no dangerouslySetInnerHTML), so there's
// no HTML-injection surface even though the source text is model- or
// user-authored. Not a general-purpose parser: covers what this app's two
// consumers actually use — Jarvis's chat replies (ResearchChat.tsx) and
// published blog post bodies (PublicSite.tsx / BlogPostPage.tsx), which
// share this single implementation rather than each rolling their own.
export function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : part
  )
}

export function renderMarkdown(text: string): React.ReactNode {
  return text.split(/\n{2,}/).map((block, bi) => {
    const lines = block.split('\n').filter(l => l.trim() !== '')
    if (lines.length === 0) return null
    const isNumbered = lines.every(l => /^\d+\.\s/.test(l.trim()))
    const isBulleted = lines.every(l => /^[-*]\s/.test(l.trim()))
    if (isNumbered) {
      return <ol key={bi}>{lines.map((l, li) => <li key={li}>{renderInline(l.trim().replace(/^\d+\.\s/, ''), `${bi}-${li}`)}</li>)}</ol>
    }
    if (isBulleted) {
      return <ul key={bi}>{lines.map((l, li) => <li key={li}>{renderInline(l.trim().replace(/^[-*]\s/, ''), `${bi}-${li}`)}</li>)}</ul>
    }
    return (
      <p key={bi}>
        {lines.map((l, li) => <React.Fragment key={li}>{renderInline(l, `${bi}-${li}`)}{li < lines.length - 1 && <br />}</React.Fragment>)}
      </p>
    )
  })
}
