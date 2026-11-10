import { describe, expect, it } from 'vitest'
import {
  analyzeBridge,
  cableSteel,
  concrete,
  validateModel,
  type BridgeModel,
  type Section,
} from '@opengirder/engine'
import * as ops from '../src/editor/ops'
import { EDIT_ACTIONS, defaultValues, editAction } from '../src/editor/actions'
import { applyAutoLanes, autoLanes, laneFromSelection, laneLength, laneSpans } from '../src/editor/lanes'
import { diagnose } from '../src/editor/diagnostics'
import { LIBRARY_MATERIALS, LIBRARY_SECTIONS, addLibraryMaterial, addLibrarySection, hollowRectSection, tubeSection } from '../src/editor/library'
import type { EditSelection } from '../src/editor/types'

const ok = <T,>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r)
  return r
}

const DECK: Section = { id: 'deck', name: 'Tabuleiro', A: 8, Iy: 90, Iz: 4, J: 6, extraDead: 40, depth: 2.2, width: 14, shape: 'box' }
const TOWER: Section = { id: 'tower', name: 'Torre', A: 20, Iy: 60, Iz: 60, J: 80, depth: 4, width: 5, shape: 'tower' }

function blank(): BridgeModel {
  return {
    schema: 'opengirder/1', name: 'Do zero', type: 'cable-stayed', nodes: [],
    materials: [concrete('c50', 50), cableSteel('stay', 'Cordoalhas CP 177', 1770)],
    sections: [DECK, TOWER], elements: [], loadCases: [], lanes: [],
  }
}

const els = (m: BridgeModel, f: (e: BridgeModel['elements'][number]) => boolean): number[] => m.elements.filter(f).map((e) => e.id)
const nodeAt = (m: BridgeModel, x: number, y: number, z: number): number => ok(ops.findNodeAt(m, [x, y, z]) ?? 'sem nó')

/** estaiada de 2 × 60 m montada só com as operações do editor */
function stayedFromScratch(layout: 'fan' | 'semi-fan' | 'harp' = 'fan'): BridgeModel {
  let m = blank()
  // tabuleiro: uma barra de 120 m, dividida a cada 10 m
  m = ok(ops.nodeLine(m, [0, 0, 20], [120, 0, 20], 1, { mat: 'c50', sec: 'deck', group: 'deck' })).model
  m = ok(ops.divideAtSpacing(m, els(m, (e) => e.group === 'deck'), 10)).model
  // torre: da fundação (z = 0) ao topo (z = 80), passando pelo tabuleiro
  m = ok(ops.nodeLine(m, [60, 0, 0], [60, 0, 20], 2, { mat: 'c50', sec: 'tower', group: 'tower' })).model
  m = ok(ops.nodeLine(m, [60, 0, 20], [60, 0, 80], 6, { mat: 'c50', sec: 'tower', group: 'tower' })).model
  // apoios: torre engastada, encontros
  m = ok(ops.assign(m, { nodes: [nodeAt(m, 60, 0, 0)], elements: [] }, { fix: [true, true, true, true, true, true] })).model
  m = ok(ops.assign(m, { nodes: [nodeAt(m, 0, 0, 20)], elements: [] }, { fix: [false, true, true, true, false, false] })).model
  m = ok(ops.assign(m, { nodes: [nodeAt(m, 120, 0, 20)], elements: [] }, { fix: [false, true, true, true, false, false] })).model
  // estais: ancoragens a 10, 20, … 50 m da torre, de cada lado
  const anchors = [10, 20, 30, 40, 50].flatMap((d) => [nodeAt(m, 60 - d, 0, 20), nodeAt(m, 60 + d, 0, 20)])
  const towerEls = els(m, (e) => e.group === 'tower' && m.nodes.find((n) => n.id === e.n1)!.z >= 20 && m.nodes.find((n) => n.id === e.n2)!.z >= 20)
  m = ok(ops.generateStays(m, { nodes: anchors, elements: towerEls }, { layout, spacing: 3, mat: 'stay', strands: 30, strandArea: 1.5e-4 })).model
  m = ok(applyAutoLanes(m)).model
  return m
}

