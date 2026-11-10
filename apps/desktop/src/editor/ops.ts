/**
 * Operações de modelagem — funções PURAS sobre o `BridgeModel` (sem React, sem DOM).
 *
 * Cada operação devolve um modelo novo (o original não é alterado) ou uma string com o
 * motivo da recusa. São a base do editor gráfico (cliques no 3D) e do menu "Operações"
 * (editor/actions.ts), e bastam para montar uma ponte do zero: nós, barras, divisão do
 * tabuleiro, torre, estais, pendurais, cópias e espelhamentos.
 *
 * Unidades do modelo: m, kN, kPa. Tudo o que referencia nós ou barras acompanha as mudanças:
 * pistas (`lanes`), cargas (`loadCases`) e cabos de protensão com caminho explícito.
 */

import type {
  BridgeModel,
  BridgeNode,
  CableElement,
  Dof6,
  Element,
  ElementGroup,
  FrameElement,
  Lane,
  LoadCase,
  Material,
  Vec3,
} from '@opengirder/engine'
import type { EditSelection } from './types'

export type P3 = [number, number, number]

/** tolerância de coincidência de nós (m) */
export const NODE_TOL = 1e-3

export interface OpOk {
  model: BridgeModel
  select?: EditSelection
  message?: string
}
export type OpResult = OpOk | string

export interface FrameDefaults {
  mat: string
  sec: string
  group?: ElementGroup
  up?: Vec3
}

export interface CableDefaults {
  mat: string
  /** área metálica (m²) */
  A: number
  group?: ElementGroup
  strands?: number
  pretension?: number
}

/* ------------------------------------------------------------------ utilitários */

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6

export const nextNodeId = (model: BridgeModel): number => model.nodes.reduce((a, n) => Math.max(a, n.id), 0) + 1
export const nextElementId = (model: BridgeModel): number => model.elements.reduce((a, e) => Math.max(a, e.id), 0) + 1

export const pos = (n: BridgeNode): P3 => [n.x, n.y, n.z]
const dist = (a: P3, b: P3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function nodeMap(model: BridgeModel): Map<number, BridgeNode> {
  return new Map(model.nodes.map((n) => [n.id, n]))
}

/** id do nó a menos de `tol` do ponto (o mais próximo), ou undefined */
export function findNodeAt(model: BridgeModel, p: P3, tol = NODE_TOL): number | undefined {
  let best: number | undefined
  let bd = tol
  for (const n of model.nodes) {
    const d = dist(pos(n), p)
    if (d <= bd) {
      bd = d
      best = n.id
    }
  }
  return best
}

/** devolve o nó existente no ponto (a menos de 1 mm) ou cria um */
export function ensureNode(
  model: BridgeModel,
  p: P3,
  extra: Partial<Pick<BridgeNode, 'role' | 'fix' | 'springs'>> = {},
): { model: BridgeModel; id: number; created: boolean } {
  if (!p.every(Number.isFinite)) throw new Error('Coordenada inválida.')
  const found = findNodeAt(model, p)
  if (found !== undefined) return { model, id: found, created: false }
  const id = nextNodeId(model)
  const node: BridgeNode = { id, x: r6(p[0]), y: r6(p[1]), z: r6(p[2]), role: extra.role ?? 'other' }
  if (extra.fix?.some(Boolean)) node.fix = [...extra.fix] as Dof6<boolean>
  if (extra.springs?.some((k) => k > 0)) node.springs = [...extra.springs] as Dof6<number>
  return { model: { ...model, nodes: [...model.nodes, node] }, id, created: true }
}

const sameEnds = (e: Element, a: number, b: number): boolean => (e.n1 === a && e.n2 === b) || (e.n1 === b && e.n2 === a)

/** nós da seleção: os selecionados mais as extremidades dos elementos selecionados */
export function selectionNodes(model: BridgeModel, sel: EditSelection): number[] {
  const out = new Set(sel.nodes)
  const ids = new Set(sel.elements)
  for (const e of model.elements) {
    if (ids.has(e.id)) {
      out.add(e.n1)
      out.add(e.n2)
    }
  }
  const valid = new Set(model.nodes.map((n) => n.id))
  return [...out].filter((id) => valid.has(id))
}

/* ------------------------------------------------------------------ criar barras e cabos */

export function addFrameBetween(model: BridgeModel, n1: number, n2: number, d: FrameDefaults): { model: BridgeModel; id: number } | string {
  const nodes = nodeMap(model)
  const a = nodes.get(n1)
  const b = nodes.get(n2)
  if (!a || !b) return 'Nó inexistente.'
  if (n1 === n2 || dist(pos(a), pos(b)) < NODE_TOL) return 'A barra precisa de dois nós distintos.'
  if (!model.materials.some((m) => m.id === d.mat)) return `Material "${d.mat}" não existe no modelo.`
  if (!model.sections.some((s) => s.id === d.sec)) return `Seção "${d.sec}" não existe no modelo.`
  if (model.elements.some((e) => sameEnds(e, n1, n2))) return `Já existe um elemento entre os nós ${n1} e ${n2}.`
  const id = nextElementId(model)
  const el: FrameElement = { kind: 'frame', id, n1, n2, mat: d.mat, sec: d.sec, group: d.group ?? 'deck' }
  if (d.up) el.up = d.up
  return { model: { ...model, elements: [...model.elements, el] }, id }
}

export function addCableBetween(model: BridgeModel, n1: number, n2: number, d: CableDefaults): { model: BridgeModel; id: number } | string {
  const nodes = nodeMap(model)
  const a = nodes.get(n1)
  const b = nodes.get(n2)
  if (!a || !b) return 'Nó inexistente.'
  if (n1 === n2 || dist(pos(a), pos(b)) < NODE_TOL) return 'O cabo precisa de dois nós distintos.'
  if (!model.materials.some((m) => m.id === d.mat)) return `Material "${d.mat}" não existe no modelo.`
  if (!(d.A > 0)) return 'A área do cabo deve ser positiva.'
  if (model.elements.some((e) => sameEnds(e, n1, n2))) return `Já existe um elemento entre os nós ${n1} e ${n2}.`
  const id = nextElementId(model)
  const el: CableElement = { kind: 'cable', id, n1, n2, mat: d.mat, A: d.A, group: d.group ?? 'stay' }
  if (d.strands && d.strands > 0) el.strands = d.strands
  if (d.pretension && d.pretension > 0) el.pretension = d.pretension
  return { model: { ...model, elements: [...model.elements, el] }, id }
}

/* ------------------------------------------------------------------ dividir barras */

/** insere `mids` entre `a` e `b` onde eles forem consecutivos numa lista de nós (pista, traçado) */
function insertBetween(list: number[], a: number, b: number, mids: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < list.length; i++) {
    out.push(list[i])
    if (i + 1 < list.length) {
      if (list[i] === a && list[i + 1] === b) out.push(...mids)
      else if (list[i] === b && list[i + 1] === a) out.push(...[...mids].reverse())
    }
  }
  return out
}

