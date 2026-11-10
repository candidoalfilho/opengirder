/**
 * Fases construtivas NO TEMPO — fluência e retração entre as fases da análise regressiva.
 *
 * A análise regressiva (stages/backward.ts) dá o estado elástico de cada estrutura parcial.
 * Aqui cada fase ganha uma duração (`daysPerStage`) e, no intervalo que se segue à montagem
 * da fase k, o concreto já montado flui e retrai:
 *
 *  - cada aduela (e a torre) é carregada com a idade t0 (`model.site.longTerm.t0`); a aduela
 *    montada na fase j tem, no início do intervalo da fase k, a idade t0 + (k − j)·dias;
 *  - o incremento de fluência do intervalo usa a curva de fluência do PRIMEIRO carregamento da
 *    peça, Δφ = φ(idade + Δt, t0) − φ(idade, t0), aplicada aos esforços que a peça tem na fase k
 *    (método da taxa de fluência); a retração do intervalo é εcs(idade + Δt, idade);
 *  - o incremento é resolvido por um passo AAEM (timedep/aaem.ts) sobre a estrutura parcial da
 *    fase, com E″ = E/(1 + χ·Δφ);
 *  - os incrementos são SOMADOS fase a fase (superposição linear): `creep` de cada fase é o
 *    acumulado desde o início da obra até o fim do intervalo daquela fase;
 *  - depois da última fase passam `tOpen` dias até a abertura e, daí até t∞, um último passo
 *    na estrutura completa (`time.final`).
 *
 * O que NÃO está aqui — ler antes de usar os números:
 *  - o estado elástico de cada fase vem da regressiva e não é corrigido pela fluência das fases
 *    anteriores (a redistribuição entra só como incremento somado);
 *  - não há retensionamento de estais nem correção de cota das aduelas seguintes;
 *  - a relaxação dos estais não é considerada; aço e seções mistas não fluem;
 *  - a torre é tratada como carregada na idade t0 no início da obra.
 * O resultado serve p/ estimar a contraflecha de fluência por fase e a ordem de grandeza da
 * variação das trações dos estais durante e depois da obra.
 */

import type { BridgeModel } from '../model/types'
import type { StageCreep, StagesResult } from '../analysis/types'
import { type StageHookInfo, type StageOptions, runStages } from '../stages/backward'
import { type FrameCreep, creepStep, systemFrameForces } from './aaem'
import { creepCoefficient, shrinkageStrain } from './nbr6118a'
import { type LongTermParams, resolveLongTerm, rheologyOf } from './params'
import type { RheologyParams } from './nbr6118a'

export interface StageTimeOptions extends StageOptions {
  /** duração de cada fase (dias); padrão 7. 0 desliga a passagem do tempo */
  daysPerStage?: number
  /** dias entre a última fase e a abertura ao tráfego; padrão 60 */
  tOpen?: number
}

interface Increment {
  u: Float64Array
  cables: Map<number, number>
  deckNodes: number[]
  final?: { u: Float64Array; cables: Map<number, number> }
}

