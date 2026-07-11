import { exportCsv, exportMarkdown } from '../../lib/export'

// One small, reused control instead of a bespoke export button pair per
// module — same `panel-add-btn` styling/placement EmergenceMonitor.tsx
// already established for its "⬇ Exportieren" JSON button, just offering
// the two new real formats. `rows` must already be flat, plain-value
// objects (callers own flattening anything nested — an array field, a
// JSON-string field — before handing rows here; see lib/export.ts).
//
// Filenames get today's date appended, matching EmergenceMonitor's existing
// JSON export convention exactly, so a module offering all three formats
// produces consistently-named files.
export function ExportButtons({ rows, filenameBase, title, disabled }: {
  rows: Record<string, unknown>[]
  filenameBase: string
  title?: string
  disabled?: boolean
}) {
  const isDisabled = disabled ?? rows.length === 0
  const stamp = new Date().toISOString().slice(0, 10)
  return (
    <>
      <button
        className="panel-add-btn"
        disabled={isDisabled}
        onClick={() => exportCsv(`${filenameBase}-${stamp}.csv`, rows)}
      >
        ⬇ CSV
      </button>
      <button
        className="panel-add-btn"
        disabled={isDisabled}
        onClick={() => exportMarkdown(`${filenameBase}-${stamp}.md`, rows, title)}
      >
        ⬇ Markdown
      </button>
    </>
  )
}
