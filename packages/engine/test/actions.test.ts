import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { brakingForce } from '../src/loads/braking'
import { cableDiameter, cableDrag, deckDrag, dynamicPressure, s2Factor, windClass } from '../src/loads/wind'
import { resolveSite } from '../src/loads/site'
import type { BridgeModel, Section } from '../src/model/types'
import { beam, STEEL } from './helpers'

const SEC: Section = { id: 'sec', name: 'seção', A: 0.5, Iy: 0.6, Iz: 0.05, J: 0.08, depth: 1.0, width: 4.0 }
const EA = STEEL.E * SEC.A
const EI = STEEL.E * SEC.Iz

function deck(L: number, n: number, ends: 'fixed' | 'simple', lanes = true): BridgeModel {
  const m = beam(L, n, { sec: SEC })
  if (ends === 'fixed') {
    m.nodes[0].fix = [true, true, true, true, true, true]
    m.nodes[n].fix = [true, true, true, true, true, true]
  } else {
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[n].fix = [false, true, true, true, false, false]
  }
  if (lanes) m.lanes = [{ id: 'l', name: 'Pista', nodes: m.nodes.map((x) => x.id), width: 8, maxEccentricity: 2 }]
  m.meta = { mainSpan: L, deckMaterial: 'steel' }
  return m
}

const OPT = { modal: false as const, nonlinear: false }
const find = (r: ReturnType<typeof analyzeBridge>, id: string) => {
  const c = r.cases?.find((x) => x.id === id)
  if (!c) throw new Error(`caso ${id} não gerado`)
  return c
}

describe('vento NBR 6123 — fatores e pressão', () => {
  it('S2 = b·Fr·(z/10)^p', () => {
    expect(s2Factor(2, 'A', 10)).toBeCloseTo(1.0, 12)
    expect(s2Factor(2, 'C', 50)).toBeCloseTo(0.95 * 5 ** 0.1, 12)
    expect(s2Factor(4, 'B', 20)).toBeCloseTo(0.85 * 0.98 * 2 ** 0.125, 12)
    expect(s2Factor(1, 'A', 10)).toBeCloseTo(1.1, 12)
    expect(windClass(18)).toBe('A')
    expect(windClass(45)).toBe('B')
    expect(windClass(300)).toBe('C')
  })
  it('q = 0,613·Vk² e arrastos', () => {
    expect(dynamicPressure(40)).toBeCloseTo(0.9808, 10)
    expect(deckDrag(12, 3)).toBeCloseTo(1.3, 12)
    expect(deckDrag(3, 3)).toBeCloseTo(2.2, 12)
    expect(deckDrag(1, 4)).toBeCloseTo(2.4, 12)
    // estai de 55 cordoalhas de 150 mm²: Ø ≈ 0,205 m; a 40 m/s Re = 5,7·10⁵ → supercrítico
    const d = cableDiameter(55 * 150e-6, 'stay')
    expect(d).toBeCloseTo(2 * Math.sqrt((4 * 55 * 150e-6) / Math.PI), 12)
    expect(cableDrag(40, d)).toBe(0.7)
    expect(cableDrag(40, 0.05)).toBe(1.2)
  })
})

describe('frenagem NBR 7188', () => {
  it('Hf = 0,25·B·L·CNF ≥ 135 kN', () => {
    expect(brakingForce(10, 30, 1)).toBe(135)
    expect(brakingForce(12.4, 400, 0.95)).toBeCloseTo(0.25 * 12.4 * 400 * 0.95, 10)
  })
})