describe('operações de modelagem', () => {
  it('nós e barras: ensureNode reaproveita, addFrameBetween recusa duplicata', () => {
    let m = blank()
    const a = ops.ensureNode(m, [0, 0, 0])
    m = a.model
    const again = ops.ensureNode(m, [0.0004, 0, 0])
    expect(again.created).toBe(false)
    expect(again.id).toBe(a.id)
    const b = ops.ensureNode(m, [10, 0, 0])
    m = b.model
    const f = ok(ops.addFrameBetween(m, a.id, b.id, { mat: 'c50', sec: 'deck', group: 'deck' }))
    expect(f.id).toBe(1)
    expect(typeof ops.addFrameBetween(f.model, b.id, a.id, { mat: 'c50', sec: 'deck' })).toBe('string')
    expect(typeof ops.addFrameBetween(f.model, a.id, a.id, { mat: 'c50', sec: 'deck' })).toBe('string')
    expect(typeof ops.addFrameBetween(f.model, a.id, b.id, { mat: 'x', sec: 'deck' })).toBe('string')
    expect(typeof ops.addCableBetween(m, a.id, b.id, { mat: 'stay', A: 0 })).toBe('string')
    const c = ok(ops.addCableBetween(m, a.id, b.id, { mat: 'stay', A: 0.004, strands: 30 }))
    expect(c.model.elements[0]).toMatchObject({ kind: 'cable', group: 'stay', strands: 30 })
  })

  it('dividir: n partes iguais, pista e carga distribuída acompanham', () => {
    let m = blank()
    m = ok(ops.nodeLine(m, [0, 0, 0], [30, 0, 0], 1, { mat: 'c50', sec: 'deck', group: 'deck' })).model
    m.lanes = [{ id: 'p', name: 'Pista', nodes: [1, 2], width: 8, maxEccentricity: 2 }]
    m.loadCases = [{ id: 'G', name: 'G', selfWeight: true, uniform: [{ element: 1, w: [0, 0, -5] }] }]
    const r = ok(ops.divideFrames(m, [1], 3))
    m = r.model
    expect(m.elements).toHaveLength(3)
    expect(m.nodes.map((n) => n.x).sort((a, b) => a - b)).toEqual([0, 10, 20, 30])
    expect(m.lanes[0].nodes).toHaveLength(4)
    expect(m.lanes[0].nodes.map((id) => m.nodes.find((n) => n.id === id)!.x)).toEqual([0, 10, 20, 30])
    expect(m.loadCases[0].uniform).toHaveLength(3)
    expect(new Set(m.loadCases[0].uniform!.map((u) => u.element))).toEqual(new Set(m.elements.map((e) => e.id)))
    expect(m.elements.every((e) => e.kind === 'frame' && e.group === 'deck' && e.sec === 'deck')).toBe(true)
    expect(validateModel({ ...m, nodes: m.nodes.map((n, i) => (i === 0 ? { ...n, fix: [true, true, true, true, true, true] } : n)) })).toEqual([])
    // por espaçamento: 30 m a cada 4 m → 8 trechos de 3,75 m… mas as barras já têm 10 m: 3 trechos cada (3,33 m)
    const s = ok(ops.divideAtSpacing(m, m.elements.map((e) => e.id), 4))
    expect(s.model.elements).toHaveLength(9)
    expect(typeof ops.divideFrames(m, [1], 1)).toBe('string')
    // ponto: divide no ponto mais próximo sobre o eixo
    const sp = ok(ops.splitFrameAt(m, 1, [4, 3, 0]))
    expect(sp.model.nodes.find((n) => n.id === sp.node)).toMatchObject({ x: 4, y: 0, z: 0 })
    expect(typeof ops.splitFrameAt(m, 1, 1.2)).toBe('string')
  })

  it('unir nós coincidentes: remapeia, junta apoios e remove barra nula ou duplicada', () => {
    const m: BridgeModel = {
      ...blank(),
      nodes: [
        { id: 1, x: 0, y: 0, z: 0, fix: [true, false, false, false, false, false] },
        { id: 2, x: 10, y: 0, z: 0 },
        { id: 3, x: 10, y: 0.0005, z: 0, fix: [false, false, true, false, false, false] },
        { id: 4, x: 20, y: 0, z: 0 },
      ],
      elements: [
        { kind: 'frame', id: 1, n1: 1, n2: 2, mat: 'c50', sec: 'deck', group: 'deck' },
        { kind: 'frame', id: 2, n1: 3, n2: 4, mat: 'c50', sec: 'deck', group: 'deck' },
        { kind: 'frame', id: 3, n1: 2, n2: 3, mat: 'c50', sec: 'deck', group: 'deck' },
        { kind: 'frame', id: 4, n1: 1, n2: 3, mat: 'c50', sec: 'deck', group: 'deck' },
      ],
      lanes: [{ id: 'p', name: 'Pista', nodes: [1, 2, 3, 4], width: 8, maxEccentricity: 2 }],
      loadCases: [{ id: 'G', name: 'G', selfWeight: true, nodal: [{ node: 3, F: [0, 0, -10, 0, 0, 0] }], uniform: [{ element: 3, w: [0, 0, -1] }] }],
    }
    const r = ops.mergeCoincidentNodes(m)
    expect(r.merged).toBe(1)
    expect(r.removedElements).toBe(2) // a barra nula 2–3 e a duplicada 1–3
    expect(r.model.nodes.map((n) => n.id)).toEqual([1, 2, 4])
    expect(r.model.nodes.find((n) => n.id === 2)!.fix).toEqual([false, false, true, false, false, false])
    expect(r.model.elements.map((e) => [e.n1, e.n2])).toEqual([[1, 2], [2, 4]])
    expect(r.model.lanes[0].nodes).toEqual([1, 2, 4])
    expect(r.model.loadCases[0].nodal![0].node).toBe(2)
    expect(r.model.loadCases[0].uniform).toEqual([])
    expect(ops.mergeCoincidentNodes(r.model).merged).toBe(0)
  })

  it('copiar, espelhar e girar', () => {
    let m = blank()
    m = ok(ops.nodeLine(m, [0, 0, 0], [0, 0, 10], 1, { mat: 'c50', sec: 'tower', group: 'pier' })).model
    m = ok(ops.assign(m, { nodes: [1], elements: [] }, { fix: [true, true, true, true, true, true] })).model
    const sel: EditSelection = { nodes: [], elements: [1] }
    // 3 cópias a cada 20 m: 4 pilares, todos engastados na base
    const c = ok(ops.copySelection(m, sel, [20, 0, 0], 3))
    expect(c.model.elements).toHaveLength(4)
    expect(c.model.nodes.filter((n) => n.fix?.every(Boolean)).map((n) => n.x).sort((a, b) => a - b)).toEqual([0, 20, 40, 60])
    expect(c.select!.elements).toHaveLength(3)
    // repetir a mesma cópia não cria nada
    expect(typeof ops.copySelection(c.model, sel, [20, 0, 0], 1)).toBe('string')
    // espelho em x = 50: pilar em x = 100
    const mi = ok(ops.mirrorSelection(m, sel, 'x', 50, true))
    expect(mi.model.nodes.some((n) => n.x === 100 && n.z === 10)).toBe(true)
    expect(mi.model.elements).toHaveLength(2)
    // espelho sem cópia move
    const mv = ok(ops.mirrorSelection(m, sel, 'x', 50, false))
    expect(mv.model.nodes.every((n) => n.x === 100)).toBe(true)
    // giro de 90° em torno de (10, 0): (0,0) → (10, −10)
    const ro = ok(ops.rotateSelection(m, sel, [10, 0], 90))
    expect(ro.model.nodes[0].x).toBeCloseTo(10, 6)
    expect(ro.model.nodes[0].y).toBeCloseTo(-10, 6)
    // mover
    const tr = ok(ops.translateNodes(m, [2], [0, 0, 5]))
    expect(tr.nodes.find((n) => n.id === 2)!.z).toBe(15)
  })

  it('apagar: recusa nó em uso, leva as extremidades soltas, limpa pista e cargas', () => {
    let m = blank()
    m = ok(ops.nodeLine(m, [0, 0, 0], [30, 0, 0], 3, { mat: 'c50', sec: 'deck', group: 'deck' })).model
    m = ok(applyAutoLanes(m)).model
    m.loadCases = [{ id: 'G', name: 'G', selfWeight: true, uniform: [{ element: 3, w: [0, 0, -1] }], nodal: [{ node: 4, F: [0, 0, -1, 0, 0, 0] }] }]
    expect(typeof ops.deleteSelection(m, { nodes: [2], elements: [] })).toBe('string')
    const r = ok(ops.deleteSelection(m, { nodes: [], elements: [3] }))
    expect(r.model.elements).toHaveLength(2)
    expect(r.model.nodes.map((n) => n.id)).toEqual([1, 2, 3]) // o nó 4 ficou solto e saiu
    expect(r.model.lanes[0].nodes).toEqual([1, 2, 3])
    expect(r.model.loadCases[0].uniform).toEqual([])
    expect(r.model.loadCases[0].nodal).toEqual([])
    // sem levar órfãos
    const keep = ok(ops.deleteSelection(m, { nodes: [], elements: [3] }, false))
    expect(keep.model.nodes).toHaveLength(4)
    const loose = ok(ops.removeLooseNodes(keep.model))
    expect(loose.model.nodes).toHaveLength(3)
    expect(typeof ops.removeLooseNodes(loose.model)).toBe('string')
  })

  it('atribuir e renumerar', () => {
    let m = blank()
    m = ok(ops.nodeLine(m, [30, 0, 0], [0, 0, 0], 3, { mat: 'c50', sec: 'deck', group: 'deck' })).model
    const a = ok(ops.assign(m, { nodes: [1], elements: [1, 2] }, { group: 'pier', sec: 'tower', fix: [true, true, true, false, false, false] }))
    expect(a.model.elements.filter((e) => e.group === 'pier' && e.kind === 'frame' && e.sec === 'tower')).toHaveLength(2)
    expect(a.model.nodes[0].fix).toEqual([true, true, true, false, false, false])
    expect(typeof ops.assign(m, { nodes: [], elements: [1] }, { sec: 'nada' })).toBe('string')
    const free = ok(ops.assign(a.model, { nodes: [1], elements: [] }, { fix: null }))
    expect(free.model.nodes[0].fix).toBeUndefined()
    m.lanes = [{ id: 'p', name: 'Pista', nodes: [1, 2, 3, 4], width: 8, maxEccentricity: 2 }]
    const r = ok(ops.renumber(m))
    expect(r.model.nodes.map((n) => [n.id, n.x])).toEqual([[1, 0], [2, 10], [3, 20], [4, 30]])
    expect(r.model.lanes[0].nodes).toEqual([4, 3, 2, 1])
    expect(validateModel({ ...r.model, nodes: r.model.nodes.map((n, i) => (i === 0 ? { ...n, fix: [true, true, true, true, true, true] } : n)) })).toEqual([])
    expect(typeof ops.renumber(r.model)).toBe('string')
  })

  it('pendurais: um por nó do tabuleiro, na vertical do nó de cima', () => {
    let m = blank()
    m = ok(ops.nodeLine(m, [0, 0, 0], [40, 0, 0], 4, { mat: 'c50', sec: 'deck', group: 'deck' })).model
    // "arco": nós a 8 m acima dos 3 nós internos
    for (const x of [10, 20, 30]) m = ops.ensureNode(m, [x, 0, 8]).model
    const all: EditSelection = { nodes: m.nodes.map((n) => n.id), elements: [] }
    const r = ok(ops.generateHangers(m, all, { mat: 'stay', A: 0.003 }))
    const hs = r.model.elements.filter((e) => e.kind === 'cable')
    expect(hs).toHaveLength(3)
    expect(hs.every((e) => e.group === 'hanger')).toBe(true)
    // pré-tração ≈ peso tributário: (25·8 + 40) kN/m × 10 m
    expect(hs.every((e) => e.kind === 'cable' && Math.abs((e.pretension ?? 0) - 2400) < 1)).toBe(true)
    expect(typeof ops.generateHangers(r.model, all, { mat: 'stay', A: 0.003 })).toBe('string')
  })
})

