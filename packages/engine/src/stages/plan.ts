/**
 * Plano de execução de uma ponte estaiada em balanços sucessivos.
 *
 * `stagePlan` devolve as fases na ordem de EXECUÇÃO. Duas origens:
 *
 *  1. `element.stage` — se algum elemento traz a fase em que é montado, vale o que o modelo
 *     diz: fases = valores distintos em ordem crescente; elementos sem `stage` existem desde
 *     o início.
 *
 *  2. Dedução geométrica (modelos `cable-stayed` sem `stage`):
 *      - RAÍZES: nós do tabuleiro ligados a barras de torre ou de pilar (tabuleiro monolítico
 *        com o pilone, ou apoiado na travessa da torre por aparelho de apoio).
 *      - A partir de cada raiz o tabuleiro avança em dois BALANÇOS (um para cada lado). Cada nó
 *        do tabuleiro pertence ao balanço da raiz mais próxima, medido ao longo do tabuleiro.
 *      - Em cada balanço as ancoragens dos estais são ordenadas pela distância à raiz. A fase k
 *        monta, em TODOS os balanços ao mesmo tempo (os dois lados de cada torre, todos os
 *        planos de cabos e os dois tabuleiros gêmeos), a k-ésima ancoragem: as aduelas entre a
 *        ancoragem k−1 e a k, suas transversinas e os estais k.
 *      - Fase 0: torres, pilares e a aduela de disparo (tabuleiro da torre até o 1º estai).
 *      - Fechamento: o que sobra do tabuleiro depois da última ancoragem de cada balanço — a
 *        aduela central entre duas torres e os trechos até os apoios extremos.
 *      - Última fase: sobrecarga permanente (`extraDead` das seções do tabuleiro), sem
 *        elementos novos.
 */

import type { BridgeModel, Element } from '../model/types'

export type StageKind = 'base' | 'cantilever' | 'closure' | 'finish'

export interface StageDef {
  index: number
  name: string
  kind: StageKind
  /** ids dos elementos montados nesta fase */
  addElements: number[]
  note: string
}

export interface StagePlan {
  stages: StageDef[]
  /** nós do tabuleiro ligados à torre (raízes dos balanços) — vazio em planos vindos de `element.stage` */
  roots: number[]
  warnings: string[]
}

const TOL = 1e-3

/** fase de execução de cada elemento (por id) segundo o plano */
export function elementStages(plan: StagePlan): Map<number, number> {
  const out = new Map<number, number>()
  for (const s of plan.stages) for (const id of s.addElements) out.set(id, s.index)
  return out
}

function hasExtraDead(model: BridgeModel): boolean {
  const deckSecs = new Set<string>()
  for (const e of model.elements) if (e.kind === 'frame' && e.group === 'deck') deckSecs.add(e.sec)
  return model.sections.some((s) => deckSecs.has(s.id) && (s.extraDead ?? 0) > 0)
}

function finishStage(index: number): StageDef {
  return {
    index, name: 'Sobrecarga permanente', kind: 'finish', addElements: [],
    note: 'Pavimento, barreiras e guarda-corpos sobre a estrutura fechada — estado final de projeto.',
  }
}

function planFromModel(model: BridgeModel): StagePlan {
  const values = Array.from(new Set(model.elements.map((e) => e.stage ?? 0))).sort((a, b) => a - b)
  if (values[0] !== 0) values.unshift(0)
  const stages: StageDef[] = values.map((v, i) => ({
    index: i,
    name: i === 0 ? 'Estrutura inicial' : `Fase ${v}`,
    kind: i === 0 ? 'base' : i === values.length - 1 ? 'closure' : 'cantilever',
    addElements: model.elements.filter((e) => (e.stage ?? 0) === v).map((e) => e.id),
    note: i === 0 ? 'Elementos sem fase definida.' : 'Fase definida no modelo.',
  }))
  if (hasExtraDead(model)) stages.push(finishStage(stages.length))
  return { stages, roots: [], warnings: [] }
}

