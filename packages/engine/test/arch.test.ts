import { describe, expect, it } from 'vitest'
import { PRESETS, analyzeBridge, defaultTemplate, generateModel, pedestrianComfort, validateModel } from '../src/index'
import type { ArchParams, BridgeModel, BridgeResults, ModalResult } from '../src/index'
import { catenaryParameter, funicularPolygon } from '../src/templates/arch'
import { beam } from './helpers'

const arch = (o: Partial<ArchParams> = {}): BridgeModel =>
  generateModel({ kind: 'arch', params: { ...(defaultTemplate('arch').params as ArchParams), name: 'teste', ...o } })

const OFF = { modal: false as const, moving: false as const }

function preset(id: string, modes = 6): { model: BridgeModel; r: BridgeResults } {
  const model = generateModel(PRESETS.find((p) => p.id === id)!.template)
  return { model, r: analyzeBridge(model, { modal: { modes }, sizeCables: true }) }
}
const maxDeckUz = (model: BridgeModel, r: BridgeResults): number =>
  Math.max(...model.nodes.map((n, i) => (n.role === 'deck' ? Math.abs(r.deadLoad.u[6 * i + 2]) : 0)))

describe('ponte em arco — geometria do eixo', () => {
  it('funicular de cargas iguais: vértices na parábola e H = qL²/8f', () => {
    const L = 120
    const f = 20
    const n = 12
    const d = L / n
    const q = 85
    const x = Array.from({ length: n + 1 }, (_, i) => i * d)
    const P = x.map((_, i) => (i === 0 || i === n ? 0 : q * d))
    const { h, H } = funicularPolygon(x, P, f)
    expect(H).toBeCloseTo((q * L * L) / (8 * f), 8)
    x.forEach((xi, i) => expect(h[i]).toBeCloseTo((4 * f * xi * (L - xi)) / (L * L), 10))
  })

  it('catenária: o parâmetro reproduz a flecha', () => {
    const a = catenaryParameter(130, 22)
    expect(a * (Math.cosh(130 / (2 * a)) - 1)).toBeCloseTo(22, 9)
  })
})