describe('estais', () => {
  it('leque: 5 por lado no topo; semi-leque e harpa criam as ancoragens na torre', () => {
    const fan = stayedFromScratch('fan')
    const stays = fan.elements.filter((e) => e.kind === 'cable')
    expect(stays).toHaveLength(10)
    const top = nodeAt(fan, 60, 0, 80)
    expect(stays.every((e) => e.n1 === top || e.n2 === top)).toBe(true)
    expect(stays.every((e) => e.kind === 'cable' && e.group === 'stay' && e.strands === 30 && Math.abs(e.A - 0.0045) < 1e-12 && e.L0 === undefined)).toBe(true)
    // pré-tração: peso tributário (240 kN/m × 10 m) / sen α
    const far = stays.find((e) => [e.n1, e.n2].includes(nodeAt(fan, 10, 0, 20)))!
    const sin = 60 / Math.hypot(50, 60)
    expect(far.kind === 'cable' && far.pretension).toBeCloseTo(2400 / sin, -1)

    const semi = stayedFromScratch('semi-fan')
    const zs = (m: BridgeModel): number[] =>
      Array.from(new Set(m.elements.filter((e) => e.kind === 'cable').map((e) => Math.max(m.nodes.find((n) => n.id === e.n1)!.z, m.nodes.find((n) => n.id === e.n2)!.z)))).sort((a, b) => a - b)
    expect(zs(semi)).toEqual([68, 71, 74, 77, 80])
    // o mais distante vai ao topo
    const farS = semi.elements.find((e) => e.kind === 'cable' && [e.n1, e.n2].includes(nodeAt(semi, 10, 0, 20)))!
    expect([farS.n1, farS.n2]).toContain(nodeAt(semi, 60, 0, 80))
    expect(validateModel(semi)).toEqual([])

    const harp = stayedFromScratch('harp')
    expect(zs(harp)).toEqual([32, 44, 56, 68, 80])
    // repetir não duplica
    const again = ops.generateStays(fan, { nodes: [], elements: stays.map((e) => e.id) }, { layout: 'fan', mat: 'stay', strands: 30, strandArea: 1.5e-4 })
    expect(typeof again).toBe('string')
  })

  it('pares: usa os nós de torre selecionados e avisa quando faltam', () => {
    let m = blank()
    m = ok(ops.nodeLine(m, [0, 0, 20], [60, 0, 20], 6, { mat: 'c50', sec: 'deck', group: 'deck' })).model
    m = ok(ops.nodeLine(m, [60, 0, 0], [60, 0, 20], 1, { mat: 'c50', sec: 'tower', group: 'tower' })).model
    m = ok(ops.nodeLine(m, [60, 0, 20], [60, 0, 50], 3, { mat: 'c50', sec: 'tower', group: 'tower' })).model
    const anchors = [20, 40].map((x) => nodeAt(m, x, 0, 20))
    const t50 = nodeAt(m, 60, 0, 50)
    const t40 = nodeAt(m, 60, 0, 40)
    const r = ok(ops.generateStays(m, { nodes: [...anchors, t50, t40], elements: [] }, { layout: 'pair', mat: 'stay', strands: 20, strandArea: 1.5e-4 }))
    const cab = r.model.elements.filter((e) => e.kind === 'cable')
    expect(cab).toHaveLength(2)
    expect(cab.find((e) => [e.n1, e.n2].includes(anchors[0]))).toMatchObject({ n1: t50 }) // o mais distante no mais alto
    expect(cab.find((e) => [e.n1, e.n2].includes(anchors[1]))).toMatchObject({ n1: t40 })
    expect(typeof ops.generateStays(m, { nodes: [...anchors, t50], elements: [] }, { layout: 'pair', mat: 'stay', strands: 20, strandArea: 1.5e-4 })).toBe('string')
    // sem torre selecionada
    expect(typeof ops.generateStays(m, { nodes: anchors, elements: [] }, { layout: 'fan', mat: 'stay', strands: 20, strandArea: 1.5e-4 })).toBe('string')
  })
})

