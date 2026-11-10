import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { buildSystem } from '../src/analysis/system'
import { solveStatic } from '../src/analysis/static'
import { LinearSolver } from '../src/analysis/linear'
import type { BridgeModel, BridgeNode, Element, Material, Section } from '../src/model/types'
import { PRESETS, generateModel } from '../src/templates'
import {
  T_INF, betaF, betaS, creepCoefficient, eps1s, fictitiousThickness, gammaHfic, phi1c, shrinkageStrain,
} from '../src/timedep/nbr6118a'
import { beam, model, SEC, STEEL } from './helpers'

const CONC: Material = { id: 'c', name: 'Concreto C30', kind: 'concrete', E: 30e6, G: 12.5e6, gamma: 0, fck: 30e3 }
const SQ: Section = { id: 'sec', name: 'pilar 1×1', A: 1, Iy: 1 / 12, Iz: 1 / 12, J: 0.14, depth: 1, width: 1 }
const OFF = { modal: false as const, moving: false as const, nonlinear: false, buckling: false as const }
const noActions = { temperature: false as const, wind: false as const, braking: false }

describe('NBR 6118 Anexo A — fluência e retração', () => {
  it('Tabela A.1: φ1c, ε1s e γ para U = 40, 70 e 90 %', () => {
    expect(phi1c(40)).toBeCloseTo(3.05, 2)
    expect(phi1c(70)).toBeCloseTo(2.0, 2)
    expect(phi1c(90)).toBeCloseTo(1.3, 2)
    expect(phi1c(70, '0-4')).toBeCloseTo(1.5, 2)
    expect(phi1c(70, '10-15')).toBeCloseTo(2.5, 2)
    expect(eps1s(40) * 1e4).toBeCloseTo(-6.3, 1)
    expect(eps1s(70) * 1e4).toBeCloseTo(-5.0, 1)
    expect(eps1s(90) * 1e4).toBeCloseTo(-2.5, 1)
    expect(gammaHfic(40)).toBeCloseTo(1.0, 1)
    expect(Math.abs(gammaHfic(70) - 1.5)).toBeLessThan(0.06)
  })

  it('βf e βs crescem com a idade, tendem a 1 e são mais lentos em peças espessas', () => {
    for (const h of [0.1, 0.3, 1.0]) {
      let pf = 0
      let ps = -1
      for (const t of [3, 10, 30, 100, 1000, 10000]) {
        const f = betaF(t, h)
        const s = betaS(t, h)
        expect(f).toBeGreaterThan(pf)
        expect(s).toBeGreaterThanOrEqual(ps)
        pf = f
        ps = s
      }
      expect(betaF(1e7, h)).toBeCloseTo(1, 2)
      expect(betaS(1e7, h)).toBeCloseTo(1, 2)
    }
    expect(betaF(100, 0.1)).toBeGreaterThan(betaF(100, 1.0))
    expect(betaS(100, 0.1)).toBeGreaterThan(betaS(100, 1.0))
  })

  it('reproduz a Tabela 8.2 (valores característicos superiores de φ e εcs em t∞)', () => {
    // [U, 2Ac/u (m), t0, φ, εcs (‰)] — C20 a C45, abatimento 5–9 cm
    const rows: [number, number, number, number, number][] = [
      [40, 0.2, 5, 4.6, -0.53], [40, 0.2, 30, 3.4, -0.44], [40, 0.2, 60, 2.9, -0.39],
      [40, 0.6, 5, 3.8, -0.47], [40, 0.6, 30, 3.0, -0.45], [40, 0.6, 60, 2.6, -0.43],
      [55, 0.2, 5, 3.9, -0.47], [55, 0.2, 30, 2.9, -0.41], [55, 0.2, 60, 2.6, -0.36],
      [55, 0.6, 5, 3.3, -0.43], [55, 0.6, 30, 2.6, -0.41], [55, 0.6, 60, 2.2, -0.40],
      [75, 0.2, 5, 2.8, -0.36], [75, 0.6, 5, 2.6, -0.32], [75, 0.6, 30, 2.1, -0.31], [75, 0.6, 60, 1.8, -0.30],
    ]
    for (const [U, h0, t0, phi, eps] of rows) {
      // a tabela é reproduzida com a idade fictícia igual à real (α = 1: cimento de endurecimento lento)
      const p = { humidity: U, hfic: fictitiousThickness(h0 / 2, 1, U), fck: 30e3, cement: 'CP III-IV' as const }
      expect(p.hfic).toBeCloseTo(h0 * gammaHfic(U), 9)
      expect(Math.abs(creepCoefficient(p, T_INF, t0) / phi - 1)).toBeLessThan(0.1)
      expect(Math.abs((shrinkageStrain(p, T_INF, t0) * 1000) / eps - 1)).toBeLessThan(0.05)
    }
  })

  it('concreto de alta resistência flui menos; cimento de endurecimento rápido "envelhece" mais depressa', () => {
    const p = { humidity: 70, hfic: 0.4, fck: 30e3 }
    expect(creepCoefficient({ ...p, fck: 60e3 }, T_INF, 28)).toBeLessThan(0.7 * creepCoefficient(p, T_INF, 28))
    expect(creepCoefficient({ ...p, cement: 'CP V-ARI' }, T_INF, 7)).toBeLessThan(creepCoefficient({ ...p, cement: 'CP III-IV' }, T_INF, 7))
    expect(creepCoefficient(p, 28, 28)).toBe(0)
    expect(shrinkageStrain(p, T_INF, 28)).toBeLessThan(0)
  })
})

