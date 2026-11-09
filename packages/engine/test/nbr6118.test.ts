import { describe, expect, it } from 'vitest'
import {
  ES,
  columnELU,
  columnMRd,
  concreteParams,
  fctm,
  fiberStresses,
  flexureELU,
  minMoment,
  rhoMin,
  shearELU,
  shearTorsionRatio,
  stressELS,
  torsionELU,
} from '../src/checks/nbr6118'
import { steelStressCheck } from '../src/checks/nbr8800'
import { PRESETS, analyzeBridge, generateModel } from '../src/index'

const C25 = 25e3
const FYD = 500e3 / 1.15

describe('NBR 6118 — materiais', () => {
  it('parâmetros do diagrama retangular, com ηc acima de 40 MPa', () => {
    const a = concreteParams(C25)
    expect(a.sigmaCd).toBeCloseTo((0.85 * 25e3) / 1.4, 6)
    expect(a.lambda).toBe(0.8)
    expect(a.ecu).toBe(0.0035)
    expect(a.xdLim).toBe(0.45)
    const b = concreteParams(50e3)
    expect(b.sigmaCd).toBeCloseTo((0.85 * Math.cbrt(40 / 50) * 50e3) / 1.4, 6)
    const c = concreteParams(70e3)
    expect(c.lambda).toBeCloseTo(0.75, 12)
    expect(c.xdLim).toBe(0.35)
    expect(c.ecu).toBeCloseTo(0.0026 + 0.035 * 0.2 ** 4, 12)
    expect(c.sigmaCd).toBeCloseTo((0.85 * 0.9 * Math.cbrt(40 / 70) * 70e3) / 1.4, 6)
    expect(fctm(30e3)).toBeCloseTo(2896, 0)
  })

  it('armadura mínima de flexão — Tabela 17.3', () => {
    expect(rhoMin(20e3)).toBeCloseTo(0.0015, 12)
    expect(rhoMin(30e3)).toBeCloseTo(0.0015, 12)
    expect(rhoMin(40e3)).toBeCloseTo(0.00179, 12)
    expect(rhoMin(50e3)).toBeCloseTo(0.00208, 12)
    expect(rhoMin(90e3)).toBeCloseTo(0.00256, 12)
    // seção 20 × 50, C25: 0,15 % · 1000 cm² = 1,5 cm²
    const r = flexureELU({ bf: 0.2, hf: 0.5, bw: 0.2, h: 0.5, d: 0.45, fck: C25, Md: 5 })
    expect(r.AsMin).toBeCloseTo(1.5e-4, 12)
    expect(r.As).toBeCloseTo(1.5e-4, 12)
    expect(r.AsCalc).toBeLessThan(1.5e-4)
  })
})

