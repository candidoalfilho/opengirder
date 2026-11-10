import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { PRESETS, generateModel } from '../src/templates'
import { leverWeights } from '../src/loads/transverse'
import type { BridgeModel } from '../src/model/types'
import type { GirderBridgeParams, GrillageParams } from '../src/templates/types'

const OFF = { modal: false as const, moving: false as const, extras: false }

function params(over: Partial<GirderBridgeParams>, grid: Partial<GrillageParams> = {}): GirderBridgeParams {
  return {
    name: 'grelha', spans: [30], deckWidth: 13, carriageway: 12.2, deckMaterial: 'concrete', fck: 40,
    deck: { A: 6, Iz: 3, Iy: 60, J: 1, depth: 1.8, extraDead: 35 },
    pierHeight: 0, elementLength: 2.5, monolithic: false, deckModel: 'grillage',
    grillage: { girders: 5, spacing: 2.6, web: 0.25, depth: 1.8, slab: 0.22, diaphragms: 'supports+mid', ...grid },
    ...over,
  }
}

/** índice, em `frames`, da barra de cada longarina que TERMINA na estaca `k` */
function girderFramesAt(m: BridgeModel, k: number): number[] {
  const order = new Map(m.elements.filter((e) => e.kind === 'frame').map((e, i) => [e.id, i]))
  return m.lanes[0].lines!.map((ln) => {
    const el = m.elements.find((e) => e.kind === 'frame' && e.n1 === ln.nodes[k - 1] && e.n2 === ln.nodes[k])!
    return order.get(el.id)!
  })
}

/** só a carga nodal P (kN, p/ baixo) no nó `node`, sem peso próprio */
function withPointLoad(m: BridgeModel, node: number, P: number): BridgeModel {
  return { ...m, loadCases: [{ id: 'P', name: 'P', nodal: [{ node, F: [0, 0, -P, 0, 0, 0] }] }] }
}

describe('regra da alavanca', () => {
  it('interpola entre as linhas vizinhas e extrapola nos balanços', () => {
    const w = new Float64Array(3)
    leverWeights([-2, 0, 2], 0.5, w)
    expect(Array.from(w)).toEqual([0, 0.75, 0.25])
    leverWeights([-2, 0, 2], -3, w)
    expect(Array.from(w)).toEqual([1.5, -0.5, 0])
    leverWeights([-2, 0, 2], 3, w)
    expect(Array.from(w)).toEqual([0, -0.5, 1.5])
  })
})

