// Run axe-core against a rendered component. jsdom has no layout engine, so the
// colour-contrast rule is skipped here; contrast is covered by a11y.test.ts instead.
import axe from 'axe-core'

export async function violationsIn(container: Element) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
  return result.violations.map((v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(' ')).join(' ; ')}]`)
}
