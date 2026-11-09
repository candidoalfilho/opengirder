import { describe, expect, it } from 'vitest'
import { buildSystem } from '../src/analysis/system'
import { solveStatic } from '../src/analysis/static'
import { LinearSolver } from '../src/analysis/linear'
import { analyzeBridge } from '../src/analyze'
import { PRESETS, autoDesignPrestress, defaultTemplate, generateModel } from '../src/index'
import type { GirderBridgeParams } from '../src/templates/types'
import type { BridgeModel, Vec3 } from '../src/model/types'
import {
  type Tendon,
  addEquivalentLoads,
  anchorageSlip,
  autoProfile,
  buildProfile,
  designTendon,
  elasticShorteningLoss,
  fctm,
  frictionForce,
  immediateLosses,
  progressiveLoss,
  psi1000RB,
  refineTendons,
  tendonData,
  tendonPath,
} from '../src/prestress'
import { beam, SEC, STEEL } from './helpers'

const EI = STEEL.E * SEC.Iz
const EA = STEEL.E * SEC.A
const OFF = { modal: false as const, moving: false as const }

function solver(m: BridgeModel) {
  const sys = buildSystem(m)
  const sol = solveStatic(sys, null, { nonlinear: false })
  return { sys, lin: new LinearSolver(sys, sol.K, false) }
}

const base: Omit<Tendon, 'profile'> = { id: 'T', nStrands: 10, strandArea: 1.4e-4, fptk: 1.9e6 }

describe('traçado do cabo', () => {
  it('parábola única entre ancoragem e ponto baixo; duas parábolas com tangente comum na inflexão', () => {
    const p = buildProfile([
      { s: 0, e: 0, kind: 'anchor' },
      { s: 12, e: 0.8, kind: 'span' },
      { s: 30, e: -0.7, kind: 'support' },
      { s: 50, e: 0.8, kind: 'span' },
    ], 0.2)
    expect(p.e(0)).toBeCloseTo(0, 12)
    expect(p.e(12)).toBeCloseTo(0.8, 12)
    expect(p.e(30)).toBeCloseTo(-0.7, 12)
    expect(p.slope(12)).toBeCloseTo(0, 12)
    expect(p.slope(30)).toBeCloseTo(0, 12)
    // inflexão a 0,2·18 m do apoio, sobre a reta que une os dois vértices
    const si = 30 - 0.2 * 18
    expect(p.e(si)).toBeCloseTo(0.8 + (-1.5 * (si - 12)) / 18, 12)
    expect(p.slope(si - 1e-7)).toBeCloseTo(p.slope(si + 1e-7), 6)
    expect(p.slope(si)).toBeCloseTo((2 * -1.5) / 18, 9)
    // parábola da ancoragem: e'(0) = 2·0,8/12
    expect(p.slope(0)).toBeCloseTo(1.6 / 12, 12)
    // ângulo acumulado = soma dos desvios: θ0 + 2·θinf(12→30) + 2·θinf(30→50)
    const t0 = Math.atan(1.6 / 12)
    const t1 = Math.atan(3 / 18)
    const t2 = Math.atan(3 / 20)
    expect(p.totalAngle).toBeCloseTo(t0 + 2 * t1 + 2 * t2, 10)
  })

  it('traçado automático: centroide nas ancoragens, embaixo nos vãos, em cima nos apoios', () => {
    const pts = autoProfile([30, 40, 30], { yTop: 0.8, yBot: 1.2 }, 0.15)
    expect(pts.map((p) => p.s)).toEqual([0, 12, 30, 50, 70, 88, 100])
    expect(pts.map((p) => +p.e.toFixed(3))).toEqual([0, 1.05, -0.65, 1.05, -0.65, 1.05, 0])
  })
})

