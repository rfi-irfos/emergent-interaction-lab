import React from 'react'

// Minimal, safe markdown rendering for assistant chat replies and published
// blog bodies. Builds JSX directly (no dangerouslySetInnerHTML), so there is
// no HTML-injection surface even though the source text is model- or
// user-authored.
//
// Supports, with a single shared inline pass:
//   - **bold**
//   - *italic*  (single asterisk; a leading "* " is also a bullet — handled
//     at the block level, not here, so inline emphasis still works)
//   - `inline code`
//   - hard line breaks (a single newline inside a paragraph keeps its break)
//   - fenced code blocks ```...```
//   - bulleted lists  (-, *, or +) and numbered lists (1. 2. ...)
//
// Anything it does not understand is passed through as plain text rather
// than shown raw — so a literal "*" is never rendered as a visible asterisk
// artifact.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Order matters: fenced/inline code first so we don't parse * inside code.
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-i${k++}`
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={key} className="md-inline-code">{tok.slice(1, -1)}</code>)
    } else {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderBlock(block: string, bi: number): React.ReactNode {
  const lines = block.split('\n')

  // Fenced code block
  if (lines[0]?.trim().startsWith('```')) {
    const body = lines.slice(1).filter(l => !l.trim().startsWith('```')).join('\n')
    return <pre key={bi} className="md-codeblock"><code>{body}</code></pre>
  }

  const trimmed = lines.map(l => l.trim())
  const nonEmpty = trimmed.filter(l => l !== '')

  // A block is a clean list only if EVERY non-empty line is a list item.
  const isNumbered = nonEmpty.length > 0 && nonEmpty.every(l => /^\d+\.\s/.test(l))
  const isBulleted = nonEmpty.length > 0 && nonEmpty.every(l => /^[-*+]\s/.test(l))

  if (isNumbered) {
    return (
      <ol key={bi}>
        {nonEmpty.map((l, li) => (
          <li key={li}>{renderInline(l.replace(/^\d+\.\s/, ''), `${bi}-${li}`)}</li>
        ))}
      </ol>
    )
  }
  if (isBulleted) {
    return (
      <ul key={bi}>
        {nonEmpty.map((l, li) => (
          <li key={li}>{renderInline(l.replace(/^[-*+]\s/, ''), `${bi}-${li}`)}</li>
        ))}
      </ul>
    )
  }

  // Paragraph with hard line breaks preserved.
  return (
    <p key={bi}>
      {lines.map((l, li) => (
        <React.Fragment key={li}>
          {renderInline(l, `${bi}-${li}`)}
          {li < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  )
}

export function renderInlineText(text: string, keyPrefix: string): React.ReactNode[] {
  return renderInline(text, keyPrefix)
}

export function renderMarkdown(text: string): React.ReactNode {
  // Split into blocks on blank lines, but keep fenced code blocks intact.
  const blocks: string[] = []
  let buf: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (inFence) {
        buf.push(line)
        blocks.push(buf.join('\n'))
        buf = []
        inFence = false
      } else {
        if (buf.length) { blocks.push(buf.join('\n')); buf = [] }
        buf.push(line)
        inFence = true
      }
      continue
    }
    if (inFence) { buf.push(line); continue }
    if (line.trim() === '') {
      if (buf.length) { blocks.push(buf.join('\n')); buf = [] }
    } else {
      buf.push(line)
    }
  }
  if (buf.length) blocks.push(buf.join('\n'))
  return blocks.map((b, bi) => renderBlock(b, bi))
}
