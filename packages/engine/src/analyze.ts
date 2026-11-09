/**
 * analyzeBridge — pipeline completo:
 *   form-finding (L0 dos estais/pendurais) → carga permanente não linear → modal no estado
 *   deformado → carga móvel NBR 7188 por linhas de influência → verificações dos cabos.
 */

import type { BridgeModel } from './model/types'
import type {
  AnalysisOptions,
  BridgeResults,
  CableCheck,
  CableForces,
  FormFindingResult,
  FrameForces,
  Reaction,
  StaticState,
} from './analysis/types'
import { validateModel } from './model/validate'
import { type BridgeSystem, buildSystem, frameTangentLocal } from './analysis/system'
import { type StaticSolution, solveStatic } from './analysis/static'
import { equivalentNodalLoads, stationForces } from './analysis/frame'
import { solveModal } from './analysis/modal'
import { findForm } from './formfinding/formFinding'
import { solveMovingLoad } from './loads/moving'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

type V3 = [number, number, number]

function staticState(sys: BridgeSystem, sol: StaticSolution, nonlinear: boolean): StaticState {
  const kt = new Float64Array(144)
  const fl = new Float64Array(12)
  const st = new Float64Array(18)
  const frames: FrameForces[] = sys.frames.map((f) => {
    frameTangentLocal(f, nonlinear, false, kt)
    for (let i = 0; i < 12; i++) {
      let s = 0
      for (let j = 0; j < 12; j++) s += kt[i * 12 + j] * f.ul[j]
      fl[i] = s
    }
    const R = f.R
    const w = f.w
    const wx = R[0] * w[0] + R[1] * w[1] + R[2] * w[2]
    const wy = R[3] * w[0] + R[4] * w[1] + R[5] * w[2]
    const wz = R[6] * w[0] + R[7] * w[1] + R[8] * w[2]
    const feq = equivalentNodalLoads(f.L0, wx, wy, wz)
    for (let i = 0; i < 12; i++) fl[i] -= feq[i]
    stationForces(fl, f.L0, wx, wy, wz, st, 0)
    const pick = (o: number): V3 => [st[o], st[o + 1], st[o + 2]]
    return { id: f.id, L: f.L0, N: pick(0), Vy: pick(3), Vz: pick(6), T: pick(9), My: pick(12), Mz: pick(15) }
  })
  const cables: CableForces[] = sys.cables.map((c) => {
    const s = c.st
    const chord = Math.hypot(s.lh, s.lz)
    let sag = 0
    if (c.w > 0 && s.H > 0 && s.lh > 0.02 * chord) sag = Math.min((c.w * c.L0 * s.lh) / (8 * s.H), 0.5 * chord)
    return { id: c.id, Ti: s.Ti, Tj: s.Tj, H: s.H, L0: c.L0, chord, sag, slack: s.slack }
  })
  const reactions: Reaction[] = []
  sys.model.nodes.forEach((nd, i) => {
    const hasFix = nd.fix?.some(Boolean)
    const hasSpring = nd.springs?.some((k) => k > 0)
    if (!hasFix && !hasSpring) return
    const R: Reaction['R'] = [0, 0, 0, 0, 0, 0]
    for (let d = 0; d < 6; d++) {
      const g = 6 * i + d
      if (nd.fix?.[d]) R[d] = sol.fint[g] - sys.fext[g]
      else if (sys.springs[g] > 0) R[d] = -sys.springs[g] * sol.u[g]
    }
    reactions.push({ node: nd.id, R })
  })
  return {
    converged: sol.converged,
    iterations: sol.iterations,
    loadSteps: 1,
    residual: sol.residual,
    u: Array.from(sol.u),
    frames,
    cables,
    reactions,
  }
}

