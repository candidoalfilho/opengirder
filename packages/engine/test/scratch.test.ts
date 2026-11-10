import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { validateModel } from '../src/model/validate'
import { cableSteel, concrete } from '../src/templates/builder'
import type { BridgeModel, BridgeNode, Element, Section } from '../src/model/types'

/**
 * Ponte estaiada escrita à mão, como sairia do editor gráfico: sem gabarito, sem `template`,
 * sem `meta` além dos vãos, sem L0 nos estais. O que o motor precisa de um modelo assim é só
 * o GRUPO de cada elemento (tabuleiro, torre, estai) e uma pista.
 */
function handBuilt(opts: { pretension: boolean }): BridgeModel {
  const DECK: Section = { id: 'deck', name: 'Tabuleiro', A: 8, Iy: 90, Iz: 4, J: 6, extraDead: 40, depth: 2.2, width: 14, shape: 'box' }
  const TOWER: Section = { id: 'tower', name: 'Torre', A: 20, Iy: 60, Iz: 60, J: 80, depth: 4, width: 5, shape: 'tower' }
  const nodes: BridgeNode[] = []
  const elements: Element[] = []
  let eid = 0
  // tabuleiro: 2 × 60 m na cota 20, nós a cada 10 m (ids 1…13)
  for (let i = 0; i <= 12; i++) nodes.push({ id: i + 1, x: 10 * i, y: 0, z: 20 })
  for (let i = 0; i < 12; i++) elements.push({ kind: 'frame', id: ++eid, n1: i + 1, n2: i + 2, mat: 'c50', sec: 'deck', group: 'deck' })
  nodes[0].fix = [false, true, true, true, false, false]
  nodes[12].fix = [false, true, true, true, false, false]
  // torre em x = 60: base engastada (id 14), passa pelo nó 7 do tabuleiro, topo na cota 80 (id 16)
  nodes.push({ id: 14, x: 60, y: 0, z: 0, fix: [true, true, true, true, true, true] })
  nodes.push({ id: 15, x: 60, y: 0, z: 50 })
  nodes.push({ id: 16, x: 60, y: 0, z: 80 })
  for (const [a, b] of [[14, 7], [7, 15], [15, 16]]) elements.push({ kind: 'frame', id: ++eid, n1: a, n2: b, mat: 'c50', sec: 'tower', group: 'tower' })
  // 5 estais por lado, em leque, no topo
  for (const d of [10, 20, 30, 40, 50]) {
    for (const side of [-1, 1]) {
      const anchor = 7 + (side * d) / 10
      const sin = 60 / Math.hypot(d, 60)
      const el: Element = { kind: 'cable', id: ++eid, n1: 16, n2: anchor, mat: 'stay', A: 30 * 1.5e-4, strands: 30, group: 'stay' }
      if (opts.pretension) el.pretension = Math.round((240 * 10) / sin)
      elements.push(el)
    }
  }
  return {
    schema: 'opengirder/1', name: 'Estaiada feita à mão', type: 'cable-stayed', nodes,
    materials: [concrete('c50', 50), cableSteel('stay', 'Cordoalhas 1770', 1770)],
    sections: [DECK, TOWER], elements, loadCases: [],
    lanes: [{ id: 'pista', name: 'Pista', nodes: Array.from({ length: 13 }, (_, i) => i + 1), width: 13.2, maxEccentricity: 5.1 }],
    meta: { mainSpan: 60, spans: [60, 60], deckMaterial: 'concrete' },
  }
}

describe('modelo construído do zero (sem gabarito)', () => {
  for (const pretension of [true, false]) {
    it(`estaiada 2 × 60 m com 5 estais por lado — ${pretension ? 'com' : 'sem'} pré-tração inicial nos estais`, () => {
      const m = handBuilt({ pretension })
      expect(validateModel(m)).toEqual([])
      const r = analyzeBridge(m, { sizeCables: true })
      expect(r.deadLoad.converged).toBe(true)
      expect(r.formFinding?.converged).toBe(true)
      expect(r.deadLoad.cables.filter((c) => c.slack)).toHaveLength(0)
      // tabuleiro no greide
      let uz = 0
      for (let i = 0; i <= 12; i++) uz = Math.max(uz, Math.abs(r.deadLoad.u[6 * i + 2]))
      expect(uz).toBeLessThan(0.03)
      // cada estai leva o peso de um painel: T·sen α ≈ 240 kN/m × 10 m (± 25%), fora os extremos
      const sinOf = (d: number): number => 60 / Math.hypot(d, 60)
      r.deadLoad.cables.forEach((c, k) => {
        const d = [10, 20, 30, 40, 50][Math.floor(k / 2)]
        if (d === 10 || d === 50) return
        expect((Math.max(c.Ti, c.Tj) * sinOf(d)) / 2400).toBeGreaterThan(0.75)
        expect((Math.max(c.Ti, c.Tj) * sinOf(d)) / 2400).toBeLessThan(1.25)
      })
      expect(r.moving).toBeDefined()
      expect(r.combos).toBeDefined()
      expect(r.checks.cables.every((c) => c.ok)).toBe(true)
      expect(r.modal?.modes.length).toBeGreaterThan(0)
      expect(r.buckling?.modes[0].factor).toBeGreaterThan(1)
    })
  }
})