describe('NBR 6118 — flexão', () => {
  it('seção retangular: confere com as tabelas KMD–KX–KZ (KMD 0,100 e 0,200)', () => {
    const b = 0.25
    const d = 0.55
    const fcd = C25 / 1.4
    for (const [kmd, kx, kz] of [[0.1, 0.1569, 0.9372], [0.2, 0.3405, 0.8638]]) {
      const Md = kmd * b * d * d * fcd
      const r = flexureELU({ bf: b, hf: 0.6, bw: b, h: 0.6, d, fck: C25, Md })
      expect(r.xd).toBeCloseTo(kx, 3)
      expect(r.AsCalc).toBeCloseTo(Md / (kz * d * FYD), 6)
      expect(r.doubly).toBe(false)
      expect(r.ok).toBe(true)
    }
    // exemplo numérico: 20 × 50, d = 45 cm, C25, Md = 140 kN·m → As = 8,23 cm²
    const ex = flexureELU({ bf: 0.2, hf: 0.5, bw: 0.2, h: 0.5, d: 0.45, fck: C25, Md: 140 })
    expect(ex.AsCalc * 1e4).toBeCloseTo(8.23, 1)
    expect(ex.domain).toBe(3)
    const low = flexureELU({ bf: 0.2, hf: 0.5, bw: 0.2, h: 0.5, d: 0.45, fck: C25, Md: 40 })
    expect(low.domain).toBe(2)
  })

  it('seção T: linha neutra na mesa (retangular de largura bf) e na alma', () => {
    const s = (0.85 * C25) / 1.4
    const sec = { bf: 1.0, hf: 0.1, bw: 0.2, h: 0.6, d: 0.55, fck: C25 }
    // mesa: mesma armadura de uma seção retangular com b = bf
    const a = flexureELU({ ...sec, Md: 600 })
    const ref = flexureELU({ bf: 1.0, hf: 0.6, bw: 1.0, h: 0.6, d: 0.55, fck: C25, Md: 600 })
    expect(a.x * 0.8).toBeLessThan(0.1)
    expect(a.AsCalc).toBeCloseTo(ref.AsCalc, 12)
    // alma: Md = 850 → abas 607,14 kN·m; alma 242,86 kN·m; y = 0,1725 m; As = 39,97 cm²
    const b = flexureELU({ ...sec, Md: 850 })
    const Mf = s * 0.8 * 0.1 * 0.5
    const y = 0.55 - Math.sqrt(0.55 ** 2 - (2 * (850 - Mf)) / (s * 0.2))
    expect(Mf).toBeCloseTo(607.14, 1)
    expect(b.x).toBeCloseTo(y / 0.8, 10)
    expect(b.AsCalc).toBeCloseTo((s * (0.08 + 0.2 * y)) / FYD, 10)
    expect(b.AsCalc * 1e4).toBeCloseTo(39.97, 1)
    expect(b.doubly).toBe(false)
  })

  it('armadura dupla quando x/d passa de 0,45', () => {
    const s = (0.85 * C25) / 1.4
    const r = flexureELU({ bf: 0.2, hf: 0.5, bw: 0.2, h: 0.5, d: 0.45, fck: C25, Md: 250, dComp: 0.05 })
    const y = 0.8 * 0.45 * 0.45
    const MLim = s * 0.2 * y * (0.45 - y / 2)
    const AsC = (250 - MLim) / (FYD * 0.4)
    expect(r.doubly).toBe(true)
    expect(r.xd).toBeCloseTo(0.45, 12)
    expect(MLim).toBeCloseTo(181.5, 0)
    expect(r.AsComp).toBeCloseTo(AsC, 10)
    expect(r.AsCalc).toBeCloseTo((s * 0.2 * y) / FYD + AsC, 10)
    expect(r.AsCalc * 1e4).toBeCloseTo(15.25, 1)
  })

  it('flexão composta: a compressão reduz a armadura, a tração aumenta; protensão alivia', () => {
    const sec = { bf: 0.3, hf: 0.7, bw: 0.3, h: 0.7, d: 0.64, fck: 30e3 }
    const pure = flexureELU({ ...sec, Md: 300 })
    const comp = flexureELU({ ...sec, Md: 300, Nd: -400 })
    const tens = flexureELU({ ...sec, Md: 300, Nd: 400 })
    expect(comp.AsCalc).toBeLessThan(pure.AsCalc)
    expect(tens.AsCalc).toBeGreaterThan(pure.AsCalc)
    // equilíbrio: As·fyd = Rc + Nd, com Rc do momento em relação à armadura
    const s = (0.85 * 30e3) / 1.4
    const Mds = 300 + 400 * (0.64 - 0.35)
    const y = 0.64 - Math.sqrt(0.64 ** 2 - (2 * Mds) / (s * 0.3))
    expect(comp.AsCalc).toBeCloseTo((s * 0.3 * y - 400) / FYD, 10)
    // tração pura no centroide com M = 0: As total = Nd/fyd
    const t = flexureELU({ ...sec, Md: 0, Nd: 500, yc: 0.64 })
    expect(t.AsCalc).toBeCloseTo(500 / FYD, 10)
    // cabo no mesmo nível da armadura passiva: troca força por força
    const p = flexureELU({ ...sec, Md: 300, Ap: 4e-4, dp: 0.64, sigmaPd: 500e3 })
    expect(p.AsCalc).toBeCloseTo(pure.AsCalc - (4e-4 * 500e3) / FYD, 10)
  })
})