describe('casos de carga das ações', () => {
  it('padrões do local e desligamento', () => {
    const m = deck(20, 4, 'simple')
    const s = resolveSite(m)
    expect(s.temperature).toEqual({ uniform: 15, gradient: 15, cables: 10 })
    expect(s.wind).toEqual({ V0: 35, S1: 1, category: 2, S3: 1.1 })
    expect(s.braking).toBe(true)
    expect(s.seismic).toBe(false)
    m.site = { temperature: false, wind: false, braking: false }
    const r = analyzeBridge(m, OPT)
    expect(r.cases).toBeUndefined()
    expect(r.combos).toBeDefined()
  })

  it('viga biengastada: TU dá N = ∓EA·α·ΔT e TG dá M = EI·α·ΔT/h', () => {
    const m = deck(24, 6, 'fixed', false)
    m.site = { temperature: { uniform: 20, gradient: 12, cables: 0 }, wind: false }
    const r = analyzeBridge(m, OPT)
    const alpha = 1.2e-5
    for (const f of find(r, 'TU+').frames) for (const v of f.N) expect(v).toBeCloseTo(-EA * alpha * 20, 5)
    for (const f of find(r, 'TU−').frames) for (const v of f.N) expect(v).toBeCloseTo(EA * alpha * 20, 5)
    const M0 = (EI * alpha * 12) / 1.0
    for (const f of find(r, 'TG+').frames) for (const v of f.Mz) expect(v).toBeCloseTo(M0, 5)
    for (const f of find(r, 'TG−').frames) for (const v of f.Mz) expect(v).toBeCloseTo(-0.5 * M0, 5)
    // sem cabos não há caso TC
    expect(r.cases!.some((c) => c.id.startsWith('TC'))).toBe(false)
  })

  it('vento transversal em viga biapoiada: força q·Ca·d por metro, My = f·L²/8', () => {
    const L = 20
    const m = deck(L, 8, 'simple')
    m.site = { temperature: false, braking: false }
    const r = analyzeBridge(m, OPT)
    // z de referência 10 m, classe A (maior dimensão 20 m), categoria II → S2 = 1
    const Vk = 35 * 1 * 1 * 1.1
    const q = (0.613 * Vk * Vk) / 1000
    const fW = q * (2.5 - (0.3 * 4) / 2.0) * 2.0
    const fWT = (2 / 3) * q * (2.5 - (0.3 * 4) / 3.0) * 3.0
    const w = find(r, 'W')
    const wt = find(r, 'WT')
    expect(w.sign).toBe('both')
    expect(Math.abs(w.frames[3].My[2])).toBeCloseTo((fW * L * L) / 8, 6)
    expect(Math.abs(wt.frames[3].My[2])).toBeCloseTo((fWT * L * L) / 8, 6)
    expect(Math.abs(w.reactions[0].R[1] + w.reactions[1].R[1])).toBeCloseTo(fW * L, 6)
    expect(w.info!.find((i) => i.label === 'Força no tabuleiro')!.value).toBeCloseTo(fW, 10)
    expect(w.info!.find((i) => i.label === 'Força transversal total')!.value).toBeCloseTo(fW * L, 8)
    // deslocamento lateral no meio do vão: 5fL⁴/384EIy
    expect(Math.abs(w.u[6 * 4 + 1])).toBeCloseTo((5 * fW * L ** 4) / (384 * STEEL.E * SEC.Iy), 9)
  })

  it('frenagem: Hf mínimo de 135 kN vai inteiro para o apoio fixo', () => {
    const m = deck(20, 8, 'simple')
    m.site = { temperature: false, wind: false }
    const r = analyzeBridge(m, OPT)
    const fr = find(r, 'FR')
    expect(fr.sign).toBe('both')
    expect(fr.info![0].value).toBe(135)
    expect(Math.abs(fr.reactions[0].R[0])).toBeCloseTo(135, 6)
    // normal linear de 135 (apoio fixo) a 0 (apoio móvel)
    expect(Math.abs(fr.frames[0].N[0])).toBeCloseTo(135, 6)
    expect(Math.abs(fr.frames[7].N[2])).toBeLessThan(1e-6)
    // sem carga móvel não há frenagem
    const r2 = analyzeBridge(m, { ...OPT, moving: false })
    expect(r2.cases).toBeUndefined()
  })
})
