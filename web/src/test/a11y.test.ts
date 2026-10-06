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
        ['body text on cards', t.fg, t.surface],
        ['muted text on cards', t.muted, t.surface],
        ['links on cards', t.accent, t.surface],
        ['error text on cards', t.danger, t.surface],
        ['white text on the red delete button', '#ffffff', t.danger],
        ['red delete-button text on the page', t.danger, t.bg],
        ['body text on the soft highlight (banners, badges, status)', t.fg, t['accent-soft']],
        ['muted text on the soft highlight', t.muted, t['accent-soft']],
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
    for (const k of ['fg', 'bg', 'panel', 'muted', 'accent', 'on-accent', 'danger', 'warn', 'surface', 'accent-soft']) {
      expect(themes.light[k], `light --${k}`).toBeTruthy()
    }
  })
})
