/**
 * Pistas de carga móvel deduzidas do modelo.
 *
 * A carga móvel do motor anda sobre `model.lanes`: caminhos ordenados de nós do tabuleiro.
 * `autoLanes` monta esses caminhos a partir das barras do grupo "Tabuleiro":
 *  - cada conjunto conexo de barras do tabuleiro vira uma pista;
 *  - o caminho é a cadeia mais longa entre duas pontas (em tabuleiros ramificados, o diâmetro
 *    da árvore), ordenada no sentido de x crescente;
 *  - largura carregável = largura da seção − 2 × 0,40 m de barreira (7,20 m se a seção não
 *    tiver largura); excentricidade máxima do veículo = largura carregável/2 − 1,5 m (≥ 0).
 *
 * Também preenche os metadados que a análise usa:
 *  - `meta.spans`: distâncias, ao longo da 1ª pista, entre pontos de apoio do tabuleiro — nó
 *    com restrição vertical (ou mola vertical), ou ligado a barra de torre/pilar diretamente
 *    ou por uma ligação rígida/transversina. Estais e pendurais NÃO dividem vãos;
 *  - `meta.mainSpan`: o maior vão (entra no coeficiente de impacto CIV);
 *  - `meta.deckMaterial`: concreto, aço ou misto, pelo material das barras do tabuleiro.
 */

import type { BridgeModel, BridgeNode, Lane } from '@opengirder/engine'
import type { EditSelection } from './types'

const BARRIER = 0.4
const DEFAULT_CARRIAGEWAY = 7.2

function nodeMap(model: BridgeModel): Map<number, BridgeNode> {
  return new Map(model.nodes.map((n) => [n.id, n]))
}

const d3 = (a: BridgeNode, b: BridgeNode): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** comprimento do caminho da pista (m) */
export function laneLength(model: BridgeModel, lane: Lane): number {
  const nodes = nodeMap(model)
  let L = 0
  for (let i = 1; i < lane.nodes.length; i++) {
    const a = nodes.get(lane.nodes[i - 1])
    const b = nodes.get(lane.nodes[i])
    if (a && b) L += d3(a, b)
  }
  return L
}

/** estacas (m) de cada nó da pista */
export function laneStations(model: BridgeModel, lane: Lane): number[] {
  const nodes = nodeMap(model)
  const s = [0]
  for (let i = 1; i < lane.nodes.length; i++) {
    const a = nodes.get(lane.nodes[i - 1])
    const b = nodes.get(lane.nodes[i])
    s.push(s[i - 1] + (a && b ? d3(a, b) : 0))
  }
  return s
}

/** cadeia mais longa de nós por barras dadas (lista de pares), por componente conexa */
function chains(pairs: [number, number][], nodes: Map<number, BridgeNode>): number[][] {
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number): void => {
    adj.set(a, [...(adj.get(a) ?? []), b])
  }
  for (const [a, b] of pairs) {
    link(a, b)
    link(b, a)
  }
  const seen = new Set<number>()
  const out: number[][] = []
  const far = (start: number): { node: number; prev: Map<number, number> } => {
    // busca em largura com distância geométrica acumulada
    const distTo = new Map<number, number>([[start, 0]])
    const prev = new Map<number, number>()
    const queue = [start]
    let best = start
    while (queue.length) {
      const cur = queue.shift()!
      for (const nb of adj.get(cur) ?? []) {
        if (distTo.has(nb)) continue
        const a = nodes.get(cur)
        const b = nodes.get(nb)
        distTo.set(nb, distTo.get(cur)! + (a && b ? d3(a, b) : 1))
        prev.set(nb, cur)
        queue.push(nb)
        if (distTo.get(nb)! > distTo.get(best)!) best = nb
      }
    }
    for (const id of distTo.keys()) seen.add(id)
    return { node: best, prev }
  }
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const a = far(start).node
    const { node: b, prev } = far(a)
    const path = [b]
    let cur = b
    while (prev.has(cur)) {
      cur = prev.get(cur)!
      path.push(cur)
    }
    if (path.length < 2) continue
    const first = nodes.get(path[0])
    const last = nodes.get(path[path.length - 1])
    if (first && last && (first.x > last.x + 1e-9 || (Math.abs(first.x - last.x) <= 1e-9 && first.y > last.y))) path.reverse()
    out.push(path)
  }
  // ordem estável: pela posição do primeiro nó (x, depois y, depois z)
  out.sort((p, q) => {
    const a = nodes.get(p[0])!
    const b = nodes.get(q[0])!
    return a.x - b.x || a.y - b.y || a.z - b.z
  })
  return out
}

