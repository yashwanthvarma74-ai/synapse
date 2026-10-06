// Type "/" at the start of a line (or after a space) to open a menu of blocks. Arrow keys move,
// Enter or Tab picks, Escape closes. The menu is a listbox that the editor points at with
// aria-activedescendant, so screen reader users hear the highlighted option while focus
// stays in the text.
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { filterSlashItems, slashItems, type SlashItem } from './slashItems'

const LIST_ID = 'slash-menu'

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowedPrefixes: [' '],
        items: ({ query }) => filterSlashItems(slashItems, query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let list: HTMLDivElement | null = null
          let items: SlashItem[] = []
          let active = 0
          let pick: ((item: SlashItem) => void) | null = null
          let dom: HTMLElement | null = null

          const draw = () => {
            if (!list) return
            list.replaceChildren()
            if (!items.length) {
              const empty = document.createElement('div')
              empty.className = 'slash-empty'
              empty.textContent = 'No matching block'
              list.append(empty)
            }
            items.forEach((item, i) => {
              const row = document.createElement('div')
              row.id = `${LIST_ID}-${item.id}`
              row.setAttribute('role', 'option')
              row.setAttribute('aria-selected', String(i === active))
              row.className = 'slash-item'
              const t = document.createElement('strong'); t.textContent = item.title
              const h = document.createElement('span'); h.textContent = item.hint
              row.append(t, h)
              row.addEventListener('mousedown', (e) => { e.preventDefault(); pick?.(item) })
              list!.append(row)
            })
            const cur = items[active]
            if (cur) dom?.setAttribute('aria-activedescendant', `${LIST_ID}-${cur.id}`)
            else dom?.removeAttribute('aria-activedescendant')
          }
          const place = (rect: DOMRect | null | undefined) => {
            if (!list || !rect) return
            list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`
            list.style.top = `${rect.bottom + 6}px`
          }
          const close = () => {
            list?.remove(); list = null
            dom?.removeAttribute('aria-activedescendant')
            dom?.removeAttribute('aria-expanded')
            dom?.removeAttribute('aria-controls')
          }
          return {
            onStart: (p) => {
              dom = p.editor.view.dom as HTMLElement
              items = p.items; active = 0; pick = (item) => p.command(item)
              list = document.createElement('div')
              list.id = LIST_ID
              list.className = 'slash-menu'
              list.setAttribute('role', 'listbox')
              list.setAttribute('aria-label', 'Insert a block')
              document.body.append(list)
              dom.setAttribute('aria-expanded', 'true')
              dom.setAttribute('aria-controls', LIST_ID)
              draw(); place(p.clientRect?.())
            },
            onUpdate: (p) => {
              items = p.items; active = Math.min(active, Math.max(0, items.length - 1)); pick = (item) => p.command(item)
              draw(); place(p.clientRect?.())
            },
            onKeyDown: ({ event }) => {
              if (event.key === 'ArrowDown') { active = (active + 1) % Math.max(1, items.length); draw(); return true }
              if (event.key === 'ArrowUp') { active = (active - 1 + items.length) % Math.max(1, items.length); draw(); return true }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const cur = items[active]
                if (!cur) return false
                pick?.(cur); return true
              }
              if (event.key === 'Escape') { close(); return true }
              return false
            },
            onExit: close,
          }
        },
      }),
    ]
  },
})
