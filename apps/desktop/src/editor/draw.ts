/**
 * Operações elementares do desenho no 3D (funções puras sobre o modelo): resolver um ponto
 * clicado em nó (novo, existente ou dividindo uma barra), criar barra/cabo com os padrões do
 * editor, mover e apagar a seleção. As operações de modelagem "de menu" (copiar, espelhar,
 * gerar estais…) ficam em editor/ops.ts + editor/actions.ts.
 */

import type { BridgeModel, BridgeNode, CableElement, Element, FrameElement, Vec3 } from '@opengirder/engine'
import type { EditDefaults, EditSelection } from './types'
import { splitFrameAt } from './ops'

/** tolerância p/ considerar dois pontos o mesmo nó (m) */
export const NODE_TOL = 1e-3

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6

export const nextNodeId = (m: BridgeModel): number => m.nodes.reduce((a, n) => Math.max(a, n.id), 0) + 1
export const nextElementId = (m: BridgeModel): number => m.elements.reduce((a, e) => Math.max(a, e.id), 0) + 1

export function nodeAt(model: BridgeModel, p: Vec3, tol = NODE_TOL): BridgeNode | undefined {
  return model.nodes.find((n) => Math.hypot(n.x - p[0], n.y - p[1], n.z - p[2]) <= tol)
}

/** alvo de um clique: ponto no espaço, e o nó ou a barra em que ele caiu */
export interface PointTarget {
  p: Vec3
  node?: number
  frame?: { id: number; t: number }
}

/** transforma o alvo do clique em nó: reutiliza, divide a barra ou cria */
export function resolvePoint(model: BridgeModel, target: PointTarget): { model: BridgeModel; node: number; created: boolean } | string {
  if (target.node !== undefined && model.nodes.some((n) => n.id === target.node)) {
    return { model, node: target.node, created: false }
  }
  const near = nodeAt(model, target.p)
  if (near) return { model, node: near.id, created: false }
  if (target.frame) {
    const r = splitFrameAt(model, target.frame.id, target.frame.t)
    if (typeof r === 'string') return r
    return { model: r.model, node: r.node, created: r.model !== model }
  }
  if (!target.p.every(Number.isFinite)) return 'Coordenada inválida.'
  const id = nextNodeId(model)
  const node: BridgeNode = { id, x: r6(target.p[0]), y: r6(target.p[1]), z: r6(target.p[2]), role: 'other' }
  return { model: { ...model, nodes: [...model.nodes, node] }, node: id, created: true }
}

const linked = (model: BridgeModel, n1: number, n2: number): Element | undefined =>
  model.elements.find((e) => (e.n1 === n1 && e.n2 === n2) || (e.n1 === n2 && e.n2 === n1))

export function addFrameBetween(model: BridgeModel, n1: number, n2: number, d: EditDefaults): { model: BridgeModel; id: number } | string {
  if (n1 === n2) return 'Os dois pontos da barra coincidem.'
  if (linked(model, n1, n2)) return 'Já existe um elemento entre esses dois nós.'
  if (!model.materials.some((m) => m.id === d.frameMat)) return 'Escolha um material para a barra.'
  if (!model.sections.some((s) => s.id === d.frameSec)) return 'Escolha uma seção para a barra.'
  const id = nextElementId(model)
  const el: FrameElement = { kind: 'frame', id, n1, n2, mat: d.frameMat, sec: d.frameSec, group: d.frameGroup }
  return { model: { ...model, elements: [...model.elements, el] }, id }
}

export function addCableBetween(model: BridgeModel, n1: number, n2: number, d: EditDefaults): { model: BridgeModel; id: number } | string {
  if (n1 === n2) return 'Os dois pontos do cabo coincidem.'
  if (linked(model, n1, n2)) return 'Já existe um elemento entre esses dois nós.'
  if (!model.materials.some((m) => m.id === d.cableMat)) return 'Escolha um material para o cabo.'
  if (!(d.cableA > 0)) return 'A área do cabo deve ser positiva.'
  const id = nextElementId(model)
  const el: CableElement = { kind: 'cable', id, n1, n2, mat: d.cableMat, A: d.cableA, group: d.cableGroup }
  if (d.cableStrands > 0) el.strands = Math.round(d.cableStrands)
  return { model: { ...model, elements: [...model.elements, el] }, id }
}