export function stagePlan(model: BridgeModel): StagePlan | null {
  if (model.elements.some((e) => e.stage !== undefined)) return planFromModel(model)
  if (model.type !== 'cable-stayed') return null

  const warnings: string[] = []
  const pos = new Map(model.nodes.map((n) => [n.id, n]))
  const deck: Element[] = []
  const links: Element[] = []
  const stays: Element[] = []
  const others: Element[] = []
  for (const e of model.elements) {
    if (!pos.has(e.n1) || !pos.has(e.n2)) continue
    if (e.kind === 'cable') (e.group === 'stay' ? stays : others).push(e)
    else if (e.group === 'deck') deck.push(e)
    else if (e.group === 'crossbeam' || e.group === 'rigid') links.push(e)
    else others.push(e)
  }
  if (deck.length === 0 || stays.length === 0) return null

  // ---- grafo do tabuleiro e raízes
  const len = (e: Element): number => {
    const a = pos.get(e.n1)!
    const b = pos.get(e.n2)!
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  }
  const adj = new Map<number, { to: number; L: number }[]>()
  const link = (a: number, b: number, L: number): void => {
    const la = adj.get(a)
    if (la) la.push({ to: b, L })
    else adj.set(a, [{ to: b, L }])
  }
  for (const e of deck) {
    const L = len(e)
    link(e.n1, e.n2, L)
    link(e.n2, e.n1, L)
  }
  const roots: number[] = []
  const seen = new Set<number>()
  for (const e of others) {
    if (e.kind !== 'frame') continue
    for (const nd of [e.n1, e.n2]) {
      if (adj.has(nd) && !seen.has(nd)) {
        seen.add(nd)
        roots.push(nd)
      }
    }
  }
  if (roots.length === 0) return null

  // ---- Dijkstra de várias fontes: distância à raiz e balanço (raiz + 1º vizinho)
  const dist = new Map<number, number>()
  const arm = new Map<number, string>()
  for (const r of roots) dist.set(r, 0)
  const open = new Set<number>(roots)
  const done = new Set<number>()
  while (open.size > 0) {
    let cur = -1
    let best = Infinity
    for (const nd of open) {
      const d = dist.get(nd)!
      if (d < best) {
        best = d
        cur = nd
      }
    }
    open.delete(cur)
    done.add(cur)
    for (const { to, L } of adj.get(cur) ?? []) {
      if (done.has(to)) continue
      const d = best + L
      if (d < (dist.get(to) ?? Infinity)) {
        dist.set(to, d)
        arm.set(to, arm.get(cur) ?? `${cur}>${to}`)
        open.add(to)
      }
    }
  }

  // ---- ancoragem de cada estai no tabuleiro (direta ou por transversina rígida)
  const linkAdj = new Map<number, number[]>()
  for (const e of links) {
    for (const [a, b] of [[e.n1, e.n2], [e.n2, e.n1]]) {
      const l = linkAdj.get(a)
      if (l) l.push(b)
      else linkAdj.set(a, [b])
    }
  }
  /** nó do tabuleiro alcançado a partir de `nd` por transversinas/ligações rígidas */
  const spineOf = (nd: number): number | undefined => {
    if (adj.has(nd)) return nd
    const visited = new Set<number>([nd])
    const queue = [nd]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const nb of linkAdj.get(cur) ?? []) {
        if (visited.has(nb)) continue
        if (adj.has(nb)) return nb
        visited.add(nb)
        queue.push(nb)
      }
    }
    return undefined
  }
  const stayAnchor = new Map<number, number>()
  const armDists = new Map<string, number[]>()
  const loose: number[] = []
  for (const s of stays) {
    const a = spineOf(s.n1)
    const b = spineOf(s.n2)
    // extremidade do tabuleiro: a que chega a um nó do tabuleiro; na dúvida, a mais baixa
    let sp: number | undefined
    if (a !== undefined && b !== undefined) sp = pos.get(s.n1)!.z <= pos.get(s.n2)!.z ? a : b
    else sp = a ?? b
    if (sp === undefined || !dist.has(sp)) {
      loose.push(s.id)
      continue
    }
    stayAnchor.set(s.id, sp)
    const key = arm.get(sp)
    if (key === undefined) continue // ancorado na própria raiz
    const d = dist.get(sp)!
    const list = armDists.get(key) ?? []
    if (!list.some((v) => Math.abs(v - d) < TOL)) list.push(d)
    armDists.set(key, list)
  }
  for (const list of armDists.values()) list.sort((p, q) => p - q)
  if (loose.length > 0) {
    warnings.push(`${loose.length} estai(s) sem ancoragem identificável no tabuleiro — considerados desde a fase inicial.`)
  }
  const nCant = Math.max(0, ...Array.from(armDists.values()).map((l) => l.length))
  const CLOSURE = nCant + 1

  // ---- fase de cada elemento
  const stageOf = new Map<number, number>()
  /** fase em que cada nó do tabuleiro passa a existir */
  const nodeStage = new Map<number, number>()
  for (const r of roots) nodeStage.set(r, 0)
  /** posição k (1…) da ancoragem do balanço que cobre a distância d; CLOSURE além da última */
  const rank = (key: string | undefined, d: number): number => {
    const list = key ? armDists.get(key) : undefined
    if (!list || list.length === 0) return CLOSURE
    for (let k = 0; k < list.length; k++) if (d <= list[k] + TOL) return k + 1
    return CLOSURE
  }
  for (const e of deck) {
    const ka = arm.get(e.n1)
    const kb = arm.get(e.n2)
    let st: number
    if (!dist.has(e.n1) || !dist.has(e.n2)) st = CLOSURE // trecho sem ligação com nenhuma torre
    else if (ka !== undefined && kb !== undefined && ka !== kb) st = CLOSURE // encontro de dois balanços
    else {
      const k = rank(ka ?? kb, Math.max(dist.get(e.n1)!, dist.get(e.n2)!))
      // a aduela de disparo (até a 1ª ancoragem) nasce com a torre
      st = k === 1 ? 0 : k
    }
    stageOf.set(e.id, st)
    for (const nd of [e.n1, e.n2]) nodeStage.set(nd, Math.min(nodeStage.get(nd) ?? Infinity, st))
  }
  for (const e of links) {
    const sp = spineOf(e.n1) ?? spineOf(e.n2)
    stageOf.set(e.id, sp !== undefined ? (nodeStage.get(sp) ?? 0) : 0)
  }
  for (const s of stays) {
    const sp = stayAnchor.get(s.id)
    if (sp === undefined) {
      stageOf.set(s.id, 0)
      continue
    }
    const key = arm.get(sp)
    stageOf.set(s.id, key === undefined ? 1 : Math.min(rank(key, dist.get(sp)!), nCant))
  }
  for (const e of others) stageOf.set(e.id, 0)

  // ---- lista de fases
  const byStage: number[][] = Array.from({ length: CLOSURE + 1 }, () => [])
  for (const e of model.elements) {
    const st = stageOf.get(e.id)
    if (st !== undefined) byStage[st].push(e.id)
  }
  const isStay = new Set(stays.map((s) => s.id))
  const stages: StageDef[] = []
  stages.push({
    index: 0, name: 'Torre e aduela de disparo', kind: 'base', addElements: byStage[0],
    note: 'Torres, pilares e o trecho do tabuleiro junto à torre, em balanço dos dois lados.',
  })
  for (let k = 1; k <= nCant; k++) {
    const ids = byStage[k]
    if (ids.length === 0) continue
    const nSt = ids.reduce((a, id) => a + (isStay.has(id) ? 1 : 0), 0)
    const nDeck = ids.length - nSt
    stages.push({
      index: stages.length,
      name: nDeck > 0 ? `Aduelas e estais ${k}` : `Estais ${k}`,
      kind: 'cantilever',
      addElements: ids,
      note: `${nSt} estai(s)${nDeck > 0 ? ' e as aduelas até a ancoragem' : ''}, nos dois lados de cada torre.`,
    })
  }
  if (byStage[CLOSURE].length > 0) {
    stages.push({
      index: stages.length, name: 'Fechamento', kind: 'closure', addElements: byStage[CLOSURE],
      note: 'Aduela de fechamento e ligação aos apoios extremos.',
    })
  }
  if (hasExtraDead(model)) stages.push(finishStage(stages.length))
  return { stages, roots, warnings }
}
