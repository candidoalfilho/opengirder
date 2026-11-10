import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { numToInput, parseNum } from '../../format'

/** campo numérico que só grava ao sair do campo ou com Enter */
export function NumField({
  label, unit, value, min = 0, max, onCommit, live = false,
}: {
  label: string
  unit?: string
  value: number
  min?: number
  max?: number
  onCommit: (v: number) => void
  /** grava a cada tecla válida (calculadoras), em vez de esperar o Enter */
  live?: boolean
}) {
  const [text, setText] = useState(numToInput(value))
  useEffect(() => setText(numToInput(value)), [value])
  const v = parseNum(text)
  const valid = Number.isFinite(v) && v >= min && (max === undefined || v <= max)
  const commit = () => {
    if (!valid) {
      setText(numToInput(value))
      return
    }
    if (Math.abs(v - value) > 1e-12) onCommit(v)
  }
  return (
    <div className="field">
      <label className="label">
        {label}
        {unit && <span className="unit">{unit}</span>}
      </label>
      <input
        className={`input ${valid ? '' : 'invalid'}`}
        value={text}
        inputMode="decimal"
        onChange={(e) => {
          setText(e.target.value)
          if (live) {
            const x = parseNum(e.target.value)
            if (Number.isFinite(x) && x >= min && (max === undefined || x <= max)) onCommit(x)
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </div>
  )
}

/** seleção múltipla do editor, lida de forma defensiva (o editor gráfico é opcional) */
export function editSelectionOf(state: unknown): { nodes: number[]; elements: number[] } {
  const s = state as { edit?: { sel?: { nodes: number[]; elements: number[] } }; selection?: { kind: 'node' | 'element'; id: number } | null }
  const sel = s.edit?.sel
  if (sel && (sel.nodes.length || sel.elements.length)) return sel
  if (s.selection) return s.selection.kind === 'node' ? { nodes: [s.selection.id], elements: [] } : { nodes: [], elements: [s.selection.id] }
  return { nodes: [], elements: [] }
}

/** seleciona no 3D: usa a seleção múltipla do editor se existir; senão o primeiro item */
export function selectInView(getState: () => unknown, sel: { nodes: number[]; elements: number[] }): void {
  const s = getState() as {
    setEditSel?: (sel: { nodes: number[]; elements: number[] }) => void
    select: (s: { kind: 'node' | 'element'; id: number } | null) => void
  }
  if (s.setEditSel) {
    s.setEditSel(sel)
    return
  }
  if (sel.elements.length) s.select({ kind: 'element', id: sel.elements[0] })
  else if (sel.nodes.length) s.select({ kind: 'node', id: sel.nodes[0] })
}

/** seleção atual (múltipla do editor, ou a simples) como hook — referências estáveis p/ o zustand */
export function useEditSelection(): { nodes: number[]; elements: number[] } {
  const multi = useStore((s) => (s as unknown as { edit?: { sel?: { nodes: number[]; elements: number[] } } }).edit?.sel)
  const single = useStore((s) => s.selection)
  return useMemo(() => editSelectionOf({ edit: { sel: multi }, selection: single }), [multi, single])
}