describe('cargas equivalentes da protensão', () => {
  it('biapoiada com cabo parabólico: w = 8Pf/L², M = −P·e, N = −P, sem reações', () => {
    const L = 24
    const f = 0.5
    const P = 3000
    const m = beam(L, 8)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[8].fix = [false, true, true, false, false, false]
    const { sys, lin } = solver(m)
    const t: Tendon = { ...base, nodes: m.nodes.map((n) => n.id), profile: [{ s: 0, e: 0 }, { s: L / 2, e: f, kind: 'span' }, { s: L, e: 0 }] }
    const path = tendonPath(sys, t)
    const profile = buildProfile(t.profile)
    const load = { nodal: new Float64Array(6 * sys.nNodes), uniform: new Map<number, Vec3>() }
    addEquivalentLoads(sys, path, profile, path.s.map(() => P), load)
    // carga equivalente uniforme p/ cima
    for (const w of load.uniform.values()) expect(w[2]).toBeCloseTo((8 * P * f) / (L * L), 9)
    const r = lin.solve(load)
    r.frames.forEach((fr, e) => {
      for (let st = 0; st < 3; st++) {
        const s = (L / 8) * (e + st / 2)
        expect(fr.Mz[st]).toBeCloseTo(-P * ((4 * f * s * (L - s)) / (L * L)), 6)
        expect(fr.N[st]).toBeCloseTo(-P, 6)
      }
    })
    for (const q of r.reactions) for (const v of q.R) expect(Math.abs(v)).toBeLessThan(1e-6)
    // contraflecha 5wL⁴/384EI e encurtamento PL/EA
    expect(r.u[6 * 4 + 2]).toBeCloseTo((5 * ((8 * P * f) / (L * L)) * L ** 4) / (384 * EI), 8)
    expect(r.u[6 * 8]).toBeCloseTo((-P * L) / EA, 9)
  })

  it('contínua de 2 vãos com cabo reto excêntrico: hiperestático 1,5·P·e no apoio central', () => {
    const L = 15
    const e = 0.3
    const P = 2000
    const m = beam(2 * L, 6)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[3].fix = [false, true, true, false, false, false]
    m.nodes[6].fix = [false, true, true, false, false, false]
    const { sys, lin } = solver(m)
    const t: Tendon = { ...base, nodes: m.nodes.map((n) => n.id), profile: [{ s: 0, e }, { s: 2 * L, e }] }
    const load = { nodal: new Float64Array(6 * sys.nNodes), uniform: new Map<number, Vec3>() }
    addEquivalentLoads(sys, tendonPath(sys, t), buildProfile(t.profile), new Array(7).fill(P), load)
    const r = lin.solve(load)
    // total = isostático (−P·e) + hiperestático (+1,5·P·e) = +0,5·P·e
    expect(r.frames[2].Mz[2]).toBeCloseTo(0.5 * P * e, 6)
    expect(r.frames[0].Mz[0]).toBeCloseTo(-P * e, 6)
    // o hiperestático vem da reação do apoio central: 3·P·e/L p/ baixo
    expect(r.reactions.find((q) => q.node === 4)!.R[2]).toBeCloseTo((-3 * P * e) / L, 6)
    expect(r.reactions.reduce((a, q) => a + q.R[2], 0)).toBeCloseTo(0, 6)
  })

  it('pipeline sem perdas: caso P com M = −Pi·e, hiperestático nulo na biapoiada e atFrames preenchido', () => {
    const L = 24
    const m = beam(L, 8)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[8].fix = [false, true, true, false, false, false]
    m.tendons = [{
      ...base, nodes: m.nodes.map((n) => n.id), mu: 0, k: 0, slip: 0, nCables: 1, phi: 0, epsCs: 0, psi1000: 0,
      profile: [{ s: 0, e: 0 }, { s: L / 2, e: 0.04, kind: 'span' }, { s: L, e: 0 }],
    }]
    const r = analyzeBridge(m, { ...OFF, nonlinear: false })
    const Pi = 10 * 1.4e-4 * Math.min(0.74 * 1.9e6, 0.82 * 0.9 * 1.9e6)
    const tr = r.prestress!.tendons![0]
    expect(tr.Pi).toBeCloseTo(Pi, 6)
    expect(tr.lossTotalPct).toBeCloseTo(0, 9)
    const P = r.cases!.find((c) => c.id === 'P')!
    expect(P.kind).toBe('prestress')
    expect(P.frames[3].Mz[2]).toBeCloseTo(-Pi * 0.04, 6)
    for (const v of tr.Mhyp) expect(Math.abs(v)).toBeLessThan(1e-6)
    expect(r.prestress!.atFrames).toHaveLength(8)
    expect(r.prestress!.atFrames[3]!.e[2]).toBeCloseTo(0.04, 12)
    expect(r.prestress!.atFrames[3]!.P[1]).toBeCloseTo(Pi, 6)
    expect(r.prestress!.atFrames[3]!.Ap[0]).toBeCloseTo(14e-4, 12)
    expect(r.prestress!.checks!.length).toBeGreaterThan(0)
  })
})