describe('ponte em arco — respostas conhecidas', () => {
  it('arco parabólico biarticulado sob carga uniforme: H = qL²/8f e flexão ≈ 0', () => {
    // só o arco de um plano do gerador (nós nos pontos de painel), sem peso, com a carga
    // uniforme em projeção horizontal aplicada nos nós
    const p = { ...(defaultTemplate('arch').params as ArchParams), tied: false, hinges: 'two-hinged' as const, elementLength: 50 }
    const full = generateModel({ kind: 'arch', params: p })
    const pos = new Map(full.nodes.map((n) => [n.id, n]))
    const els = full.elements.filter((e) => e.kind === 'frame' && e.sec === 'arch' && pos.get(e.n1)!.y > 0)
    const used = new Set(els.flatMap((e) => [e.n1, e.n2]))
    const nodes = full.nodes.filter((n) => used.has(n.id))
    const L = p.span
    const f = p.rise
    const d = L / p.panels
    const q = 90
    const model: BridgeModel = {
      ...full,
      nodes: nodes.map((n) => (n.fix ? n : { ...n, fix: [false, true, false, true, false, true] })),
      elements: els,
      materials: full.materials.map((m) => ({ ...m, gamma: 0 })),
      loadCases: [{ id: 'q', name: 'q', nodal: nodes.filter((n) => !n.fix).map((n) => ({ node: n.id, F: [0, 0, -q * d, 0, 0, 0] })) }],
      lanes: [],
    }
    expect(els.length).toBe(p.panels)
    const r = analyzeBridge(model, { ...OFF, nonlinear: false })
    const H0 = (q * L * L) / (8 * f)
    const Rx = r.deadLoad.reactions.map((s) => Math.abs(s.R[0])).filter((v) => v > 1)
    expect(Rx.length).toBe(2)
    // o encurtamento do arco reduz o empuxo em ~ (15/8)·I/(A·f²) = 0,15 %
    for (const v of Rx) expect(v / H0).toBeCloseTo(1, 2)
    expect(Rx[0] / H0).toBeGreaterThan(0.995)
    const Mmax = Math.max(...r.deadLoad.frames.flatMap((s) => s.Mz.map(Math.abs)))
    expect(Mmax).toBeLessThan(0.004 * q * L * L / 8)
    // normal no fecho = −H
    const crown = Math.max(...r.deadLoad.frames.map((s) => s.N[0]))
    expect(-crown / H0).toBeCloseTo(1, 2)
  })

  it('arco superior com empuxo: reação horizontal = funicular das forças do próprio modelo', () => {
    const p = { ...(defaultTemplate('arch').params as ArchParams), tied: false, hinges: 'two-hinged' as const, shape: 'funicular' as const }
    const model = generateModel({ kind: 'arch', params: p })
    const r = analyzeBridge(model, OFF)
    expect(r.deadLoad.converged).toBe(true)
    expect(r.formFinding?.converged).toBe(true)
    expect(r.deadLoad.cables.every((c) => !c.slack)).toBe(true)
    expect(maxDeckUz(model, r)).toBeLessThan(0.005)
    // empuxo por arco × estimativa de carga uniforme equivalente
    const steel = 77
    const wDeck = steel * p.deck.A + p.deck.extraDead
    const wArch = steel * p.arch.A * (1 + (8 * p.rise ** 2) / (3 * p.span ** 2))
    const H0 = ((wDeck / 2 + wArch) * p.span ** 2) / (8 * p.rise)
    const springs = r.deadLoad.reactions.filter((s) => Math.abs(s.R[0]) > 1)
    expect(springs.length).toBe(4)
    for (const s of springs) expect(Math.abs(s.R[0]) / H0).toBeCloseTo(1, 1)
    // eixo funicular: flexão do arco pequena frente a H·f
    const archIds = new Set(model.elements.filter((e) => e.kind === 'frame' && e.sec === 'arch').map((e) => e.id))
    const Mmax = Math.max(...r.deadLoad.frames.filter((s) => archIds.has(s.id)).flatMap((s) => s.Mz.map(Math.abs)))
    expect(Mmax).toBeLessThan(0.01 * H0 * p.rise)
  })

  it('bowstring: sem empuxo nos apoios e tração do tirante = soma dos empuxos dos arcos', () => {
    const model = arch()
    const r = analyzeBridge(model, OFF)
    expect(r.deadLoad.converged).toBe(true)
    const V = r.deadLoad.reactions.reduce((s, q) => s + q.R[2], 0)
    const Hsum = r.deadLoad.reactions.reduce((s, q) => s + Math.abs(q.R[0]) + Math.abs(q.R[1]), 0)
    expect(Hsum).toBeLessThan(1e-6 * V)
    const byId = new Map(model.elements.map((e) => [e.id, e]))
    const pos = new Map(model.nodes.map((n) => [n.id, n]))
    // empuxo de cada arco = componente horizontal da normal no fecho
    let H = 0
    let tie = 0
    for (const f of r.deadLoad.frames) {
      const e = byId.get(f.id)!
      if (e.kind !== 'frame') continue
      const a = pos.get(e.n1)!
      const b = pos.get(e.n2)!
      const mid = 0.5 * (a.x + b.x)
      if (e.sec === 'arch' && Math.abs(mid - 65) < 2.6 && a.x < 65) {
        const c = Math.abs(b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
        H += -f.N[1] * c
      }
      if (e.group === 'deck' && Math.abs(mid - 62.5) < 0.1) tie = f.N[1]
    }
    expect(H).toBeGreaterThan(15000)
    expect(tie / H).toBeCloseTo(1, 2)
  })
})

describe('ponte em arco — gerador e modelos de referência', () => {
  const variants: [string, Partial<ArchParams>][] = [
    ['bowstring 1 plano', { planes: 1, hangerArea: 0.0048, arch: { material: 'steel', fck: 40, A: 0.34, I: 0.14, Iout: 0.09, J: 0.16, depth: 1.6, width: 1.2 } }],
    ['arcos inclinados (basket handle)', { inclinationDeg: 10 }],
    ['catenária com acessos', { shape: 'catenary', approachSpans: [30] }],
    ['tabuleiro intermediário', { layout: 'half-through', tied: false, deckOffset: 8, rise: 26, hangerArea: 0.0042 }],
    ['arco inferior com montantes', { layout: 'deck', tied: false, deckOffset: 2, shape: 'funicular', braced: true }],
  ]
  for (const [name, o] of variants) {
    it(`${name}: modelo válido, converge, sem pendural frouxo`, () => {
      const model = arch(o)
      expect(validateModel(model)).toEqual([])
      expect(model.type).toBe('arch')
      expect(model.lanes[0].nodes.length).toBeGreaterThan(10)
      expect(model.meta?.mainSpan).toBe(130)
      const r = analyzeBridge(model, { modal: { modes: 4 } })
      expect(r.deadLoad.converged).toBe(true)
      if (r.formFinding) expect(r.formFinding.converged).toBe(true)
      expect(r.deadLoad.cables.filter((c) => c.slack).length).toBe(0)
      expect(r.checks.cables.filter((c) => !c.ok).length).toBe(0)
      expect(r.modal?.modes.length).toBe(4)
      expect(r.moving).toBeDefined()
      // com pendurais, o form-finding segura o tabuleiro no greide
      if (o.layout !== 'deck') expect(maxDeckUz(model, r)).toBeLessThan(0.03)
    })
  }

  it('arco atirantado metálico: pendurais tracionados, tabuleiro no greide, modal', () => {
    const { model, r } = preset('arco-atirantado')
    expect(r.deadLoad.converged).toBe(true)
    expect(r.formFinding?.converged).toBe(true)
    expect(r.deadLoad.cables.length).toBe(24)
    expect(r.deadLoad.cables.every((c) => !c.slack && c.Ti > 600 && c.Ti < 1200)).toBe(true)
    expect(r.checks.cables.every((c) => c.ok)).toBe(true)
    expect(maxDeckUz(model, r)).toBeLessThan(0.01)
    expect(r.modal?.converged).toBe(true)
    expect(r.modal!.modes[0].period).toBeGreaterThan(0.8)
    expect(r.modal!.modes[0].period).toBeLessThan(2)
  })

  it('arco de concreto de 290 m: compressão no arco ≈ empuxo estimado, modal', () => {
    const { model, r } = preset('arco-concreto')
    expect(validateModel(model)).toEqual([])
    expect(r.deadLoad.converged).toBe(true)
    const p = model.template!.params as ArchParams
    const archIds = new Set(model.elements.filter((e) => e.kind === 'frame' && e.sec === 'arch').map((e) => e.id))
    const N = r.deadLoad.frames.filter((s) => archIds.has(s.id)).flatMap((s) => s.N)
    expect(Math.max(...N)).toBeLessThan(0) // todo comprimido
    // no fecho, |N| = H ≈ carga permanente total × L/(8f)
    const W = r.deadLoad.reactions.reduce((s, q) => s + q.R[2], 0)
    const H = -Math.max(...N)
    expect(H).toBeGreaterThan(0.6 * W * p.span / (8 * p.rise) * (p.span / 552))
    expect(H).toBeLessThan(W * p.span / (8 * p.rise))
    expect(maxDeckUz(model, r)).toBeLessThan(0.2)
    expect(r.modal?.converged).toBe(true)
  })
})

describe('extradorso e passarela', () => {
  it('ponte extradorso: converge, sem estai frouxo, estais aprovados após o dimensionamento', () => {
    const { model, r } = preset('extradorso')
    expect(r.deadLoad.converged).toBe(true)
    expect(r.formFinding?.converged).toBe(true)
    expect(r.deadLoad.cables.filter((c) => c.slack).length).toBe(0)
    expect(r.checks.cables.filter((c) => !c.ok).length).toBe(0)
    expect(maxDeckUz(model, r)).toBeLessThan(0.03)
    const p = model.template!.params as { towerHeight: number; mainSpan: number }
    expect(p.mainSpan / p.towerHeight).toBeGreaterThanOrEqual(8)
    expect(p.mainSpan / p.towerHeight).toBeLessThanOrEqual(12)
  })

  it('passarela estaiada: carga de multidão sem impacto e triagem de conforto', () => {
    const { model, r } = preset('passarela', 8)
    expect(model.meta?.liveLoad).toBe('Pedestres')
    expect(r.deadLoad.converged).toBe(true)
    expect(r.deadLoad.cables.filter((c) => c.slack).length).toBe(0)
    expect(r.checks.cables.filter((c) => !c.ok).length).toBe(0)
    const mv = r.moving!
    expect(mv.vehicle).toBe('Pedestres')
    expect([mv.CIV, mv.CNF, mv.CIA]).toEqual([1, 1, 1])
    expect(mv.axleLoad).toBe(0)
    expect(mv.distributed).toBeCloseTo(5 * 3.5, 12)
    expect(r.pedestrian).toBeDefined()
    expect(r.pedestrian!.fVertical).toBeGreaterThan(0)
    expect(r.pedestrian!.ok).toBe(r.pedestrian!.critical.length === 0)
  })

  it('carga de pedestres em viga biapoiada: M = p·b·L²/8, sem CIV/CNF/CIA', () => {
    const L = 24
    const b = 3
    const m = beam(L, 24)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[24].fix = [false, true, true, true, false, false]
    m.lanes = [{ id: 'l', name: 'l', nodes: m.nodes.map((n) => n.id), width: b, maxEccentricity: 0 }]
    m.meta = { mainSpan: L, spans: [L], deckMaterial: 'steel' }
    const r = analyzeBridge(m, { modal: false, nonlinear: false, moving: { vehicle: 'Pedestres' } })
    const mv = r.moving!
    expect(mv.CIV).toBe(1)
    expect(mv.frames[11].Mz.max[2]).toBeCloseTo((5 * b * L * L) / 8, 6)
    expect(mv.frames[0].Vy.max[0]).toBeCloseTo((5 * b * L) / 2, 1)
    expect(r.pedestrian).toBeUndefined() // sem análise modal
    // TB-450 continua sendo o padrão quando o modelo não diz nada
    expect(analyzeBridge(m, { modal: false, nonlinear: false }).moving!.vehicle).toBe('TB-450')
    // e o modelo pode trazer a carga de projeto
    m.meta.liveLoad = 'Pedestres'
    expect(analyzeBridge(m, { modal: false, nonlinear: false }).moving!.vehicle).toBe('Pedestres')
  })

  it('triagem de conforto: modos na faixa do passo', () => {
    const mode = (index: number, f: number, kind: ModalResult['modes'][number]['kind']): ModalResult['modes'][number] => ({
      index, frequency: f, period: 1 / f, kind, shape: [], massPct: kind === 'transversal' ? [0, 30, 0] : [0, 0, 30],
    })
    const modal: ModalResult = {
      totalMass: 1, iterations: 1, converged: true,
      modes: [mode(1, 0.6, 'transversal'), mode(2, 1.0, 'transversal'), mode(3, 1.0, 'vertical'), mode(4, 2.0, 'vertical'), mode(5, 2.0, 'transversal'), mode(6, 3.0, 'torcional')],
    }
    const c = pedestrianComfort(modal)
    expect(c.ok).toBe(false)
    expect(c.critical.map((x) => [x.mode, x.direction])).toEqual([[2, 'lateral'], [4, 'vertical']])
    expect(c.fVertical).toBe(1.0)
    expect(c.fLateral).toBe(0.6)
    expect(pedestrianComfort({ ...modal, modes: [mode(1, 3.2, 'vertical'), mode(2, 1.5, 'transversal')] }).ok).toBe(true)
  })
})
