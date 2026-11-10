import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { PRESETS, generateModel } from '../src/templates'
import { civ } from '../src/loads/nbr7188'
import { runCombinations } from '../src/combos/nbr8681'
import type { AnalysisContext } from '../src/analysis/context'
import type { CombinationResult, LoadCaseResult } from '../src/analysis/types'
import type { BridgeModel, Section } from '../src/model/types'
import { beam, STEEL } from './helpers'

const SEC: Section = { id: 'sec', name: 'seção', A: 0.5, Iy: 0.6, Iz: 0.05, J: 0.08, depth: 1.0, width: 4.0 }
const EA = STEEL.E * SEC.A
const EI = STEEL.E * SEC.Iz
const OPT = { modal: false as const, nonlinear: false }

function simple(L: number, n: number): BridgeModel {
  const m = beam(L, n, { sec: SEC })
  m.nodes[0].fix = [true, true, true, true, false, false]
  m.nodes[n].fix = [false, true, true, true, false, false]
  m.lanes = [{ id: 'l', name: 'Pista', nodes: m.nodes.map((x) => x.id), width: 8, maxEccentricity: 2 }]
  m.meta = { mainSpan: L, deckMaterial: 'steel' }
  return m
}

describe('combinações NBR 8681', () => {
  it('viga biapoiada com G + Q + vento + frenagem: envoltórias conferidas à mão', () => {
    const L = 20
    const g = 30
    const P = 400
    const m = simple(L, 8)
    m.loadCases = [{
      id: 'g', name: 'g',
      uniform: m.elements.map((e) => ({ element: e.id, w: [0, 0, -g] as [number, number, number] })),
      nodal: [{ node: 9, F: [-P, 0, 0, 0, 0, 0] }],
    }]
    m.site = { temperature: false }
    const r = analyzeBridge(m, OPT)
    const c = r.combos!
    const mid = c.frames[3]
    const Mg = (g * L * L) / 8
    const MQ = r.moving!.frames[3].Mz.max[2]
    expect(MQ).toBeGreaterThan(0)
    expect(r.deadLoad.frames[3].Mz[2]).toBeCloseTo(Mg, 6)
    // vento e frenagem não geram Mz na viga reta: só G e Q
    expect(mid.elu.Mz.max[2]).toBeCloseTo(1.35 * Mg + 1.5 * MQ, 6)
    expect(mid.elu.Mz.min[2]).toBeCloseTo(1.0 * Mg, 6)
    expect(mid.elsRare.Mz.max[2]).toBeCloseTo(Mg + MQ, 6)
    expect(mid.elsFreq.Mz.max[2]).toBeCloseTo(Mg + 0.5 * MQ, 6)
    expect(mid.elsQp.Mz.max[2]).toBeCloseTo(Mg + 0.3 * MQ, 6)
    // flexão lateral: o vento é a ação principal (γ = 1,4), o pior entre W e WT
    const w = Math.abs(r.cases!.find((x) => x.id === 'W')!.frames[3].My[2])
    const wt = Math.abs(r.cases!.find((x) => x.id === 'WT')!.frames[3].My[2])
    expect(mid.elu.My.max[2]).toBeCloseTo(1.4 * Math.max(w, wt), 6)
    expect(mid.elu.My.min[2]).toBeCloseTo(-1.4 * Math.max(w, wt), 6)
    expect(mid.elsFreq.My.max[2]).toBeCloseTo(0.3 * Math.max(w, wt), 6)
    expect(mid.elsQp.My.max[2]).toBeCloseTo(0, 9)
    // normal: G (−P), frenagem ±135·(1 − x/L) acompanha a carga móvel
    const Nfr = Math.abs(r.cases!.find((x) => x.id === 'FR')!.frames[3].N[2])
    expect(Nfr).toBeCloseTo(135 / 2, 6)
    expect(mid.elu.N.min[2]).toBeCloseTo(-1.35 * P - 1.5 * Nfr, 6)
    expect(mid.elu.N.max[2]).toBeCloseTo(-1.0 * P + 1.5 * Nfr, 6)
    // N concomitante com o Mz máximo: G desfavorável (1,35); com o mínimo: G favorável (1,0)
    expect(mid.NatMz.max[2]).toBeCloseTo(-1.35 * P, 6)
    expect(mid.NatMz.min[2]).toBeCloseTo(-1.0 * P, 6)
    // flecha frequente: só ações variáveis, ψ1 = 0,5 sobre a carga móvel
    expect(c.uzFreq.min[4]).toBeCloseTo(0.5 * r.moving!.uzMin[4], 9)
    expect(c.uzFreq.max[4]).toBeCloseTo(0, 9)
  })

  it('reação de apoio: envoltória da carga móvel (linha de influência 1 − x/L) e ELU', () => {
    const L = 20
    const g = 30
    const m = simple(L, 20)
    m.loadCases = [{ id: 'g', name: 'g', uniform: m.elements.map((e) => ({ element: e.id, w: [0, 0, -g] as [number, number, number] })) }]
    m.site = { temperature: false, wind: false, braking: false }
    const r = analyzeBridge(m, OPT)
    // p·largura em todo o vão + 3 eixos de 120 kN em x = 0; 1,5; 3,0
    const RQ = civ(L) * 1.0 * ((5 * 8 * L) / 2 + 120 * (1 + (1 - 1.5 / L) + (1 - 3 / L)))
    const rq = r.moving!.reactions![0]
    expect(rq.max[2] / RQ).toBeCloseTo(1, 2)
    expect(rq.min[2]).toBeCloseTo(0, 6)
    const el = r.combos!.reactions[0]
    expect(el.elu.max[2]).toBeCloseTo(1.35 * ((g * L) / 2) + 1.5 * rq.max[2], 6)
    expect(el.elu.min[2]).toBeCloseTo((g * L) / 2, 6)
    expect(el.elsRare.max[2]).toBeCloseTo((g * L) / 2 + rq.max[2], 6)
  })

  it('casos alternativos (TU+ × TU−, TG+ × TG−): entra no máximo um de cada par', () => {
    const m = beam(24, 6, { sec: SEC })
    m.nodes[0].fix = [true, true, true, true, true, true]
    m.nodes[6].fix = [true, true, true, true, true, true]
    m.site = { temperature: { uniform: 20, gradient: 12, cables: 0 }, wind: false }
    const r = analyzeBridge(m, OPT)
    const c = r.combos!
    const N0 = EA * 1.2e-5 * 20
    const M0 = EI * 1.2e-5 * 12
    const f = c.frames[2]
    expect(f.elu.N.max[1]).toBeCloseTo(1.2 * N0, 5)
    expect(f.elu.N.min[1]).toBeCloseTo(-1.2 * N0, 5)
    expect(f.elu.Mz.max[1]).toBeCloseTo(1.2 * M0, 5)
    expect(f.elu.Mz.min[1]).toBeCloseTo(-1.2 * 0.5 * M0, 5)
    expect(f.elsRare.N.max[1]).toBeCloseTo(N0, 5)
    expect(f.elsFreq.N.max[1]).toBeCloseTo(0.5 * N0, 5)
    expect(f.elsQp.N.max[1]).toBeCloseTo(0.3 * N0, 5)
    // sem carga móvel: só as combinações com a ponte descarregada
    expect(c.list.map((x) => x.id)).toEqual(['ELU-5', 'ELS-R5', 'ELS-F5', 'ELS-QP'])
    expect(c.list[0].factors).toMatchObject({ G: 1.35, 'TU+': 1.2, 'TU−': 1.2, 'TG+': 1.2, 'TG−': 1.2 })
  })

  it('protensão e sismo vindos de outros módulos entram com γp e na combinação excepcional', () => {
    const L = 20
    const g = 30
    const m = simple(L, 4)
    m.loadCases = [{ id: 'g', name: 'g', uniform: m.elements.map((e) => ({ element: e.id, w: [0, 0, -g] as [number, number, number] })) }]
    m.site = { temperature: false, wind: false, braking: false }
    const r = analyzeBridge(m, { ...OPT, moving: false })
    // só ações permanentes: ELU = 1,35·G ou 1,0·G
    expect(r.combos!.list.map((x) => x.id)).toEqual(['ELU-0', 'ELS-QP'])
    const Mg = (g * L * L) / 8
    expect(r.combos!.frames[1].elu.Mz.max[2]).toBeCloseTo(1.35 * Mg, 6)
    expect(r.combos!.frames[1].elu.Mz.min[2]).toBeCloseTo(Mg, 6)
    expect(r.combos!.frames[1].elsRare.Mz.max[2]).toBeCloseTo(Mg, 6)

    // casos sintéticos: protensão (Mz = −100, N = −1000) e sismo (Mz = ±50, N = ±20)
    const mk = (id: string, kind: LoadCaseResult['kind'], sign: LoadCaseResult['sign'], Mz: number, N: number): LoadCaseResult => ({
      id, name: id, kind, sign,
      u: new Array(6 * m.nodes.length).fill(0),
      frames: r.deadLoad.frames.map((f) => ({
        id: f.id, L: f.L, N: [N, N, N], Vy: [0, 0, 0], Vz: [0, 0, 0], T: [0, 0, 0], My: [0, 0, 0], Mz: [Mz, Mz, Mz],
      })),
      cables: [],
      reactions: [],
    })
    const res = { ...r, combos: undefined }
    const ctx = {
      res, sys: { nNodes: m.nodes.length }, cases: [mk('P', 'prestress', 'fixed', -100, -1000), mk('E', 'seismic', 'both', 50, 20)],
      lap: () => {},
    } as unknown as AnalysisContext
    runCombinations(ctx)
    const c = res.combos as unknown as CombinationResult
    expect(c.list.map((x) => x.id)).toEqual(['ELU-0', 'EXC-1', 'ELS-QP'])
    expect(c.list[1].factors).toMatchObject({ G: 1.15, P: 1.2, E: 1 })
    const f = c.frames[1]
    // máx.: ELU normal 1,35·Mg − 0,9·100 contra excepcional 1,15·Mg − 0,9·100 + 50
    expect(f.elu.Mz.max[2]).toBeCloseTo(Math.max(1.35 * Mg - 90, 1.15 * Mg - 90 + 50), 6)
    expect(f.elu.Mz.min[2]).toBeCloseTo(Mg - 120 - 50, 6)
    expect(f.elsQp.Mz.max[2]).toBeCloseTo(Mg - 100, 6)
    // N concomitante com o Mz mínimo: protensão desfavorável (1,2) e sismo com o sinal do Mz
    expect(f.NatMz.min[2]).toBeCloseTo(-1.2 * 1000 - 20, 6)
    expect(f.NatMz.max[2]).toBeCloseTo(-0.9 * 1000, 6)
  })
})