/** nós da seleção: os selecionados e as extremidades dos elementos selecionados */
export function selectionNodes(model: BridgeModel, sel: EditSelection): number[] {
  const out = new Set(sel.nodes)
  const els = new Set(sel.elements)
  for (const e of model.elements) {
    if (els.has(e.id)) {
      out.add(e.n1)
      out.add(e.n2)
    }
  }
  return [...out]
}

/**
 * Apaga a seleção: os elementos selecionados e depois os nós selecionados que ficaram sem uso.
 * Nó ainda usado por elemento não selecionado é mantido (devolvido em `kept`).
 */
export function deleteSelection(
  model: BridgeModel,
  sel: EditSelection,
): { model: BridgeModel; removedElements: number; removedNodes: number; kept: number[] } {
  const els = new Set(sel.elements)
  const elements = model.elements.filter((e) => !els.has(e.id))
  const used = new Set<number>()
  for (const e of elements) {
    used.add(e.n1)
    used.add(e.n2)
  }
  const kept = sel.nodes.filter((id) => used.has(id))
  const gone = new Set(sel.nodes.filter((id) => !used.has(id)))
  const nodes = model.nodes.filter((n) => !gone.has(n.id))
  const removedElements = model.elements.length - elements.length
  const removedNodes = model.nodes.length - nodes.length
  if (removedElements === 0 && removedNodes === 0) return { model, removedElements, removedNodes, kept }
  const lanes = model.lanes
    .map((l) => (l.nodes.some((id) => gone.has(id)) ? { ...l, nodes: l.nodes.filter((id) => !gone.has(id)) } : l))
    .filter((l) => l.nodes.length >= 2)
  const loadCases = model.loadCases.map((lc) => ({
    ...lc,
    ...(lc.nodal ? { nodal: lc.nodal.filter((x) => !gone.has(x.node)) } : {}),
    ...(lc.uniform ? { uniform: lc.uniform.filter((x) => !els.has(x.element)) } : {}),
  }))
  return { model: { ...model, nodes, elements, lanes, loadCases }, removedElements, removedNodes, kept }
}

/** desloca os nós; cabos ligados a eles perdem o L0 (o form-finding recalcula) */
export function translateNodes(model: BridgeModel, ids: number[], d: Vec3): BridgeModel {
  if (ids.length === 0 || (d[0] === 0 && d[1] === 0 && d[2] === 0)) return model
  const set = new Set(ids)
  const nodes = model.nodes.map((n) => (set.has(n.id) ? { ...n, x: r6(n.x + d[0]), y: r6(n.y + d[1]), z: r6(n.z + d[2]) } : n))
  const elements = model.elements.map((e) => {
    if (e.kind !== 'cable' || e.L0 === undefined || (!set.has(e.n1) && !set.has(e.n2))) return e
    const { L0: _drop, ...rest } = e
    return rest
  })
  return { ...model, nodes, elements }
}

/** aplica as mesmas restrições a vários nós */
export function setNodesFix(model: BridgeModel, ids: number[], fix: boolean[]): BridgeModel {
  const set = new Set(ids)
  const any = fix.some(Boolean)
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      if (!set.has(n.id)) return n
      const { fix: _f, ...rest } = n
      return any ? { ...rest, fix: [fix[0], fix[1], fix[2], fix[3], fix[4], fix[5]] as BridgeNode['fix'] } : rest
    }),
  }
}

/** interpreta "x; y; z" (ou 2 valores no plano de trabalho); prefixo @ = relativo. null = inválido */
export function parseCoords(
  text: string,
  plane: { kind: 'elevation' | 'plan' | 'cross'; offset: number },
  last: Vec3 | null,
): Vec3 | null {
  let t = text.trim()
  const rel = t.startsWith('@')
  if (rel) t = t.slice(1)
  const parts = t.split(/[;\s]+/).filter((x) => x.length > 0).map((x) => Number(x.replace(',', '.')))
  if (parts.length < 2 || parts.length > 3 || !parts.every(Number.isFinite)) return null
  let v: Vec3
  if (parts.length === 3) v = [parts[0], parts[1], parts[2]]
  else if (plane.kind === 'elevation') v = [parts[0], rel ? 0 : plane.offset, parts[1]]
  else if (plane.kind === 'plan') v = [parts[0], parts[1], rel ? 0 : plane.offset]
  else v = [rel ? 0 : plane.offset, parts[0], parts[1]]
  if (!rel) return v
  if (!last) return null
  return [last[0] + v[0], last[1] + v[1], last[2] + v[2]]
}