describe('pistas', () => {
  it('pista automática: caminho ordenado, largura da seção menos barreiras, vãos entre apoios', () => {
    const m = stayedFromScratch()
    expect(m.lanes).toHaveLength(1)
    const lane = m.lanes[0]
    expect(lane.nodes).toHaveLength(13)
    expect(lane.nodes.map((id) => m.nodes.find((n) => n.id === id)!.x)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
    expect(lane.width).toBeCloseTo(13.2, 9)
    expect(lane.maxEccentricity).toBeCloseTo(5.1, 9)
    expect(laneLength(m, lane)).toBeCloseTo(120, 9)
    expect(laneSpans(m, lane)).toEqual([60, 60])
    expect(m.meta?.spans).toEqual([60, 60])
    expect(m.meta?.mainSpan).toBe(60)
    expect(m.meta?.deckMaterial).toBe('concrete')
  })

  it('dois tabuleiros desconexos viram duas pistas; pista pela seleção', () => {
    let m = blank()
    m = ok(ops.nodeLine(m, [0, -8, 0], [40, -8, 0], 4, { mat: 'c50', sec: 'deck', group: 'deck' })).model
    m = ok(ops.nodeLine(m, [0, 8, 0], [40, 8, 0], 4, { mat: 'c50', sec: 'deck', group: 'deck' })).model
    const lanes = autoLanes(m)
    expect(lanes).toHaveLength(2)
    expect(lanes.map((l) => l.name)).toEqual(['Pista 1', 'Pista 2'])
    const first = m.elements.filter((e) => m.nodes.find((n) => n.id === e.n1)!.y < 0).map((e) => e.id)
    const lane = ok(laneFromSelection(m, { nodes: [], elements: first }))
    expect(lane.nodes).toHaveLength(5)
    expect(typeof laneFromSelection(m, { nodes: [], elements: m.elements.map((e) => e.id) })).toBe('string')
    expect(typeof applyAutoLanes(blank())).toBe('string')
  })
})

describe('registro de ações', () => {
  it('todas têm chave única, grupo e descrição; rodam com os valores padrão quando habilitadas', () => {
    const keys = EDIT_ACTIONS.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
    const m = stayedFromScratch()
    const sel: EditSelection = { nodes: [m.nodes[1].id, m.nodes[2].id], elements: [m.elements[0].id] }
    for (const a of EDIT_ACTIONS) {
      expect(a.label.length).toBeGreaterThan(2)
      expect(a.description.length).toBeGreaterThan(10)
      const en = a.enabled(m, sel)
      expect(en === true || typeof en === 'string').toBe(true)
      for (const p of a.params) {
        if (p.kind === 'select') expect((p.options ?? []).length).toBeGreaterThan(0)
      }
      if (en !== true) continue
      const r = a.run(m, sel, defaultValues(a, m, sel))
      if (typeof r !== 'string') expect(validateModel(r.model)).toEqual([])
    }
    // sem seleção: as que precisam de seleção explicam o motivo
    const none: EditSelection = { nodes: [], elements: [] }
    expect(typeof editAction('move')!.enabled(m, none)).toBe('string')
    expect(typeof editAction('stays')!.enabled(m, none)).toBe('string')
    expect(editAction('merge')!.enabled(m, none)).toBe(true)
  })

  it('linha de barras assume as coordenadas dos dois nós selecionados', () => {
    const m = stayedFromScratch()
    const a = nodeAt(m, 0, 0, 20)
    const b = nodeAt(m, 60, 0, 80)
    const act = editAction('line')!
    const v = defaultValues(act, m, { nodes: [a, b], elements: [] })
    expect([v.x1, v.z1, v.x2, v.z2]).toEqual([0, 20, 60, 80])
    expect(v.sec).toBe('deck')
    expect(v.mat).toBe('c50')
  })
})

describe('diagnóstico', () => {
  it('modelo montado do zero sai limpo; defeitos são apontados com seleção e correção', () => {
    const m = stayedFromScratch()
    const d0 = diagnose(m)
    expect(d0.filter((d) => d.severity === 'erro')).toEqual([])
    // sem pista
    const noLane = diagnose({ ...m, lanes: [] })
    expect(noLane.some((d) => d.fix === 'auto-lanes')).toBe(true)
    // nó solto e nó coincidente
    let bad = ops.ensureNode(m, [200, 0, 0]).model
    bad = { ...bad, nodes: [...bad.nodes, { id: 999, x: 0, y: 0, z: 20.0002 }] }
    const d1 = diagnose(bad)
    expect(d1.some((d) => d.fix === 'loose' && d.select?.nodes.length === 2)).toBe(true)
    expect(d1.some((d) => d.fix === 'merge')).toBe(true)
    // sem apoio em x
    const noX = diagnose({ ...m, nodes: m.nodes.map((n) => (n.fix?.every(Boolean) ? { ...n, fix: [false, true, true, true, true, true] } : n)) })
    expect(noX.some((d) => d.severity === 'erro' && /ux/.test(d.text))).toBe(true)
    // parte desconexa
    let two = ok(ops.nodeLine(m, [300, 0, 0], [320, 0, 0], 2, { mat: 'c50', sec: 'deck', group: 'pier' })).model
    two = ok(ops.assign(two, { nodes: [nodeAt(two, 300, 0, 0)], elements: [] }, { fix: [true, true, true, true, true, true] })).model
    expect(diagnose(two).some((d) => /desconex|separad/i.test(d.text))).toBe(true)
    // cabo sem grupo de cabo
    const g = diagnose({ ...m, elements: m.elements.map((e) => (e.kind === 'cable' ? { ...e, group: 'deck' as const } : e)) })
    expect(g.some((d) => /grupo/i.test(d.text) && d.select?.elements.length === 10)).toBe(true)
    // modelo vazio
    expect(diagnose(blank()).some((d) => d.severity === 'erro')).toBe(true)
  })
})

describe('biblioteca', () => {
  it('materiais e seções prontos são válidos e não duplicam', () => {
    let m: BridgeModel = { ...blank(), materials: [], sections: [] }
    for (const item of LIBRARY_MATERIALS) {
      const mat = item.make()
      expect(mat.E).toBeGreaterThan(0)
      expect(mat.name.length).toBeGreaterThan(2)
      m = addLibraryMaterial(m, item).model
    }
    expect(m.materials).toHaveLength(LIBRARY_MATERIALS.length)
    const again = addLibraryMaterial(m, LIBRARY_MATERIALS[0])
    expect(again.added).toBe(false)
    expect(again.model.materials).toHaveLength(LIBRARY_MATERIALS.length)
    for (const item of LIBRARY_SECTIONS) {
      const s = item.make()
      expect(s.A > 0 && s.Iy > 0 && s.Iz > 0 && s.J > 0).toBe(true)
      m = addLibrarySection(m, item).model
    }
    expect(m.sections).toHaveLength(LIBRARY_SECTIONS.length)
    expect(addLibrarySection(m, LIBRARY_SECTIONS[0]).added).toBe(false)
    // C40: Ecs = 0,9 · 5600·√40 = 31,9 GPa
    const c40 = LIBRARY_MATERIALS.find((x) => x.key === 'c40')!.make()
    expect(c40.E / 1e6).toBeCloseTo(31.88, 1)
    expect(c40.fck).toBe(40000)
  })

  it('calculadoras: retângulo vazado e tubo circular conferem com as fórmulas', () => {
    const r = hollowRectSection(4, 6, 0.5)
    expect(r.A).toBeCloseTo(4 * 6 - 3 * 5, 9)
    expect(r.Iz).toBeCloseTo((4 * 6 ** 3 - 3 * 5 ** 3) / 12, 6)
    expect(r.Iy).toBeCloseTo((6 * 4 ** 3 - 5 * 3 ** 3) / 12, 6)
    const t = tubeSection(2, 0.05)
    const ri = 0.95
    expect(t.A).toBeCloseTo(Math.PI * (1 - ri * ri), 2)
    expect(t.Iz).toBeCloseTo((Math.PI / 4) * (1 - ri ** 4), 2)
    expect(t.J).toBeCloseTo((Math.PI / 2) * (1 - ri ** 4), 1)
  })
})

describe('aceitação: estaiada construída do zero', () => {
  it('2 × 60 m, torre de 60 m acima do tabuleiro, 5 estais por lado: analisa, converge e fica no greide', () => {
    const m = stayedFromScratch('fan')
    expect(validateModel(m)).toEqual([])
    const r = analyzeBridge(m, { sizeCables: true })
    expect(r.deadLoad.converged).toBe(true)
    expect(r.formFinding?.converged).toBe(true)
    expect(r.deadLoad.cables.filter((c) => c.slack)).toHaveLength(0)
    const deck = new Set(m.lanes[0].nodes)
    let uz = 0
    m.nodes.forEach((n, i) => {
      if (deck.has(n.id)) uz = Math.max(uz, Math.abs(r.deadLoad.u[6 * i + 2]))
    })
    expect(uz).toBeLessThan(0.03)
    expect(r.moving).toBeDefined()
    expect(r.combos).toBeDefined()
    expect(r.checks.cables.every((c) => c.ok)).toBe(true)
    expect(r.modal?.modes.length).toBeGreaterThan(0)
  })

  it('o mesmo com semi-leque e harpa', () => {
    for (const layout of ['semi-fan', 'harp'] as const) {
      const m = stayedFromScratch(layout)
      const r = analyzeBridge(m, { sizeCables: true, modal: false })
      expect(r.deadLoad.converged).toBe(true)
      expect(r.deadLoad.cables.filter((c) => c.slack)).toHaveLength(0)
      expect(r.checks.cables.every((c) => c.ok)).toBe(true)
    }
  })
})