/**
 * Divide a barra nos parâmetros `ts` (0 < t < 1, a partir de n1). O 1º trecho mantém o id da
 * barra; os demais recebem ids novos. Pistas, traçados de protensão e cargas distribuídas
 * que usavam a barra passam a usar todos os trechos.
 */
export function subdivideFrame(model: BridgeModel, elementId: number, ts: number[]): { model: BridgeModel; nodes: number[]; elements: number[] } | string {
  const el = model.elements.find((e) => e.id === elementId)
  if (!el) return `Elemento ${elementId} não existe.`
  if (el.kind !== 'frame') return `O elemento ${elementId} é um cabo: só barras podem ser divididas.`
  const nodes = nodeMap(model)
  const a = nodes.get(el.n1)
  const b = nodes.get(el.n2)
  if (!a || !b) return `Barra ${elementId} referencia nó inexistente.`
  const L = dist(pos(a), pos(b))
  const cut = Array.from(new Set(ts.filter((t) => t * L > NODE_TOL && (1 - t) * L > NODE_TOL).map((t) => Math.round(t * 1e9) / 1e9))).sort((x, y) => x - y)
  if (cut.length === 0) return { model, nodes: [], elements: [elementId] }

  let m = model
  const mids: number[] = []
  for (const t of cut) {
    const p: P3 = [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y), a.z + t * (b.z - a.z)]
    const r = ensureNode(m, p, { role: a.role === b.role ? a.role : 'other' })
    m = r.model
    if (r.id !== el.n1 && r.id !== el.n2 && !mids.includes(r.id)) mids.push(r.id)
  }
  if (mids.length === 0) return { model, nodes: [], elements: [elementId] }
  const chain = [el.n1, ...mids, el.n2]
  let nid = nextElementId(m)
  const pieces: FrameElement[] = []
  for (let i = 0; i + 1 < chain.length; i++) {
    pieces.push({ ...el, id: i === 0 ? el.id : nid++, n1: chain[i], n2: chain[i + 1] })
  }
  const newIds = pieces.slice(1).map((p) => p.id)
  const elements: Element[] = []
  for (const e of m.elements) {
    if (e.id === el.id) elements.push(...pieces)
    else elements.push(e)
  }
  const lanes = m.lanes.map((l) => ({ ...l, nodes: insertBetween(l.nodes, el.n1, el.n2, mids) }))
  const loadCases = m.loadCases.map((lc) => {
    if (!lc.uniform?.some((u) => u.element === el.id)) return lc
    const uniform = lc.uniform.flatMap((u) => (u.element === el.id ? [u, ...newIds.map((id) => ({ ...u, element: id }))] : [u]))
    return { ...lc, uniform }
  })
  const out: BridgeModel = { ...m, elements, lanes, loadCases }
  if (m.tendons?.some((t) => t.nodes)) {
    out.tendons = m.tendons.map((t) => (t.nodes ? { ...t, nodes: insertBetween(t.nodes, el.n1, el.n2, mids) } : t))
  }
  return { model: out, nodes: mids, elements: pieces.map((p) => p.id) }
}

/** divide a barra num parâmetro t (0–1) ou no ponto mais próximo de `where` sobre o eixo */
export function splitFrameAt(model: BridgeModel, elementId: number, where: number | P3): { model: BridgeModel; node: number } | string {
  let t: number
  if (typeof where === 'number') t = where
  else {
    const el = model.elements.find((e) => e.id === elementId)
    if (!el) return `Elemento ${elementId} não existe.`
    const nodes = nodeMap(model)
    const a = nodes.get(el.n1)
    const b = nodes.get(el.n2)
    if (!a || !b) return `Barra ${elementId} referencia nó inexistente.`
    const d: P3 = [b.x - a.x, b.y - a.y, b.z - a.z]
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    t = L2 > 0 ? ((where[0] - a.x) * d[0] + (where[1] - a.y) * d[1] + (where[2] - a.z) * d[2]) / L2 : 0
  }
  if (!(t > 0 && t < 1)) return 'O ponto de divisão precisa ficar entre as extremidades da barra.'
  const r = subdivideFrame(model, elementId, [t])
  if (typeof r === 'string') return r
  if (r.nodes.length === 0) return 'O ponto de divisão coincide com uma extremidade da barra.'
  return { model: r.model, node: r.nodes[0] }
}

function divideEach(model: BridgeModel, ids: number[], parts: (L: number) => number): OpResult {
  const frames = ids.filter((id) => model.elements.some((e) => e.id === id && e.kind === 'frame'))
  if (frames.length === 0) return 'Selecione ao menos uma barra (cabos não são divididos).'
  let m = model
  const nodes: number[] = []
  const elements: number[] = []
  let created = 0
  const nm = nodeMap(model)
  for (const id of frames) {
    const el = m.elements.find((e) => e.id === id)!
    const L = dist(pos(nm.get(el.n1)!), pos(nm.get(el.n2)!))
    const n = Math.max(1, Math.round(parts(L)))
    const ts: number[] = []
    for (let i = 1; i < n; i++) ts.push(i / n)
    const r = subdivideFrame(m, id, ts)
    if (typeof r === 'string') return r
    m = r.model
    nodes.push(...r.nodes)
    elements.push(...r.elements)
    created += r.elements.length - 1
  }
  if (created === 0) return 'Nada a dividir: as barras já têm o tamanho pedido.'
  return { model: m, select: { nodes: [], elements }, message: `${frames.length} barra(s) dividida(s) em ${elements.length} trechos` }
}

