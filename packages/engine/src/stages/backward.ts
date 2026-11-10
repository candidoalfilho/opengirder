/**
 * Fases construtivas de pontes estaiadas — ANÁLISE REGRESSIVA (desmontagem).
 *
 * Parte-se do estado final de projeto: os estais têm os comprimentos indeformados L0 que o
 * form-finding encontrou, e com eles a ponte pronta fica no greide. A ponte é então
 * "desmontada" na ordem inversa da execução (plano em stages/plan.ts): sai a sobrecarga
 * permanente, abre-se o fechamento, e saem um a um os pares aduela + estai, do mais distante
 * para o mais próximo da torre. Cada fase é uma análise NÃO LINEAR completa da estrutura
 * parcial (barras corrotacionais + cabos de catenária), com os MESMOS L0 e a mesma geometria
 * indeformada das barras.
 *
 * O que isso responde: se a obra for montada com os comprimentos de fabricação do estado
 * final, quais são, em cada fase, as trações nos estais, a posição da ponta dos balanços
 * (cota de montagem das aduelas em relação ao greide), o deslocamento e o momento na torre.
 * A tração de um estai na fase em que ele entra é a força de instalação a aplicar no macaco.
 *
 * Hipóteses e limites — ler antes de usar os números:
 *  - SEM fluência, retração nem relaxação: material elástico, sem idade. Em tabuleiros de
 *    concreto os efeitos reológicos redistribuem esforços entre as fases e o estado final.
 *  - Comprimentos de fabricação dos estais = L0 finais (uma única operação de protensão por
 *    estai, sem retensionamento).
 *  - Fechamento ideal: a aduela de fechamento e os apoios extremos entram sem esforço, com as
 *    pontas dos balanços corrigidas para a posição de projeto (macaqueamento). A diferença
 *    entre a ponta livre e o greide, antes do fechamento, está em `tips`.
 *  - Sem cargas de equipamento por padrão (treliça lançadeira, carro de avanço, formas).
 *    `equipment` aplica uma carga vertical concentrada (kN) na ponta de cada balanço.
 *  - Engaste provisório: onde o tabuleiro só se apoia na torre por aparelho de apoio (torre em
 *    X), o aparelho é travado à flexão até a última fase — como o engaste provisório da aduela
 *    de disparo numa obra em balanços sucessivos. `temporaryFixity: false` desliga.
 *  - Os dois lados de cada torre (e os dois tabuleiros gêmeos) avançam ao mesmo tempo.
 */

import type { BridgeModel, Element, LoadCase, NodalLoad, Section } from '../model/types'
import type { StageResult, StagesResult } from '../analysis/types'
import { type BridgeSystem, buildSystem } from '../analysis/system'
import { type StaticSolution, solveStatic } from '../analysis/static'
import { elementStages, stagePlan } from './plan'

export interface StageOptions {
  /** não linearidade geométrica (padrão true) */
  nonlinear?: boolean
  /** carga vertical concentrada na ponta de cada balanço, em kN (padrão 0) */
  equipment?: number
  /** trava à flexão os aparelhos de apoio tabuleiro–torre até a última fase (padrão true) */
  temporaryFixity?: boolean
  onProgress?: (fraction: number) => void
  /** chamado após cada fase resolvida (da última p/ a primeira), com a estrutura parcial no
   *  estado de equilíbrio da fase — usado por timedep/stagesTime.ts p/ a fluência entre fases */
  onStage?: (info: StageHookInfo) => void
}

