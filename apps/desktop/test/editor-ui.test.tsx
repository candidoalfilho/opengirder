/**
 * Editor gráfico: geometria da captura, operações elementares do desenho, o comando de
 * confirmar pontos (o mesmo usado pelo clique no 3D e pelo campo de coordenadas), o estado
 * de edição no store e a renderização dos painéis — sem DOM.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { analyzeBridge, validateModel, type BridgeModel, type Vec3 } from '@opengirder/engine'
import { blankModel } from '../src/editor/blank'
import {
  addCableBetween,
  addFrameBetween,
  deleteSelection,
  parseCoords,
  resolvePoint,
  selectionNodes,
  setNodesFix,
  translateNodes,
} from '../src/editor/draw'
import { boxSelect, planeAxes, pointSegment2D, rayPlane, raySegmentParam, snapAlong, snapToGrid } from '../src/editor/snap'
import type { EditDefaults } from '../src/editor/types'

// o store aplica o tema no <html> ao ser criado
;(globalThis as Record<string, unknown>).document = { documentElement: { dataset: {} } }

const DEF: EditDefaults = {
  frameMat: 'concrete', frameSec: 'deck', frameGroup: 'deck',
  cableMat: 'strand', cableGroup: 'stay', cableA: 0.012, cableStrands: 80,
}
const ok = <T,>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r)
  return r
}

describe('captura do cursor', () => {
  it('malha do plano de trabalho', () => {
    expect(snapToGrid([12.4, 3, 19.6], { kind: 'elevation', offset: 0 }, 1)).toEqual([12, 0, 20])
    expect(snapToGrid([12.4, 3.6, 19.6], { kind: 'plan', offset: 20 }, 0.5)).toEqual([12.5, 3.5, 20])
    expect(snapToGrid([7, 3.26, 19.6], { kind: 'cross', offset: 60 }, 0)).toEqual([60, 3.26, 19.6])
    expect(planeAxes('cross')).toEqual({ u: 1, v: 2, n: 0 })
  })

  it('raio × plano e raio × barra', () => {
    expect(rayPlane([10, -100, 30], [0, 1, 0], { kind: 'elevation', offset: 0 })).toEqual([10, 0, 30])
    expect(rayPlane([10, -100, 30], [1, 0, 0], { kind: 'elevation', offset: 0 })).toBeNull() // paralelo
    expect(rayPlane([10, 100, 30], [0, 1, 0], { kind: 'elevation', offset: 0 })).toBeNull() // de costas
    // raio vertical que passa por x = 45 de uma barra horizontal de 0 a 60
    expect(raySegmentParam([45, 0, 100], [0, 0, -1], [0, 0, 20], [60, 0, 20])).toBeCloseTo(0.75, 12)
    expect(pointSegment2D(5, 3, 0, 0, 10, 0)).toEqual({ dist: 3, t: 0.5 })
  })

  it('posição ao longo da barra em múltiplos do passo; extremidades viram nó', () => {
    expect(snapAlong(0.742, 60, 1)).toBeCloseTo(45 / 60, 12)
    expect(snapAlong(0.004, 60, 1)).toBe(0)
    expect(snapAlong(0.997, 60, 1)).toBe(1)
    expect(snapAlong(0.4, 60, 0)).toBeCloseTo(0.4, 12)
  })

  it('janela: da esquerda pega o que está inteiro dentro; da direita, o que cruza', () => {
    const S = (x: number, y: number) => ({ x, y, ok: true })
    const nodes = [{ id: 1, s: S(10, 10) }, { id: 2, s: S(50, 10) }, { id: 3, s: S(90, 10) }]
    const els = [{ id: 7, a: S(10, 10), b: S(50, 10) }, { id: 8, a: S(50, 10), b: S(90, 10) }]
    expect(boxSelect(nodes, els, 0, 0, 60, 20)).toEqual({ nodes: [1, 2], elements: [7] })
    expect(boxSelect(nodes, els, 60, 20, 0, 0)).toEqual({ nodes: [1, 2], elements: [7, 8] })
    expect(boxSelect([{ id: 1, s: { x: 10, y: 10, ok: false } }], [], 0, 0, 60, 20).nodes).toEqual([])
  })

  it('coordenadas digitadas: absolutas, no plano e relativas', () => {
    const el = { kind: 'elevation' as const, offset: 4 }
    expect(parseCoords('10; 0; 20', el, null)).toEqual([10, 0, 20])
    expect(parseCoords('10,5 20', el, null)).toEqual([10.5, 4, 20])
    expect(parseCoords('@60; 0; 0', el, [0, 0, 20])).toEqual([60, 0, 20])
    expect(parseCoords('@5; 2', el, [10, 4, 20])).toEqual([15, 4, 22])
    expect(parseCoords('@5; 2', el, null)).toBeNull()
    expect(parseCoords('abc', el, null)).toBeNull()
    expect(parseCoords('3; 7', { kind: 'plan', offset: 12 }, null)).toEqual([3, 7, 12])
  })
})

/** estaiada pequena desenhada só com as operações do editor */
function drawBridge(): BridgeModel {
  let m = blankModel('teste', 'cable-stayed')
  const at = (p: Vec3): number => {
    const r = ok(resolvePoint(m, { p }))
    m = r.model
    return r.node
  }
  const a = at([0, 0, 20])
  const mid = at([60, 0, 20])
  const b = at([120, 0, 20])
  const f1 = ok(addFrameBetween(m, a, mid, DEF))
  m = f1.model
  const f2 = ok(addFrameBetween(m, mid, b, DEF))
  m = f2.model
  const tw: EditDefaults = { ...DEF, frameSec: 'tower', frameGroup: 'tower' }
  const base = at([60, 0, 0])
  const top = at([60, 0, 60])
  m = ok(addFrameBetween(m, base, mid, tw)).model
  const shaft = ok(addFrameBetween(m, mid, top, tw))
  m = shaft.model
  m = setNodesFix(m, [a], [true, true, true, false, false, false])
  m = setNodesFix(m, [b], [false, true, true, false, false, false])
  m = setNodesFix(m, [base], [true, true, true, true, true, true])
  // estais: ancoragens criadas dividindo a torre e o tabuleiro onde o clique cai
  for (const [z, d] of [[44, 15], [52, 30], [60, 45]] as [number, number][]) {
    for (const side of [-1, 1]) {
      const onTower = m.elements.find((e) => {
        if (e.kind !== 'frame' || e.group !== 'tower') return false
        const n1 = m.nodes.find((n) => n.id === e.n1)!
        const n2 = m.nodes.find((n) => n.id === e.n2)!
        return Math.min(n1.z, n2.z) < z && Math.max(n1.z, n2.z) > z
      })
      let t: number
      if (onTower) {
        const n1 = m.nodes.find((n) => n.id === onTower.n1)!
        const n2 = m.nodes.find((n) => n.id === onTower.n2)!
        const r = ok(resolvePoint(m, { p: [60, 0, z], frame: { id: onTower.id, t: (z - n1.z) / (n2.z - n1.z) } }))
        m = r.model
        t = r.node
      } else t = at([60, 0, z])
      const x = 60 + side * d
      const onDeck = m.elements.find((e) => {
        if (e.kind !== 'frame' || e.group !== 'deck') return false
        const n1 = m.nodes.find((n) => n.id === e.n1)!
        const n2 = m.nodes.find((n) => n.id === e.n2)!
        return Math.min(n1.x, n2.x) < x && Math.max(n1.x, n2.x) > x
      })!
      const n1 = m.nodes.find((n) => n.id === onDeck.n1)!
      const n2 = m.nodes.find((n) => n.id === onDeck.n2)!
      const r = ok(resolvePoint(m, { p: [x, 0, 20], frame: { id: onDeck.id, t: (x - n1.x) / (n2.x - n1.x) } }))
      m = r.model
      m = ok(addCableBetween(m, t, r.node, DEF)).model
    }
  }
  return m
}