/** divide cada barra em n partes iguais */
export function divideFrames(model: BridgeModel, ids: number[], n: number): OpResult {
  if (!(Number.isFinite(n) && n >= 2)) return 'O número de partes deve ser 2 ou mais.'
  if (n > 500) return 'Número de partes grande demais (máximo 500).'
  return divideEach(model, ids, () => n)
}

/** divide cada barra em trechos iguais de comprimento ≈ `spacing` */
export function divideAtSpacing(model: BridgeModel, ids: number[], spacing: number): OpResult {
  if (!(spacing > 0)) return 'O espaçamento deve ser positivo.'
  return divideEach(model, ids, (L) => Math.min(500, L / spacing))
}

/* ------------------------------------------------------------------ referências */

/** remapeia ids de nós em pistas, cargas e protensão; `map` devolve undefined p/ nó removido */
function remapNodeRefs(model: BridgeModel, map: (id: number) => number | undefined): Pick<BridgeModel, 'lanes' | 'loadCases' | 'tendons'> {
  const path = (list: number[]): number[] => {
    const out: number[] = []
    for (const id of list) {
      const v = map(id)
      if (v === undefined) continue
      if (out[out.length - 1] !== v) out.push(v)
    }
    return out
  }
  const lanes: Lane[] = []
  for (const l of model.lanes) {
    const nodes = path(l.nodes)
    if (nodes.length >= 2) lanes.push({ ...l, nodes })
  }
  const loadCases: LoadCase[] = model.loadCases.map((lc) => {
    if (!lc.nodal?.length) return lc
    const nodal = lc.nodal.flatMap((nl) => {
      const v = map(nl.node)
      return v === undefined ? [] : [{ ...nl, node: v }]
    })
    return { ...lc, nodal }
  })
  const out: Pick<BridgeModel, 'lanes' | 'loadCases' | 'tendons'> = { lanes, loadCases }
  if (model.tendons) {
    const laneIds = new Set(lanes.map((l) => l.id))
    out.tendons = model.tendons.flatMap((t) => {
      if (t.nodes) {
        const nodes = path(t.nodes)
        return nodes.length >= 2 ? [{ ...t, nodes }] : []
      }
      return !t.lane || laneIds.has(t.lane) ? [t] : []
    })
  }
  return out
}

/** tira das cargas distribuídas as barras que não existem mais */
function dropElementRefs(model: BridgeModel): BridgeModel {
  const ids = new Set(model.elements.map((e) => e.id))
  if (!model.loadCases.some((lc) => lc.uniform?.some((u) => !ids.has(u.element)))) return model
  return { ...model, loadCases: model.loadCases.map((lc) => (lc.uniform ? { ...lc, uniform: lc.uniform.filter((u) => ids.has(u.element)) } : lc)) }
}

/* ------------------------------------------------------------------ unir nós */

/**
 * Une os nós a menos de `tol` um do outro (fica o de menor id, com a união das restrições).
 * Remapeia elementos, pistas e cargas; remove elementos de comprimento nulo e duplicados.
 */
export function mergeCoincidentNodes(model: BridgeModel, tol = NODE_TOL): { model: BridgeModel; merged: number; removedElements: number } {
  const t = Math.max(tol, 1e-9)
  const cell = (v: number): number => Math.floor(v / t)
  const grid = new Map<string, BridgeNode[]>()
  const target = new Map<number, number>()
  const kept: BridgeNode[] = []
  const sorted = [...model.nodes].sort((a, b) => a.id - b.id)
  for (const n of sorted) {
    const cx = cell(n.x)
    const cy = cell(n.y)
    const cz = cell(n.z)
    let hit: BridgeNode | undefined
    for (let i = -1; i <= 1 && !hit; i++) {
      for (let j = -1; j <= 1 && !hit; j++) {
        for (let k = -1; k <= 1 && !hit; k++) {
          for (const o of grid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
            if (dist(pos(o), pos(n)) <= t) {
              hit = o
              break
            }
          }
        }
      }
    }
    if (hit) target.set(n.id, hit.id)
    else {
      const key = `${cx},${cy},${cz}`
      const arr = grid.get(key)
      if (arr) arr.push(n)
      else grid.set(key, [n])
      kept.push(n)
    }
  }
  const map = (id: number): number => target.get(id) ?? id
  // restrições e molas do nó absorvido passam p/ o que fica
  const byId = nodeMap(model)
  const fixOf = new Map<number, Dof6<boolean>>()
  const springOf = new Map<number, Dof6<number>>()
  for (const [from, to] of target) {
    const src = byId.get(from)!
    if (src.fix?.some(Boolean)) {
      const cur = fixOf.get(to) ?? ([...(byId.get(to)!.fix ?? [false, false, false, false, false, false])] as Dof6<boolean>)
      src.fix.forEach((v, d) => {
        if (v) cur[d] = true
      })
      fixOf.set(to, cur)
    }
    if (src.springs?.some((k) => k > 0)) {
      const cur = springOf.get(to) ?? ([...(byId.get(to)!.springs ?? [0, 0, 0, 0, 0, 0])] as Dof6<number>)
      src.springs.forEach((v, d) => {
        if (v > cur[d]) cur[d] = v
      })
      springOf.set(to, cur)
    }
  }
  const order = new Set(kept.map((n) => n.id))
  const nodes = model.nodes
    .filter((n) => order.has(n.id))
    .map((n) => {
      const fix = fixOf.get(n.id)
      const springs = springOf.get(n.id)
      return fix || springs ? { ...n, ...(fix ? { fix } : {}), ...(springs ? { springs } : {}) } : n
    })

  const seen = new Set<string>()
  const elements: Element[] = []
  let removed = 0
  for (const e of model.elements) {
    const n1 = map(e.n1)
    const n2 = map(e.n2)
    const key = `${e.kind}:${Math.min(n1, n2)}-${Math.max(n1, n2)}`
    if (n1 === n2 || seen.has(key)) {
      removed++
      continue
    }
    seen.add(key)
    elements.push(n1 === e.n1 && n2 === e.n2 ? e : { ...e, n1, n2 })
  }
  if (target.size === 0 && removed === 0) return { model, merged: 0, removedElements: 0 }
  const refs = remapNodeRefs(model, map)
  const out = dropElementRefs({ ...model, nodes, elements, ...refs })
  return { model: out, merged: target.size, removedElements: removed }
}