/** largura carregável e excentricidade padrão p/ uma largura de seção */
export function laneWidths(sectionWidth: number | undefined): { width: number; maxEccentricity: number } {
  const width = sectionWidth && sectionWidth > 2 * BARRIER + 1 ? Math.round((sectionWidth - 2 * BARRIER) * 100) / 100 : DEFAULT_CARRIAGEWAY
  return { width, maxEccentricity: Math.max(0, Math.round((width / 2 - 1.5) * 100) / 100) }
}

/** nós do tabuleiro que são pontos de apoio (dividem vãos) — regra no cabeçalho */
export function deckSupportNodes(model: BridgeModel): Set<number> {
  const out = new Set<number>()
  for (const n of model.nodes) if (n.fix?.[2] || (n.springs?.[2] ?? 0) > 0) out.add(n.id)
  const inSub = new Set<number>()
  for (const e of model.elements) {
    if (e.kind === 'frame' && (e.group === 'tower' || e.group === 'pier')) {
      inSub.add(e.n1)
      inSub.add(e.n2)
    }
  }
  for (const id of inSub) out.add(id)
  // um salto por ligação rígida ou transversina
  for (const e of model.elements) {
    if (e.kind !== 'frame' || (e.group !== 'rigid' && e.group !== 'crossbeam')) continue
    if (inSub.has(e.n1) || model.nodes.find((n) => n.id === e.n1)?.fix?.[2]) out.add(e.n2)
    if (inSub.has(e.n2) || model.nodes.find((n) => n.id === e.n2)?.fix?.[2]) out.add(e.n1)
  }
  return out
}

/** vãos ao longo de uma pista: distâncias entre pontos de apoio (as pontas contam como apoio) */
export function laneSpans(model: BridgeModel, lane: Lane): number[] {
  const sup = deckSupportNodes(model)
  const s = laneStations(model, lane)
  const marks: number[] = [0]
  lane.nodes.forEach((id, i) => {
    if (i > 0 && i < lane.nodes.length - 1 && sup.has(id) && s[i] - marks[marks.length - 1] > 1e-6) marks.push(s[i])
  })
  const total = s[s.length - 1]
  if (total - marks[marks.length - 1] > 1e-6) marks.push(total)
  const spans: number[] = []
  for (let i = 1; i < marks.length; i++) spans.push(Math.round((marks[i] - marks[i - 1]) * 1000) / 1000)
  return spans
}

function deckMaterialKind(model: BridgeModel): 'concrete' | 'steel' | 'composite' | undefined {
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const count = new Map<string, number>()
  for (const e of model.elements) {
    if (e.kind !== 'frame' || e.group !== 'deck') continue
    const m = mats.get(e.mat)
    if (!m) continue
    const kind = m.kind === 'concrete' ? 'concrete' : /mista|homogeneizada/i.test(m.name) ? 'composite' : m.kind === 'steel' ? 'steel' : ''
    if (kind) count.set(kind, (count.get(kind) ?? 0) + 1)
  }
  let best: string | undefined
  for (const [k, v] of count) if (!best || v > (count.get(best) ?? 0)) best = k
  return best as 'concrete' | 'steel' | 'composite' | undefined
}

