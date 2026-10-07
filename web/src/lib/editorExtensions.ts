import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'

// What a document can contain. The editor, the version preview and the exports all use the same list,
// so they agree on what a "heading" or an "image" is.
export const contentExtensions = [
  StarterKit.configure({ undoRedo: false }), // undo comes from Yjs, so it only undoes your own edits
  Image.configure({ HTMLAttributes: { loading: 'lazy' } }),
]