/* ------------------------------------------------------------------ mover, copiar, espelhar, girar */

export function translateNodes(model: BridgeModel, nodeIds: number[], d: P3): BridgeModel | string {
  if (!d.every(Number.isFinite)) return 'Deslocamento inválido.'
  const ids = new Set(nodeIds)
  if (ids.size === 0) return 'Nenhum nó selecionado.'
  return { ...model, nodes: model.nodes.map((n) => (ids.has(n.id) ? { ...n, x: r6(n.x + d[0]), y: r6(n.y + d[1]), z: r6(n.z + d[2]) } : n)) }
}

type Transform = (p: P3) => P3

/** copia os nós e elementos da seleção aplicando `f`; reaproveita nós coincidentes */
function copyWith(model: BridgeModel, sel: EditSelection, f: Transform, upf?: (v: Vec3) => Vec3): { model: BridgeModel; nodes: number[]; elements: number[] } {
  const byId = nodeMap(model)
  let m = model
  const map = new Map<number, number>()
  const newNodes: number[] = []
  for (const id of selectionNodes(model, sel)) {
    const src = byId.get(id)!
    const r = ensureNode(m, f(pos(src)), { role: src.role, fix: src.fix, springs: src.springs })
    m = r.model
    map.set(id, r.id)
    if (r.created) newNodes.push(r.id)
  }
  const ids = new Set(sel.elements)
  const add: Element[] = []
  let nid = nextElementId(m)
  const exists = (a: number, b: number): boolean => m.elements.some((e) => sameEnds(e, a, b)) || add.some((e) => sameEnds(e, a, b))
  for (const e of model.elements) {
    if (!ids.has(e.id)) continue
    const n1 = map.get(e.n1)!
    const n2 = map.get(e.n2)!
    if (n1 === n2 || exists(n1, n2)) continue
    const copy: Element = { ...e, id: nid++, n1, n2 }
    if (copy.kind === 'frame' && copy.up && upf) copy.up = upf(copy.up)
    add.push(copy)
  }
  // cargas distribuídas acompanham as barras copiadas
  let loadCases = m.loadCases
  if (add.length && loadCases.some((lc) => lc.uniform?.length)) {
    const from = new Map<number, number[]>()
    const srcs = model.elements.filter((e) => ids.has(e.id))
    for (const c of add) {
      const src = srcs.find((s) => map.get(s.n1) === c.n1 && map.get(s.n2) === c.n2 && s.kind === c.kind)
      if (src) from.set(src.id, [...(from.get(src.id) ?? []), c.id])
    }
    loadCases = loadCases.map((lc) => (lc.uniform ? { ...lc, uniform: lc.uniform.flatMap((u) => [u, ...(from.get(u.element) ?? []).map((id) => ({ ...u, element: id }))]) } : lc))
  }
  return { model: { ...m, elements: [...m.elements, ...add], loadCases }, nodes: newNodes, elements: add.map((e) => e.id) }
}

/** copia a seleção `times` vezes, com passo `d` (cópia k fica em k·d) */
export function copySelection(model: BridgeModel, sel: EditSelection, d: P3, times = 1): OpResult {
  if (!d.every(Number.isFinite) || Math.hypot(d[0], d[1], d[2]) < NODE_TOL) return 'Informe um deslocamento diferente de zero.'
  if (!(times >= 1 && times <= 500)) return 'O número de cópias deve estar entre 1 e 500.'
  if (selectionNodes(model, sel).length === 0) return 'Selecione nós ou elementos para copiar.'
  let m = model
  const nodes: number[] = []
  const elements: number[] = []
  for (let k = 1; k <= Math.round(times); k++) {
    const r = copyWith(m, sel, (p) => [p[0] + k * d[0], p[1] + k * d[1], p[2] + k * d[2]])
    m = r.model
    nodes.push(...r.nodes)
    elements.push(...r.elements)
  }
  if (nodes.length === 0 && elements.length === 0) return 'Nada foi criado: as cópias coincidem com o que já existe.'
  return { model: m, select: { nodes, elements }, message: `${nodes.length} nó(s) e ${elements.length} elemento(s) criados` }
}

const AXIS = { x: 0, y: 1, z: 2 } as const

/** espelha em relação ao plano `plane` = `at` (ex.: plane 'x', at 60 → x' = 120 − x) */
export function mirrorSelection(model: BridgeModel, sel: EditSelection, plane: 'x' | 'y' | 'z', at: number, copy = true): OpResult {
  if (!Number.isFinite(at)) return 'Posição do plano de espelhamento inválida.'
  const ids = selectionNodes(model, sel)
  if (ids.length === 0) return 'Selecione nós ou elementos para espelhar.'
  const k = AXIS[plane]
  const f: Transform = (p) => {
    const q: P3 = [p[0], p[1], p[2]]
    q[k] = 2 * at - p[k]
    return q
  }
  const upf = (v: Vec3): Vec3 => {
    const q: Vec3 = [v[0], v[1], v[2]]
    q[k] = -v[k]
    return q
  }
  if (copy) {
    const r = copyWith(model, sel, f, upf)
    if (r.nodes.length === 0 && r.elements.length === 0) return 'Nada foi criado: o espelho coincide com o que já existe.'
    return { model: r.model, select: { nodes: r.nodes, elements: r.elements }, message: `${r.nodes.length} nó(s) e ${r.elements.length} elemento(s) criados por espelhamento` }
  }
  const set = new Set(ids)
  const nodes = model.nodes.map((n) => {
    if (!set.has(n.id)) return n
    const q = f(pos(n))
    return { ...n, x: r6(q[0]), y: r6(q[1]), z: r6(q[2]) }
  })
  return { model: { ...model, nodes }, select: sel, message: `${ids.length} nó(s) espelhados` }
}

