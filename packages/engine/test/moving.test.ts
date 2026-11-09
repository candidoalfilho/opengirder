import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { civ, cnf, ciaFactor, VEHICLES } from '../src/loads/nbr7188'
import { beam } from './helpers'

describe('NBR 7188', () => {
  it('coeficientes', () => {
    expect(civ(5)).toBe(1.35)
    expect(civ(10)).toBeCloseTo(1 + (1.06 * 20) / 60, 12)
    expect(civ(50)).toBeCloseTo(1.212, 12)
    expect(civ(200)).toBeCloseTo(1.0848, 12)
    expect(civ(1280)).toBeCloseTo(1.0848, 12)
    expect(cnf(1)).toBeCloseTo(1.05, 12)
    expect(cnf(2)).toBe(1)
    expect(cnf(3)).toBeCloseTo(0.95, 12)
    expect(cnf(6)).toBe(0.9)
    expect(ciaFactor('concrete')).toBe(1.25)
    expect(ciaFactor('steel')).toBe(1.15)
    expect(VEHICLES['TB-450'].wheelLoad * 6).toBe(450)
    expect(VEHICLES['TB-240'].wheelLoad * 6).toBe(240)
  })

  it('viga biapoiada de 30 m: momento máximo do TB-450 = fórmula fechada', () => {
    const L = 30
    const W = 7.2 // 2 faixas → CNF = 1
    const m = beam(L, 60)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[60].fix = [false, true, true, true, false, false]
    m.lanes = [{ id: 'l', name: 'l', nodes: m.nodes.map((n) => n.id), width: W, maxEccentricity: 2.1, joints: [-100] }]
    m.meta = { mainSpan: L, spans: [L], deckMaterial: 'concrete' }
    const r = analyzeBridge(m, { modal: false, nonlinear: false })
    const mv = r.moving!
    expect(mv.CIV).toBeCloseTo(1 + (1.06 * 20) / 80, 12)
    expect(mv.CNF).toBe(1)
    expect(mv.axleLoad).toBe(120)
    const p = 5 * W
    // p em todo o vão + eixos de 120 kN em L/2 e L/2 ± 1,5 m
    const Mk = (p * L * L) / 8 + 120 * (L / 4) + 2 * 120 * (L / 4 - 0.75)
    const env = mv.frames[29].Mz // barra que termina no meio do vão
    expect(env.max[2] / (mv.CIV * Mk)).toBeCloseTo(1, 4)
    expect(env.min[2]).toBeCloseTo(0, 6)
    // cortante máximo no apoio: p·L/2 + eixos em 0, 1,5 e 3 m
    const Vk = (p * L) / 2 + 120 * (1 + (L - 1.5) / L + (L - 3) / L)
    expect(mv.frames[0].Vy.max[0] / (mv.CIV * Vk)).toBeCloseTo(1, 3)
    // torção: meia pista carregada + veículo excêntrico, viga engastada à torção nas duas pontas
    expect(mv.frames[0].T.max[0]).toBeGreaterThan(0)
    expect(mv.frames[0].T.min[0]).toBeCloseTo(-mv.frames[0].T.max[0], 6)
  })

  it('viga contínua de 2 vãos: momento mínimo no apoio central', () => {
    const L = 20
    const m = beam(2 * L, 80)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[40].fix = [false, true, true, false, false, false]
    m.nodes[80].fix = [false, true, true, true, false, false]
    m.lanes = [{ id: 'l', name: 'l', nodes: m.nodes.map((n) => n.id), width: 7.2, maxEccentricity: 0, joints: [-100] }]
    m.meta = { mainSpan: L, spans: [L, L], deckMaterial: 'concrete' }
    const r = analyzeBridge(m, { modal: false, nonlinear: false })
    const mv = r.moving!
    const p = 36
    // distribuída nos dois vãos: −pL²/8. Veículo: LI do momento no apoio de viga de 2 vãos iguais,
    // η(x) = −x(L² − x²)/(4L²), máxima em x = L/√3
    const eta = (x: number): number => (-x * (L * L - x * x)) / (4 * L * L)
    let best = 0
    for (let x = 1.5; x < L - 1.5; x += 0.01) best = Math.min(best, 120 * (eta(x - 1.5) + eta(x) + eta(x + 1.5)))
    const Mk = (-p * L * L) / 8 + best
    expect(mv.frames[39].Mz.min[2] / (mv.CIV * Mk)).toBeCloseTo(1, 3)
    // máximo positivo no apoio central é nulo (LI toda negativa)
    expect(mv.frames[39].Mz.max[2]).toBeCloseTo(0, 6)
    // CIA só perto de juntas
    expect(mv.CIA).toBe(1.25)
  })
})
