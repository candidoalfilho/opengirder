import { describe, expect, it } from 'vitest'
import { buildSystem } from '../src/analysis/system'
import { solveStatic } from '../src/analysis/static'
import { LinearSolver } from '../src/analysis/linear'
import type { BridgeModel, Material } from '../src/model/types'
import { beam, model, SEC, STEEL } from './helpers'

function solver(m: BridgeModel, nonlinear = false) {
  const sys = buildSystem(m)
  const sol = solveStatic(sys, null, { nonlinear })
  return { sys, lin: new LinearSolver(sys, sol.K, nonlinear) }
}

const EI = STEEL.E * SEC.Iz
const EA = STEEL.E * SEC.A

describe('casos lineares sobre a tangente', () => {
  it('carga uniforme em viga biapoiada: M = qL²/8 e reações qL/2', () => {
    const L = 20
    const m = beam(L, 8)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[8].fix = [false, true, true, false, false, false]
    const { sys, lin } = solver(m)
    const r = lin.solve({ uniform: new Map(sys.frames.map((_, e) => [e, [0, 0, -10] as [number, number, number]])) })
    expect(r.frames[3].Mz[2]).toBeCloseTo((10 * L * L) / 8, 6)
    expect(r.reactions[0].R[2]).toBeCloseTo(100, 6)
    expect(r.u[6 * 4 + 2]).toBeCloseTo((-5 * 10 * L ** 4) / (384 * EI), 8)
  })

  it('gradiente térmico: biengastada dá M = EI·α·ΔT/h constante; biapoiada dá M = 0 e contraflecha κL²/8', () => {
    const L = 20
    const kappa = (1e-5 * 15) / 1.2 // α·ΔT/h, topo mais quente
    const fixed = beam(L, 4)
    fixed.nodes[0].fix = [true, true, true, true, true, true]
    fixed.nodes[4].fix = [true, true, true, true, true, true]
    let s = solver(fixed)
    let r = s.lin.solve({ strain: new Map(s.sys.frames.map((_, e) => [e, { kz: -kappa }])) })
    for (const f of r.frames) for (const v of f.Mz) expect(v).toBeCloseTo(EI * kappa, 6)
    expect(Math.abs(r.u[6 * 2 + 2])).toBeLessThan(1e-12)

    const simple = beam(L, 4)
    simple.nodes[0].fix = [true, true, true, true, false, false]
    simple.nodes[4].fix = [false, true, true, false, false, false]
    s = solver(simple)
    r = s.lin.solve({ strain: new Map(s.sys.frames.map((_, e) => [e, { kz: -kappa }])) })
    for (const f of r.frames) for (const v of f.Mz) expect(Math.abs(v)).toBeLessThan(1e-6)
    // topo mais quente: a viga sobe
    expect(r.u[6 * 2 + 2]).toBeCloseTo((kappa * L * L) / 8, 9)
  })

  it('variação uniforme: barra impedida N = −EA·α·ΔT; barra livre alonga α·ΔT·L sem esforço', () => {
    const L = 12
    const eps = 1.2e-5 * 20
    const held = beam(L, 3)
    held.nodes[0].fix = [true, true, true, true, true, true]
    held.nodes[3].fix = [true, true, true, true, true, true]
    let s = solver(held)
    let r = s.lin.solve({ strain: new Map(s.sys.frames.map((_, e) => [e, { eps }])) })
    for (const f of r.frames) for (const v of f.N) expect(v).toBeCloseTo(-EA * eps, 6)
    expect(r.reactions[0].R[0]).toBeCloseTo(EA * eps, 6)

    const free = beam(L, 3)
    free.nodes[0].fix = [true, true, true, true, true, true]
    free.nodes[3].fix = [false, true, true, true, false, false]
    s = solver(free)
    r = s.lin.solve({ strain: new Map(s.sys.frames.map((_, e) => [e, { eps }])) })
    for (const f of r.frames) for (const v of f.N) expect(Math.abs(v)).toBeLessThan(1e-6)
    expect(r.u[6 * 3]).toBeCloseTo(eps * L, 10)
  })

  it('recalque do apoio central de viga contínua de 2 vãos: M = 3EIδ/L²', () => {
    const L = 15
    const m = beam(2 * L, 6)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[3].fix = [false, true, true, false, false, false]
    m.nodes[6].fix = [false, true, true, false, false, false]
    const { lin } = solver(m)
    const d = 0.02
    const r = lin.solve({ settlement: new Map([[6 * 3 + 2, -d]]) })
    expect(r.u[6 * 3 + 2]).toBeCloseTo(-d, 12)
    expect(r.frames[2].Mz[2]).toBeCloseTo((3 * EI * d) / (L * L), 6)
    // reação no apoio que recalca: alivia 2·(3EIδ/L³)
    const rb = r.reactions.find((x) => x.node === 4)!
    expect(rb.R[2]).toBeCloseTo((-6 * EI * d) / L ** 3, 6)
  })

  it('cabo: alongar L0 com as ancoragens presas reduz a tração de EA·ΔL0/L0', () => {
    const CABLE: Material = { id: 'c', name: 'cabo', kind: 'cable', E: 195e6, G: 75e6, gamma: 0, fpk: 1860e3 }
    const A = 0.003
    const L0 = 49.9
    const m = model(
      [
        { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
        { id: 2, x: 30, y: 0, z: 40, fix: [true, true, true, true, true, true] },
      ],
      [{ kind: 'cable', id: 1, n1: 1, n2: 2, mat: 'c', A, L0 }],
      { materials: [CABLE] },
    )
    const sys = buildSystem(m)
    const sol = solveStatic(sys, null, { nonlinear: true })
    const lin = new LinearSolver(sys, sol.K, true)
    const T0 = sys.cables[0].st.Ti
    expect(T0).toBeCloseTo((CABLE.E * A * (50 - L0)) / L0, 3)
    const dL0 = 0.01
    const r = lin.solve({ cableDL0: new Map([[0, dL0]]) })
    const T1 = (CABLE.E * A * (50 - L0 - dL0)) / (L0 + dL0)
    expect(r.cables[0].dT).toBeCloseTo(T1 - T0, 3)
  })

  it('cabo aquecido sustentando um peso: o nó desce α·ΔT·L0 e a tração não muda', () => {
    const CABLE: Material = { id: 'c', name: 'cabo', kind: 'cable', E: 195e6, G: 75e6, gamma: 0, fpk: 1860e3 }
    const m = model(
      [
        { id: 1, x: 0, y: 0, z: 20, fix: [true, true, true, true, true, true] },
        { id: 2, x: 0, y: 0, z: 0, fix: [true, true, false, true, true, true] },
      ],
      [{ kind: 'cable', id: 1, n1: 1, n2: 2, mat: 'c', A: 0.002, L0: 19.99 }],
      { materials: [CABLE], loadCases: [{ id: 'p', name: 'p', nodal: [{ node: 2, F: [0, 0, -500, 0, 0, 0] }] }] },
    )
    const sys = buildSystem(m)
    const sol = solveStatic(sys, null, { nonlinear: true })
    expect(sol.converged).toBe(true)
    const lin = new LinearSolver(sys, sol.K, true)
    const dL0 = 1.2e-5 * 25 * 19.99
    const r = lin.solve({ cableDL0: new Map([[0, dL0]]) })
    expect(r.u[6 + 2]).toBeCloseTo(-dL0 * (1 + 500 / (CABLE.E * 0.002)), 5)
    expect(Math.abs(r.cables[0].dT)).toBeLessThan(1e-3)
  })
})
