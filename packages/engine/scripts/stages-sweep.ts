import { analyzeBridge, defaultTemplate, generateModel, PRESETS } from '../src/index'
import type { CableStayedParams, TemplateParams } from '../src/index'
const cs = (o: Partial<CableStayedParams>): TemplateParams => {
  const t = defaultTemplate('cable-stayed')
  return { kind: 'cable-stayed', params: { ...(t.params as CableStayedParams), ...o } }
}
const cases: [string, TemplateParams, object][] = [
  ['estaiada padrão', cs({}), {}],
  ['1 plano', cs({ planes: 1 }), {}],
  ['leque', cs({ layout: 'fan' }), {}],
  ['harpa', cs({ layout: 'harp' }), {}],
  ['1 torre 120/120', cs({ towers: 1, mainSpan: 120, sideSpan: 120, staysPerSide: 10 }), {}],
  ['1 torre 150/90 harpa 1 plano', cs({ towers: 1, mainSpan: 150, sideSpan: 90, staysPerSide: 8, planes: 1, layout: 'harp' }), {}],
  ['curva R=300 mastro', cs({ towers: 1, mainSpan: 120, sideSpan: 120, staysPerSide: 10, planRadius: 300 }), {}],
  ['torre X reta', cs({ towers: 1, mainSpan: 120, sideSpan: 120, staysPerSide: 10, towerShape: 'X' }), {}],
  ['torre X reta sem engaste prov.', cs({ towers: 1, mainSpan: 120, sideSpan: 120, staysPerSide: 10, towerShape: 'X' }), { temporaryFixity: false }],
  ['torre inclinada 10°', cs({ towers: 1, mainSpan: 160, sideSpan: 100, staysPerSide: 10, towerTiltDeg: 10 }), {}],
  ['2 torres aço', cs({ deckMaterial: 'steel', deck: { A: 0.9, Iz: 1.8, Iy: 60, J: 3, depth: 2.2, extraDead: 60 } }), {}],
  ['3 estais', cs({ staysPerSide: 3 }), {}],
  ['São Paulo sem engaste prov.', PRESETS.find((p) => p.id === 'octavio-frias')!.template, { temporaryFixity: false }],
  ['São Paulo + equipamento 800 kN', PRESETS.find((p) => p.id === 'octavio-frias')!.template, { equipment: 800 }],
]
for (const [name, t, so] of cases) {
  try {
    const m = generateModel(t)
    const r = analyzeBridge(m, { modal: false, moving: false, stages: so })
    const st = r.stages
    if (!st) { console.log(`✗ ${name}: sem fases — ${r.warnings.join(' | ')}`); continue }
    const nc = st.stages.filter((s) => !s.converged).map((s) => s.index)
    const sl = st.stages.filter((s) => s.nSlack > 0).map((s) => `${s.index}:${s.nSlack}`)
    const tip = Math.max(...st.stages.flatMap((s) => s.tips.map((x) => Math.abs(x.uz))), 0)
    const tw = Math.max(...st.stages.flatMap((s) => s.towers.map((x) => Math.abs(x.ux))), 0)
    const kinds = st.stages.map((s) => s.kind[0]).join('')
    console.log(`${nc.length === 0 ? '✓' : '✗'} ${name.padEnd(34)} ${String(st.stages.length).padStart(2)} fases [${kinds}] ${String(st.elapsed).padStart(5)} ms NC=[${nc}] frouxos=[${sl}] ponta máx ${(tip * 1000).toFixed(0)} mm torre máx ${(tw * 1000).toFixed(0)} mm ${st.stages.filter((s) => s.error).map((s) => s.index + ':' + s.error).join(' ; ')}`)
  } catch (e) {
    console.log(`✗ ${name}: EXCEÇÃO — ${(e as Error).message.split('\n')[0]}`)
  }
}