describe('desenho do zero', () => {
  it('modelo em branco: materiais e seções prontos, sem nós', () => {
    const m = blankModel()
    expect(m.nodes).toHaveLength(0)
    expect(m.materials.map((x) => x.kind)).toEqual(['concrete', 'steel', 'cable', 'rigid'])
    expect(m.sections.map((s) => s.id)).toEqual(['deck', 'tower', 'pier', 'rigid'])
    expect(validateModel(m).length).toBeGreaterThan(0) // vazio ainda não analisa
  })

  it('ponto sobre nó existente reutiliza o nó; sobre barra, divide a barra', () => {
    let m = blankModel()
    const a = ok(resolvePoint(m, { p: [0, 0, 0] }))
    m = a.model
    const b = ok(resolvePoint(m, { p: [10, 0, 0] }))
    m = b.model
    expect(ok(resolvePoint(m, { p: [10, 0, 0.0004] })).node).toBe(b.node) // tolerância de 1 mm
    const f = ok(addFrameBetween(m, a.node, b.node, DEF))
    m = f.model
    expect(typeof addFrameBetween(m, b.node, a.node, DEF)).toBe('string') // duplicada
    expect(typeof addFrameBetween(m, a.node, a.node, DEF)).toBe('string')
    const s = ok(resolvePoint(m, { p: [4, 0, 0], frame: { id: f.id, t: 0.4 } }))
    expect(s.created).toBe(true)
    expect(s.model.nodes).toHaveLength(3)
    expect(s.model.elements).toHaveLength(2)
    const nd = s.model.nodes.find((n) => n.id === s.node)!
    expect([nd.x, nd.y, nd.z]).toEqual([4, 0, 0])
  })

  it('estaiada desenhada à mão analisa: converge, estais tracionados, tabuleiro no greide', () => {
    const m = drawBridge()
    expect(validateModel(m)).toEqual([])
    expect(m.elements.filter((e) => e.kind === 'cable')).toHaveLength(6)
    expect(m.elements.filter((e) => e.kind === 'frame' && e.group === 'deck')).toHaveLength(8)
    const r = analyzeBridge(m, { moving: false, modal: false })
    expect(r.deadLoad.converged).toBe(true)
    expect(r.formFinding?.converged).toBe(true)
    for (const c of r.deadLoad.cables) {
      expect(c.slack).toBe(false)
      expect(c.Ti).toBeGreaterThan(1000)
    }
    const uz = r.deadLoad.u.filter((_, i) => i % 6 === 2).map(Math.abs)
    expect(Math.max(...uz)).toBeLessThan(0.02)
  })

  it('mover limpa o L0 dos cabos ligados; apagar poupa nó ainda em uso', () => {
    let m = drawBridge()
    const cable = m.elements.find((e) => e.kind === 'cable')!
    m = { ...m, elements: m.elements.map((e) => (e.kind === 'cable' ? { ...e, L0: 50 } : e)) }
    const moved = translateNodes(m, [cable.n1], [0, 0, 1])
    const touched = moved.elements.filter((e) => e.kind === 'cable' && (e.n1 === cable.n1 || e.n2 === cable.n1))
    expect(touched.length).toBeGreaterThan(0)
    for (const e of touched) expect(e.kind === 'cable' && e.L0).toBeUndefined()
    expect(moved.elements.some((e) => e.kind === 'cable' && e.L0 === 50)).toBe(true)
    expect(translateNodes(m, [], [1, 0, 0])).toBe(m)

    const sel = { nodes: [cable.n1, cable.n2], elements: [cable.id] }
    expect(selectionNodes(m, { nodes: [], elements: [cable.id] }).sort()).toEqual([cable.n1, cable.n2].sort())
    const d = deleteSelection(m, sel)
    expect(d.removedElements).toBe(1)
    expect(d.removedNodes).toBe(0) // as duas ancoragens seguem presas à torre e ao tabuleiro
    expect(d.kept.sort()).toEqual([cable.n1, cable.n2].sort())
    expect(validateModel(d.model)).toEqual([])
  })
})