/** gira em torno do eixo vertical que passa por (cx, cy); ângulo em graus, anti-horário em planta */
export function rotateSelection(model: BridgeModel, sel: EditSelection, center: [number, number], angleDeg: number, copy = false): OpResult {
  if (![center[0], center[1], angleDeg].every(Number.isFinite)) return 'Centro ou ângulo inválido.'
  const ids = selectionNodes(model, sel)
  if (ids.length === 0) return 'Selecione nós ou elementos para girar.'
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const f: Transform = (p) => {
    const dx = p[0] - center[0]
    const dy = p[1] - center[1]
    return [center[0] + c * dx - s * dy, center[1] + s * dx + c * dy, p[2]]
  }
  const upf = (v: Vec3): Vec3 => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]
  if (copy) {
    const r = copyWith(model, sel, f, upf)
    if (r.nodes.length === 0 && r.elements.length === 0) return 'Nada foi criado: a cópia girada coincide com o que já existe.'
    return { model: r.model, select: { nodes: r.nodes, elements: r.elements }, message: `${r.nodes.length} nó(s) e ${r.elements.length} elemento(s) criados por rotação` }
  }
  const set = new Set(ids)
  const selEl = new Set(sel.elements)
  const nodes = model.nodes.map((n) => {
    if (!set.has(n.id)) return n
    const q = f(pos(n))
    return { ...n, x: r6(q[0]), y: r6(q[1]), z: r6(q[2]) }
  })
  const elements = model.elements.map((e) => (e.kind === 'frame' && e.up && selEl.has(e.id) ? { ...e, up: upf(e.up) } : e))
  return { model: { ...model, nodes, elements }, select: sel, message: `${ids.length} nó(s) girados ${angleDeg.toLocaleString('pt-BR')}°` }
}

/* ------------------------------------------------------------------ linha de nós / barras */

/** n trechos iguais de `a` a `b`: cria os n + 1 nós e, se `frame` for dado, as barras */
export function nodeLine(model: BridgeModel, a: P3, b: P3, n: number, frame?: FrameDefaults): OpResult {
  if (![...a, ...b].every(Number.isFinite)) return 'Coordenadas inválidas.'
  if (!(n >= 1 && n <= 2000)) return 'O número de trechos deve estar entre 1 e 2000.'
  if (dist(a, b) < NODE_TOL) return 'Os dois pontos coincidem.'
  const N = Math.round(n)
  let m = model
  const ids: number[] = []
  const created: number[] = []
  const role: BridgeNode['role'] = frame?.group === 'deck' ? 'deck' : frame?.group === 'tower' ? 'tower' : frame?.group === 'pier' ? 'pier' : 'other'
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const r = ensureNode(m, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])], { role })
    m = r.model
    ids.push(r.id)
    if (r.created) created.push(r.id)
  }
  const elements: number[] = []
  if (frame) {
    for (let i = 0; i < N; i++) {
      if (m.elements.some((e) => sameEnds(e, ids[i], ids[i + 1]))) continue
      const r = addFrameBetween(m, ids[i], ids[i + 1], frame)
      if (typeof r === 'string') return r
      m = r.model
      elements.push(r.id)
    }
  }
  if (created.length === 0 && elements.length === 0) return 'Nada foi criado: a linha coincide com o que já existe.'
  return {
    model: m,
    select: { nodes: frame ? [] : ids, elements },
    message: frame ? `${elements.length} barra(s) e ${created.length} nó(s) criados` : `${created.length} nó(s) criados`,
  }
}

/* ------------------------------------------------------------------ estais */

export interface StayOptions {
  /**
   * 'fan'      leque: todos os estais de cada torre no nó mais alto selecionado;
   * 'semi-fan' semi-leque: ancoragens na torre espaçadas de `spacing` a partir do topo (cria os nós);
   * 'harp'     harpa: estais paralelos, cota proporcional à distância (cria os nós);
   * 'pair'     usa só os nós de torre selecionados: a ancoragem mais distante vai ao nó mais alto.
   */
  layout: 'fan' | 'semi-fan' | 'harp' | 'pair'
  /** semi-leque: distância vertical entre ancoragens na torre (m) */
  spacing?: number
  /** material do cabo (id) */
  mat: string
  strands: number
  /** área de cada cordoalha (m²) */
  strandArea: number
}

interface TowerLine {
  x: number
  y: number
  /** nós da torre selecionados, do mais alto ao mais baixo */
  nodes: BridgeNode[]
}

/** peso por comprimento (kN/m) das barras do tabuleiro ligadas ao nó (média) */
function deckWeightAt(model: BridgeModel, nodeId: number): number {
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  let sum = 0
  let n = 0
  for (const e of model.elements) {
    if (e.kind !== 'frame' || e.group !== 'deck' || (e.n1 !== nodeId && e.n2 !== nodeId)) continue
    const mat = mats.get(e.mat)
    const sec = secs.get(e.sec)
    if (!mat || !sec) continue
    sum += mat.gamma * sec.A + (sec.extraDead ?? 0)
    n++
  }
  return n ? sum / n : 0
}

/**
 * Gera estais entre nós do tabuleiro e nós da(s) torre(s).
 *
 * Seleção: os nós (ou barras) do tabuleiro que recebem estai e os nós (ou barras) da torre.
 * É "torre" o nó ligado a barra do grupo torre/pilar e a nenhuma do tabuleiro; os demais nós
 * selecionados são ancoragens. O nó de encontro tabuleiro–torre não recebe estai. Com várias torres (ou várias
 * pernas), cada ancoragem vai para a linha de torre mais próxima em planta. De cada lado da
 * torre, o estai mais longo liga a ancoragem mais distante ao ponto mais alto.
 *
 * Os estais nascem sem L0, com uma pré-tração estimada pelo peso tributário do tabuleiro
 * dividido pelo seno do ângulo — é o ponto de partida do form-finding.
 */
