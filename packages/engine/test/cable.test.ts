import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import type { BridgeNode, Element, Material } from '../src/model/types'
import { model, SEC, STEEL } from './helpers'

const CABLE: Material = { id: 'c', name: 'cabo', kind: 'cable', E: 160e6, G: 60e6, gamma: 80, fpk: 1770e3 }
const OFF = { modal: false as const, moving: false as const, formFinding: false }

function hangingCable(n: number, L: number, L0total: number, A: number): { nodes: BridgeNode[]; elements: Element[] } {
  const nodes: BridgeNode[] = []
  const elements: Element[] = []
  for (let i = 0; i <= n; i++) {
    // chute inicial: parábola
    const x = (L * i) / n
    nodes.push({ id: i + 1, x, y: 0, z: -4 * 0.1 * L * (i / n) * (1 - i / n), role: 'cable' })
  }
  nodes[0].fix = [true, true, true, true, true, true]
  nodes[n].fix = [true, true, true, true, true, true]
  for (let i = 0; i < n; i++) {
    elements.push({ kind: 'cable', id: i + 1, n1: i + 1, n2: i + 2, mat: 'c', A, L0: L0total / n, group: 'main-cable' })
  }
  return { nodes, elements }
}

describe('cabos — análise não linear', () => {
  it('cabo suspenso em 10 trechos cai na mesma catenária de um trecho único', () => {
    const L = 100
    const A = 0.002
    const L0 = 104
    const one = analyzeBridge(
      model(
        [
          { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
          { id: 2, x: L, y: 0, z: 0, fix: [true, true, true, true, true, true] },
        ],
        [{ kind: 'cable', id: 1, n1: 1, n2: 2, mat: 'c', A, L0 }],
        { materials: [CABLE] },
      ),
      OFF,
    )
    const H1 = one.deadLoad.cables[0].H
    const { nodes, elements } = hangingCable(10, L, L0, A)
    const r = analyzeBridge(model(nodes, elements, { materials: [CABLE] }), OFF)
    expect(r.deadLoad.converged).toBe(true)
    for (const c of r.deadLoad.cables) expect(c.H / H1).toBeCloseTo(1, 7)
    // flecha no meio: catenária inextensível como referência grosseira (cabo é quase inextensível)
    const w = 80 * A
    const zMid = nodes[5].z + r.deadLoad.u[6 * 5 + 2]
    const a = H1 / w
    expect(-zMid).toBeGreaterThan(0.98 * a * (Math.cosh(L / (2 * a)) - 1))
    expect(-zMid).toBeLessThan(1.03 * a * (Math.cosh(L / (2 * a)) - 1))
    // reações verticais = metade do peso
    const Rz = r.deadLoad.reactions.reduce((s, q) => s + q.R[2], 0)
    expect(Rz).toBeCloseTo(w * L0, 6)
  })

  it('carga concentrada no meio de um cabo tenso: equilíbrio 2·T·sen θ = P', () => {
    const L = 40
    const A = 0.001
    const P = 50
    const nodes: BridgeNode[] = [
      { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
      { id: 2, x: L / 2, y: 0, z: -1 },
      { id: 3, x: L, y: 0, z: 0, fix: [true, true, true, true, true, true] },
    ]
    const light = { ...CABLE, gamma: 1e-6 }
    const elements: Element[] = [
      { kind: 'cable', id: 1, n1: 1, n2: 2, mat: 'c', A, L0: 20.0 },
      { kind: 'cable', id: 2, n1: 2, n2: 3, mat: 'c', A, L0: 20.0 },
    ]
    const m = model(nodes, elements, { materials: [light] })
    m.loadCases = [{ id: 'p', name: 'p', nodal: [{ node: 2, F: [0, 0, -P, 0, 0, 0] }] }]
    const r = analyzeBridge(m, OFF)
    expect(r.deadLoad.converged).toBe(true)
    const d = 1 - r.deadLoad.u[6 + 2] // flecha total
    const c = Math.hypot(20, d)
    const T = (light.E * A * (c - 20)) / 20
    expect(r.deadLoad.cables[0].Ti / T).toBeCloseTo(1, 5)
    expect((2 * T * d) / c).toBeCloseTo(P, 4)
    // solução fechada do cabo sem peso: P = 2·EA·(c − L)/L·d/c
    expect(d).toBeGreaterThan(0)
  })

  it('viga estaiada: form-finding zera a flecha nas ancoragens', () => {
    // viga de 40 m apoiada nas pontas, com 3 estais partindo de um mastro rígido
    const nodes: BridgeNode[] = []
    const elements: Element[] = []
    for (let i = 0; i <= 8; i++) nodes.push({ id: i + 1, x: 5 * i, y: 0, z: 0, role: 'deck' })
    nodes[0].fix = [true, true, true, true, false, false]
    nodes[8].fix = [false, true, true, true, false, false]
    for (let i = 0; i < 8; i++) elements.push({ kind: 'frame', id: i + 1, n1: i + 1, n2: i + 2, mat: 's', sec: 'sec', group: 'deck' })
    nodes.push({ id: 10, x: 20, y: 0, z: 25, role: 'tower', fix: [true, true, true, true, true, true] })
    ;[3, 5, 7].forEach((nd, k) => {
      elements.push({ kind: 'cable', id: 20 + k, n1: 10, n2: nd, mat: 'c', A: 0.002, group: 'stay' })
    })
    const heavy = { ...STEEL, gamma: 77 }
    const m = model(nodes, elements, {
      materials: [heavy, CABLE],
      sections: [{ ...SEC, A: 0.4, Iz: 0.02, Iy: 0.2, J: 0.01 }],
      type: 'cable-stayed',
    })
    const r = analyzeBridge(m, { modal: false, moving: false })
    expect(r.formFinding?.converged).toBe(true)
    for (const idx of [2, 4, 6]) expect(Math.abs(r.deadLoad.u[6 * idx + 2])).toBeLessThan(1e-3)
    // com flecha nula nas ancoragens o tabuleiro vira viga contínua sobre apoios rígidos:
    // 4 vãos de 10 m, q = 30,8 kN/m → reação central (R = 0,929·q·L) e momento sobre ele
    const q = 77 * 0.4
    const stay = r.deadLoad.cables[1] // estai vertical do meio
    expect(Math.max(stay.Ti, stay.Tj) / (0.9286 * q * 10)).toBeGreaterThan(0.97)
    expect(Math.max(stay.Ti, stay.Tj) / (0.9286 * q * 10)).toBeLessThan(1.05)
    expect(r.deadLoad.frames[3].Mz[2] / (-0.0714 * q * 100)).toBeGreaterThan(0.9)
    expect(r.deadLoad.frames[3].Mz[2] / (-0.0714 * q * 100)).toBeLessThan(1.1)
  })

  it('corda tensa: f_n = n/(2L)·√(T/m)', () => {
    const L = 60
    const A = 0.001
    const n = 30
    const nodes: BridgeNode[] = []
    const elements: Element[] = []
    for (let i = 0; i <= n; i++) nodes.push({ id: i + 1, x: (L * i) / n, y: 0, z: 0, role: 'cable', fix: [true, false, true, true, true, true] })
    nodes[0].fix = [true, true, true, true, true, true]
    nodes[n].fix = [true, true, true, true, true, true]
    const T = 800
    const E = CABLE.E
    // L0 tal que T = EA·(c − L0)/L0
    const c = L / n
    const L0 = c / (1 + T / (E * A))
    for (let i = 0; i < n; i++) elements.push({ kind: 'cable', id: i + 1, n1: i + 1, n2: i + 2, mat: 'c', A, L0 })
    const r = analyzeBridge(model(nodes, elements, { materials: [CABLE] }), { moving: false, formFinding: false, modal: { modes: 2 } })
    const mass = (80 * A * (L0 / c)) / 9.80665
    const f1 = (1 / (2 * L)) * Math.sqrt(T / mass)
    // modos transversais (y) — a gravidade não entra
    expect(r.modal!.modes[0].frequency / f1).toBeCloseTo(1, 2)
    expect(r.modal!.modes[1].frequency / (2 * f1)).toBeCloseTo(1, 2)
    expect(r.modal!.modes[0].kind).toBe('transversal')
  })
})
