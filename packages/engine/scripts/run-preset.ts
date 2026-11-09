/* eslint-disable no-console */
import { PRESETS, analyzeBridge, generateModel } from '../src/index'

const ids = process.argv.slice(2)
for (const p of PRESETS) {
  if (ids.length && !ids.includes(p.id)) continue
  const model = generateModel(p.template)
  const t0 = performance.now()
  const r = analyzeBridge(model, { modal: { modes: Number(process.env.MODES ?? 12) }, sizeCables: true })
  const dt = performance.now() - t0
  const cab = r.deadLoad.cables
  const groups = new Map<string, number[]>()
  r.checks.cables.forEach((c) => {
    const g = groups.get(c.group) ?? []
    g.push(c.TG)
    groups.set(c.group, g)
  })
  console.log(`\n=== ${p.label}: ${r.nNodes} nós, ${r.nElements} el., ${r.nDofs} GDL, ${dt.toFixed(0)} ms`)
  console.log('  timings', JSON.stringify(r.timings))
  console.log(`  estático: conv=${r.deadLoad.converged} it=${r.deadLoad.iterations} res=${r.deadLoad.residual.toExponential(2)}`)
  if (r.formFinding) console.log(`  form-finding: conv=${r.formFinding.converged} it=${r.formFinding.iterations} hist(mm)=${r.formFinding.history.map((h) => (1000 * h).toFixed(1)).join(' ')}`)
  for (const [g, v] of groups) console.log(`  ${g}: n=${v.length} T min=${Math.min(...v).toFixed(0)} máx=${Math.max(...v).toFixed(0)} kN`)
  const bad = r.checks.cables.filter((c) => !c.ok)
  console.log(`  cabos frouxos=${cab.filter((c) => c.slack).length} reprovados=${bad.length} ELS máx=${Math.max(0, ...r.checks.cables.map((c) => c.ratioEls)).toFixed(2)} ELU máx=${Math.max(0, ...r.checks.cables.map((c) => c.ratioElu)).toFixed(2)}`)
  let umax = 0
  for (let i = 0; i < r.nNodes; i++) umax = Math.max(umax, Math.hypot(r.deadLoad.u[6 * i], r.deadLoad.u[6 * i + 1], r.deadLoad.u[6 * i + 2]))
  console.log(`  |u| máx (permanente) = ${(1000 * umax).toFixed(1)} mm`)
  const mz = r.deadLoad.frames.flatMap((f) => f.Mz)
  const nn = r.deadLoad.frames.flatMap((f) => f.N)
  console.log(`  Mz ∈ [${Math.min(...mz).toFixed(0)}, ${Math.max(...mz).toFixed(0)}] kN·m; N ∈ [${Math.min(...nn).toFixed(0)}, ${Math.max(...nn).toFixed(0)}] kN`)
  if (r.modal) console.log('  modos: ' + r.modal.modes.map((m) => `${m.period.toFixed(2)}s ${m.kind.slice(0, 4)}(${m.massPct.map((v) => v.toFixed(0)).join('/')})`).join(' | '))
  if (r.moving) console.log(`  móvel: CIV=${r.moving.CIV.toFixed(3)} CNF=${r.moving.CNF} uz mín=${(1000 * Math.min(...r.moving.uzMin)).toFixed(0)} mm, ΔT máx=${Math.max(0, ...r.moving.cables.map((c) => c.max)).toFixed(0)} kN`)
  for (const w of r.warnings) console.log('  ⚠ ' + w)
}
