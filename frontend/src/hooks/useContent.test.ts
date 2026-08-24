import { describe, expect, it } from 'vitest'
import { staticContentFilename } from './useContent'

describe('staticContentFilename', () => {
  it('uses the canonical content.json for English', () => {
    expect(staticContentFilename('en')).toBe('content.json')
  })

  it('uses the language suffix for translations', () => {
    expect(staticContentFilename('de')).toBe('content.de.json')
  })
})
