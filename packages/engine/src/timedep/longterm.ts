/**
 * Efeitos diferidos na obra pronta: fluência e retração do concreto de t0 (entrada da carga
 * permanente) até t∞, pelo método do módulo efetivo ajustado pela idade (timedep/aaem.ts).
 *
 * Para cada instante de saída faz-se UM passo AAEM de t0 até ele, com φ(t, t0) e εcs(t, t0)
 * do Anexo A da NBR 6118 por seção (espessura fictícia de cada uma) — os instantes são
 * independentes entre si. Esforços sustentados = carga permanente + protensão (caso 'P', se
 * houver). O estado em t∞ vira o caso de carga 'CS' (`kind: 'creep'`), que entra nas
 * combinações como ação permanente indireta (NBR 8681: γ = 1,2 desfavorável e 0 favorável no
 * ELU; nos ELS, com e sem o efeito — a envoltória cobre a obra nova e a obra em t∞).
 *
 * Hipóteses: todo o concreto tem a mesma idade t0 ao ser carregado (a história da execução
 * fica em timedep/stagesTime.ts); a retração é contada a partir de t0; aço, cabos e seções
 * mistas homogeneizadas em aço não fluem; a perda de protensão por fluência/retração é
 * calculada à parte (prestress/losses.ts) e não é realimentada aqui.
 */

import type { AnalysisContext } from '../analysis/context'
import type { FrameForces, LoadCaseResult, LongTermInstant, LongTermResult } from '../analysis/types'
import type { BridgeModel } from '../model/types'
import type { BridgeSystem } from '../analysis/system'
import { type CreepStepResult, type FrameCreep, creepStep } from './aaem'
import { creepCoefficient, shrinkageStrain } from './nbr6118a'
import { type LongTermParams, type SectionRheology, resolveLongTerm, sectionRheology } from './params'

type V3 = [number, number, number]
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

/** soma esforços de dois estados (mesma ordem de barras) */
export function addFrameForces(a: FrameForces[], b: FrameForces[] | undefined): FrameForces[] {
  if (!b) return a
  return a.map((f, i) => {
    const g = b[i]
    if (!g) return f
    return { id: f.id, L: f.L, N: add3(f.N, g.N), Vy: add3(f.Vy, g.Vy), Vz: add3(f.Vz, g.Vz), T: add3(f.T, g.T), My: add3(f.My, g.My), Mz: add3(f.Mz, g.Mz) }
  })
}

/** chave (seção|material) de cada barra do sistema, '' se não for de concreto com reologia */
export function frameRheology(sys: BridgeSystem, model: BridgeModel, rheo: Map<string, SectionRheology>): (SectionRheology | null)[] {
  const byId = new Map(model.elements.map((e) => [e.id, e]))
  return sys.frames.map((f) => {
    const e = byId.get(f.id)
    return e && e.kind === 'frame' ? (rheo.get(`${e.sec}|${e.mat}`) ?? null) : null
  })
}

/** instantes de saída entre t0 e t∞ (escala aproximadamente logarítmica) */
export function outputTimes(p: LongTermParams): number[] {
  const out = [p.t0 + 30, p.t0 + 90, p.t0 + 365, p.t0 + 3 * 365, p.t0 + 10 * 365].filter((t) => t < 0.9 * p.tInf)
  out.push(p.tInf)
  return out
}

