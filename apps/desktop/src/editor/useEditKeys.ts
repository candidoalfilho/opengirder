/**
 * Atalhos de teclado do editor gráfico. Só valem com o modo de edição ligado e quando o foco
 * não está num campo de texto. Ctrl/Cmd+Z e Shift+Z (desfazer/refazer) já são tratados na
 * barra superior.
 */

import { useEffect } from 'react'
import { useStore } from '../store'
import type { EditTool } from './types'
import { cancelCommand, deleteSelected } from './session'

const TOOL_KEYS: Record<string, EditTool> = { s: 'select', n: 'node', b: 'frame', c: 'cable', m: 'move' }

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export function useEditKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      if (!st.edit.active || !st.model || st.screen !== 'workspace' || typing(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') {
        // 1º cancela o comando em curso; depois limpa a seleção; por fim volta a Selecionar
        if (cancelCommand()) return
        const { sel, tool } = st.edit
        if (sel.nodes.length || sel.elements.length) st.setEditSel({ nodes: [], elements: [] })
        else if (tool !== 'select') st.setEdit({ tool: 'select' })
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        st.setEditSel({ nodes: st.model.nodes.map((n) => n.id), elements: st.model.elements.map((x) => x.id) })
        return
      }
      if (mod || e.altKey) return
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) {
        cancelCommand()
        st.setEdit({ tool })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