/** pistas deduzidas das barras do grupo "Tabuleiro" (não altera o modelo) */
export function autoLanes(model: BridgeModel): Lane[] {
  const nodes = nodeMap(model)
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  const pairs: [number, number][] = []
  for (const e of model.elements) if (e.kind === 'frame' && e.group === 'deck' && nodes.has(e.n1) && nodes.has(e.n2)) pairs.push([e.n1, e.n2])
  const paths = chains(pairs, nodes)
  return paths.map((path, i) => {
    const onPath = new Set(path)
    let w: number | undefined
    for (const e of model.elements) {
      if (e.kind !== 'frame' || e.group !== 'deck' || !onPath.has(e.n1) || !onPath.has(e.n2)) continue
      const sw = secs.get(e.sec)?.width
      if (sw && (!w || sw > w)) w = sw
    }
    const prev = model.lanes[i]
    return {
      id: prev?.id ?? (i === 0 ? 'pista' : `pista-${i + 1}`),
      name: prev?.name ?? (paths.length > 1 ? `Pista ${i + 1}` : 'Pista'),
      nodes: path,
      ...laneWidths(w),
    }
  })
}

/** preenche `meta.spans`, `meta.mainSpan` e `meta.deckMaterial` a partir das pistas do modelo */
export function withSpanMeta(model: BridgeModel): BridgeModel {
  const lane = model.lanes[0]
  const meta = { ...model.meta }
  if (lane) {
    const spans = laneSpans(model, lane)
    if (spans.length) {
      meta.spans = spans
      meta.mainSpan = Math.max(...spans)
    }
  }
  const dm = deckMaterialKind(model)
  if (dm) meta.deckMaterial = dm
  return { ...model, meta }
}

/** recria as pistas automaticamente e atualiza os vãos nos metadados */
export function applyAutoLanes(model: BridgeModel): { model: BridgeModel; message: string } | string {
  const lanes = autoLanes(model)
  if (lanes.length === 0) return 'Não há barras do grupo "Tabuleiro" para formar uma pista. Atribua o grupo Tabuleiro às barras da pista.'
  const out = withSpanMeta({ ...model, lanes })
  const L = lanes.map((l) => laneLength(out, l).toLocaleString('pt-BR', { maximumFractionDigits: 1 })).join(' m, ')
  return { model: out, message: `${lanes.length} pista(s) criada(s): ${L} m` }
}

/** pista a partir da seleção: barras selecionadas (encadeadas) ou nós selecionados (ordenados por x) */
export function laneFromSelection(model: BridgeModel, sel: EditSelection): Lane | string {
  const nodes = nodeMap(model)
  const ids = new Set(sel.elements)
  const pairs: [number, number][] = []
  for (const e of model.elements) if (ids.has(e.id) && e.kind === 'frame') pairs.push([e.n1, e.n2])
  let path: number[]
  if (pairs.length) {
    const cs = chains(pairs, nodes)
    if (cs.length > 1) return 'As barras selecionadas formam mais de um trecho desconexo: selecione um caminho contínuo.'
    path = cs[0] ?? []
  } else {
    path = sel.nodes
      .filter((id) => nodes.has(id))
      .sort((a, b) => nodes.get(a)!.x - nodes.get(b)!.x || nodes.get(a)!.y - nodes.get(b)!.y)
  }
  if (path.length < 2) return 'Selecione as barras do caminho da pista (ou ao menos dois nós).'
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  let w: number | undefined
  for (const e of model.elements) {
    if (e.kind !== 'frame' || !ids.has(e.id)) continue
    const sw = secs.get(e.sec)?.width
    if (sw && (!w || sw > w)) w = sw
  }
  const taken = new Set(model.lanes.map((l) => l.id))
  let k = model.lanes.length + 1
  while (taken.has(`pista-${k}`)) k++
  return { id: `pista-${k}`, name: `Pista ${k}`, nodes: path, ...laneWidths(w) }
}
