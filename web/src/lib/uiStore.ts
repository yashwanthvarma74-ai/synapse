// UI-only state (Zustand): things that exist only in this browser tab and never touch the
// server. Anything fetched from the server belongs in queries.ts instead.
import { create } from 'zustand'
import type { Tool } from './canvasRenderer'

interface UiState {
  shareOpen: boolean
  setShareOpen: (open: boolean) => void
  canvasTool: Tool
  setCanvasTool: (tool: Tool) => void
  canvasHelpOpen: boolean
  setCanvasHelpOpen: (open: boolean) => void
  resetCanvasUi: () => void
}

export const useUi = create<UiState>((set) => ({
  shareOpen: false,
  setShareOpen: (shareOpen) => set({ shareOpen }),
  canvasTool: 'select',
  setCanvasTool: (canvasTool) => set({ canvasTool }),
  canvasHelpOpen: false,
  setCanvasHelpOpen: (canvasHelpOpen) => set({ canvasHelpOpen }),
  resetCanvasUi: () => set({ canvasTool: 'select', canvasHelpOpen: false }),
}))
