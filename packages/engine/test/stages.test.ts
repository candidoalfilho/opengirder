import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { PRESETS, generateModel } from '../src/templates'
import { runStages } from '../src/stages/backward'
import { stagePlan } from '../src/stages/plan'
import type { BridgeModel, BridgeNode, Element, Material, Section } from '../src/model/types'

const DECK: Material = { id: 'd', name: 'aço', kind: 'steel', E: 200e6, G: 77e6, gamma: 77 }
const CABLE: Material = { id: 'c', name: 'cabo', kind: 'cable', E: 195e6, G: 75e6, gamma: 0, fpk: 1860e3 }
const SEC: Section = { id: 'deck', name: 'tabuleiro', A: 0.05, Iy: 0.02, Iz: 0.01, J: 0.01 }
const TOWER: Section = { id: 'tower', name: 'torre', A: 0.5, Iy: 0.5, Iz: 0.5, J: 0.5 }

/** torre engastada + tabuleiro em balanço de comprimento L (monolítico com a torre) + 1 estai na ponta */
function mast(L: number, H: number, n: number, extra: Partial<BridgeModel> = {}): BridgeModel {
  const nodes: BridgeNode[] = [{ id: 1, x: 0, y: 0, z: 0, role: 'tower', fix: [true, true, true, true, true, true] }]
  const elements: Element[] = []
  nodes.push({ id: 2, x: 0, y: 0, z: H, role: 'tower' })
  elements.push({ kind: 'frame', id: 1, n1: 1, n2: 2, mat: 'd', sec: 'tower', group: 'tower' })
  for (let i = 1; i <= n; i++) {
    nodes.push({ id: 2 + i, x: (L * i) / n, y: 0, z: 0, role: 'deck' })
    elements.push({ kind: 'frame', id: 1 + i, n1: i === 1 ? 1 : 1 + i, n2: 2 + i, mat: 'd', sec: 'deck', group: 'deck' })
  }
  elements.push({ kind: 'cable', id: 100, n1: 2, n2: 2 + n, mat: 'c', A: 0.002, pretension: 150, group: 'stay' })
  return {
    schema: 'opengirder/1', name: 'mastro', type: 'cable-stayed', nodes,
    materials: [DECK, CABLE], sections: [SEC, TOWER], elements, loadCases: [], lanes: [], ...extra,
  }
}