describe('curvatura imposta linear no solver de casos', () => {
  it('balanço com κ de 0 a κb: giro κb·L/2 e flecha κb·L²/6 na ponta, sem esforços', () => {
    const m = beam(6, 1)
    m.nodes[0].fix = [true, true, true, true, true, true]
    const sys = buildSystem(m)
    const sol = solveStatic(sys, null, { nonlinear: false })
    const lin = new LinearSolver(sys, sol.K, false)
    const kb = 2e-4
    const r = lin.solve({ strain: new Map([[0, { kz: 0, kzEnd: kb }]]) })
    expect(r.u[6 + 2]).toBeCloseTo((kb * 36) / 6, 10)
    expect(r.u[6 + 4]).toBeCloseTo((-kb * 6) / 2, 10) // rotação em torno de Y global: −dz/dx
    for (const v of r.frames[0].Mz) expect(Math.abs(v)).toBeLessThan(1e-6)
    for (const v of r.frames[0].Vy) expect(Math.abs(v)).toBeLessThan(1e-6)
  })
})

function column(extra: Element[] = [], materials: Material[] = [CONC]): BridgeModel {
  const nodes: BridgeNode[] = [
    { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
    { id: 2, x: 0, y: 0, z: 5 },
    { id: 3, x: 0, y: 0, z: 10 },
  ]
  const els: Element[] = [
    { kind: 'frame', id: 1, n1: 1, n2: 2, mat: 'c', sec: 'sec', group: 'pier' },
    { kind: 'frame', id: 2, n1: 2, n2: 3, mat: 'c', sec: 'sec', group: 'pier' },
    ...extra,
  ]
  return model(nodes, els, {
    materials, sections: [SQ, { ...SEC, id: 'st' }],
    loadCases: [{ id: 'p', name: 'p', nodal: [{ node: 3, F: [0, 0, -3000, 0, 0, 0] }] }],
    site: noActions,
  })
}

describe('efeitos diferidos — método do módulo efetivo ajustado pela idade', () => {
  it('pilar livre sob carga constante: encurtamento final (1 + φ)·N·L/EA + εcs·L, sem variação de esforço', () => {
    const r = analyzeBridge(column(), OFF)
    const lt = r.longTerm!
    const cs = r.cases!.find((c) => c.id === 'CS')!
    expect(cs.kind).toBe('creep')
    const { phi, epsCs } = lt.sections[0]
    expect(phi).toBeGreaterThan(1.5)
    expect(epsCs).toBeLessThan(-1e-4)
    const el = (-3000 * 10) / (CONC.E * 1)
    expect(r.deadLoad.u[6 * 2 + 2]).toBeCloseTo(el, 9)
    expect(cs.u[6 * 2 + 2]).toBeCloseTo(phi * el + epsCs * 10, 9)
    expect(r.deadLoad.u[6 * 2 + 2] + cs.u[6 * 2 + 2]).toBeCloseTo((1 + phi) * el + epsCs * 10, 9)
    for (const f of cs.frames) for (const v of f.N) expect(Math.abs(v)).toBeLessThan(1e-6)
    // seção quadrada 1×1 a 70 %: hfic = γ·2·1/4
    expect(lt.sections[0].hfic).toBeCloseTo(gammaHfic(70) * 0.5, 6)
    // evolução monótona até t∞
    const uz = lt.instants.map((i) => Math.abs(i.uzTower))
    for (let i = 1; i < uz.length; i++) expect(uz[i]).toBeGreaterThan(uz[i - 1])
    expect(lt.instants[lt.instants.length - 1].uzTower).toBeCloseTo(cs.u[6 * 2 + 2], 9)
  })

  it('barra biengastada: a retração impedida gera N = |εcs|·EA/(1 + χ·φ) (relaxada pela fluência)', () => {
    const m = column()
    m.nodes[2].fix = [true, true, true, true, true, true]
    m.loadCases = []
    const r = analyzeBridge(m, OFF)
    const { phi, epsCs } = r.longTerm!.sections[0]
    const cs = r.cases!.find((c) => c.id === 'CS')!
    const N = (-epsCs * CONC.E * 1) / (1 + 0.8 * phi)
    for (const f of cs.frames) for (const v of f.N) expect(v).toBeCloseTo(N, 6)
    expect(N).toBeGreaterThan(0)
  })

  it('pilar de concreto em paralelo com barra de aço: a fluência transfere carga do concreto para o aço', () => {
    const steel: Material = { ...STEEL, id: 's' }
    const m = column(
      [
        { kind: 'frame', id: 3, n1: 1, n2: 2, mat: 's', sec: 'st', group: 'pier' },
        { kind: 'frame', id: 4, n1: 2, n2: 3, mat: 's', sec: 'st', group: 'pier' },
      ],
      [CONC, steel],
    )
    const r = analyzeBridge(m, OFF)
    const { phi, epsCs } = r.longTerm!.sections[0]
    const cs = r.cases!.find((c) => c.id === 'CS')!
    const kc = CONC.E * 1
    const ks = STEEL.E * SEC.A
    const Nc0 = (-3000 * kc) / (kc + ks)
    expect(r.deadLoad.frames[0].N[1]).toBeCloseTo(Nc0, 6)
    const free = (phi * Nc0) / kc + epsCs
    const dNc = -free / ((1 + 0.8 * phi) / kc + 1 / ks)
    expect(cs.frames[0].N[1]).toBeCloseTo(dNc, 6)
    expect(cs.frames[2].N[1]).toBeCloseTo(-dNc, 6)
    expect(dNc).toBeGreaterThan(0) // o concreto alivia
  })

  it('viga contínua homogênea: a fluência amplia as flechas por φ e NÃO redistribui momentos', () => {
    const L = 20
    const m = beam(2 * L, 16, { mat: { ...CONC, id: 's', gamma: 25 }, sec: { ...SQ, extraDead: 20 } })
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[8].fix = [false, true, true, false, false, false]
    m.nodes[16].fix = [false, true, true, false, false, false]
    m.site = noActions
    const r = analyzeBridge(m, OFF)
    const cs = r.cases!.find((c) => c.id === 'CS')!
    const { phi } = r.longTerm!.sections[0]
    const Msup = r.deadLoad.frames[7].Mz[2]
    expect(Msup).toBeCloseTo((-45 * L * L) / 8, 3)
    for (const f of cs.frames) for (const v of f.Mz) expect(Math.abs(v)).toBeLessThan(0.005 * Math.abs(Msup))
    for (const i of [3, 4, 5, 11, 12]) {
      expect(cs.u[6 * i + 2] / r.deadLoad.u[6 * i + 2]).toBeGreaterThan(0.99 * phi)
      expect(cs.u[6 * i + 2] / r.deadLoad.u[6 * i + 2]).toBeLessThan(1.01 * phi)
    }
    // a combinação quase permanente carrega o efeito diferido como ação permanente indireta
    expect(r.combos!.list.every((c) => 'CS' in c.factors)).toBe(true)
    const elu = r.combos!.list.find((c) => c.limit === 'ELU')!
    expect(elu.factors.CS).toBe(1.2)
  })

  it('desligado em model.site.longTerm e ausente em modelos sem concreto', () => {
    const m = column()
    m.site = { ...noActions, longTerm: false }
    expect(analyzeBridge(m, OFF).longTerm).toBeUndefined()
    const s = beam(20, 4)
    s.nodes[0].fix = [true, true, true, true, false, false]
    s.nodes[4].fix = [false, true, true, false, false, false]
    const r = analyzeBridge(s, OFF)
    expect(r.longTerm).toBeUndefined()
    expect(r.cases?.some((c) => c.kind === 'creep') ?? false).toBe(false)
  })

  it('umidade menor e carregamento mais cedo aumentam os efeitos', () => {
    const base = column()
    const dry = column()
    dry.site = { ...noActions, longTerm: { humidity: 40 } }
    const early = column()
    early.site = { ...noActions, longTerm: { t0: 7 } }
    const u = (m: BridgeModel): number => analyzeBridge(m, OFF).cases!.find((c) => c.id === 'CS')!.u[6 * 2 + 2]
    expect(Math.abs(u(dry))).toBeGreaterThan(1.2 * Math.abs(u(base)))
    expect(Math.abs(u(early))).toBeGreaterThan(1.05 * Math.abs(u(base)))
  })
})

describe('efeitos diferidos — modelos de referência', () => {
  it('estaiadas de concreto: o tabuleiro desce, os estais mudam poucos por cento e nada fica frouxo', () => {
    for (const id of ['rio-negro', 'estaiada-3-vaos', 'octavio-frias']) {
      const p = PRESETS.find((x) => x.id === id)!
      const r = analyzeBridge(generateModel(p.template), { sizeCables: true, modal: false, buckling: false })
      const lt = r.longTerm!
      expect(lt, id).toBeDefined()
      const fin = lt.instants[lt.instants.length - 1]
      expect(fin.uzDeck, id).toBeLessThan(0)
      expect(Math.abs(fin.uzDeck), id).toBeLessThan(1.5)
      expect(lt.cableChange![0], id).toBeGreaterThan(-0.25)
      expect(lt.cableChange![1], id).toBeLessThan(0.25)
      const cs = r.cases!.find((c) => c.id === 'CS')!
      r.deadLoad.cables.forEach((c, i) => expect(Math.max(c.Ti, c.Tj) + cs.cables[i].dT, id).toBeGreaterThan(0))
    }
  })

  it('Golden Gate (tabuleiro e torres de aço) não tem caso de fluência', () => {
    const p = PRESETS.find((x) => x.id === 'golden-gate')!
    const r = analyzeBridge(generateModel(p.template), { modal: false, moving: false, buckling: false })
    expect(r.longTerm).toBeUndefined()
  })
})

describe('fases construtivas no tempo', () => {
  const CABLE: Material = { id: 'cb', name: 'cabo', kind: 'cable', E: 195e6, G: 75e6, gamma: 0, fpk: 1860e3 }
  const DECKC: Material = { id: 'c', name: 'Concreto C40', kind: 'concrete', E: 32e6, G: 13e6, gamma: 25, fck: 40e3 }
  const TOWS: Material = { id: 's', name: 'aço', kind: 'steel', E: 200e6, G: 77e6, gamma: 0 }
  const DSEC: Section = { id: 'deck', name: 'tabuleiro', A: 2, Iy: 6, Iz: 0.6, J: 1, depth: 1.5, width: 6 }
  const TSEC: Section = { id: 'tower', name: 'torre', A: 0.5, Iy: 0.5, Iz: 0.5, J: 0.5 }

  /** torre de aço engastada + balanço de concreto de comprimento L + 1 estai na ponta */
  function mast(L: number, H: number, n: number): BridgeModel {
    const nodes: BridgeNode[] = [{ id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] }, { id: 2, x: 0, y: 0, z: H }]
    const elements: Element[] = [{ kind: 'frame', id: 1, n1: 1, n2: 2, mat: 's', sec: 'tower', group: 'tower' }]
    for (let i = 1; i <= n; i++) {
      nodes.push({ id: 2 + i, x: (L * i) / n, y: 0, z: 0 })
      elements.push({ kind: 'frame', id: 1 + i, n1: i === 1 ? 1 : 1 + i, n2: 2 + i, mat: 'c', sec: 'deck', group: 'deck' })
    }
    elements.push({ kind: 'cable', id: 100, n1: 2, n2: 2 + n, mat: 'cb', A: 0.004, pretension: 600, group: 'stay' })
    return {
      schema: 'opengirder/1', name: 'mastro', type: 'cable-stayed', nodes,
      materials: [DECKC, TOWS, CABLE], sections: [DSEC, TSEC], elements, loadCases: [], lanes: [], site: noActions,
    }
  }

  it('balanço de concreto sem estai durante uma fase: a ponta desce Δφ·wL⁴/8EI a mais', async () => {
    const { runStagesInTime } = await import('../src/timedep/stagesTime')
    const { rheologyOf, resolveLongTerm } = await import('../src/timedep/params')
    const L = 20
    const m = mast(L, 15, 8)
    const final = analyzeBridge(m, { modal: false, moving: false, formFinding: false, nonlinear: false })
    const st = runStagesInTime(m, final.cableL0, { nonlinear: false, daysPerStage: 10, tOpen: 30 })
    const p = resolveLongTerm(m)
    if (!p) throw new Error('efeitos diferidos desligados')
    const rheo = rheologyOf(DSEC, DECKC, p)
    const dphi = creepCoefficient(rheo, p.t0 + 10, p.t0)
    const el = (-(DECKC.gamma * DSEC.A) * L ** 4) / (8 * DECKC.E * DSEC.Iz)
    const s0 = st.stages[0]
    expect(s0.tips[0].uz).toBeCloseTo(el, 8)
    expect(s0.creep!.day).toBe(10)
    expect(s0.creep!.tips[0].uz / (dphi * el)).toBeCloseTo(1, 3)
    // a retração do intervalo encurta o balanço: εcs·L na ponta
    expect(s0.creep!.u[6 * 9] / (shrinkageStrain(rheo, p.t0 + 10, p.t0) * L)).toBeCloseTo(1, 3)
    // fase com o estai: acumula o intervalo seguinte; até a abertura passam tOpen dias
    const s1 = st.stages[1]
    expect(s1.creep!.day).toBe(10 + 30)
    expect(Math.abs(s1.creep!.tips.length)).toBe(0)
    expect(Math.abs(s1.creep!.uzMax)).toBeGreaterThan(Math.abs(s0.creep!.uzMax) * 0.5)
    expect(st.time!.daysPerStage).toBe(10)
    expect(st.time!.stays[0].id).toBe(100)
    // da abertura a t∞ o concreto continua fluindo: o estai ganha ou perde carga, o tabuleiro se move
    expect(Math.abs(st.time!.final.uzMax)).toBeGreaterThan(0)
    // sem tempo: resultado idêntico ao da regressiva pura
    const plain = runStagesInTime(m, final.cableL0, { nonlinear: false, daysPerStage: 0 })
    expect(plain.time).toBeUndefined()
    expect(plain.stages[0].creep).toBeUndefined()
  })

  it('estaiada de três vãos: contraflecha de fluência por fase e variação das trações até t∞', () => {
    const p = PRESETS.find((x) => x.id === 'estaiada-3-vaos')!
    const r = analyzeBridge(generateModel(p.template), { sizeCables: true, modal: false, buckling: false, stages: { daysPerStage: 7 } })
    const st = r.stages!
    expect(st.time).toBeDefined()
    let prev = 0
    for (const s of st.stages) {
      expect(s.creep, `fase ${s.index}`).toBeDefined()
      expect(s.creep!.day).toBeGreaterThan(prev)
      prev = s.creep!.day
      expect(s.creep!.u.every(Number.isFinite)).toBe(true)
    }
    const Tmax = Math.max(...st.stays.map((s) => s.Tfinal))
    for (const s of st.time!.stays) {
      expect(Math.abs(s.dTbuild)).toBeLessThan(0.5 * Tmax)
      expect(Math.abs(s.dTfinal)).toBeLessThan(0.5 * Tmax)
    }
    expect(Math.abs(st.time!.final.uzMax)).toBeLessThan(2)
  })
})
