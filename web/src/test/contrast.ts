// WCAG 2 contrast maths, used by the accessibility tests.
const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)

export function luminance(hex: string) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Read the colour tokens (--mrd-name: #hex) from the design system's light theme: everything in its
// tokens.css before the dark theme starts. Synapse has one theme: light.
export function readThemes(css: string) {
  const root = css.slice(0, css.indexOf("[data-theme='dark']"))
  const light = Object.fromEntries([...root.matchAll(/--mrd-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
  return { light }
}
