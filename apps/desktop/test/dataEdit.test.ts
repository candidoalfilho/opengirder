import { describe, expect, it } from 'vitest'
import { PRESETS, analyzeBridge, generateModel, validateModel, type BridgeModel } from '@opengirder/engine'
import * as ed from '../src/panels/features/dataEdit'

const viaduct = (): BridgeModel => generateModel(PRESETS.find((p) => p.id === 'viaduto')!.template)
const ok = (r: ed.Edit): BridgeModel => {
  if (typeof r === 'string') throw new Error(r)
  return r
}

describe('edição de dados do modelo', () => {
  it('nós: mover, restringir, adicionar e remover (só se não usado)', () => {
    let m = viaduct()
    const n0 = m.nodes[0]
    m = ok(ed.patchNode(m, n0.id, { z: n0.z + 0.5 }))
    expect(m.nodes[0].z).toBe(n0.z + 0.5)
    expect(typeof ed.patchNode(m, n0.id, { x: NaN })).toBe('string')
    const free = m.nodes.find((n) => !n.fix)!
    m = ok(ed.setNodeFix(m, free.id, 2, true))
    expect(m.nodes.find((n) => n.id === free.id)!.fix).toEqual([false, false, true, false, false, false])
    m = ok(ed.setNodeFix(m, free.id, 2, false))
    expect(m.nodes.find((n) => n.id === free.id)!.fix).toBeUndefined()
    expect(typeof ed.removeNode(m, n0.id)).toBe('string') // usado por barra
    const added = ed.addNode(m)
    expect(added.id).toBe(Math.max(...m.nodes.map((n) => n.id)) + 1)
    m = ok(ed.removeNode(added.model, added.id))
    expect(m.nodes.some((n) => n.id === added.id)).toBe(false)
  })

  it('barras e cabos: religar, criar, remover; cargas distribuídas acompanham a remoção', () => {
    let m = viaduct()
    const f = m.elements.find((e) => e.kind === 'frame')!
    expect(typeof ed.patchFrame(m, f.id, { n1: 99999 })).toBe('string')
    expect(typeof ed.patchFrame(m, f.id, { n1: f.n2 })).toBe('string')
    const a = ed.addNode(m)
    const r = ed.addFrame(a.model, f.n1, a.id)
    if (typeof r === 'string') throw new Error(r)
    m = r.model
    expect(validateModel(m)).toEqual([])
    const lc = m.loadCases[0].id
    m = ok(ed.addUniformLoad(m, lc, r.id))
    m = ok(ed.patchUniformLoad(m, lc, 0, { axis: 2, value: -10 }))
    expect(m.loadCases[0].uniform).toEqual([{ element: r.id, w: [0, 0, -10] }])
    m = ed.removeElement(m, r.id)
    expect(m.loadCases[0].uniform).toEqual([])
    expect(typeof ed.addCable(m, f.n1, f.n2)).toBe('string') // sem material de cabo
    const mat = ed.addMaterial(m)
    m = ok(ed.patchMaterial(mat.model, mat.id, { kind: 'cable', fpk: 1860e3, fy: null }))
    const c = ed.addCable(m, f.n1, a.id)
    if (typeof c === 'string') throw new Error(c)
    m = ok(ed.patchCable(c.model, c.id, { A: 0.0042, strands: 28, L0: 12.5 }))
    const cab = m.elements.find((e) => e.id === c.id)!
    expect(cab.kind === 'cable' && cab.A).toBe(0.0042)
    m = ok(ed.patchCable(m, c.id, { L0: null, strands: null }))
    const cab2 = m.elements.find((e) => e.id === c.id)!
    expect('L0' in cab2).toBe(false)
    expect(typeof ed.patchCable(m, c.id, { A: -1 })).toBe('string')
  })

  it('seções e materiais: editar, duplicar e bloquear remoção do que está em uso', () => {
    let m = viaduct()
    const s = m.sections[0]
    m = ok(ed.patchSection(m, s.id, { Iz: 4.2, extraDead: null, name: 'Caixão novo' }))
    expect(m.sections[0].Iz).toBe(4.2)
    expect('extraDead' in m.sections[0]).toBe(false)
    expect(typeof ed.patchSection(m, s.id, { A: 0 })).toBe('string')
    expect(typeof ed.removeSection(m, s.id)).toBe('string')
    const d = ed.addSection(m, s.id)
    expect(d.model.sections.length).toBe(m.sections.length + 1)
    expect(ok(ed.removeSection(d.model, d.id)).sections.length).toBe(m.sections.length)
    const mt = m.materials[0]
    expect(typeof ed.removeMaterial(m, mt.id)).toBe('string')
    expect(typeof ed.patchMaterial(m, mt.id, { E: -5 })).toBe('string')
    const d2 = ed.addMaterial(m, mt.id)
    expect(new Set(d2.model.materials.map((x) => x.id)).size).toBe(d2.model.materials.length)
  })

  it('cargas: o 1º caso criado preserva o peso próprio; carga nodal entra na análise', () => {
    let m: BridgeModel = { ...viaduct(), loadCases: [] }
    const c = ed.addLoadCase(m)
    m = c.model
    expect(m.loadCases.map((x) => !!x.selfWeight)).toEqual([true, false])
    const base = analyzeBridge(m, { modal: false, moving: false })
    const mid = m.nodes.find((n) => !n.fix && n.role === 'deck')!
    m = ok(ed.addNodalLoad(m, c.id, mid.id))
    m = ok(ed.patchNodalLoad(m, c.id, 0, { dof: 2, value: -1000 }))
    expect(typeof ed.addNodalLoad(m, c.id, 123456)).toBe('string')
    expect(typeof ed.removeNode(m, mid.id)).toBe('string')
    const r = analyzeBridge(m, { modal: false, moving: false })
    const sum = (x: typeof r): number => x.deadLoad.reactions.reduce((a, b) => a + b.R[2], 0)
    expect(sum(r) - sum(base)).toBeCloseTo(1000, 3)
    m = ed.setGroupUniformLoad(m, c.id, 'deck', [0, 0, -5])
    const nDeck = m.elements.filter((e) => e.kind === 'frame' && e.group === 'deck').length
    expect(m.loadCases[1].uniform!.length).toBe(nDeck)
    m = ed.setGroupUniformLoad(m, c.id, 'deck', [0, 0, -7])
    expect(m.loadCases[1].uniform!.length).toBe(nDeck)
    m = ed.removeLoadCase(m, c.id)
    expect(m.loadCases.length).toBe(1)
  })
})