describe('ações e combinações nos modelos de referência', () => {
  for (const id of ['golden-gate', 'viaduto']) {
    it(`${id}: casos e combinações calculados em menos de 1 s`, () => {
      const p = PRESETS.find((x) => x.id === id)!
      const r = analyzeBridge(generateModel(p.template), { modal: false })
      const ids = r.cases!.map((c) => c.id)
      expect(ids).toEqual(expect.arrayContaining(['TU+', 'TU−', 'TG+', 'TG−', 'W', 'WT', 'FR']))
      expect(ids.includes('TC+')).toBe(id === 'golden-gate')
      const c = r.combos!
      expect(c.frames.length).toBe(r.deadLoad.frames.length)
      expect(c.cables.length).toBe(r.deadLoad.cables.length)
      expect(c.reactions.length).toBe(r.deadLoad.reactions.length)
      for (const f of c.frames) {
        for (let s = 0; s < 3; s++) {
          expect(Number.isFinite(f.elu.Mz.max[s]) && Number.isFinite(f.elu.Mz.min[s])).toBe(true)
          expect(f.elu.Mz.max[s]).toBeGreaterThanOrEqual(f.elsRare.Mz.max[s] - 1e-6 - 0.35 * Math.abs(f.elsRare.Mz.max[s]))
          expect(f.elsRare.Mz.max[s]).toBeGreaterThanOrEqual(f.elsFreq.Mz.max[s] - 1e-6)
          expect(f.elsFreq.Mz.max[s]).toBeGreaterThanOrEqual(f.elsQp.Mz.max[s] - 1e-6)
          expect(f.elsQp.Mz.max[s]).toBeGreaterThanOrEqual(f.elsQp.Mz.min[s] - 1e-9)
        }
      }
      const extra = (r.timings.acoes ?? 0) + (r.timings.combinacoes ?? 0)
      console.log(`${id}: ${r.cases!.length} casos, ${c.list.length} combinações, ações ${r.timings.acoes} ms + combinações ${r.timings.combinacoes} ms`)
      expect(extra).toBeLessThan(1000)
    })
  }
})

describe('passarelas — NBR 8681, Tabela 6', () => {
  it('multidão entra com ψ de passarelas (0,6 / 0,4 / 0,3) e não gera caso de frenagem', () => {
    const m = generateModel(PRESETS.find((p) => p.id === 'passarela')!.template)
    const r = analyzeBridge(m, { modal: false })
    expect(r.moving!.vehicle).toBe('Pedestres')
    expect(r.cases!.some((c) => c.kind === 'braking')).toBe(false)
    const by = new Map(r.combos!.list.map((c) => [c.id, c.factors]))
    // vento principal no ELU: γq·ψ0 = 1,5·0,6
    expect(by.get('ELU-2')!.Q).toBeCloseTo(0.9, 9)
    // frequente com a multidão principal: ψ1 = 0,4; quase permanente: ψ2 = 0,3
    expect(by.get('ELS-F1')!.Q).toBeCloseTo(0.4, 9)
    expect(by.get('ELS-QP')!.Q).toBeCloseTo(0.3, 9)
  })
})
