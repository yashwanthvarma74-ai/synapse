import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLORS } from '@/lib/identity'
import { contrast, readThemes } from './contrast'

const css = readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8')
const themes = readThemes(css)

describe('colour contrast (WCAG 2 AA), computed from the real stylesheet', () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const text: Array<[string, string, string]> = [
        ['body text on page', t.fg, t.bg],
        ['body text on panel', t.fg, t.panel],
        ['muted text on page', t.muted, t.bg],
        ['muted text on panel', t.muted, t.panel],
        ['links on page', t.accent, t.bg],
        ['links on panel', t.accent, t.panel],
        ['text on accent buttons', t['on-accent'], t.accent],
        ['error text on page', t.danger, t.bg],
        ['error text on panel', t.danger, t.panel],
        ['text on the offline-toggle highlight', '#000000', t.warn],
      ]
      for (const [what, fg, bg] of text) {
        it(`${what} is at least 4.5:1`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5))
      }
      it('the focus ring stands out from the page (3:1 for non-text)', () => {
        expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3)
        expect(contrast(t.accent, t.panel)).toBeGreaterThanOrEqual(3)
      })
    })
  }

  it('every avatar and cursor-label colour has 4.5:1 with its white text', () => {
    for (const c of COLORS) expect(contrast(c, '#ffffff'), c).toBeGreaterThanOrEqual(4.5)
  })

  it('the stylesheet really defines the tokens the tests rely on', () => {
    for (const k of ['fg', 'bg', 'panel', 'muted', 'accent', 'on-accent', 'danger', 'warn']) {
      expect(themes.light[k], `light --${k}`).toBeTruthy()
      expect(themes.dark[k], `dark --${k}`).toBeTruthy()
    }
  })
})
