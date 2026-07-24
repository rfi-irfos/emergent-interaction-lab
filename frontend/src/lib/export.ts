// Shared export helpers for every Observatory/Verwaltung module — one real
// download-triggering mechanism (see `triggerDownload`), generalized from the
// two ad-hoc copies that existed before this file (EmergenceMonitor.tsx's own
// `downloadJson`, ResearchChat.tsx's own `downloadText`). Both now import
// from here instead of carrying their own Blob + <a> dance, so there is
// exactly one place that knows how a browser download actually gets
// triggered in this app.
//
// `exportCsv`/`exportMarkdown` are the two new real serializers every
// Observatory/Verwaltung list module wires an export button to. Both take
// the same shape — an array of flat, already-flattened row objects — on
// purpose: callers own the judgment of which fields to include and how to
// flatten anything nested (an array field, a JSON-string field, …) *before*
// handing rows here, so this file never has to guess at a module's own data
// shape.

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename: string, data: unknown) {
  triggerDownload(filename, JSON.stringify(data, null, 2), 'application/json')
}

// Same signature/default mimeType ResearchChat.tsx's local `downloadText`
// already used for its conversation-transcript export — kept so that call
// site didn't have to change shape, just its import.
export function downloadText(filename: string, text: string, mimeType = 'text/markdown;charset=utf-8') {
  triggerDownload(filename, text, mimeType)
}

// The union of keys across ALL rows, not just rows[0]'s — this app's real
// data is routinely heterogeneous (e.g. a field only some rows carry, like
// SimulationCenter's `narrative` which is null until a run finishes), and
// keying off the first row alone would silently drop any column absent
// there for the whole export.
function unionKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); keys.push(k) }
    }
  }
  return keys
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

// RFC 4180 §2.6: a field MUST be quoted if it contains the delimiter, a
// double quote, or a line break (CR or LF); a literal quote inside a quoted
// field is escaped by doubling it. Anything else is left unquoted — still
// spec-correct (quoting is only ever required, never forbidden, for a plain
// field) and keeps a normal export readable.
function csvEscape(value: unknown): string {
  const s = cellText(value)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const keys = unionKeys(rows)
  const lines = [keys.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(keys.map(k => csvEscape(row[k])).join(','))
  }
  // CRLF per RFC 4180 §2.2 — also what makes Excel (still the most common
  // real consumer of a downloaded .csv) reliably respect an embedded \n
  // inside a quoted field instead of occasionally misreading the row break.
  return lines.join('\r\n') + '\r\n'
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  // Leading UTF-8 BOM: without it, Excel (unlike effectively every other
  // real consumer of a .csv) guesses the wrong encoding for anything outside
  // plain ASCII — and this app's real data is routinely German (ä/ö/ü/ß) or
  // the em/en-dashes Jarvis's own prose regularly produces.
  // Written via fromCharCode rather than a literal embedded character so it
  // can't get silently mangled by any encoding step between here and disk.
  const BOM = String.fromCharCode(0xfeff)
  triggerDownload(filename, BOM + toCsv(rows), 'text/csv;charset=utf-8')
}

// A literal "|" inside a cell would be read as a new column boundary; a
// literal line break would split the row across multiple physical lines and
// derail every row rendered after it. Folding a newline to a visible "<br>"
// (valid inside a GFM/CommonMark table cell) keeps the row a single physical
// line while still preserving the line break's presence, rather than just
// silently collapsing it to a space. Backslash is escaped first so an
// already-escaped source string doesn't get double-escaped by the following
// two replacements.
function mdEscapeCell(value: unknown): string {
  const s = cellText(value)
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>')
}

export function toMarkdownTable(rows: Record<string, unknown>[], title?: string): string {
  const heading = title ? `# ${title}\n\n` : ''
  if (rows.length === 0) return `${heading}_Keine Daten._\n`
  const keys = unionKeys(rows)
  const lines = [
    `| ${keys.join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${keys.map(k => mdEscapeCell(row[k])).join(' | ')} |`),
  ]
  return `${heading}${lines.join('\n')}\n`
}

export function exportMarkdown(filename: string, rows: Record<string, unknown>[], title?: string) {
  triggerDownload(filename, toMarkdownTable(rows, title), 'text/markdown;charset=utf-8')
}

// Minimal, dependency-free YAML block-scalar serializer — this app's export
// rows are always a flat array of flat key/value objects (see this file's
// own doc comment), never nested structures, so a full spec-compliant YAML
// library would be solving a much bigger problem than this actually has.
// Plain scalars are written bare; anything containing a character that would
// change YAML's parse (colon+space, a leading special char, a line break) is
// double-quoted with the same escaping JSON already uses for strings, which
// is valid YAML flow-scalar syntax.
function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const s = cellText(value)
  if (s === '') return '""'
  const needsQuoting = /^[\s"'>|*&!%#@,[\]{}?:-]|: |:$|\r|\n|^\s|\s$/.test(s)
  return needsQuoting ? JSON.stringify(s) : s
}

export function toYaml(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '[]\n'
  const keys = unionKeys(rows)
  return rows.map(row => {
    const lines = keys.map((k, i) => `${i === 0 ? '- ' : '  '}${k}: ${yamlScalar(row[k])}`)
    return lines.join('\n')
  }).join('\n') + '\n'
}

export function exportYaml(filename: string, rows: Record<string, unknown>[]) {
  triggerDownload(filename, toYaml(rows), 'application/yaml;charset=utf-8')
}