function runAnalysis(model: BridgeModel, opts: AnalysisOptions): BridgeResults {
  const errors = validateModel(model)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  const progress = opts.onProgress ?? (() => {})
  const timings: Record<string, number> = {}
  const warnings: string[] = []
  let t = now()
  const lap = (name: string): void => {
    const t1 = now()
    timings[name] = Math.round(t1 - t)
    t = t1
  }

  progress('Montando o modelo', 0)
  const sys = buildSystem(model)
  warnings.push(...sys.warnings)
  const nonlinear = opts.nonlinear ?? true
  lap('montagem')

  // ---- form-finding + carga permanente
  let sol: StaticSolution
  let formFinding: FormFindingResult | undefined
  const adjustable = sys.cables.some((c) => c.group === 'stay' || c.group === 'hanger')
  if ((opts.formFinding ?? true) && adjustable) {
    progress('Form-finding dos cabos', 0.05)
    const ff = findForm(sys, { nonlinear, onProgress: (f) => progress('Form-finding dos cabos', 0.05 + 0.4 * f) })
    sol = ff.solution
    formFinding = ff.result
    if (!ff.result.converged) {
      warnings.push(
        `Form-finding não estabilizou em ${ff.result.iterations} iterações (deslocamento máximo de ` +
          `${(1000 * ff.result.residual).toFixed(0)} mm nas ancoragens do tabuleiro).`,
      )
    }
    lap('formFinding')
  } else {
    progress('Carga permanente', 0.1)
    sol = solveStatic(sys, null, { nonlinear })
    lap('cargaPermanente')
  }
  if (!sol.converged) {
    warnings.push(`A análise de carga permanente não convergiu (resíduo ${sol.residual.toExponential(2)} kN).`)
  }
  if (sol.kgReduced) {
    warnings.push(
      'A rigidez tangente com a compressão atuante não é positiva definida (possível instabilidade); ' +
        'a parcela de compressão da rigidez geométrica foi descartada na solução.',
    )
  }
  const deadLoad = staticState(sys, sol, nonlinear)
  const nSlack = deadLoad.cables.filter((c) => c.slack).length
  if (nSlack > 0) warnings.push(`${nSlack} cabo(s) frouxo(s) sob carga permanente.`)

  // ---- modal
  let modal: BridgeResults['modal']
  if (opts.modal !== false && sys.nEq > 0) {
    progress('Análise modal', 0.5)
    try {
      modal = solveModal(sys, sol.K, opts.modal?.modes ?? 12)
      if (!modal.converged) warnings.push('A iteração por subespaço não convergiu para todos os modos pedidos.')
    } catch (e) {
      warnings.push(`Análise modal não realizada: ${(e as Error).message}`)
    }
    lap('modal')
  }

  // ---- carga móvel
  let moving: BridgeResults['moving']
  if (opts.moving !== false && model.lanes.length > 0 && sys.nEq > 0) {
    progress('Carga móvel NBR 7188', 0.6)
    const spans = model.meta?.spans ?? []
    let Liv = model.meta?.mainSpan ?? 0
    if (model.type === 'girder' && spans.length > 1) Liv = spans.reduce((a, b) => a + b, 0) / spans.length
    if (!(Liv > 0)) {
      const xs = model.nodes.map((n) => n.x)
      Liv = Math.max(...xs) - Math.min(...xs)
    }
    moving = solveMovingLoad(sys, sol.K, {
      vehicle: opts.moving?.vehicle ?? 'TB-450',
      lanes: opts.moving?.lanes,
      nonlinear,
      Liv,
      deckMaterial: model.meta?.deckMaterial,
      onProgress: (f) => progress('Carga móvel NBR 7188', 0.6 + 0.35 * f),
    })
    if (Liv > 200) {
      warnings.push(
        'Vão acima de 200 m: a NBR 7188 exige estudo específico de amplificação dinâmica; foi usado o CIV de 200 m.',
      )
    }
    lap('cargaMovel')
  }

  // ---- verificações dos cabos
  progress('Verificações', 0.97)
  const mv = new Map((moving?.cables ?? []).map((c) => [c.id, c]))
  const cables: CableCheck[] = sys.cables.map((c, i) => {
    const s = deadLoad.cables[i]
    const TG = Math.max(s.Ti, s.Tj)
    const q = mv.get(c.id)
    const dTQ = q ? Math.max(q.max, 0) : 0
    const Fu = c.A * c.fpk
    const Tels = TG + dTQ
    const Telu = 1.35 * TG + 1.5 * dTQ
    const ratioEls = Fu > 0 ? Tels / (0.45 * Fu) : 0
    const ratioElu = Fu > 0 ? Telu / (0.65 * Fu) : 0
    return {
      id: c.id,
      group: c.group ?? 'cabo',
      TG, dTQ, Tels, Telu, Fu, ratioEls, ratioElu,
      dSigma: q ? (q.max - q.min) / c.A / 1000 : 0,
      ok: ratioEls <= 1 && ratioElu <= 1 && !s.slack,
    }
  })
  lap('verificacoes')
  progress('Concluído', 1)

  return {
    nNodes: sys.nNodes,
    nElements: sys.frames.length + sys.cables.length,
    nDofs: sys.nEq,
    formFinding,
    deadLoad,
    modal,
    moving,
    checks: { cables },
    cableL0: sys.cables.map((c) => ({ id: c.id, L0: c.L0 })),
    warnings,
    timings,
  }
}