describe('NBR 6118 — cortante e torção', () => {
  it('modelo I: VRd2, Vc0, Asw/s e armadura mínima (20 × 50, d = 45, C25)', () => {
    const r = shearELU({ bw: 0.2, d: 0.45, fck: C25, Vsd: 150 })
    expect(r.VRd2).toBeCloseTo(0.27 * 0.9 * (25e3 / 1.4) * 0.2 * 0.45, 8)
    expect(r.VRd2).toBeCloseTo(390.5, 0)
    expect(r.Vc).toBeCloseTo(69.26, 1)
    expect(r.AswS * 1e4).toBeCloseTo(4.59, 1)
    expect(r.AswSMin * 1e4).toBeCloseTo(2.05, 2)
    expect(r.ok).toBe(true)
    // abaixo de Vc: só a mínima; acima de VRd2: reprova
    expect(shearELU({ bw: 0.2, d: 0.45, fck: C25, Vsd: 50 }).AswS).toBeCloseTo(r.AswSMin, 12)
    expect(shearELU({ bw: 0.2, d: 0.45, fck: C25, Vsd: 400 }).ok).toBe(false)
    // tração: Vc = 0
    expect(shearELU({ bw: 0.2, d: 0.45, fck: C25, Vsd: 150, Nd: 100 }).Vc).toBe(0)
  })

  it('torção de seção vazada: TRd2, estribos e armadura longitudinal', () => {
    // parede he = 0,10 m, linha média 0,5 × 0,3 m
    const r = torsionELU({ Ae: 0.15, he: 0.1, ue: 1.6, fck: C25, Tsd: 40 })
    expect(r.TRd2).toBeCloseTo(0.5 * 0.9 * (25e3 / 1.4) * 0.15 * 0.1, 8)
    expect(r.A90S).toBeCloseTo(40 / (2 * 0.15 * FYD), 12)
    expect(r.Asl).toBeCloseTo((40 * 1.6) / (2 * 0.15 * FYD), 12)
    expect(shearTorsionRatio(150, 390.5, 40, r.TRd2)).toBeCloseTo(150 / 390.5 + 40 / r.TRd2, 12)
  })
})

describe('NBR 6118 — flexo-compressão de pilares', () => {
  const sec = { b: 0.4, h: 0.6, fck: 30e3 }
  const sigma = (0.85 * 30e3) / 1.4

  it('sem armadura: M = N·(h/2 − y/2) com y = N/(σcd·b)', () => {
    const N = 1000
    const y = N / (sigma * 0.4)
    expect(columnMRd(sec, 1e-12, -N)).toBeCloseTo(N * (0.3 - y / 2), 3)
  })

  it('compressão centrada: N_Rd = σcd·Ac + As·Es·2‰', () => {
    const As = 0.004
    const NRd = sigma * 0.24 + As * ES * 0.002
    expect(columnMRd(sec, As, -0.995 * NRd)).toBeGreaterThanOrEqual(0)
    expect(columnMRd(sec, As, -0.995 * NRd)).toBeLessThan(0.02 * NRd * 0.6)
    expect(Number.isNaN(columnMRd(sec, As, -1.005 * NRd))).toBe(true)
    // tração centrada: As·fyd
    expect(Number.isNaN(columnMRd(sec, As, 1.005 * As * FYD))).toBe(true)
    expect(Number.isFinite(columnMRd(sec, As, 0.99 * As * FYD))).toBe(true)
  })

  it('diagrama de interação: o momento resistente cresce até a ruptura balanceada', () => {
    const As = 0.003
    const m0 = columnMRd(sec, As, 0)
    const m1 = columnMRd(sec, As, -1500)
    const m2 = columnMRd(sec, As, -4000)
    expect(m1).toBeGreaterThan(m0)
    expect(m2).toBeLessThan(m1)
    // mais aço, mais momento
    expect(columnMRd(sec, 2 * As, -1500)).toBeGreaterThan(m1)
  })

  it('dimensionamento: armadura mínima se sobra, e a que zera a folga se falta', () => {
    const small = columnELU({ ...sec, Nd: -1500, Md: 100 })
    expect(small.As).toBeCloseTo(Math.max((0.15 * 1500) / FYD, 0.004 * 0.24), 12)
    expect(small.ratio).toBeLessThan(1)
    const big = columnELU({ ...sec, Nd: -1500, Md: 450 })
    expect(big.As).toBeGreaterThan(small.As)
    expect(columnMRd(sec, big.As, -1500)).toBeCloseTo(450, 0)
    expect(big.ratio).toBeCloseTo(1, 3)
    // flexão oblíqua exige mais que a reta
    const obl = columnELU({ ...sec, Nd: -1500, Md: 450, MdOther: 150 })
    expect(obl.As).toBeGreaterThan(big.As)
    // seção vazada com a mesma envolvente resiste menos que a maciça
    const tube = { b: 4, h: 6, tw: 0.4, tf: 0.5, fck: 40e3 }
    expect(columnMRd(tube, 0.05, -40000)).toBeLessThan(columnMRd({ b: 4, h: 6, fck: 40e3 }, 0.05, -40000))
    expect(minMoment(-2000, 0.6)).toBeCloseTo(2000 * (0.015 + 0.018), 12)
    expect(minMoment(300, 0.6)).toBe(0)
  })
})

