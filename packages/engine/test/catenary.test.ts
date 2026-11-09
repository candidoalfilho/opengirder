import { describe, expect, it } from 'vitest'
import { catenaryFlex, evalCable, newCableState, solveCatenary, unstressedLengthForTension } from '../src/analysis/catenary'

describe('catenária elástica', () => {
  it('cabo inextensível nivelado reproduz a catenária clássica', () => {
    // catenária y = a·cosh(x/a): vão l, comprimento S = 2a·sinh(l/2a), H = w·a
    const w = 2
    const a = 80
    const l = 100
    const S = 2 * a * Math.sinh(l / (2 * a))
    const sol = { H: 0, V0: 0, iterations: 0 }
    expect(solveCatenary(l, 0, { EA: 1e12, w, L0: S }, null, sol)).toBe(true)
    expect(sol.H).toBeCloseTo(w * a, 3)
    expect(sol.V0).toBeCloseTo((-w * S) / 2, 4)
  })

  it('cabo inclinado: equilíbrio global e flecha', () => {
    const p = { EA: 5e5, w: 0.8, L0: 130 }
    const st = newCableState()
    evalCable(100, 0, 60, p, st)
    // forças internas: soma vertical = peso total; soma horizontal = 0
    expect(st.fI[0] + st.fJ[0]).toBeCloseTo(0, 8)
    expect(st.fI[2] + st.fJ[2]).toBeCloseTo(p.w * p.L0, 8)
    // momento em relação a I: H·lz − Vj·lh + ∫peso = 0 → verificado pela posição do CG via projeções
    const f = catenaryFlex(st.H, st.V0, p.L0, p.EA, p.w)
    expect(f.lh).toBeCloseTo(100, 8)
    expect(f.lz).toBeCloseTo(60, 8)
  })

  it('rigidez tangente = derivada numérica das forças', () => {
    const p = { EA: 3e5, w: 1.2, L0: 101 }
    const d = [80, 30, 45]
    const st = newCableState()
    evalCable(d[0], d[1], d[2], p, st)
    const k = Float64Array.from(st.k3)
    const h = 1e-5
    for (let j = 0; j < 3; j++) {
      const dp = [...d]
      const dm = [...d]
      dp[j] += h
      dm[j] -= h
      const sp = newCableState()
      const sm = newCableState()
      evalCable(dp[0], dp[1], dp[2], p, sp)
      evalCable(dm[0], dm[1], dm[2], p, sm)
      for (let i = 0; i < 3; i++) {
        const num = (sp.fJ[i] - sm.fJ[i]) / (2 * h)
        expect(k[i * 3 + j]).toBeCloseTo(num, 3)
      }
    }
  })

  it('pendural vertical tenso: tração elástica e rigidez T/L', () => {
    const p = { EA: 1e6, w: 0.5, L0: 10 }
    const st = newCableState()
    evalCable(0, 0, -10.01, p, st) // I em cima, J embaixo
    expect(st.converged).toBe(true)
    const Tmid = (p.EA * 0.01) / 10
    expect((st.Ti + st.Tj) / 2).toBeCloseTo(Tmid, 0)
    expect(st.Ti - st.Tj).toBeCloseTo(p.w * p.L0, 2)
    expect(st.k3[0]).toBeCloseTo(Tmid / 10.01, 0)
    expect(st.k3[8]).toBeCloseTo(p.EA / p.L0, -2)
  })

  it('L0 p/ tração-alvo', () => {
    const EA = 4e5
    const w = 0.6
    const L0 = unstressedLengthForTension(120, 70, EA, w, 2500)
    const st = newCableState()
    evalCable(120, 0, 70, { EA, w, L0 }, st)
    expect(Math.max(st.Ti, st.Tj)).toBeCloseTo(2500, 3)
  })

  it('módulo de Ernst: rigidez axial aparente de estai', () => {
    // E_eq = E / (1 + (γ·l)²·E/(12σ³))  com l = projeção horizontal
    const A = 0.01
    const E = 195e6
    const gamma = 80
    const lh = 300
    const lz = 120
    const T = 4000
    const L0 = unstressedLengthForTension(lh, lz, E * A, gamma * A, T)
    const st = newCableState()
    evalCable(lh, 0, lz, { EA: E * A, w: gamma * A, L0 }, st)
    const c = Math.hypot(lh, lz)
    const e = [lh / c, 0, lz / c]
    let kax = 0
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) kax += e[i] * st.k3[i * 3 + j] * e[j]
    const sigma = T / A
    const Eeq = E / (1 + ((gamma * lh) ** 2 * E) / (12 * sigma ** 3))
    expect(kax / ((Eeq * A) / c)).toBeGreaterThan(0.97)
    expect(kax / ((Eeq * A) / c)).toBeLessThan(1.03)
  })
})