export function runLongTerm(ctx: AnalysisContext): void {
  const { model, sys, res, nonlinear } = ctx
  const p = resolveLongTerm(model)
  if (!p) return
  const rheo = sectionRheology(model, p)
  if (rheo.size === 0) return
  ctx.progress('Fluência e retração', 0.965)
  const perFrame = frameRheology(sys, model, rheo)
  const prestress = (ctx.cases.find((c) => c.kind === 'prestress' && c.id === 'P') ?? ctx.cases.find((c) => c.kind === 'prestress'))?.frames
  const sustained = addFrameForces(res.deadLoad.frames, prestress)

  // seção de referência p/ as curvas: a de mais barras, de preferência do tabuleiro
  const groupOf = new Map<string, Set<string>>()
  const byId = new Map(model.elements.map((e) => [e.id, e]))
  for (const f of sys.frames) {
    const e = byId.get(f.id)
    if (!e || e.kind !== 'frame') continue
    const k = `${e.sec}|${e.mat}`
    const g = groupOf.get(k) ?? new Set<string>()
    g.add(f.group ?? '')
    groupOf.set(k, g)
  }
  const list = [...rheo.entries()]
  list.sort((a, b) => Number(groupOf.get(b[0])?.has('deck')) - Number(groupOf.get(a[0])?.has('deck')) || b[1].nFrames - a[1].nFrames)
  const ref = list[0][1]

  const deckNodes = new Set<number>()
  const towerNodes = new Set<number>()
  for (const f of sys.frames) {
    if (f.group === 'deck') {
      deckNodes.add(f.a)
      deckNodes.add(f.b)
    } else if (f.group === 'tower' || f.group === 'pier') {
      towerNodes.add(f.a)
      towerNodes.add(f.b)
    }
  }

  const step = (t: number): CreepStepResult => {
    const creep: (FrameCreep | null)[] = perFrame.map((r) =>
      r ? { phi: creepCoefficient(r.rheo, t, p.t0), epsCs: shrinkageStrain(r.rheo, t, p.t0) } : null,
    )
    return creepStep(sys, sustained, creep, nonlinear, p.chi)
  }
  const instants: LongTermInstant[] = []
  let last: CreepStepResult | null = null
  for (const t of outputTimes(p)) {
    const st = step(t)
    last = st
    let uzDeck = 0
    let uzNode = -1
    for (const i of deckNodes) {
      const v = st.u[6 * i + 2]
      if (Math.abs(v) > Math.abs(uzDeck)) {
        uzDeck = v
        uzNode = model.nodes[i].id
      }
    }
    let uzTower = 0
    for (const i of towerNodes) {
      const v = st.u[6 * i + 2]
      if (Math.abs(v) > Math.abs(uzTower)) uzTower = v
    }
    let lo = 0
    let hi = 0
    for (const c of st.cables) {
      if (c.dT < lo) lo = c.dT
      if (c.dT > hi) hi = c.dT
    }
    instants.push({ t, phi: creepCoefficient(ref.rheo, t, p.t0), epsCs: shrinkageStrain(ref.rheo, t, p.t0), uzDeck, uzNode, dT: [lo, hi], uzTower })
  }
  if (!last) return
  if (last.kgReduced) {
    ctx.warnings.push(
      'Efeitos diferidos: com o módulo do concreto reduzido pela fluência, a rigidez sob a carga permanente deixa de ser ' +
        'positiva (risco de instabilidade por fluência); a parcela de compressão da rigidez geométrica foi descartada no cálculo.',
    )
  }

  const fin = instants[instants.length - 1]
  const cs: LoadCaseResult = {
    id: 'CS',
    name: 'Fluência e retração (t = ∞)',
    kind: 'creep',
    sign: 'fixed',
    u: last.u,
    frames: last.frames,
    cables: last.cables,
    reactions: last.reactions,
    info: [
      { label: 'Umidade relativa', value: p.humidity, unit: '%' },
      { label: 'Idade do concreto no carregamento t0', value: p.t0, unit: 'dias' },
      { label: `Coeficiente de fluência φ(t∞, t0) — ${ref.name}`, value: fin.phi, unit: '' },
      { label: `Retração εcs(t∞, t0) — ${ref.name}`, value: fin.epsCs * 1000, unit: '‰' },
      { label: 'Coeficiente de envelhecimento χ', value: p.chi, unit: '' },
    ],
  }
  ctx.cases.push(cs)

  // curvas da seção de referência
  const ct: number[] = []
  const cphi: number[] = []
  const ceps: number[] = []
  const n = 40
  for (let i = 0; i <= n; i++) {
    const t = p.t0 * Math.pow(p.tInf / p.t0, i / n)
    ct.push(t)
    cphi.push(i === 0 ? 0 : creepCoefficient(ref.rheo, t, p.t0))
    ceps.push(i === 0 ? 0 : shrinkageStrain(ref.rheo, t, p.t0))
  }

  let cableChange: [number, number] | undefined
  if (last.cables.length > 0) {
    let lo = 0
    let hi = 0
    last.cables.forEach((c, i) => {
      const d = res.deadLoad.cables[i]
      const T = d ? Math.max(d.Ti, d.Tj) : 0
      if (!(T > 0)) return
      const r = c.dT / T
      if (r < lo) lo = r
      if (r > hi) hi = r
    })
    cableChange = [lo, hi]
  }

  const out: LongTermResult = {
    params: { humidity: p.humidity, t0: p.t0, tInf: p.tInf, cement: p.cement, slump: p.slump, temperature: p.temperature, chi: p.chi },
    sections: [...rheo.values()].map(({ rheo: _r, ...s }) => s),
    instants,
    curve: { t: ct, phi: cphi, epsCs: ceps },
    caseId: cs.id,
    cableChange,
  }
  res.longTerm = out
  ctx.lap('efeitosDiferidos')
}
