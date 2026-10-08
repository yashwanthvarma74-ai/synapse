import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLORS } from '@/lib/collab/identity'
import { contrast, readThemes } from './contrast'

// the colours are the design system's (Synapse's tokens.css only gives them its own names)
const css = readFileSync(path.resolve(__dirname, '../../node_modules/@yashwanthvarma74/tokens/dist/tokens.css'), 'utf8')
const themes = readThemes(css)

describe('colour contrast (WCAG 2 AA), computed from the real stylesheet', () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const c = (k: string) => t[k]
      const text: Array<[string, string, string]> = [
        ['body text on page', c('color-text-primary'), c('color-bg-canvas')],
        ['body text on panel', c('color-text-primary'), c('color-bg-muted')],
        ['muted text on page', c('color-text-secondary'), c('color-bg-canvas')],
        ['muted text on panel', c('color-text-secondary'), c('color-bg-muted')],
        ['links on page', c('color-text-link'), c('color-bg-canvas')],
        ['links on panel', c('color-text-link'), c('color-bg-muted')],
        ['text on accent buttons', c('color-accent-on-accent'), c('color-accent-default')],
        ['error text on page', c('color-danger-text'), c('color-bg-canvas')],
        ['error text on panel', c('color-danger-text'), c('color-bg-muted')],
        ['body text on cards', c('color-text-primary'), c('color-bg-surface')],
        ['muted text on cards', c('color-text-secondary'), c('color-bg-surface')],
        ['links on cards', c('color-text-link'), c('color-bg-surface')],
        ['error text on cards', c('color-danger-text'), c('color-bg-surface')],
        ['white text on the red delete button', c('color-text-inverse'), c('color-danger-solid')],
        ['body text on the soft highlight (banners, badges, status)', c('color-text-primary'), c('color-accent-subtle')],
        ['muted text on the soft highlight', c('color-text-secondary'), c('color-accent-subtle')],
      ]
      for (const [what, fg, bg] of text) {
        it(`${what} is at least 4.5:1`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5))
      }
      it('the focus ring stands out from the page (3:1 for non-text)', () => {
        expect(contrast(c('color-focus-ring'), c('color-bg-canvas'))).toBeGreaterThanOrEqual(3)
        expect(contrast(c('color-focus-ring'), c('color-bg-muted'))).toBeGreaterThanOrEqual(3)
      })
    })
  }

  it('every avatar and cursor-label colour has 4.5:1 with its white text', () => {
    for (const c of COLORS) expect(contrast(c, '#ffffff'), c).toBeGreaterThanOrEqual(4.5)
  })

  it('the stylesheet really defines the tokens the tests rely on', () => {
    for (const k of ['color-text-primary', 'color-bg-canvas', 'color-bg-muted', 'color-text-secondary', 'color-accent-default', 'color-accent-on-accent', 'color-danger-text', 'color-bg-surface', 'color-accent-subtle', 'color-text-link', 'color-focus-ring']) {
      expect(themes.light[k], `light --mrd-${k}`).toBeTruthy()
    }
  })
})
