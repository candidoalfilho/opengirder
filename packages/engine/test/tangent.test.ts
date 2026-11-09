import { describe, expect, it } from 'vitest'
import { buildSystem, evaluate } from '../src/analysis/system'
import type { BridgeNode, Element } from '../src/model/types'
import { model, SEC, STEEL } from './helpers'

/** tangente montada (densa, por sondagem do skyline) × diferença finita das forças internas */
function check(nodes: BridgeNode[], elements: Element[], scale: number): number {
  const m = model(nodes, elements, {
    materials: [STEEL, { id: 'c', name: 'cabo', kind: 'cable', E: 195e6, G: 7e7, gamma: 80 }],
    sections: [SEC],
  })
  const sys = buildSystem(m)
  const nd = 6 * sys.nNodes
  const u = new Float64Array(nd)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)
  for (let i = 0; i < nd; i++) if (sys.eq[i] >= 0) u[i] = scale * rnd()
  const f0 = new Float64Array(nd)
  const K = evaluate(sys, u, true, { nonlinear: true }, f0)!
  let worst = 0
  let kmax = 0
  const fp = new Float64Array(nd)
  const fm = new Float64Array(nd)
  const h = 1e-6
  for (let j = 0; j < nd; j++) {
    if (sys.eq[j] < 0) continue
    const up = Float64Array.from(u)
    const um = Float64Array.from(u)
    up[j] += h
    um[j] -= h
    evaluate(sys, up, false, { nonlinear: true }, fp)
    evaluate(sys, um, false, { nonlinear: true }, fm)
    for (let i = 0; i < nd; i++) {
      if (sys.eq[i] < 0) continue
      const num = (fp[i] - fm[i]) / (2 * h)
      const k = K.get(sys.eq[i], sys.eq[j])
      kmax = Math.max(kmax, Math.abs(k))
      worst = Math.max(worst, Math.abs(k - num))
    }
  }
  return worst / kmax
}

describe('consistência da rigidez tangente', () => {
  it('barra em orientação geral, pequenos deslocamentos', () => {
    const nodes: BridgeNode[] = [
      { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
      { id: 2, x: 3, y: 4, z: 2 },
      { id: 3, x: 7, y: 5, z: 1 },
    ]
    const elements: Element[] = [
      { kind: 'frame', id: 1, n1: 1, n2: 2, mat: 's', sec: 'sec' },
      { kind: 'frame', id: 2, n1: 2, n2: 3, mat: 's', sec: 'sec' },
    ]
    expect(check(nodes, elements, 1e-4)).toBeLessThan(2e-3)
  })

  it('barra horizontal fora dos eixos + cabo', () => {
    const nodes: BridgeNode[] = [
      { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
      { id: 2, x: 5, y: 5, z: 0 },
      { id: 3, x: 2, y: 1, z: 30, fix: [true, true, true, true, true, true] },
    ]
    const elements: Element[] = [
      { kind: 'frame', id: 1, n1: 1, n2: 2, mat: 's', sec: 'sec' },
      { kind: 'cable', id: 2, n1: 3, n2: 2, mat: 'c', A: 0.002, L0: 30.2 },
    ]
    expect(check(nodes, elements, 1e-4)).toBeLessThan(2e-3)
  })
})