describe('estado de edição no store', () => {
  it('confirmar pontos cria nós e barras em polilinha; modelo novo sai do modo de edição', async () => {
    const { useStore } = await import('../src/store')
    const { commitPoint, startBlank, useEditSession, cancelCommand, deleteSelected } = await import('../src/editor/session')
    startBlank(blankModel())
    let st = useStore.getState()
    expect(st.edit.active).toBe(true)
    expect(st.edit.tool).toBe('frame')
    expect(st.edit.defaults.frameSec).toBe('deck')
    expect(st.edit.defaults.cableMat).toBe('strand')

    commitPoint({ p: [0, 0, 20] })
    commitPoint({ p: [60, 0, 20] })
    commitPoint({ p: [120, 0, 20] })
    st = useStore.getState()
    expect(st.model!.nodes).toHaveLength(3)
    expect(st.model!.elements).toHaveLength(2)
    expect(useEditSession.getState().pending).toBe(3)
    expect(st.edit.sel).toEqual({ nodes: [], elements: [2] })
    expect(st.selection).toEqual({ kind: 'element', id: 2 })
    expect(st.past).toHaveLength(3) // um passo de desfazer por clique
    expect(cancelCommand()).toBe(true)
    expect(cancelCommand()).toBe(false)

    // cabo: termina a cada par
    st.setEdit({ tool: 'cable' })
    commitPoint({ p: [60, 0, 60] })
    commitPoint({ p: [0, 0, 20], node: 1 })
    st = useStore.getState()
    expect(st.model!.elements.filter((e) => e.kind === 'cable')).toHaveLength(1)
    expect(useEditSession.getState().pending).toBeNull()

    // apagar: o cabo sai, o nó 1 fica (usado pela barra) e é avisado
    st.setEditSel({ nodes: [1], elements: [3] })
    deleteSelected()
    st = useStore.getState()
    expect(st.model!.elements).toHaveLength(2)
    expect(st.model!.nodes.some((n) => n.id === 1)).toBe(true)
    expect(st.toast?.kind).toBe('err')

    // desfazer limpa a seleção; a seleção é podada quando o item deixa de existir
    st.setEditSel({ nodes: [4], elements: [] })
    st.updateModel((m) => ({ ...m, nodes: m.nodes.filter((n) => n.id !== 4) }))
    expect(useStore.getState().edit.sel.nodes).toEqual([])
    expect(useStore.getState().edit.active).toBe(true)

    useStore.getState().loadModel(blankModel('outro'))
    expect(useStore.getState().edit.active).toBe(false)
  })

  it('painéis do editor renderizam com modelo vazio e com seleção mista', async () => {
    const { useStore } = await import('../src/store')
    const { EditToolbar, EditToggle } = await import('../src/editor/EditToolbar')
    const { EditPanel } = await import('../src/editor/EditPanel')
    const { ModelIdentity } = await import('../src/editor/ModelIdentity')
    const { startBlank } = await import('../src/editor/session')
    // na renderização de servidor o zustand lê o estado INICIAL do store; aqui interessa o atual
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot())
    startBlank(blankModel())
    expect(renderToString(<EditToolbar />)).toContain('Operações')
    expect(renderToString(<EditToggle />)).toContain('Concluir edição')
    expect(renderToString(<EditPanel />)).toBe('')
    expect(renderToString(<ModelIdentity />)).toContain('Tipo de ponte')

    const m = drawBridge()
    useStore.getState().loadModel(m)
    useStore.getState().setEdit({ active: true, tool: 'cable' })
    const cable = m.elements.find((e) => e.kind === 'cable')!
    const frame = m.elements.find((e) => e.kind === 'frame')!
    useStore.getState().setEditSel({ nodes: [m.nodes[0].id, m.nodes[1].id], elements: [cable.id, frame.id] })
    const html = renderToString(<EditPanel />)
    expect(html).toContain('2 nós')
    expect(html).toContain('Apoio fixo')
    expect(html).toContain('Cordoalhas')
    expect(html).toContain('Seção')
    expect(renderToString(<EditToolbar />)).toContain('Cordoalhas fptk 1770 MPa')
  })
})
