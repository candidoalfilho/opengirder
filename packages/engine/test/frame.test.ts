import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { beam, SEC, STEEL } from './helpers'

const OFF = { modal: false as const, moving: false as const }

describe('pórtico espacial — soluções analíticas', () => {
  it('viga biapoiada sob carga uniforme: M = qL²/8, δ = 5qL⁴/384EI', () => {
    const L = 20
    const q = 12
    const m = beam(L, 8)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[8].fix = [false, true, true, false, false, false]
    m.loadCases = [{ id: 'q', name: 'q', uniform: m.elements.map((e) => ({ element: e.id, w: [0, 0, -q] as [number, number, number] })) }]
    const r = analyzeBridge(m, { ...OFF, nonlinear: false })
    const EI = STEEL.E * SEC.Iz
    expect(r.deadLoad.u[6 * 4 + 2]).toBeCloseTo((-5 * q * L ** 4) / (384 * EI), 8)
    expect(r.deadLoad.frames[3].Mz[2]).toBeCloseTo((q * L * L) / 8, 6)
    expect(r.deadLoad.frames[0].Vy[0]).toBeCloseTo((q * L) / 2, 6)
    expect(r.deadLoad.reactions[0].R[2]).toBeCloseTo((q * L) / 2, 6)
    // não linear: mesma resposta a menos de termos O((δ/L)²) — aqui δ/L = 1/64
    const r2 = analyzeBridge(m, { ...OFF, nonlinear: true })
    expect(r2.deadLoad.converged).toBe(true)
    expect(r2.deadLoad.u[6 * 4 + 2] / r.deadLoad.u[6 * 4 + 2]).toBeCloseTo(1, 2)
    expect(r2.deadLoad.frames[3].Mz[2] / ((q * L * L) / 8)).toBeCloseTo(1, 2)
  })

  it('peso próprio + sobrecarga permanente da seção', () => {
    const L = 10
    const m = beam(L, 4, { mat: { ...STEEL, gamma: 77 }, sec: { ...SEC, extraDead: 3 } })
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[4].fix = [false, true, true, false, false, false]
    const r = analyzeBridge(m, { ...OFF, nonlinear: false })
    const q = 77 * SEC.A + 3
    expect(r.deadLoad.frames[1].Mz[2]).toBeCloseTo((q * L * L) / 8, 6)
  })

  it('balanço inclinado no espaço com carga na ponta: δ = PL³/3EI', () => {
    const m = beam(5, 5)
    // gira a viga: direção (3, 4, 12)/13
    m.nodes.forEach((n) => {
      const s = n.x
      n.x = (3 * s) / 13
      n.y = (4 * s) / 13
      n.z = (12 * s) / 13
    })
    m.nodes[0].fix = [true, true, true, true, true, true]
    // carga ⟂ ao eixo, no plano vertical da barra: P·ey, ey = projeção de Z ⟂ ex
    const ex = [3 / 13, 4 / 13, 12 / 13]
    const ey = [-ex[0] * ex[2], -ex[1] * ex[2], 1 - ex[2] * ex[2]]
    const ny = Math.hypot(...ey)
    const P = 10
    m.loadCases = [{ id: 'p', name: 'p', nodal: [{ node: 6, F: [(P * ey[0]) / ny, (P * ey[1]) / ny, (P * ey[2]) / ny, 0, 0, 0] }] }]
    const r = analyzeBridge(m, { ...OFF, nonlinear: false })
    const u = r.deadLoad.u.slice(30, 33)
    const d = (u[0] * ey[0] + u[1] * ey[1] + u[2] * ey[2]) / ny
    expect(d).toBeCloseTo((P * 125) / (3 * STEEL.E * SEC.Iz), 9)
    // carga em +y na ponta: traciona a fibra −y no engaste → Mz positivo
    expect(r.deadLoad.frames[0].Mz[0]).toBeCloseTo(P * 5, 6)
  })

  it('efeito de 2ª ordem: amplificação 1/(1 − P/Pcr) em coluna biarticulada', () => {
    const L = 10
    const m = beam(L, 10)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[10].fix = [false, true, true, false, false, false]
    const EI = STEEL.E * SEC.Iz
    const Pcr = (Math.PI ** 2 * EI) / L ** 2
    const P = 0.5 * Pcr
    const q = 1
    m.loadCases = [{
      id: 'p', name: 'p',
      nodal: [{ node: 11, F: [-P, 0, 0, 0, 0, 0] }],
      uniform: m.elements.map((e) => ({ element: e.id, w: [0, 0, -q] as [number, number, number] })),
    }]
    const lin = analyzeBridge(m, { ...OFF, nonlinear: false })
    const nl = analyzeBridge(m, { ...OFF, nonlinear: true })
    expect(nl.deadLoad.converged).toBe(true)
    const amp = nl.deadLoad.u[6 * 5 + 2] / lin.deadLoad.u[6 * 5 + 2]
    // solução exata da viga-coluna com carga uniforme: fator ≈ 1/(1 − P/Pcr) (erro < 0,5%)
    expect(amp).toBeGreaterThan(1.99)
    expect(amp).toBeLessThan(2.02)
    // momento no meio: q·L²/8 + P·δ
    const d = -nl.deadLoad.u[6 * 5 + 2]
    expect(nl.deadLoad.frames[4].Mz[2]).toBeCloseTo((q * L * L) / 8 + P * d, 1)
    expect(nl.deadLoad.frames[4].N[2]).toBeCloseTo(-P, 3)
  })

  it('tração enrijece: viga tracionada flete menos (corda)', () => {
    const L = 10
    const m = beam(L, 10)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[10].fix = [false, true, true, false, false, false]
    const EI = STEEL.E * SEC.Iz
    const Pe = (Math.PI ** 2 * EI) / L ** 2
    m.loadCases = [{
      id: 'p', name: 'p',
      nodal: [{ node: 11, F: [Pe, 0, 0, 0, 0, 0] }],
      uniform: m.elements.map((e) => ({ element: e.id, w: [0, 0, -1] as [number, number, number] })),
    }]
    const lin = analyzeBridge(m, { ...OFF, nonlinear: false })
    const nl = analyzeBridge(m, { ...OFF, nonlinear: true })
    const amp = nl.deadLoad.u[6 * 5 + 2] / lin.deadLoad.u[6 * 5 + 2]
    expect(amp).toBeGreaterThan(0.495)
    expect(amp).toBeLessThan(0.505)
  })

  it('modos de viga biapoiada: f_n = n²π/(2L²)·√(EI/m)', () => {
    const L = 30
    const mat = { ...STEEL, gamma: 77 }
    const m = beam(L, 30, { mat })
    // só flexão vertical: trava y, torção e o eixo
    m.nodes.forEach((n) => (n.fix = [true, true, false, true, false, true]))
    m.nodes[0].fix = [true, true, true, true, false, true]
    m.nodes[30].fix = [true, true, true, true, false, true]
    const r = analyzeBridge(m, { moving: false, modal: { modes: 3 }, nonlinear: false })
    const mass = (77 * SEC.A) / 9.80665
    const f1 = (Math.PI / (2 * L * L)) * Math.sqrt((STEEL.E * SEC.Iz) / mass)
    expect(r.modal!.modes[0].frequency / f1).toBeCloseTo(1, 2)
    expect(r.modal!.modes[1].frequency / (4 * f1)).toBeCloseTo(1, 2)
    expect(r.modal!.modes[2].frequency / (9 * f1)).toBeCloseTo(1, 1)
    expect(r.modal!.modes[0].kind).toBe('vertical')
    expect(r.modal!.modes[0].massPct[2]).toBeCloseTo(81.06, 0)
  })
})