describe('tabuleiro em grelha — vigas múltiplas', () => {
  it('carga permanente: a soma dos momentos das longarinas é o momento da viga única', () => {
    const p = params({})
    const m = generateModel({ kind: 'girder', params: p })
    const r = analyzeBridge(m, { ...OFF, nonlinear: false })
    const mid = Math.floor(m.lanes[0].nodes.length / 2)
    const fr = girderFramesAt(m, mid)
    const sum = fr.reduce((a, i) => a + r.deadLoad.frames[i].Mz[2], 0)
    // laje 13 × 0,22 + 5 almas 0,25 × 1,58, γ = 25, + 35 kN/m; nervura da transversina central
    const w = 25 * (13 * 0.22 + 5 * 0.25 * 1.58) + 35
    const rib = 25 * 0.3 * (0.8 * 1.8 - 0.22) * (4 * 2.6)
    const ref = (w * 30 * 30) / 8 + (rib * 30) / 4
    expect(Math.abs(sum / ref - 1)).toBeLessThan(0.01)
    // reações verticais = peso total (as três transversinas inclusive)
    const Rz = r.deadLoad.reactions.reduce((a, x) => a + x.R[2], 0)
    expect(Math.abs(Rz / (w * 30 + 3 * rib) - 1)).toBeLessThan(0.002)
    // flecha média das longarinas ≈ viga única com a soma das inércias
    const E = m.materials.find((x) => x.id === 'deck')!.E
    const I = m.sections.find((x) => x.id === 'deck')!.Iz * 3 + m.sections.find((x) => x.id === 'deck-edge-l')!.Iz * 2
    const delta = (5 * w * 30 ** 4) / (384 * E * I) + (rib * 30 ** 3) / (48 * E * I)
    const idx = new Map(m.nodes.map((n, i) => [n.id, i]))
    const uz = m.lanes[0].lines!.map((ln) => r.deadLoad.u[6 * idx.get(ln.nodes[mid])! + 2])
    const mean = uz.reduce((a, b) => a + b, 0) / uz.length
    expect(Math.abs(-mean / delta - 1)).toBeLessThan(0.03)
  })

  it('transversina rígida no meio do vão: repartição de Courbon/Engesser', () => {
    // hipóteses de Courbon: longarinas iguais e sem torção, laje desprezível, transversina rígida
    // à flexão e SEM rigidez à torção (uma transversina de apoio rígida à torção engasta
    // parcialmente as longarinas umas nas outras e reduz a redistribuição: de 0,60 p/ 0,42 na
    // longarina de borda, com uma nervura de 1,5 × 4 m)
    const p = params({}, {
      slab: 0.02, girder: { A: 1, Iz: 0.3, Iy: 0.05, J: 1e-7 }, diaphragm: { width: 0.05, depth: 10 },
    })
    const base = generateModel({ kind: 'girder', params: p })
    const lines = base.lanes[0].lines!
    const mid = Math.floor(base.lanes[0].nodes.length / 2)
    const P = 1000
    const L = 30
    const ys = lines.map((l) => l.y)
    const sumY2 = ys.reduce((a, y) => a + y * y, 0)
    for (const loaded of [0, 1, 2]) {
      const r = analyzeBridge(withPointLoad(base, lines[loaded].nodes[mid], P), { ...OFF, nonlinear: false })
      const fr = girderFramesAt(base, mid)
      const e = ys[loaded]
      fr.forEach((i, l) => {
        const share = 1 / ys.length + (e * ys[l]) / sumY2
        const M = r.deadLoad.frames[i].Mz[2]
        // cada longarina é uma viga biapoiada com a sua parcela no meio do vão
        expect(Math.abs(M - (share * P * L) / 4)).toBeLessThan(0.01 * ((P * L) / 4))
      })
      const total = fr.reduce((a, i) => a + r.deadLoad.frames[i].Mz[2], 0)
      expect(total).toBeCloseTo((P * L) / 4, 3)
    }
  })

  it('sem transversina no vão e laje fina: a longarina carregada leva bem mais que a de Courbon', () => {
    const p = params({}, { slab: 0.12, diaphragms: 'supports' })
    const base = generateModel({ kind: 'girder', params: p })
    const lines = base.lanes[0].lines!
    const mid = Math.floor(base.lanes[0].nodes.length / 2)
    const P = 1000
    const r = analyzeBridge(withPointLoad(base, lines[0].nodes[mid], P), { ...OFF, nonlinear: false })
    const fr = girderFramesAt(base, mid)
    const M = fr.map((i) => r.deadLoad.frames[i].Mz[2])
    const share = M[0] / M.reduce((a, b) => a + b, 0)
    const ys = lines.map((l) => l.y)
    const courbon = 1 / ys.length + (ys[0] * ys[0]) / ys.reduce((a, y) => a + y * y, 0)
    expect(courbon).toBeCloseTo(0.6, 6)
    expect(share).toBeGreaterThan(0.75)
    // a vizinha recebe bem menos, e as distantes quase nada (ou alívio)
    expect(M[1]).toBeLessThan(0.3 * M[0])
    expect(Math.abs(M[3])).toBeLessThan(0.1 * M[0])
  })

  it('TB-450 em 5 longarinas de 30 m: a de borda fica perto de Courbon e acima da média', () => {
    const p = params({})
    const m = generateModel({ kind: 'girder', params: p })
    const r = analyzeBridge(m, { modal: false, extras: false, nonlinear: false })
    const mv = r.moving!
    const mid = Math.floor(m.lanes[0].nodes.length / 2)
    const fr = girderFramesAt(m, mid)
    const MQ = fr.map((i) => mv.frames[i].Mz.max[2])
    const L = 30
    const phi = mv.CIV * mv.CNF
    // viga única: p·B·L²/8 + eixos de 120 kN em L/2 e L/2 ± 1,5 m
    const Mdist = (5 * 12.2 * L * L) / 8
    const Mveh = 120 * (L / 4 + 2 * ((L / 2 - 1.5) / 2))
    const mean = (phi * (Mdist + Mveh)) / 5
    // Courbon p/ a longarina de borda (y = 5,2 m): η(y) = 1/5 + 5,2·y/Σy² (Σy² = 67,6)
    const eta = (y: number): number => 0.2 + (5.2 * y) / 67.6
    const y0 = -0.2 / (5.2 / 67.6) // zero da linha de influência transversal
    const area = 0.2 * (6.1 - y0) + ((5.2 / 67.6) * (6.1 ** 2 - y0 ** 2)) / 2
    const courbon = phi * ((5 * area * L * L) / 8 + Mveh * eta(4.6))
    // simetria
    expect(MQ[0]).toBeCloseTo(MQ[4], 3)
    expect(MQ[1]).toBeCloseTo(MQ[3], 3)
    // borda: mais que a média, perto de Courbon (a laje e a torção das longarinas redistribuem um pouco)
    expect(MQ[0]).toBeGreaterThan(1.3 * mean)
    expect(MQ[0] / courbon).toBeGreaterThan(0.88)
    expect(MQ[0] / courbon).toBeLessThan(1.04)
    // central: perto da média (todas as faixas carregadas)
    expect(MQ[2] / mean).toBeGreaterThan(0.95)
    expect(MQ[2] / mean).toBeLessThan(1.15)
    // a soma das envoltórias é maior que o momento da viga única (cada longarina tem o seu pior caso)
    expect(MQ.reduce((a, b) => a + b, 0)).toBeGreaterThan(phi * (Mdist + Mveh))
  })

  it('modelo pronto de vigas múltiplas: análise completa, verificações atendidas', () => {
    const preset = PRESETS.find((x) => x.id === 'vigas-pre-moldadas')!
    const m = generateModel(preset.template)
    expect(m.lanes[0].lines).toHaveLength(5)
    const r = analyzeBridge(m, {})
    expect(r.deadLoad.converged).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.modal!.modes.length).toBeGreaterThan(0)
    expect(r.moving).toBeDefined()
    expect(r.combos!.list.length).toBeGreaterThan(4)
    const sc = r.checks.sections!
    expect(sc.length).toBeGreaterThan(100)
    expect(sc.filter((c) => !c.ok)).toHaveLength(0)
    // as longarinas são dimensionadas como seção T (sem aproximação de seção)
    expect(sc.filter((c) => c.group === 'deck').every((c) => !c.approx && c.member === 'beam')).toBe(true)
    // Σ reações verticais = peso (longarinas + sobrecarga + nervuras das transversinas)
    // (só os aparelhos de apoio do tabuleiro: os pilares sob aparelho são barras independentes)
    const zDeck = Math.max(...m.nodes.map((n) => n.z))
    const Rz = r.deadLoad.reactions
      .filter((x) => m.nodes.find((n) => n.id === x.node)!.z === zDeck)
      .reduce((a, x) => a + x.R[2], 0)
    const w = 25 * (13 * 0.22 + 5 * 0.3 * 1.58) + 35
    const rib = 25 * 0.3 * (0.8 * 1.8 - 0.22) * (4 * 2.6)
    expect(Math.abs(Rz / (w * 90 + 7 * rib) - 1)).toBeLessThan(0.002)
  })

  it('pilares monolíticos e nº par de longarinas: o pilar entra no eixo da transversina de apoio', () => {
    const p = params({ spans: [25, 25], pierHeight: 9, monolithic: true }, { girders: 4, spacing: 3 })
    const m = generateModel({ kind: 'girder', params: p })
    const r = analyzeBridge(m, { extras: false })
    expect(r.deadLoad.converged).toBe(true)
    expect(r.moving).toBeDefined()
    const base = r.deadLoad.reactions.find((x) => m.nodes.find((n) => n.id === x.node)!.z === 0)!
    expect(base.R[2]).toBeGreaterThan(0)
  })
})