/**
 * Pré-dimensionamento dos estais: nº de cordoalhas p/ atender ELS (0,45·Fu) e ELU (0,65·Fu)
 * com as forças da análise. Só aumenta. Devolve o modelo redimensionado, ou null se nada muda.
 */
function resizeStays(model: BridgeModel, res: BridgeResults): BridgeModel | null {
  const checks = new Map(res.checks.cables.map((c) => [c.id, c]))
  let changed = false
  const elements = model.elements.map((e) => {
    if (e.kind !== 'cable' || e.group !== 'stay' || !e.strands) return e
    const c = checks.get(e.id)
    if (!c || !(c.Fu > 0)) return e
    const fuStrand = c.Fu / e.strands
    const need = Math.ceil(Math.max(c.Tels / 0.45, c.Telu / 0.65) / fuStrand - 1e-9)
    // tração permanente como ponto de partida do novo form-finding
    const { L0: _l0, ...rest } = e
    if (need <= e.strands) return { ...rest, pretension: c.TG }
    changed = true
    return { ...rest, pretension: c.TG, strands: need, A: (e.A / e.strands) * need }
  })
  return changed ? { ...model, elements } : null
}

export function analyzeBridge(model: BridgeModel, opts: AnalysisOptions = {}): BridgeResults {
  const sizing = !!opts.sizeCables && opts.moving !== false && model.lanes.length > 0 &&
    model.elements.some((e) => e.kind === 'cable' && e.group === 'stay' && !!e.strands)
  if (!sizing) return runAnalysis(model, opts)
  // passes de dimensionamento sem análise modal; o último passe roda completo
  const quick: AnalysisOptions = { ...opts, modal: false }
  const total = (r: BridgeResults): number => Object.values(r.timings).reduce((a, b) => a + b, 0)
  let res = runAnalysis(model, quick)
  let spent = 0
  let current = model
  let resized = false
  for (let pass = 0; pass < 4; pass++) {
    const next = resizeStays(current, res)
    if (!next) break
    current = next
    resized = true
    spent += total(res)
    res = runAnalysis(current, quick)
  }
  if (opts.modal !== false) {
    // último passe completo (com modal), partindo do L0 já convergido — sem refazer o form-finding
    spent += total(res)
    const ff = res.formFinding
    res = runAnalysis(applyCableL0(current, res.cableL0), { ...opts, formFinding: false })
    res.formFinding = ff
  }
  if (spent > 0) res.timings.dimensionamento = spent
  if (resized) {
    const size = new Map<number, { A: number; strands?: number }>()
    for (const e of current.elements) if (e.kind === 'cable') size.set(e.id, { A: e.A, strands: e.strands })
    res.cableL0 = res.cableL0.map((c) => ({ ...c, ...size.get(c.id) }))
  }
  return res
}

/** grava no modelo os comprimentos indeformados (e áreas, se redimensionadas) da análise */
export function applyCableL0(model: BridgeModel, cableL0: BridgeResults['cableL0']): BridgeModel {
  const map = new Map(cableL0.map((c) => [c.id, c]))
  return {
    ...model,
    elements: model.elements.map((e) => {
      if (e.kind !== 'cable') return e
      const c = map.get(e.id)
      if (!c) return e
      const { pretension: _drop, ...rest } = e
      const out = { ...rest, L0: c.L0 }
      if (c.A !== undefined) out.A = c.A
      if (c.strands !== undefined) out.strands = c.strands
      return out
    }),
  }
}