describe('perdas de protensão', () => {
  const td = tendonData({ ...base, mu: 0.2, k: 0.002, slip: 0.006, profile: [] })

  it('σpi padrão: mín(0,74·fptk; 0,82·fpyk) e k = 0,01·μ', () => {
    const d = tendonData({ ...base, profile: [] })
    expect(d.sigmaPi).toBeCloseTo(0.82 * 0.9 * 1.9e6, 6)
    expect(d.k).toBeCloseTo(0.002, 12)
    expect(d.Pi).toBeCloseTo(d.sigmaPi * 14e-4, 6)
  })

  it('atrito: P(x) = Pi·e^−(μ·Σα + k·x)', () => {
    const L = 30
    const f = 0.9
    const profile = buildProfile([{ s: 0, e: 0 }, { s: L / 2, e: f, kind: 'span' }, { s: L, e: 0 }])
    const th = Math.atan((4 * f) / L)
    const P = frictionForce([0, L / 2, L], profile, td, 'start')
    expect(P[0]).toBeCloseTo(td.Pi, 9)
    expect(P[1]).toBeCloseTo(td.Pi * Math.exp(-(0.2 * th + 0.002 * (L / 2))), 6)
    expect(P[2]).toBeCloseTo(td.Pi * Math.exp(-(0.2 * 2 * th + 0.002 * L)), 6)
    // pelos dois lados: simétrico, mínimo no meio
    const s = Array.from({ length: 31 }, (_, i) => i)
    const both = immediateLosses(s, profile, { ...td, slip: 0 })
    expect(both.P[5]).toBeCloseTo(both.P[25], 6)
    expect(Math.min(...both.P)).toBeCloseTo(both.P[15], 9)
    // alongamento teórico = ∫P dx/(Ep·Ap)
    expect(both.elongation).toBeGreaterThan((both.P[15] * L) / (td.Ep * td.Ap))
    expect(both.elongation).toBeLessThan((td.Pi * L) / (td.Ep * td.Ap))
  })

  it('acomodação da ancoragem: w = √(δ·Ep·Ap/p) e queda 2·p·w na ancoragem (atrito linear)', () => {
    const p = 12 // kN/m
    const x = Array.from({ length: 81 }, (_, i) => i * 0.5)
    const P = x.map((v) => 2000 - p * v)
    const target = 0.006 * 200e6 * 14e-4
    const r = anchorageSlip(x, P, target)
    const w = Math.sqrt(target / p)
    expect(r.length).toBeCloseTo(w, 6)
    expect(r.drop).toBeCloseTo(2 * p * w, 6)
    // além de w nada muda; dentro, espelho em torno de P(w)
    expect(r.P[80]).toBeCloseTo(P[80], 9)
    expect(r.P[10]).toBeCloseTo(2 * (2000 - p * w) - P[10], 6)
    // conservação: área de perda = δ·Ep·Ap
    let area = 0
    for (let i = 1; i < x.length; i++) area += 0.5 * (P[i] - r.P[i] + P[i - 1] - r.P[i - 1]) * 0.5
    expect(area / target).toBeCloseTo(1, 2)
    // cabo curto: a perda se espalha por todo o comprimento, com a mesma área
    const short = anchorageSlip(x.slice(0, 11), P.slice(0, 11), target)
    let a2 = 0
    for (let i = 1; i < 11; i++) a2 += 0.5 * (P[i] - short.P[i] + P[i - 1] - short.P[i - 1]) * 0.5
    expect(a2).toBeCloseTo(target, 6)
  })

  it('encurtamento elástico: Δσp = αp·σc·(n − 1)/(2n)', () => {
    const sec = { A: 6, I: 3, yTop: 0.8, yBot: 1.2, Ec: 32e6, fck: 40e3 }
    const d = { ...td, nCables: 4 }
    expect(elasticShorteningLoss(5000, d, sec)).toBeCloseTo((200 / 32) * 5000 * (3 / 8) * d.Ap, 9)
    expect(elasticShorteningLoss(5000, { ...td, nCables: 1 }, sec)).toBe(0)
  })

  it('perdas progressivas (9.6.3.4.2): exemplo numérico à mão', () => {
    // Ap = 14 cm², Ac = 0,5 m², Ic = 0,04 m⁴, ep = 0,3 m, αp = 200/32 = 6,25, φ = 2,5, εcs = −2,5e-4
    // σp0 = 1 330 MPa (0,7·fptk → ψ1000 = 2,5% → ψ∞ = 6,25% → χ = −ln(0,9375) = 0,064539)
    // σc,p0g = 8 MPa
    const sec = { A: 0.5, I: 0.04, yTop: 0.4, yBot: 0.4, Ec: 32e6, fck: 40e3 }
    const P0 = 1.33e6 * 14e-4
    const num = -2.5e-4 * 200e6 - 6.25 * 8000 * 2.5 - 1.33e6 * 0.064539
    const den = 1 + 0.064539 + (1 + 1.25) * 6.25 * (1 + (0.09 * 0.5) / 0.04) * (14e-4 / 0.5)
    expect(psi1000RB(0.7)).toBeCloseTo(0.025, 12)
    expect(progressiveLoss(P0, 0.3, 8000, td, sec)).toBeCloseTo((-num / den) * 14e-4, 2)
    // ordem de grandeza: 12 a 20% de σp0
    const pct = -num / den / 1.33e6
    expect(pct).toBeGreaterThan(0.12)
    expect(pct).toBeLessThan(0.2)
  })

  it('fctm da NBR 6118: 0,3·fck^(2/3)', () => {
    expect(fctm(40e3)).toBeCloseTo(300 * Math.pow(40, 2 / 3), 6)
  })
})

