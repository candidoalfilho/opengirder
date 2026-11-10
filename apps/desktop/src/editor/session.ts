/**
 * Estado efêmero do comando de desenho em curso (não entra no desfazer nem no arquivo):
 * o nó de partida da barra/cabo, o último ponto usado e a dica de status. Também concentra
 * a lógica de "confirmar um ponto", usada tanto pelo clique no 3D quanto pelo campo de
 * coordenadas da barra de ferramentas.
 */

import { create } from 'zustand'
import type { BridgeModel, Vec3 } from '@opengirder/engine'
import { useStore } from '../store'
import type { EditSelection } from './types'
import { addCableBetween, addFrameBetween, deleteSelection, resolvePoint, type PointTarget } from './draw'

interface Session {
  /** nó de partida do elemento em desenho */
  pending: number | null
  /** último ponto confirmado (p/ coordenadas relativas) */
  last: Vec3 | null
  set: (p: Partial<Pick<Session, 'pending' | 'last'>>) => void
}

export const useEditSession = create<Session>((set) => ({
  pending: null,
  last: null,
  set: (p) => set(p),
}))

const nodePos = (m: BridgeModel, id: number): Vec3 | null => {
  const n = m.nodes.find((x) => x.id === id)
  return n ? [n.x, n.y, n.z] : null
}

/** cancela o comando em curso; devolve true se havia algo a cancelar */
export function cancelCommand(): boolean {
  const s = useEditSession.getState()
  if (s.pending === null) return false
  s.set({ pending: null })
  return true
}

/**
 * Confirma um ponto com a ferramenta ativa (nó, barra ou cabo). Uma única chamada de
 * `updateModel` por clique, para o desfazer voltar um passo por vez.
 */
export function commitPoint(target: PointTarget): void {
  const st = useStore.getState()
  const model = st.model
  if (!model) return
  const { tool, defaults } = st.edit
  if (tool !== 'node' && tool !== 'frame' && tool !== 'cable') return
  const ses = useEditSession.getState()

  const r = resolvePoint(model, target)
  if (typeof r === 'string') {
    st.notify(r, 'err')
    return
  }
  let next = r.model
  const node = r.node
  let sel: EditSelection = { nodes: [node], elements: [] }
  let pending: number | null = ses.pending

  if (tool === 'node') {
    pending = null
  } else if (pending === null || !next.nodes.some((n) => n.id === pending)) {
    pending = node
  } else if (pending === node) {
    // clique repetido no mesmo ponto encerra a polilinha
    pending = null
  } else {
    const made = tool === 'frame' ? addFrameBetween(next, pending, node, defaults) : addCableBetween(next, pending, node, defaults)
    if (typeof made === 'string') {
      st.notify(made, 'err')
      // o ponto novo (se houve) fica; o comando segue a partir dele na barra
      if (next !== model) st.updateModel(() => next)
      useEditSession.getState().set({ pending: tool === 'frame' ? node : null, last: nodePos(next, node) })
      return
    }
    next = made.model
    sel = { nodes: [], elements: [made.id] }
    pending = tool === 'frame' ? node : null
  }
  if (next !== model) st.updateModel(() => next)
  useStore.getState().setEditSel(sel)
  useEditSession.getState().set({ pending, last: nodePos(next, node) })
}

/** apaga a seleção do editor, avisando o que não pôde ser apagado */
export function deleteSelected(): void {
  const st = useStore.getState()
  const model = st.model
  if (!model) return
  const sel = st.edit.sel
  if (sel.nodes.length === 0 && sel.elements.length === 0) return
  const r = deleteSelection(model, sel)
  if (r.model !== model) st.updateModel(() => r.model)
  cancelCommand()
  const parts: string[] = []
  if (r.removedElements) parts.push(`${r.removedElements} elemento(s)`)
  if (r.removedNodes) parts.push(`${r.removedNodes} nó(s)`)
  if (r.kept.length) {
    st.notify(
      `${parts.length ? `Apagado: ${parts.join(' e ')}. ` : ''}Nó(s) ${r.kept.slice(0, 6).join(', ')}${r.kept.length > 6 ? '…' : ''} ainda em uso por outros elementos — não apagado(s).`,
      'err',
    )
  } else if (parts.length) st.notify(`Apagado: ${parts.join(' e ')}.`)
  useStore.getState().setEditSel({ nodes: r.kept, elements: [] })
}

/** texto de ajuda da ferramenta, conforme o estágio do comando */
export function toolHint(tool: string, pending: number | null): string {
  switch (tool) {
    case 'select':
      return 'Clique para selecionar · Shift acrescenta · arraste no vazio para a janela · Delete apaga'
    case 'node':
      return 'Clique para criar um nó (sobre uma barra, divide a barra)'
    case 'frame':
      return pending === null ? 'Barra: clique no 1º ponto' : `Barra: clique no próximo ponto (a partir do nó ${pending}) · Esc encerra`
    case 'cable':
      return pending === null ? 'Cabo: clique na 1ª ancoragem' : `Cabo: clique na 2ª ancoragem (a partir do nó ${pending}) · Esc cancela`
    case 'move':
      return 'Mover: arraste a seleção no plano de trabalho'
    default:
      return ''
  }
}

/** os botões de vista (Elevação, Planta, Frontal) levam o plano de trabalho junto */
export function followView(preset: string): void {
  const st = useStore.getState()
  if (!st.edit.active) return
  const kind = preset === 'elev' ? 'elevation' : preset === 'plan' ? 'plan' : preset === 'front' ? 'cross' : null
  if (!kind || kind === st.edit.plane.kind) return
  const axis = kind === 'elevation' ? 1 : kind === 'plan' ? 2 : 0
  st.setEdit({ plane: { kind, offset: planeOffsetFor(st.model, axis, st.edit.sel.nodes, useEditSession.getState().last) } })
}

/**
 * Posição natural de um plano de trabalho novo: passa pelo último ponto usado, senão pelo nó
 * selecionado, senão pelo valor mais frequente da coordenada entre os nós (o eixo da ponte em
 * elevação, o greide em planta) — em corte, pelo meio da obra.
 */
export function planeOffsetFor(model: BridgeModel | null, axis: 0 | 1 | 2, selNodes: number[], last: Vec3 | null): number {
  if (last) return last[axis]
  if (!model || model.nodes.length === 0) return 0
  const coord = (n: { x: number; y: number; z: number }): number => (axis === 0 ? n.x : axis === 1 ? n.y : n.z)
  const picked = model.nodes.find((n) => n.id === selNodes[selNodes.length - 1])
  if (picked) return coord(picked)
  if (axis === 0) {
    let lo = Infinity
    let hi = -Infinity
    for (const n of model.nodes) {
      lo = Math.min(lo, n.x)
      hi = Math.max(hi, n.x)
    }
    return Math.round(((lo + hi) / 2) * 1000) / 1000
  }
  const count = new Map<number, number>()
  let best = 0
  let bestN = 0
  for (const n of model.nodes) {
    const v = Math.round(coord(n) * 1000) / 1000
    const c = (count.get(v) ?? 0) + 1
    count.set(v, c)
    if (c > bestN) {
      bestN = c
      best = v
    }
  }
  return best
}

/** abre um modelo em branco já no modo de edição */
export function startBlank(model: BridgeModel): void {
  const st = useStore.getState()
  st.loadModel(model)
  useStore.getState().setEdit({ active: true, tool: 'frame', plane: { kind: 'elevation', offset: 0 }, sel: { nodes: [], elements: [] } })
  useEditSession.getState().set({ pending: null, last: null })
}
