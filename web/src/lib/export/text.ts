import { runsToText, type Block, type Run } from './blocks'

const indent = (text: string, pad: string) => text.split('\n').map((line) => (line ? pad + line : line)).join('\n')

// ---- plain text ------------------------------------------------------------------------------------
function plainBlock(b: Block): string {
  switch (b.type) {
    case 'heading':
    case 'paragraph':
      return runsToText(b.runs)
    case 'list':
      return b.items
        .map((item, i) => {
          const marker = b.ordered ? `${i + 1}. ` : '- '
          const body = item.map(plainBlock).join('\n')
          return marker + indent(body, ' '.repeat(marker.length)).trimStart()
        })
        .join('\n')
    case 'quote':
      return indent(b.blocks.map(plainBlock).join('\n\n'), '> ')
    case 'code':
      return indent(b.text, '    ')
    case 'rule':
      return '----------'
    case 'image':
      return `[Image${b.alt ? `: ${b.alt}` : ''}]`
  }
}

export const toPlainText = (blocks: Block[]) => blocks.map(plainBlock).join('\n\n') + '\n'

// ---- Markdown --------------------------------------------------------------------------------------
function markRun(r: Run): string {
  let t = r.text
  if (r.code) t = '`' + t + '`'
  if (r.bold) t = `**${t}**`
  if (r.italic) t = `*${t}*`
  if (r.strike) t = `~~${t}~~`
  if (r.href) t = `[${t}](${r.href})`
  return t
}

function markdownBlock(b: Block): string {
  switch (b.type) {
    case 'heading':
      return '#'.repeat(b.level) + ' ' + b.runs.map(markRun).join('')
    case 'paragraph':
      return b.runs.map(markRun).join('')
    case 'list':
      return b.items
        .map((item, i) => {
          const marker = b.ordered ? `${i + 1}. ` : '- '
          return marker + indent(item.map(markdownBlock).join('\n'), ' '.repeat(marker.length)).trimStart()
        })
        .join('\n')
    case 'quote':
      return indent(b.blocks.map(markdownBlock).join('\n\n'), '> ')
    case 'code':
      return '```\n' + b.text + '\n```'
    case 'rule':
      return '---'
    case 'image':
      return `![${b.alt}](${b.src})`
  }
}

export const toMarkdown = (blocks: Block[]) => blocks.map(markdownBlock).join('\n\n') + '\n'