describe('fases construtivas — análise regressiva', () => {
  it('balanço com 1 estai: a fase sem estai é o balanço puro, δ = wL⁴/8EI (+ PL³/3EI com equipamento)', () => {
    const L = 20
    const m = mast(L, 15, 8)
    const plan = stagePlan(m)!
    expect(plan.stages.map((s) => s.kind)).toEqual(['base', 'cantilever'])
    expect(plan.stages[1].addElements).toEqual([100])
    expect(plan.roots).toEqual([1])

    const final = analyzeBridge(m, { modal: false, moving: false, formFinding: false, nonlinear: false })
    const st = runStages(m, final.cableL0, { nonlinear: false })
    const w = DECK.gamma * SEC.A
    const EI = DECK.E * SEC.Iz
    const s0 = st.stages[0]
    expect(s0.converged).toBe(true)
    expect(s0.stays).toHaveLength(0)
    expect(s0.hidden).toEqual([100])
    expect(s0.tips).toHaveLength(1)
    expect(s0.tips[0].node).toBe(10)
    expect(s0.tips[0].uz).toBeCloseTo((-w * L ** 4) / (8 * EI), 8)
    // momento de engaste: wL²/2 em torno de Y (tabuleiro para +X carregado para −Z)
    expect(Math.abs(s0.towers[0].baseM)).toBeCloseTo((w * L * L) / 2, 5)
    // a última fase é o estado final
    const fin = st.stages[1]
    expect(fin.stays[0].T / Math.max(final.deadLoad.cables[0].Ti, final.deadLoad.cables[0].Tj)).toBeCloseTo(1, 6)
    expect(st.stays[0]).toMatchObject({ id: 100, stage: 1 })
    expect(st.stays[0].Tinstall).toBeCloseTo(st.stays[0].Tfinal, 6)

    const P = 40
    const eq = runStages(m, final.cableL0, { nonlinear: false, equipment: P })
    expect(eq.stages[0].tips[0].uz).toBeCloseTo((-w * L ** 4) / (8 * EI) - (P * L ** 3) / (3 * EI), 8)
    // o equipamento sai antes do estado final
    expect(eq.stages[1].stays[0].T).toBeCloseTo(fin.stays[0].T, 6)
  })

  it('sobrecarga permanente só entra na última fase', () => {
    const L = 20
    const m = mast(L, 15, 4, { sections: [{ ...SEC, extraDead: 6 }, TOWER] })
    const final = analyzeBridge(m, { modal: false, moving: false, formFinding: false, nonlinear: false })
    const st = runStages(m, final.cableL0, { nonlinear: false })
    expect(st.stages.map((s) => s.kind)).toEqual(['base', 'cantilever', 'finish'])
    const w = DECK.gamma * SEC.A
    expect(st.stages[0].tips[0].uz).toBeCloseTo((-w * L ** 4) / (8 * DECK.E * SEC.Iz), 8)
    expect(st.stages[2].stays[0].T).toBeGreaterThan(st.stages[1].stays[0].T)
    expect(st.stages[2].stays[0].T / Math.max(final.deadLoad.cables[0].Ti, final.deadLoad.cables[0].Tj)).toBeCloseTo(1, 6)
  })

  it('plano definido no modelo por `stage`', () => {
    const m = mast(20, 15, 4)
    m.elements = m.elements.map((e) => (e.id === 100 ? { ...e, stage: 3 } : e.id >= 4 ? { ...e, stage: 2 } : e))
    const plan = stagePlan(m)!
    expect(plan.stages.map((s) => s.addElements.length)).toEqual([3, 2, 1])
    expect(plan.stages[2].addElements).toEqual([100])
  })

  it('Rio Negro, três vãos e São Paulo: todas as fases convergem e a última reproduz o estado final', () => {
    for (const id of ['rio-negro', 'estaiada-3-vaos', 'octavio-frias']) {
      const p = PRESETS.find((x) => x.id === id)!
      const model = generateModel(p.template)
      const params = p.template.params as { staysPerSide: number }
      const r = analyzeBridge(model, { modal: false, moving: false, stages: true })
      const st = r.stages!
      // torre + 1 fase por estai + fechamento + sobrecarga
      expect(st.stages).toHaveLength(params.staysPerSide + 3)
      expect(st.stages.every((s) => s.converged)).toBe(true)
      expect(st.stages.every((s) => s.nSlack === 0)).toBe(true)
      const fin = st.stages[st.stages.length - 1]
      expect(fin.hidden).toHaveLength(0)
      for (const c of r.deadLoad.cables) {
        const s = fin.stays.find((x) => x.id === c.id)!
        expect(Math.abs(s.T / Math.max(c.Ti, c.Tj) - 1)).toBeLessThan(1e-3)
      }
      // os estais entram um par por fase, e cada fase mostra só o que já foi montado
      st.stages.forEach((s, k) => {
        if (s.kind === 'cantilever') expect(s.stays.length).toBe((model.elements.filter((e) => e.kind === 'cable').length / params.staysPerSide) * k)
      })
      expect(st.stays.every((s) => s.Tinstall > 0 && s.Tfinal > 0)).toBe(true)
      // todo nó do tabuleiro tem cota de montagem
      const deckNodes = new Set<number>()
      for (const e of model.elements) if (e.kind === 'frame' && e.group === 'deck') { deckNodes.add(e.n1); deckNodes.add(e.n2) }
      expect(st.erection).toHaveLength(deckNodes.size)
    }
  })
})
