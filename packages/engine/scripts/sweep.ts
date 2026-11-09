/* eslint-disable no-console */
import { analyzeBridge, defaultTemplate, generateModel, validateModel } from '../src/index'
import type { ArchParams, CableStayedParams, GirderBridgeParams, SuspensionParams, TemplateParams } from '../src/index'

const cs = (o: Partial<CableStayedParams>): TemplateParams => {
  const t = defaultTemplate('cable-stayed')
  return { kind: 'cable-stayed', params: { ...(t.params as CableStayedParams), ...o } }
}
const su = (o: Partial<SuspensionParams>): TemplateParams => {
  const t = defaultTemplate('suspension')
  return { kind: 'suspension', params: { ...(t.params as SuspensionParams), ...o } }
}
const gi = (o: Partial<GirderBridgeParams>): TemplateParams => {
  const t = defaultTemplate('girder')
  return { kind: 'girder', params: { ...(t.params as GirderBridgeParams), ...o } }
}
const ar = (o: Partial<ArchParams>): TemplateParams => {
  const t = defaultTemplate('arch')
  return { kind: 'arch', params: { ...(t.params as ArchParams), ...o } }
}
const cases: [string, TemplateParams][] = [
  ['estaiada padrão', cs({})],
  ['1 plano', cs({ planes: 1 })],
  ['leque', cs({ layout: 'fan' })],
  ['harpa', cs({ layout: 'harp' })],
  ['1 torre 120/120', cs({ towers: 1, mainSpan: 120, sideSpan: 120, staysPerSide: 10 })],
  ['1 torre 150/90 harpa 1 plano', cs({ towers: 1, mainSpan: 150, sideSpan: 90, staysPerSide: 8, planes: 1, layout: 'harp' })],
  ['curva R=300 mastro', cs({ towers: 1, mainSpan: 120, sideSpan: 120, staysPerSide: 10, planRadius: 300 })],
  ['torre X reta', cs({ towers: 1, mainSpan: 120, sideSpan: 120, staysPerSide: 10, towerShape: 'X' })],
  ['torre inclinada 10°', cs({ towers: 1, mainSpan: 160, sideSpan: 100, staysPerSide: 10, towerTiltDeg: 10 })],
  ['2 torres aço', cs({ deckMaterial: 'steel', deck: { A: 0.9, Iz: 1.8, Iy: 60, J: 3, depth: 2.2, extraDead: 60 } })],
  ['3 estais', cs({ staysPerSide: 3 })],
  ['pênsil padrão', su({})],
  ['pênsil, vãos laterais de 60 m (cabo íngreme: reprova, esperado)', su({ sideSpan: 60 })],
  ['pênsil 300 m, 2 subdiv.', su({ mainSpan: 300, sideSpan: 90, towerHeight: 40, subdivisions: 2, cableArea: 0.06 })],
  ['pênsil flecha 1/8', su({ sagRatio: 0.125 })],
  ['viga padrão', gi({})],
  ['viga 1 vão', gi({ spans: [35] })],
  ['pórtico monolítico', gi({ monolithic: true })],
  ['viga 5 vãos sem pilares', gi({ spans: [25, 30, 30, 30, 25], pierHeight: 0 })],
  ['arco atirantado padrão', ar({})],
  ['arco atirantado 1 plano', ar({ planes: 1, hangerArea: 0.0048, arch: { material: 'steel', fck: 40, A: 0.34, I: 0.14, Iout: 0.09, J: 0.16, depth: 1.6, width: 1.2 } })],
  ['arco superior biarticulado com empuxo', ar({ tied: false, hinges: 'two-hinged', shape: 'funicular' })],
  ['arcos inclinados 10° (basket handle)', ar({ inclinationDeg: 10 })],
  ['arco de tabuleiro intermediário', ar({ layout: 'half-through', tied: false, deckOffset: 8, rise: 26, hangerArea: 0.0042 })],
  ['arco inferior com montantes e acessos', ar({ layout: 'deck', tied: false, deckOffset: 2, shape: 'funicular', approachSpans: [25] })],
  ['arco catenária 200 m f/L = 1/7', ar({ span: 200, rise: 200 / 7, panels: 20, shape: 'catenary', hangerArea: 0.003, arch: { material: 'steel', fck: 40, A: 0.3, I: 0.2, Iout: 0.12, J: 0.2, depth: 2.2, width: 1.6 } })],
  ['viga aço', gi({ deckMaterial: 'steel', deck: { A: 0.35, Iz: 0.9, Iy: 8, J: 0.5, depth: 2.4, extraDead: 70 } })],
]
for (const [name, t] of cases) {
  try {
    const m = generateModel(t)
    const errs = validateModel(m)
    if (errs.length) { console.log(`✗ ${name}: inválido — ${errs[0]}`); continue }
    const t0 = performance.now()
    const r = analyzeBridge(m, { modal: { modes: 6 }, sizeCables: true })
    const slack = r.deadLoad.cables.filter((c) => c.slack).length
    const fail = r.checks.cables.filter((c) => !c.ok).length
    let dz = 0
    m.nodes.forEach((n, i) => { if (n.role === 'deck') dz = Math.max(dz, Math.abs(r.deadLoad.u[6 * i + 2])) })
    const ok = r.deadLoad.converged && (r.formFinding?.converged ?? true) && slack === 0 && fail === 0
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(44)} ${String(r.nDofs).padStart(5)} GDL ${(performance.now() - t0).toFixed(0).padStart(5)} ms conv=${r.deadLoad.converged} ff=${r.formFinding ? r.formFinding.converged + '/' + r.formFinding.iterations : '-'} uz=${(1000 * dz).toFixed(1)}mm frouxos=${slack} reprov=${fail} T1=${r.modal?.modes[0]?.period.toFixed(2)}s ${r.warnings.filter((w) => !w.startsWith('Vão acima')).join(' | ')} ${process.env.TIMINGS ? JSON.stringify(r.timings) : ''}`)
  } catch (e) {
    console.log(`✗ ${name}: EXCEÇÃO — ${(e as Error).message.split('\n')[0]}`)
  }
}
