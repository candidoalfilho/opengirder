import { describe, expect, it } from 'vitest'
import { PRESETS, analyzeBridge, applyCableL0, defaultTemplate, generateModel, validateModel } from '../src/index'
import type { BridgeResults } from '../src/analysis/types'
import type { BridgeModel } from '../src/model/types'

const cache = new Map<string, { model: BridgeModel; r: BridgeResults }>()
function run(id: string): { model: BridgeModel; r: BridgeResults } {
  let v = cache.get(id)
  if (!v) {
    const model = generateModel(PRESETS.find((p) => p.id === id)!.template)
    v = { model, r: analyzeBridge(model, { modal: { modes: 8 }, sizeCables: true }) }
    cache.set(id, v)
  }
  return v
}
const maxDeck = (model: BridgeModel, r: BridgeResults, d: number): number =>
  Math.max(...model.nodes.map((n, i) => (n.role === 'deck' ? Math.abs(r.deadLoad.u[6 * i + d]) : 0)))

const sumRz = (r: BridgeResults): number => r.deadLoad.reactions.reduce((s, q) => s + q.R[2], 0)
/** peso total: barras (γ·A + sobrecarga permanente)·L + cabos γ·A·L0 (com as áreas finais) */
function weight(model: BridgeModel, r: BridgeResults): number {
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  const pos = new Map(model.nodes.map((n) => [n.id, n]))
  const cab = new Map(r.cableL0.map((c) => [c.id, c]))
  let W = 0
  for (const e of model.elements) {
    const g = mats.get(e.mat)!.gamma
    if (e.kind === 'frame') {
      const a = pos.get(e.n1)!
      const b = pos.get(e.n2)!
      const sec = secs.get(e.sec)!
      W += (g * sec.A + (sec.extraDead ?? 0)) * Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    } else {
      const c = cab.get(e.id)!
      W += g * (c.A ?? e.A) * c.L0
    }
  }
  return W
}