export interface StageHookInfo {
  k: number
  last: number
  /** modelo parcial da fase e seu sistema, no estado de equilíbrio */
  sub: BridgeModel
  sys: BridgeSystem
  /** fase em que cada elemento é montado */
  stageOf: Map<number, number>
  nonlinear: boolean
  converged: boolean
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const TEMP = '__engaste'

export function runStages(
  model: BridgeModel,
  cableL0: { id: number; L0: number }[],
  opts: StageOptions = {},
): StagesResult {
  const t0 = now()
  const nonlinear = opts.nonlinear ?? true
  const equipment = Math.max(0, opts.equipment ?? 0)
  const tempFix = opts.temporaryFixity ?? true

  // modelo final: estais com os L0 de fabricação
  const l0 = new Map(cableL0.map((c) => [c.id, c.L0]))
  const base: BridgeModel = {
    ...model,
    elements: model.elements.map((e) => {
      if (e.kind !== 'cable') return e
      const L0 = l0.get(e.id)
      if (L0 === undefined) return e
      const { pretension: _drop, ...rest } = e
      return { ...rest, L0 }
    }),
  }
  const plan = stagePlan(base)
  if (!plan || plan.stages.length < 2) {
    throw new Error('não foi possível deduzir a sequência executiva deste modelo (defina `stage` nos elementos).')
  }
  const warnings = [...plan.warnings]
  const stageOf = elementStages(plan)
  const nStages = plan.stages.length
  const last = nStages - 1
  const finish = plan.stages[last].kind === 'finish' ? last : -1

  const nodeIndex = new Map(base.nodes.map((n, i) => [n.id, i]))
  const nNodes = base.nodes.length
  const deckEls = base.elements.filter((e) => e.kind === 'frame' && e.group === 'deck')
  const linkEls = base.elements.filter((e) => e.kind === 'frame' && (e.group === 'crossbeam' || e.group === 'rigid'))
  const deckSecs = new Set(deckEls.map((e) => (e.kind === 'frame' ? e.sec : '')))
  const roots = new Set(plan.roots)

  // ---- seções provisórias: sem sobrecarga permanente; aparelho de apoio travado
  const bare: Section[] = base.sections.map((s) => (deckSecs.has(s.id) && s.extraDead ? { ...s, extraDead: 0 } : s))
  const bearings = new Set<number>()
  const tempSecs: Section[] = []
  if (tempFix) {
    const made = new Set<string>()
    for (const e of base.elements) {
      if (e.kind !== 'frame' || e.group !== 'pier' || (!roots.has(e.n1) && !roots.has(e.n2))) continue
      const sec = base.sections.find((s) => s.id === e.sec)
      if (!sec) continue
      bearings.add(e.id)
      if (!made.has(sec.id)) {
        made.add(sec.id)
        tempSecs.push({
          ...sec, id: sec.id + TEMP, name: `${sec.name} (engaste provisório)`,
          Iy: Math.max(sec.Iy, 8), Iz: Math.max(sec.Iz, 8), J: Math.max(sec.J, 8),
        })
      }
    }
  }

  // ---- torres: componentes conexos das barras de torre com base engastada
  const parent = new Map<number, number>()
  const find = (a: number): number => {
    let r = a
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(a, r)
    return r
  }
  for (const e of base.elements) {
    if (e.kind !== 'frame' || e.group !== 'tower') continue
    for (const nd of [e.n1, e.n2]) if (!parent.has(nd)) parent.set(nd, nd)
    parent.set(find(e.n1), find(e.n2))
  }
  const comps = new Map<number, number[]>()
  for (const nd of parent.keys()) {
    const r = find(nd)
    const l = comps.get(r)
    if (l) l.push(nd)
    else comps.set(r, [nd])
  }
  const towers: { top: number; bases: number[]; x: number }[] = []
  for (const nodes of comps.values()) {
    const idx = nodes.map((id) => nodeIndex.get(id)!).filter((i) => i !== undefined)
    const bases = idx.filter((i) => {
      const f = base.nodes[i].fix
      return !!f && f[0] && f[1] && f[2]
    })
    if (bases.length === 0) continue
    let top = idx[0]
    for (const i of idx) if (base.nodes[i].z > base.nodes[top].z) top = i
    towers.push({ top, bases, x: base.nodes[bases[0]].x })
  }
  towers.sort((a, b) => a.x - b.x)

  /** pontas livres dos balanços na fase k: nós de grau 1 do tabuleiro montado, sem apoio */
  const tipsOf = (k: number): number[] => {
    const deg = new Map<number, number>()
    for (const e of deckEls) {
      if ((stageOf.get(e.id) ?? 0) > k) continue
      deg.set(e.n1, (deg.get(e.n1) ?? 0) + 1)
      deg.set(e.n2, (deg.get(e.n2) ?? 0) + 1)
    }
    const held = new Set<number>()
    const fixed = (id: number): boolean => !!base.nodes[nodeIndex.get(id)!]?.fix?.some(Boolean)
    for (const e of linkEls) {
      if ((stageOf.get(e.id) ?? 0) > k) continue
      if (fixed(e.n2)) held.add(e.n1)
      if (fixed(e.n1)) held.add(e.n2)
    }
    const out: number[] = []
    for (const [nd, d] of deg) if (d === 1 && !roots.has(nd) && !fixed(nd) && !held.has(nd)) out.push(nd)
    return out
  }

  // ---- uma análise por fase, da última para a primeira
  const results: StageResult[] = new Array(nStages)
  let warm: Float64Array | null = null
  for (let k = last; k >= 0; k--) {
    const def = plan.stages[k]
    const building = k < last && def.kind !== 'finish'
    const active = (e: Element): boolean => (stageOf.get(e.id) ?? 0) <= k
    const tips = building && def.kind !== 'closure' ? tipsOf(k) : []
    const elements = base.elements.filter(active).map((e) =>
      building && e.kind === 'frame' && bearings.has(e.id) ? { ...e, sec: e.sec + TEMP } : e,
    )
    const loadCases: LoadCase[] = base.loadCases.length > 0 ? [...base.loadCases] : [{ id: 'G', name: 'Permanente', selfWeight: true }]
    if (equipment > 0 && tips.length > 0) {
      loadCases.push({
        id: 'equip', name: 'Equipamento na ponta do balanço',
        nodal: tips.map((node): NodalLoad => ({ node, F: [0, 0, -equipment, 0, 0, 0] })),
      })
    }
    const sub: BridgeModel = {
      ...base,
      elements,
      sections: [...(finish >= 0 && k < finish ? bare : base.sections), ...(building ? tempSecs : [])],
      loadCases,
    }
    const hidden = base.elements.filter((e) => !active(e)).map((e) => e.id)

    const sys = buildSystem(sub)
    let sol: StaticSolution | null = null
    let error: string | undefined
    const attempt = (u0: Float64Array | null): StaticSolution | null => {
      try {
        return solveStatic(sys, u0, { nonlinear, maxIter: 40 })
      } catch (e) {
        error = (e as Error).message
        return null
      }
    }
    // Tolerância de engenharia: desequilíbrio abaixo de 0,01% do peso da estrutura montada.
    // O critério relativo do solver (1e-8) nem sempre é atingível em estruturas parciais com
    // barras muito curtas e rígidas (ancoragens quase coincidentes na torre).
    let weight = 0
    for (let i = 2; i < sys.fext.length; i += 6) weight += Math.abs(sys.fext[i])
    const good = (x: StaticSolution | null): boolean => !!x && (x.converged || x.residual <= 1e-4 * weight)
    sol = attempt(null)
    if (!good(sol) && warm) {
      // parte do estado da fase seguinte (mesma numeração de nós); GDL fora da fase ficam em zero
      const u0 = Float64Array.from(warm)
      for (let i = 0; i < sys.eq.length; i++) if (sys.eq[i] < 0) u0[i] = 0
      const retry = attempt(u0)
      if (retry && (good(retry) || !sol || retry.residual < sol.residual)) sol = retry
    }

    const r: StageResult = {
      index: k, name: def.name, kind: def.kind, note: def.note,
      added: def.addElements, hidden,
      converged: false, iterations: 0, residual: 0, u: [],
      stays: [], nSlack: 0, Tmax: 0,
      tips: [], uzMax: 0, towers: [], deckNmin: 0,
    }
    if (!sol) {
      r.u = new Array(6 * nNodes).fill(0)
      r.error = error ?? 'a análise não convergiu'
    } else {
      r.converged = good(sol)
      r.iterations = sol.iterations
      r.residual = sol.residual
      if (!r.converged) r.error = `resíduo final de ${sol.residual.toExponential(2)} kN`
      const u = sol.u
      r.u = Array.from(u)
      for (const c of sys.cables) {
        if (c.group !== 'stay') continue
        const T = Math.max(c.st.Ti, c.st.Tj)
        r.stays.push({ id: c.id, T, slack: c.st.slack })
        if (c.st.slack) r.nSlack++
        if (T > r.Tmax) r.Tmax = T
      }
      r.tips = tips.map((node) => ({ node, uz: u[6 * nodeIndex.get(node)! + 2] }))
      for (const f of sys.frames) {
        if (f.group !== 'deck') continue
        if (f.N < r.deckNmin) r.deckNmin = f.N
        for (const i of [f.a, f.b]) {
          const uz = u[6 * i + 2]
          if (Math.abs(uz) > Math.abs(r.uzMax)) r.uzMax = uz
        }
      }
      r.towers = towers.map((t) => {
        let baseM = 0
        for (const i of t.bases) baseM += sol!.fint[6 * i + 4] - sys.fext[6 * i + 4]
        return { topNode: base.nodes[t.top].id, ux: u[6 * t.top], baseM }
      })
      if (r.converged) warm = sol.u
      opts.onStage?.({ k, last, sub, sys, stageOf, nonlinear, converged: r.converged })
    }
    results[k] = r
    opts.onProgress?.((last - k + 1) / nStages)
  }

  // ---- resumo por estai e cotas de montagem
  const fin = results[last]
  const tFinal = new Map(fin.stays.map((s) => [s.id, s.T]))
  const stays: StagesResult['stays'] = []
  for (const e of base.elements) {
    if (e.kind !== 'cable' || e.group !== 'stay') continue
    const st = stageOf.get(e.id) ?? 0
    const at = results[st].stays.find((s) => s.id === e.id)
    stays.push({ id: e.id, stage: st, Tinstall: at?.T ?? 0, Tfinal: tFinal.get(e.id) ?? 0 })
  }
  const born = new Map<number, number>()
  for (const e of deckEls) {
    const st = stageOf.get(e.id) ?? 0
    for (const nd of [e.n1, e.n2]) born.set(nd, Math.min(born.get(nd) ?? Infinity, st))
  }
  const erection: StagesResult['erection'] = []
  for (const [node, stage] of born) {
    const i = nodeIndex.get(node)
    if (i === undefined) continue
    erection.push({ node, stage, uz: results[stage].u[6 * i + 2] ?? 0 })
  }

  // balanços desequilibrados: a torre trabalha sozinha em flexão até o fechamento
  let worst = { k: -1, ratio: 0, ux: 0 }
  for (const r of results) {
    if (r.index === last) continue
    r.towers.forEach((t, i) => {
      const tw = towers[i]
      const H = base.nodes[tw.top].z - Math.min(...tw.bases.map((b) => base.nodes[b].z))
      const ratio = H > 0 ? Math.abs(t.ux) / H : 0
      if (ratio > worst.ratio) worst = { k: r.index, ratio, ux: t.ux }
    })
  }
  if (worst.ratio > 1 / 300) {
    warnings.push(
      `Fases construtivas: na fase ${worst.k} o topo da torre desloca ${(1000 * Math.abs(worst.ux)).toFixed(0)} mm ` +
        `(H/${(1 / worst.ratio).toFixed(0)}) — os balanços dos dois lados não se equilibram com os comprimentos finais dos ` +
        'estais; na obra isso pede apoios ou estais provisórios, ou retensionamento.',
    )
  }

  const failed = results.filter((r) => !r.converged)
  if (failed.length > 0) {
    warnings.push(`Fases construtivas: ${failed.length} fase(s) sem convergência (${failed.map((r) => r.index).join(', ')}).`)
  }
  const slack = results.filter((r) => r.nSlack > 0)
  if (slack.length > 0) {
    warnings.push(`Fases construtivas: estais frouxos em ${slack.length} fase(s) (${slack.map((r) => r.index).join(', ')}).`)
  }
  return { stages: results, stays, erection, equipment, temporaryFixity: bearings.size > 0, warnings, elapsed: Math.round(now() - t0) }
}