export function generateStays(model: BridgeModel, sel: EditSelection, o: StayOptions): OpResult {
  if (!model.materials.some((m) => m.id === o.mat)) return 'Escolha um material de cabo existente no modelo (aba Biblioteca).'
  if (!(o.strands >= 1)) return 'O número de cordoalhas deve ser 1 ou mais.'
  if (!(o.strandArea > 0)) return 'A área da cordoalha deve ser positiva.'
  const byId = nodeMap(model)
  const ids = selectionNodes(model, sel)
  const inTower = new Set<number>()
  const inDeck = new Set<number>()
  for (const e of model.elements) {
    if (e.kind !== 'frame') continue
    const g = e.group
    if (g === 'tower' || g === 'pier') {
      inTower.add(e.n1)
      inTower.add(e.n2)
    } else if (g === 'deck') {
      inDeck.add(e.n1)
      inDeck.add(e.n2)
    }
  }
  const towerSel = ids.filter((id) => inTower.has(id) && !inDeck.has(id)).map((id) => byId.get(id)!)
  let deckSel = ids.filter((id) => !inTower.has(id)).map((id) => byId.get(id)!)
  if (towerSel.length === 0) return 'Selecione também os nós (ou barras) da torre, acima do tabuleiro. A torre precisa ser do grupo "Torre".'
  if (deckSel.length === 0) return 'Selecione os nós (ou barras) do tabuleiro que recebem estai.'

  // linhas de torre: nós selecionados agrupados pela posição em planta (1 m)
  const lines: TowerLine[] = []
  for (const n of towerSel) {
    const top = lines.find((l) => Math.hypot(l.x - n.x, l.y - n.y) < 1.0 + 0.2 * Math.abs(n.z - l.nodes[0].z))
    if (top) top.nodes.push(n)
    else lines.push({ x: n.x, y: n.y, nodes: [n] })
  }
  for (const l of lines) {
    l.nodes.sort((a, b) => b.z - a.z)
    l.x = l.nodes[0].x
    l.y = l.nodes[0].y
  }
  // direção do tabuleiro em planta: eixo de maior extensão das ancoragens
  const ext = (k: 'x' | 'y'): number => Math.max(...deckSel.map((n) => n[k])) - Math.min(...deckSel.map((n) => n[k]))
  const along: 'x' | 'y' = ext('x') >= ext('y') ? 'x' : 'y'
  // ancoragens em cima da linha da torre (a menos de 0,5 m ao longo do eixo) não recebem estai
  deckSel = deckSel.filter((n) => !lines.some((l) => Math.abs(n[along] - l[along]) < 0.5 && Math.hypot(n.x - l.x, n.y - l.y) < 0.5))
  if (deckSel.length === 0) return 'Os nós do tabuleiro selecionados estão sobre a torre: selecione as ancoragens ao longo do vão.'

  let m = model
  let created = 0
  let skipped = 0
  const newEls: number[] = []
  const newNodes: number[] = []
  const A = o.strands * o.strandArea

  /** nó da torre na cota z sobre a linha: reaproveita ou divide a barra da torre que contém a cota */
  const towerNodeAt = (line: TowerLine, z: number): number | string => {
    const top = line.nodes[0]
    const cur = nodeMap(m)
    const lineNodes = new Set<number>()
    for (const n of m.nodes) if (inTowerNow(n.id) && Math.hypot(n.x - top.x, n.y - top.y) < 1.0 + 0.2 * Math.abs(n.z - top.z)) lineNodes.add(n.id)
    for (const id of lineNodes) if (Math.abs(cur.get(id)!.z - z) < 0.02) return id
    for (const e of m.elements) {
      if (e.kind !== 'frame' || (e.group !== 'tower' && e.group !== 'pier')) continue
      if (!lineNodes.has(e.n1) || !lineNodes.has(e.n2)) continue
      const a = cur.get(e.n1)!
      const b = cur.get(e.n2)!
      const lo = Math.min(a.z, b.z)
      const hi = Math.max(a.z, b.z)
      if (z <= lo || z >= hi) continue
      const r = splitFrameAt(m, e.id, (z - a.z) / (b.z - a.z))
      if (typeof r === 'string') return r
      m = r.model
      newNodes.push(r.node)
      return r.node
    }
    return `Não há barra de torre na cota ${z.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m para criar a ancoragem.`
  }
  const inTowerNow = (id: number): boolean => m.elements.some((e) => e.kind === 'frame' && (e.group === 'tower' || e.group === 'pier') && (e.n1 === id || e.n2 === id))

  // cada ancoragem vai p/ a linha de torre mais próxima em planta
  const byLine = new Map<TowerLine, BridgeNode[]>()
  for (const n of deckSel) {
    let best = lines[0]
    for (const l of lines) if (Math.hypot(n.x - l.x, n.y - l.y) < Math.hypot(n.x - best.x, n.y - best.y)) best = l
    byLine.set(best, [...(byLine.get(best) ?? []), n])
  }

  for (const [line, anchors] of byLine) {
    const top = line.nodes[0]
    for (const side of [-1, 1]) {
      const list = anchors
        .filter((n) => Math.sign(n[along] - line[along]) === side)
        .sort((a, b) => Math.abs(b[along] - line[along]) - Math.abs(a[along] - line[along])) // mais distante primeiro
      if (list.length === 0) continue
      const dMax = Math.abs(list[0][along] - line[along])
      // níveis distintos de distância (dois planos de estais compartilham o nível)
      const levels: number[] = []
      for (const n of list) {
        const d = Math.abs(n[along] - line[along])
        if (!levels.some((v) => Math.abs(v - d) < 0.05)) levels.push(d)
      }
      const zDeck = list.reduce((s, n) => s + n.z, 0) / list.length
      for (const n of list) {
        const d = Math.abs(n[along] - line[along])
        const k = levels.findIndex((v) => Math.abs(v - d) < 0.05) // 0 = mais distante
        let tid: number | string
        if (o.layout === 'fan') tid = top.id
        else if (o.layout === 'pair') {
          if (k >= line.nodes.length) {
            return `Faltam nós de torre: ${levels.length} ancoragens de um lado e só ${line.nodes.length} nó(s) de torre selecionados. Use "leque", "semi-leque" ou "harpa", ou selecione mais nós da torre.`
          }
          tid = line.nodes[k].id
        } else if (o.layout === 'semi-fan') {
          const sp = o.spacing ?? 2
          if (!(sp > 0)) return 'O espaçamento das ancoragens na torre deve ser positivo.'
          tid = towerNodeAt(line, top.z - k * sp)
        } else {
          tid = towerNodeAt(line, zDeck + (top.z - zDeck) * (d / dMax))
        }
        if (typeof tid === 'string') return tid
        const tn = nodeMap(m).get(tid)!
        if (tn.z - n.z < 0.5) return `A ancoragem na torre (nó ${tn.id}) precisa ficar acima do tabuleiro.`
        if (m.elements.some((e) => sameEnds(e, tid as number, n.id))) {
          skipped++
          continue
        }
        // pré-tração: peso tributário do tabuleiro / sen α, repartido entre os estais do nível
        const neigh = levels.map((v) => v).sort((a, b) => a - b)
        const i = neigh.findIndex((v) => Math.abs(v - d) < 0.05)
        const prev = i > 0 ? neigh[i - 1] : 0
        // o estai mais distante leva também meio painel para fora (até o apoio ou a ponta)
        const next = i < neigh.length - 1 ? neigh[i + 1] : 2 * d - prev
        const trib = (d - prev) / 2 + (next - d) / 2
        const sameLevel = list.filter((q) => Math.abs(Math.abs(q[along] - line[along]) - d) < 0.05).length
        const chord = dist(pos(tn), pos(n))
        const sin = (tn.z - n.z) / chord
        // ancoragem fora do eixo (borda ligada por transversina): o peso vem do nó vizinho do
        // tabuleiro e é repartido entre os estais do mesmo nível
        let w = deckWeightAt(m, n.id)
        let share = 1
        if (!(w > 0)) {
          for (const e of m.elements) {
            if (e.kind !== 'frame' || (e.n1 !== n.id && e.n2 !== n.id)) continue
            w = Math.max(w, deckWeightAt(m, e.n1 === n.id ? e.n2 : e.n1))
          }
          share = sameLevel
        }
        const T = w > 0 && sin > 0.05 ? (w * trib) / sin / share : 0
        const r = addCableBetween(m, tid, n.id, { mat: o.mat, A, group: 'stay', strands: o.strands, pretension: T > 0 ? Math.round(T) : undefined })
        if (typeof r === 'string') return r
        m = r.model
        newEls.push(r.id)
        created++
      }
    }
  }
  if (created === 0) return skipped ? 'Todos os estais pedidos já existem.' : 'Nenhum estai a criar com esta seleção.'
  return {
    model: m,
    select: { nodes: [], elements: newEls },
    message: `${created} estai(s) criados${newNodes.length ? ` e ${newNodes.length} ancoragem(ns) na torre` : ''}${skipped ? ` (${skipped} já existiam)` : ''}`,
  }
}