describe('viaduto protendido (modelo de referência)', () => {
  it('pré-dimensionamento + ajuste: perdas plausíveis, hiperestático presente e tensões em serviço atendidas', () => {
    const preset = PRESETS.find((p) => p.id === 'viaduto')!
    let model = generateModel(preset.template)
    if (!model.tendons?.length) model = { ...model, tendons: [designTendon(model)!] }
    expect(model.tendons!.length).toBe(1)
    let r = analyzeBridge(model, { modal: false })
    for (let i = 0; i < 3 && !r.prestress!.ok; i++) {
      const next = refineTendons(model, r)
      if (!next) break
      model = next
      r = analyzeBridge(model, { modal: false })
    }
    const tr = r.prestress!.tendons![0]
    // cabo de 100 m em 3 vãos (Σα ≈ 0,9 rad até o meio): imediatas de 8 a 20%, totais de 15 a 35%
    expect(tr.lossImmediatePct).toBeGreaterThan(8)
    expect(tr.lossImmediatePct).toBeLessThan(20)
    expect(tr.lossTotalPct).toBeGreaterThan(15)
    expect(tr.lossTotalPct).toBeLessThan(35)
    // atrito no meio do cabo confere com a fórmula: Pi·e^−(μ·Σα/2 + k·L/2)
    const kMid = tr.s.findIndex((s) => Math.abs(s - 50) < 1e-6)
    expect(tr.Pjack[kMid] / tr.Pi).toBeCloseTo(Math.exp(-(0.2 * tr.totalAngle * 0.5 + 0.002 * 50)), 6)
    // tensão média de compressão P/A entre 2 e 7 MPa
    const A = model.sections.find((s) => s.id === 'deck')!.A
    const Pm = tr.Pinf.reduce((a, b) => a + b, 0) / tr.Pinf.length
    expect(Pm / A).toBeGreaterThan(2000)
    expect(Pm / A).toBeLessThan(7000)
    // viga contínua: há hiperestático de protensão no apoio interno, linear no vão extremo
    const kSup = tr.s.findIndex((s) => Math.abs(s - 30) < 1e-6)
    expect(Math.abs(tr.Mhyp[kSup])).toBeGreaterThan(0.05 * Math.abs(tr.Miso[kSup]))
    const kHalf = tr.s.findIndex((s) => Math.abs(s - 15) < 1e-6)
    expect(tr.Mhyp[kHalf] / tr.Mhyp[kSup]).toBeCloseTo(0.5, 1)
    // protensão não gera resultante: soma das reações verticais do caso P é nula
    const P = r.cases!.find((c) => c.id === 'P')!
    const sum = P.reactions.reduce((a, q) => a + q.R[2], 0)
    expect(Math.abs(sum)).toBeLessThan(1e-3 * tr.Pi)
    // verificações normativas atendidas
    const fails = r.prestress!.checks!.filter((c) => !c.ok && !c.informative)
    expect(fails.map((c) => `${c.key} ${c.value.toFixed(0)} > ${c.limit.toFixed(0)}`)).toEqual([])
    expect(r.prestress!.ok).toBe(true)
    // contrato com as verificações de seção
    const at = r.prestress!.atFrames.filter(Boolean)
    expect(at.length).toBe(tr.s.length - 1)
    expect(at[0]!.Ap[0]).toBeCloseTo(tr.Ap, 12)
  })
})