describe('tensões em serviço e aço', () => {
  it('tensões nas fibras: σ = N/A ∓ M/W', () => {
    const s = fiberStresses(2, 0.5, 0.4, -4000, 1000)
    expect(s.top).toBeCloseTo(-2000 - 2000, 10)
    expect(s.bot).toBeCloseTo(-2000 + 2500, 10)
    expect(stressELS(s, { compression: 0.6 * 30e3, tension: 0 }).ok).toBe(false)
    expect(stressELS(s, { compression: 0.6 * 30e3, tension: 1000 }).ratio).toBeCloseTo(0.5, 10)
  })

  it('NBR 8800 (elástico): σ = N/A + M/W contra fy/1,10', () => {
    const r = steelStressCheck({ A: 0.05, Wtop: 0.02, Wbot: 0.025, Wy: 0.01, Aw: 0.02, fy: 345e3, Nd: -2000, Mzd: 3000, Myd: 500, Vd: 1500 })
    // topo comprimido: −40 − 150 = −190 MPa; lateral 50 MPa
    expect(r.sigma).toBeCloseTo(240e3, 6)
    expect(r.ratio).toBeCloseTo(240 / (345 / 1.1), 10)
    expect(r.shearRatio).toBeCloseTo(75 / (0.6 * 345 / 1.1), 10)
    expect(r.ok).toBe(true)
  })
})

describe('verificação de seções na análise', () => {
  it('viaduto em caixão: armaduras plausíveis no tabuleiro e pilares na mínima', () => {
    const model = generateModel(PRESETS.find((p) => p.id === 'viaduto')!.template)
    expect(model.sections[0].geometry?.kind).toBe('box')
    expect(model.sections[0].yTop! + model.sections[0].yBot!).toBeCloseTo(2, 10)
    const r = analyzeBridge(model, { modal: false })
    const sc = r.checks.sections!
    const deck = sc.filter((c) => c.group === 'deck')
    const piers = sc.filter((c) => c.group === 'pier')
    expect(deck).toHaveLength(model.elements.filter((e) => e.group === 'deck').length)
    expect(piers.length).toBeGreaterThan(0)
    const Ac = model.sections[0].A
    for (const c of deck) {
      expect(c.method).toBe('NBR 6118')
      expect(c.member).toBe('beam')
      expect(c.approx).toBe(false)
      expect(Number.isFinite(c.AsInf!) && Number.isFinite(c.AsSup!)).toBe(true)
      // nunca abaixo da mínima onde há momento, nem acima de 4 %
      expect(c.rho!).toBeLessThan(0.04)
      expect(c.AswS!).toBeGreaterThan(0)
      expect(c.ratios.shear!).toBeLessThan(1)
      expect(c.ok).toBe(true)
    }
    const maxInf = Math.max(...deck.map((c) => c.AsInf!))
    const maxSup = Math.max(...deck.map((c) => c.AsSup!))
    expect(maxInf).toBeGreaterThanOrEqual(rhoMin(40e3) * Ac - 1e-9)
    expect(maxSup).toBeGreaterThanOrEqual(rhoMin(40e3) * Ac - 1e-9)
    // ordem de grandeza: entre a mínima (≈ 114 cm²) e 1,5 % de Ac
    expect(maxInf).toBeLessThan(0.015 * Ac)
    expect(maxSup).toBeLessThan(0.015 * Ac)
    // momento negativo de cálculo sobre os pilares na faixa de viga contínua
    const MdNeg = Math.max(...deck.map((c) => c.MdNeg))
    expect(MdNeg).toBeGreaterThan(10e3)
    expect(MdNeg).toBeLessThan(120e3)
    for (const c of piers) {
      expect(c.member).toBe('column')
      expect(c.AsTotal!).toBeCloseTo(c.AsMin!, 10)
      expect(c.ok).toBe(true)
    }
  })

  it('sem combinações nem protensão: usa 1,35·G + 1,5·Q', () => {
    const model = generateModel(PRESETS.find((p) => p.id === 'viaduto')!.template)
    const bare = { ...model, site: { temperature: false as const, wind: false as const, braking: false, seismic: false as const } }
    const r = analyzeBridge(bare, { modal: false })
    const sc = r.checks.sections!
    expect(sc.length).toBeGreaterThan(0)
    for (const c of sc) expect(Number.isFinite(c.ratio)).toBe(true)
  })
})