/* ------------------------------------------------------------------ pendurais */

export interface HangerOptions {
  mat: string
  /** área de cada pendural (m²) */
  A: number
  /** tolerância em planta p/ casar o nó de cima com o de baixo (m) */
  tol?: number
}

/**
 * Pendurais verticais: liga cada nó do tabuleiro selecionado ao nó selecionado que está
 * acima dele na mesma posição em planta (arco ou cabo principal).
 */
export function generateHangers(model: BridgeModel, sel: EditSelection, o: HangerOptions): OpResult {
  if (!model.materials.some((m) => m.id === o.mat)) return 'Escolha um material de cabo existente no modelo (aba Biblioteca).'
  if (!(o.A > 0)) return 'A área do pendural deve ser positiva.'
  const byId = nodeMap(model)
  const nodes = selectionNodes(model, sel).map((id) => byId.get(id)!)
  if (nodes.length < 2) return 'Selecione os nós do tabuleiro e os nós do arco (ou do cabo principal) acima deles.'
  const tol = o.tol ?? 0.1
  let m = model
  const els: number[] = []
  const lower = [...nodes].sort((a, b) => a.z - b.z)
  const used = new Set<number>()
  for (const lo of lower) {
    if (used.has(lo.id)) continue
    let best: BridgeNode | undefined
    for (const hi of nodes) {
      if (hi.id === lo.id || hi.z - lo.z < 0.5) continue
      if (Math.hypot(hi.x - lo.x, hi.y - lo.y) > tol) continue
      if (!best || hi.z < best.z) best = hi // o mais próximo acima
    }
    if (!best) continue
    used.add(best.id)
    if (m.elements.some((e) => sameEnds(e, lo.id, best!.id))) continue
    const W = deckWeightAt(m, lo.id)
    let trib = 0
    for (const e of m.elements) {
      if (e.kind !== 'frame' || e.group !== 'deck' || (e.n1 !== lo.id && e.n2 !== lo.id)) continue
      const other = byId.get(e.n1 === lo.id ? e.n2 : e.n1)
      if (other) trib += dist(pos(lo), pos(other)) / 2
    }
    const r = addCableBetween(m, best.id, lo.id, { mat: o.mat, A: o.A, group: 'hanger', pretension: W * trib > 0 ? Math.round(W * trib) : undefined })
    if (typeof r === 'string') return r
    m = r.model
    els.push(r.id)
  }
  if (els.length === 0) return `Nenhum par de nós na mesma vertical (tolerância de ${tol.toLocaleString('pt-BR')} m em planta).`
  return { model: m, select: { nodes: [], elements: els }, message: `${els.length} pendural(is) criados` }
}

/* ------------------------------------------------------------------ apagar */

/**
 * Apaga os elementos selecionados e os nós selecionados. Um nó ainda usado por elemento
 * não selecionado não é apagado (recusa). Com `orphans`, as extremidades que ficarem soltas
 * e sem apoio também saem.
 */