describe('pré-dimensionamento da protensão', () => {
  const girder = (mod: (p: GirderBridgeParams) => void): BridgeModel => {
    const t = defaultTemplate('girder')
    if (t.kind !== 'girder') throw new Error('gabarito inesperado')
    mod(t.params)
    return generateModel(t)
  }

  it('balanceamento: vãos que pedem menos força recebem menos flecha (20 + 50 + 20)', () => {
    const m = girder((p) => {
      p.spans = [20, 50, 20]
      p.prestress = { enabled: false }
    })
    const t = designTendon(m)!
    const e = t.profile.filter((q) => q.kind === 'span').map((q) => q.e)
    // vão central com a excentricidade máxima; extremos quase no centroide
    expect(e[1]).toBeGreaterThan(1)
    expect(e[0]).toBeLessThan(0.2 * e[1])
    expect(e[2]).toBeCloseTo(e[0], 9)
    // força ≈ g·L²/(8·f) no vão central, com P∞ ≈ 0,78·σpi por cordoalha
    const sec = m.sections.find((s) => s.id === 'deck')!
    const g = 25 * sec.A + (sec.extraDead ?? 0)
    const f = e[1] - t.profile.find((q) => q.kind === 'support')!.e
    const P = (g * 50 * 50) / (8 * f)
    expect(t.nStrands).toBe(Math.ceil(P / (0.78 * 0.82 * 0.9 * 1.9e6 * 1.4e-4)))
  })

  it('gabaritos de viga saem do assistente com as tensões de protensão atendidas', () => {
    const cases: [string, (p: GirderBridgeParams) => void][] = [
      ['1 vão', (p) => { p.spans = [35] }],
      ['2 vãos desiguais', (p) => { p.spans = [30, 20] }],
      ['20 + 50 + 20', (p) => { p.spans = [20, 50, 20] }],
      ['5 vãos sem pilares', (p) => { p.spans = [25, 30, 30, 30, 25]; p.pierHeight = 0 }],
      ['pórtico', (p) => { p.monolithic = true }],
    ]
    for (const [name, mod] of cases) {
      const m = girder(mod)
      expect(m.tendons?.length, name).toBe(1)
      const r = analyzeBridge(m, { modal: false })
      const fails = r.prestress!.checks!.filter((c) => !c.ok && !c.informative).map((c) => c.key)
      expect(fails, name).toEqual([])
    }
  })

  it('autoDesignPrestress parte de um modelo sem cabos e devolve um cabo verificado', () => {
    const m = girder((p) => {
      p.prestress = { enabled: false }
    })
    expect(m.tendons).toBeUndefined()
    const auto = autoDesignPrestress(m)!
    expect(auto.ok).toBe(true)
    expect(auto.model.tendons![0].nStrands).toBeGreaterThan(50)
    // tabuleiro de aço: sem protensão no gabarito
    expect(girder((p) => { p.deckMaterial = 'steel' }).tendons).toBeUndefined()
  })
})
