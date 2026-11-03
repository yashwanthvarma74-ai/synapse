// Editor extension: choose a file from a picker, or paste / drop files into the page. Images
// become pictures, anything else becomes a link. Needs the document id for the upload permit.
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ACCEPT, uploadFile, type Uploaded } from './uploads'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    uploads: {
      chooseFile: (kind: 'image' | 'file') => ReturnType
    }
  }
}

export interface UploadOptions {
  docId: string
  onStatus: (message: string, isError?: boolean) => void
}

function insert(editor: Editor, file: Uploaded, pos?: number) {
  const at = pos ?? editor.state.selection.to
  if (file.image) editor.chain().focus().insertContentAt(at, { type: 'image', attrs: { src: file.url, alt: file.name } }).run()
  else editor.chain().focus().insertContentAt(at, [{ type: 'text', text: file.name, marks: [{ type: 'link', attrs: { href: file.url } }] }, { type: 'text', text: ' ' }]).run()
}

async function handle(editor: Editor, opts: UploadOptions, files: File[], pos?: number) {
  for (const file of files) {
    opts.onStatus(`Uploading ${file.name}…`)
    try {
      insert(editor, await uploadFile(opts.docId, file), pos)
      opts.onStatus(`Added ${file.name}.`)
    } catch (err) {
      opts.onStatus((err as Error).message, true)
    }
  }
}

export const Uploads = Extension.create<UploadOptions>({
  name: 'uploads',
  addOptions: () => ({ docId: '', onStatus: () => {} }),
  addCommands() {
    return {
      chooseFile: (kind) => () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = kind === 'image' ? ACCEPT.split(',').filter((t) => t.startsWith('image/')).join(',') : ACCEPT
        input.onchange = () => void handle(this.editor, this.options, [...(input.files ?? [])])
        input.click()
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    const { editor, options } = this
    return [
      new Plugin({
        key: new PluginKey('uploadPasteDrop'),
        props: {
          handlePaste: (_view, event) => {
            const files = [...(event.clipboardData?.files ?? [])]
            if (!files.length) return false // normal text paste
            void handle(editor, options, files)
            return true
          },
          handleDrop: (view, event) => {
            const files = [...(event.dataTransfer?.files ?? [])]
            if (!files.length) return false
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            void handle(editor, options, files, at)
            return true
          },
        },
      }),
    ]
  },
})