export function runStagesInTime(
  model: BridgeModel,
  cableL0: { id: number; L0: number }[],
  opts: StageTimeOptions = {},
): StagesResult {
  const days = opts.daysPerStage ?? 7
  const tOpen = Math.max(0, opts.tOpen ?? 60)
  const p = resolveLongTerm(model)
  if (!p || !(days > 0)) return runStages(model, cableL0, opts)

  const incs = new Map<number, Increment>()
  const cache = new Map<string, RheologyParams | null>()
  const onStage = (info: StageHookInfo): void => {
    opts.onStage?.(info)
    if (!info.converged) return
    const inc = stageIncrement(info, p, days, tOpen, cache)
    if (inc) incs.set(info.k, inc)
  }
  const res = runStages(model, cableL0, { ...opts, onStage })
  if (incs.size === 0) return res

  const nNodes = model.nodes.length
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]))
  const cum = new Float64Array(6 * nNodes)
  const cumT = new Map<number, number>()
  const last = res.stages.length - 1
  for (let k = 0; k <= last; k++) {
    const st = res.stages[k]
    const inc = incs.get(k)
    if (inc) {
      for (let i = 0; i < cum.length; i++) cum[i] += inc.u[i]
      for (const [id, dT] of inc.cables) cumT.set(id, (cumT.get(id) ?? 0) + dT)
    }
    let uzMax = 0
    for (const i of inc?.deckNodes ?? []) {
      const v = cum[6 * i + 2]
      if (Math.abs(v) > Math.abs(uzMax)) uzMax = v
    }
    let lo = 0
    let hi = 0
    for (const s of st.stays) {
      const d = cumT.get(s.id) ?? 0
      if (d < lo) lo = d
      if (d > hi) hi = d
    }
    const creep: StageCreep = {
      day: k < last ? (k + 1) * days : last * days + tOpen,
      u: Array.from(cum),
      tips: st.tips.map((t) => ({ node: t.node, uz: cum[6 * (nodeIndex.get(t.node) ?? 0) + 2] })),
      uzMax,
      dT: [lo, hi],
      towersUx: st.towers.map((t) => cum[6 * (nodeIndex.get(t.topNode) ?? 0)]),
    }
    st.creep = creep
  }

  const fin = incs.get(last)?.final
  if (fin) {
    let uzMax = 0
    for (const i of incs.get(last)!.deckNodes) {
      const v = fin.u[6 * i + 2]
      if (Math.abs(v) > Math.abs(uzMax)) uzMax = v
    }
    let lo = 0
    let hi = 0
    const stays: { id: number; dT: number }[] = []
    for (const s of res.stays) {
      const d = fin.cables.get(s.id) ?? 0
      stays.push({ id: s.id, dT: d })
      if (d < lo) lo = d
      if (d > hi) hi = d
    }
    res.time = {
      daysPerStage: days,
      tOpen,
      t0: p.t0,
      final: { u: Array.from(fin.u), uzMax, stays, dT: [lo, hi] },
      stays: res.stays.map((s) => ({ id: s.id, dTbuild: cumT.get(s.id) ?? 0, dTfinal: fin.cables.get(s.id) ?? 0 })),
    }
  }
  return res
}

/** incremento de fluência + retração no intervalo que se segue à fase k (e, na última, até t∞) */
function stageIncrement(
  info: StageHookInfo,
  p: LongTermParams,
  days: number,
  tOpen: number,
  cache: Map<string, RheologyParams | null>,
): Increment | null {
  const { k, last, sub, sys, stageOf, nonlinear } = info
  const byId = new Map(sub.elements.map((e) => [e.id, e]))
  const mats = new Map(sub.materials.map((m) => [m.id, m]))
  const secs = new Map(sub.sections.map((s) => [s.id, s]))
  const rheoOf = (id: number): RheologyParams | null => {
    const e = byId.get(id)
    if (!e || e.kind !== 'frame') return null
    const key = `${e.sec}|${e.mat}`
    if (cache.has(key)) return cache.get(key)!
    const mat = mats.get(e.mat)
    const sec = secs.get(e.sec)
    const r = mat && sec && mat.kind === 'concrete' ? rheologyOf(sec, mat, p) : null
    cache.set(key, r)
    return r
  }
  const rheo = sys.frames.map((f) => rheoOf(f.id))
  if (!rheo.some(Boolean)) return null
  const forces = systemFrameForces(sys, nonlinear)
  const dt = k < last ? days : tOpen
  /** idade da barra no início do intervalo da fase k */
  const age = (id: number): number => p.t0 + (k - Math.min(stageOf.get(id) ?? 0, k)) * days
  const interval = (a0: (id: number) => number, a1: (id: number) => number): (FrameCreep | null)[] =>
    sys.frames.map((f, e) => {
      const r = rheo[e]
      if (!r) return null
      const t1 = a0(f.id)
      const t2 = a1(f.id)
      if (!(t2 > t1)) return null
      return {
        phi: Math.max(0, creepCoefficient(r, t2, p.t0) - creepCoefficient(r, t1, p.t0)),
        epsCs: shrinkageStrain(r, t2, t1),
      }
    })
  const cablesOf = (st: { cables: { id: number; dT: number }[] }): Map<number, number> => new Map(st.cables.map((c) => [c.id, c.dT]))
  const deck = new Set<number>()
  for (const f of sys.frames) {
    if (f.group !== 'deck') continue
    deck.add(f.a)
    deck.add(f.b)
  }
  const out: Increment = { u: new Float64Array(6 * sys.nNodes), cables: new Map(), deckNodes: [...deck] }
  if (dt > 0) {
    const st = creepStep(sys, forces, interval(age, (id) => age(id) + dt), nonlinear, p.chi)
    out.u = Float64Array.from(st.u)
    out.cables = cablesOf(st)
  }
  if (k === last) {
    // da abertura até t∞, na estrutura completa
    const open = (id: number): number => age(id) + tOpen
    const st = creepStep(sys, forces, interval(open, (id) => Math.max(p.tInf, open(id) + 1)), nonlinear, p.chi)
    out.final = { u: Float64Array.from(st.u), cables: cablesOf(st) }
  }
  return out
}