describe('modelos de referência', () => {
  it('todos os modelos e gabaritos padrão são válidos', () => {
    for (const p of PRESETS) expect(validateModel(generateModel(p.template))).toEqual([])
    for (const k of ['girder', 'cable-stayed', 'suspension'] as const) {
      const m = generateModel(defaultTemplate(k))
      expect(validateModel(m)).toEqual([])
      expect(m.type).toBe(k)
    }
  })

  it('Golden Gate: equilíbrio, tração nos cabos e modos contra os valores publicados', () => {
    const { model, r } = run('golden-gate')
    expect(r.deadLoad.converged).toBe(true)
    expect(r.formFinding?.converged).toBe(true)
    // tabuleiro no greide sob carga permanente
    expect(maxDeck(model, r, 2)).toBeLessThan(0.005)
    // tração no cabo principal: faixa publicada 213–253 MN (48–57 mil kip)
    const main = r.checks.cables.filter((c) => c.group === 'main-cable').map((c) => c.TG)
    expect(Math.min(...main)).toBeGreaterThan(205e3)
    expect(Math.max(...main)).toBeLessThan(265e3)
    // pendurais: carga de um painel de 15,24 m dividida por dois cabos
    const hang = r.checks.cables.filter((c) => c.group === 'hanger').map((c) => c.TG)
    const P = (225 * 15.24) / 2
    expect(Math.min(...hang) / P).toBeGreaterThan(0.9)
    expect(Math.max(...hang) / P).toBeLessThan(1.15)
    expect(r.deadLoad.cables.some((c) => c.slack)).toBe(false)
    // equilíbrio global: Σ reações verticais = peso total
    expect(sumRz(r) / weight(model, r)).toBeCloseTo(1, 6)
    // modos (modelo ADINA do retrofit sísmico, HDR): 20,495 s / 11,631 s / 7,808 s
    const modes = r.modal!.modes
    expect(modes[0].kind).toBe('transversal')
    expect(modes[0].period / 20.495).toBeGreaterThan(0.95)
    expect(modes[0].period / 20.495).toBeLessThan(1.05)
    expect(modes[1].kind).toBe('longitudinal')
    expect(modes[1].period / 11.631).toBeGreaterThan(0.9)
    expect(modes[1].period / 11.631).toBeLessThan(1.1)
    const vert = modes.find((m) => m.kind === 'vertical')!
    expect(vert.period / 7.808).toBeGreaterThan(0.95)
    expect(vert.period / 7.808).toBeLessThan(1.05)
    expect(r.checks.cables.every((c) => c.ok)).toBe(true)
  })

  it('Estaiada de São Paulo: 144 estais tracionados, tabuleiros e mastro no lugar', () => {
    const { model, r } = run('octavio-frias')
    expect(model.elements.filter((e) => e.kind === 'cable').length).toBe(144)
    expect(model.lanes.length).toBe(2)
    expect(r.deadLoad.converged).toBe(true)
    expect(r.formFinding?.converged).toBe(true)
    expect(r.deadLoad.cables.some((c) => c.slack)).toBe(false)
    expect(maxDeck(model, r, 2)).toBeLessThan(0.03)
    // mastro no prumo (topo a menos de 5 cm)
    const top = model.nodes.map((n, i) => ({ n, i })).filter((q) => q.n.role === 'tower').sort((a, b) => b.n.z - a.n.z)[0]
    expect(Math.hypot(r.deadLoad.u[6 * top.i], r.deadLoad.u[6 * top.i + 1])).toBeLessThan(0.05)
    // estais na faixa de 9 a 25+ cordoalhas de 15,7 mm trabalhando abaixo de 0,45·fptk
    const T = r.checks.cables.map((c) => c.TG)
    expect(Math.min(...T)).toBeGreaterThan(400)
    expect(Math.max(...T)).toBeLessThan(4000)
    expect(r.checks.cables.every((c) => c.ok)).toBe(true)
    // carga total nos apoios = peso da estrutura
    expect(sumRz(r) / weight(model, r)).toBeCloseTo(1, 6)
    expect(r.modal!.modes[0].period).toBeGreaterThan(1.5)
    expect(r.modal!.modes[0].period).toBeLessThan(6)
  })

  it('Rio Negro e estaiada de três vãos: forças suaves, sem cabos frouxos', () => {
    for (const id of ['rio-negro', 'estaiada-3-vaos']) {
      const { model, r } = run(id)
      expect(r.deadLoad.converged).toBe(true)
      expect(r.formFinding?.converged).toBe(true)
      expect(r.deadLoad.cables.some((c) => c.slack)).toBe(false)
      expect(maxDeck(model, r, 2)).toBeLessThan(0.03)
      expect(r.checks.cables.every((c) => c.ok)).toBe(true)
      const T = r.checks.cables.map((c) => c.TG)
      expect(Math.max(...T) / Math.min(...T)).toBeLessThan(6)
    }
    expect(run('rio-negro').model.elements.filter((e) => e.kind === 'cable').length).toBe(104)
  })

  it('viaduto: viga contínua 30 + 40 + 30 sob peso próprio e TB-450', () => {
    const { r } = run('viaduto')
    expect(r.deadLoad.converged).toBe(true)
    const q = 6.5 * 25 + 35
    // Σ reações = peso do tabuleiro (os pilares são balanços independentes, com reação própria)
    const Mz = r.deadLoad.frames.flatMap((f) => f.Mz)
    // momento negativo sobre os pilares de viga contínua 30-40-30: entre qL²/12 e qL²/8 do vão de 40
    expect(-Math.min(...Mz)).toBeGreaterThan((q * 40 * 40) / 14)
    expect(-Math.min(...Mz)).toBeLessThan((q * 40 * 40) / 8)
    expect(r.moving!.CIV).toBeCloseTo(1 + (1.06 * 20) / (100 / 3 + 50), 10)
    expect(r.moving!.CNF).toBeCloseTo(0.95, 10)
    expect(r.modal!.modes[0].kind).toBe('vertical')
  })

  it('reaplicar o L0 do form-finding reproduz o mesmo estado sem iterar', () => {
    const { model, r } = run('rio-negro')
    const m2 = applyCableL0(model, r.cableL0)
    const r2 = analyzeBridge(m2, { modal: false, moving: false, formFinding: false })
    expect(r2.deadLoad.converged).toBe(true)
    const a = r.checks.cables.map((c) => c.TG)
    const b = r2.checks.cables.map((c) => c.TG)
    for (let i = 0; i < a.length; i++) expect(b[i] / a[i]).toBeCloseTo(1, 5)
  })
})