export function deleteSelection(model: BridgeModel, sel: EditSelection, orphans = true): OpResult {
  const elIds = new Set(sel.elements)
  const ndIds = new Set(sel.nodes)
  if (elIds.size === 0 && ndIds.size === 0) return 'Nada selecionado.'
  const elements = model.elements.filter((e) => !elIds.has(e.id))
  const used = new Set<number>()
  for (const e of elements) {
    used.add(e.n1)
    used.add(e.n2)
  }
  const blocked = [...ndIds].filter((id) => used.has(id))
  if (blocked.length) {
    return `Nó(s) ${blocked.slice(0, 8).join(', ')}${blocked.length > 8 ? '…' : ''} ainda usado(s) por elementos não selecionados: selecione também esses elementos.`
  }
  const drop = new Set(ndIds)
  if (orphans) {
    const byId = nodeMap(model)
    for (const e of model.elements) {
      if (!elIds.has(e.id)) continue
      for (const id of [e.n1, e.n2]) {
        const n = byId.get(id)
        if (n && !used.has(id) && !n.fix?.some(Boolean) && !n.springs?.some((k) => k > 0)) drop.add(id)
      }
    }
  }
  const nodes = model.nodes.filter((n) => !drop.has(n.id))
  const removedEl = model.elements.length - elements.length
  const removedNd = model.nodes.length - nodes.length
  if (removedEl === 0 && removedNd === 0) return 'Nada a apagar.'
  const refs = remapNodeRefs(model, (id) => (drop.has(id) ? undefined : id))
  const out = dropElementRefs({ ...model, nodes, elements, ...refs })
  return { model: out, select: { nodes: [], elements: [] }, message: `${removedEl} elemento(s) e ${removedNd} nó(s) apagados` }
}

/** remove os nós que não pertencem a nenhum elemento */
export function removeLooseNodes(model: BridgeModel): OpResult {
  const used = new Set<number>()
  for (const e of model.elements) {
    used.add(e.n1)
    used.add(e.n2)
  }
  const loose = model.nodes.filter((n) => !used.has(n.id)).map((n) => n.id)
  if (loose.length === 0) return 'Não há nós soltos.'
  const drop = new Set(loose)
  const refs = remapNodeRefs(model, (id) => (drop.has(id) ? undefined : id))
  return { model: { ...model, nodes: model.nodes.filter((n) => !drop.has(n.id)), ...refs }, select: { nodes: [], elements: [] }, message: `${loose.length} nó(s) solto(s) removidos` }
}

/* ------------------------------------------------------------------ atribuir */

export interface AssignPatch {
  group?: ElementGroup
  sec?: string
  mat?: string
  /** restrições dos nós (null = soltar todas) */
  fix?: Dof6<boolean> | null
}

export function assign(model: BridgeModel, sel: EditSelection, patch: AssignPatch): OpResult {
  const elIds = new Set(sel.elements)
  let nEl = 0
  let nNd = 0
  let elements = model.elements
  if (patch.group !== undefined || patch.sec !== undefined || patch.mat !== undefined) {
    if (elIds.size === 0) return 'Selecione os elementos que recebem a atribuição.'
    if (patch.sec !== undefined && !model.sections.some((s) => s.id === patch.sec)) return `Seção "${patch.sec}" não existe.`
    let mat: Material | undefined
    if (patch.mat !== undefined) {
      mat = model.materials.find((m) => m.id === patch.mat)
      if (!mat) return `Material "${patch.mat}" não existe.`
    }
    elements = model.elements.map((e) => {
      if (!elIds.has(e.id)) return e
      let out: Element = e
      if (patch.group !== undefined && e.group !== patch.group) out = { ...out, group: patch.group }
      if (patch.mat !== undefined && e.mat !== patch.mat) out = { ...out, mat: patch.mat }
      if (patch.sec !== undefined && out.kind === 'frame' && out.sec !== patch.sec) out = { ...out, sec: patch.sec }
      if (out !== e) nEl++
      return out
    })
  }
  let nodes = model.nodes
  if (patch.fix !== undefined) {
    const ids = new Set(sel.nodes)
    if (ids.size === 0) return 'Selecione os nós que recebem os apoios.'
    nodes = model.nodes.map((n) => {
      if (!ids.has(n.id)) return n
      nNd++
      const { fix: _old, ...rest } = n
      return patch.fix && patch.fix.some(Boolean) ? { ...rest, fix: [...patch.fix] as Dof6<boolean> } : rest
    })
  }
  if (nEl === 0 && nNd === 0) return 'Nada mudou: a seleção já tem esses valores.'
  const parts: string[] = []
  if (nEl) parts.push(`${nEl} elemento(s) alterados`)
  if (nNd) parts.push(`${nNd} nó(s) com apoio alterado`)
  return { model: { ...model, nodes, elements }, select: sel, message: parts.join(' e ') }
}

/* ------------------------------------------------------------------ renumerar */

/** nós renumerados de 1 a n por x, depois y, depois z; elementos de 1 a m na ordem atual */
export function renumber(model: BridgeModel): OpResult {
  const sorted = [...model.nodes].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z || a.id - b.id)
  const nmap = new Map<number, number>()
  sorted.forEach((n, i) => nmap.set(n.id, i + 1))
  const emap = new Map<number, number>()
  model.elements.forEach((e, i) => emap.set(e.id, i + 1))
  const same = sorted.every((n, i) => n.id === i + 1) && model.elements.every((e, i) => e.id === i + 1)
  if (same) return 'A numeração já está em ordem.'
  const nodes = sorted.map((n) => ({ ...n, id: nmap.get(n.id)! }))
  const elements = model.elements.map((e) => ({ ...e, id: emap.get(e.id)!, n1: nmap.get(e.n1) ?? e.n1, n2: nmap.get(e.n2) ?? e.n2 }))
  const refs = remapNodeRefs(model, (id) => nmap.get(id))
  const loadCases = refs.loadCases.map((lc) => (lc.uniform ? { ...lc, uniform: lc.uniform.flatMap((u) => (emap.has(u.element) ? [{ ...u, element: emap.get(u.element)! }] : [])) } : lc))
  return { model: { ...model, nodes, elements, ...refs, loadCases }, select: { nodes: [], elements: [] }, message: `${nodes.length} nós e ${elements.length} elementos renumerados` }
}
