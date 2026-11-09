/**
 * Protensão do tabuleiro — orquestração.
 *
 * `runPrestress(ctx)` (marcador [ext:casos] de analyze.ts): para cada `model.tendons`, calcula as
 * perdas e resolve o caso linear 'P' (protensão em t = ∞) sobre a tangente do estado
 * permanente. A sequência segue a obra:
 *   1. atrito + acomodação da ancoragem                     → P após a cravação;
 *   2. caso com essa força + peso próprio → tensão no concreto junto ao cabo → perda por
 *      encurtamento elástico                                → P0;
 *   3. caso com P0 + carga permanente → perdas progressivas → P∞;
 *   4. caso com P∞                                          → caso 'P' das combinações.
 *
 * A protensão NÃO altera o peso nem o estado permanente G: é um caso linear separado, que as
 * combinações somam. O momento do caso já é o total (isostático −P·e + hiperestático).
 *
 * `runPrestressChecks(ctx)` (marcador [ext:verificacoes], depois das combinações): tensões
 * normais nas fibras extremas no ato da protensão e em serviço — ver checks.ts.
 */

import type { Vec3 } from '../model/types'
import type { AnalysisContext } from '../analysis/context'
import type { BridgeResults, EnvForces, FrameForces, LimitState, PrestressAtFrame } from '../analysis/types'
import type { LinearState } from '../analysis/linear'
import type { PrestressCheck, PrestressSection, Tendon, TendonData, TendonResult, TendonStress } from './types'
import { tendonData } from './types'
import { type TendonProfile, buildProfile } from './profile'
import { elasticShorteningLoss, immediateLosses, progressiveLoss } from './losses'
import { type TendonPath, addEquivalentLoads, alongPath, segActive, tendonPath } from './equivalent'
import { type NMEnv, fibreStress, serviceLimits } from './checks'

export * from './types'
export { buildProfile, autoProfile, type TendonProfile } from './profile'
export { frictionForce, anchorageSlip, immediateLosses, elasticShorteningLoss, progressiveLoss, psi1000RB } from './losses'
export { tendonPath, addEquivalentLoads, alongPath, type TendonPath } from './equivalent'
export { fctm, fibreStress, serviceLimits } from './checks'
export { designTendon, refineTendons, deckPrestressSection, type TendonDesignOptions } from './design'

interface Item {
  tendon: Tendon
  td: TendonData
  path: TendonPath
  profile: TendonProfile
  sec: PrestressSection
  /** parcela do peso próprio na carga permanente do tabuleiro (0–1) */
  swRatio: number
  /** nó do caminho dentro do traçado? */
  active: boolean[]
  e: number[]
  P0: number[]
  Pinf: number[]
  /** N e Mz nos nós do caminho, do caso com P0 e do caso com P∞ */
  f0: { N: number[]; Mz: number[] }
  fInf: { N: number[]; Mz: number[] }
}

const internals = new WeakMap<BridgeResults, Item[]>()

/** seção de concreto vista pela protensão, a partir da barra `frame` (índice em sys.frames) */
function sectionOf(ctx: AnalysisContext, frame: number): { sec: PrestressSection; swRatio: number } {
  const model = ctx.model
  const el = model.elements.find((e) => e.id === ctx.sys.frames[frame].id)
  const s = el && el.kind === 'frame' ? model.sections.find((q) => q.id === el.sec) : undefined
  const m = el ? model.materials.find((q) => q.id === el.mat) : undefined
  if (!s || !m) throw new Error('seção ou material do tabuleiro não encontrados')
  const depth = s.depth && s.depth > 0 ? s.depth : 2 * Math.sqrt((3 * s.Iz) / s.A)
  const sw = m.gamma * s.A
  return {
    sec: {
      A: s.A, I: s.Iz,
      yTop: s.yTop && s.yTop > 0 ? s.yTop : depth / 2,
      yBot: s.yBot && s.yBot > 0 ? s.yBot : depth / 2,
      Ec: m.E,
      fck: m.fck && m.fck > 0 ? m.fck : 40e3,
    },
    swRatio: sw + (s.extraDead ?? 0) > 0 ? sw / (sw + (s.extraDead ?? 0)) : 1,
  }
}

function solveTendons(ctx: AnalysisContext, items: Item[], P: (it: Item) => number[]): LinearState {
  const load = { nodal: new Float64Array(6 * ctx.sys.nNodes), uniform: new Map<number, Vec3>() }
  for (const it of items) addEquivalentLoads(ctx.sys, it.path, it.profile, P(it), load)
  return ctx.lin.solve(load)
}

const mean = (v: number[], on: boolean[]): number => {
  let s = 0
  let n = 0
  v.forEach((x, i) => {
    if (on[i]) {
      s += x
      n++
    }
  })
  return n ? s / n : 0
}

export function runPrestress(ctx: AnalysisContext): void {
  const tendons = (ctx.model.tendons ?? []).filter((t) => t.nStrands > 0 && (t.profile?.length ?? 0) >= 2)
  if (tendons.length === 0) return
  ctx.progress('Protensão', 0.96)
  const { sys, res } = ctx

  const items: Item[] = []
  const stage: { Panc: number[]; Pjack: number[]; slipLength: [number, number]; elongation: number }[] = []
  for (const tendon of tendons) {
    const path = tendonPath(sys, tendon)
    const profile = buildProfile(tendon.profile, tendon.inflection)
    const td = tendonData(tendon)
    const first = path.segs.findIndex((_, k) => segActive(path, profile, k))
    if (first < 0) {
      ctx.warnings.push(`Cabo de protensão "${tendon.name ?? tendon.id}": o traçado não cobre nenhuma barra do caminho.`)
      continue
    }
    const { sec, swRatio } = sectionOf(ctx, path.segs[first].frame)
    const n = path.s.length
    const active = path.s.map((_, k) => (k > 0 && segActive(path, profile, k - 1)) || (k < n - 1 && segActive(path, profile, k)))
    const idx = active.map((a, k) => (a ? k : -1)).filter((k) => k >= 0)
    const im = immediateLosses(idx.map((k) => path.s[k]), profile, td)
    const spread = (v: number[]): number[] => {
      const out = new Array<number>(n).fill(0)
      idx.forEach((k, j) => (out[k] = v[j]))
      return out
    }
    stage.push({ Panc: spread(im.P), Pjack: spread(im.Pjack), slipLength: im.slipLength, elongation: im.elongation })
    items.push({
      tendon, td, path, profile, sec, swRatio, active,
      e: path.s.map((s, k) => (active[k] ? profile.e(s) : 0)),
      P0: [], Pinf: [], f0: { N: [], Mz: [] }, fInf: { N: [], Mz: [] },
    })
    const emax = Math.max(...path.s.map((s, k) => (active[k] ? profile.e(s) : 0)))
    const emin = Math.min(...path.s.map((s, k) => (active[k] ? profile.e(s) : 0)))
    if (emax > sec.yBot + 1e-6 || -emin > sec.yTop + 1e-6) {
      ctx.warnings.push(`Cabo de protensão "${tendon.name ?? tendon.id}": o traçado sai da seção de concreto.`)
    }
    if (td.sigmaPi > Math.min(0.74 * td.fptk, 0.82 * td.fpyk) * 1.0001) {
      ctx.warnings.push(
        `Cabo de protensão "${tendon.name ?? tendon.id}": σpi acima do limite da NBR 6118 9.6.1.2.1 ` +
          '(0,74·fptk e 0,82·fpyk na pós-tração com aço RB).',
      )
    }
  }
  if (items.length === 0) return

  const dead = res.deadLoad.frames
  /** tensão no concreto no nível do cabo (kPa, compressão +) p/ o caso `f` + fração `g` de G */
  const sigmaC = (it: Item, f: { N: number[]; Mz: number[] }, G: { N: number[]; Mz: number[] }, g: number, k: number): number =>
    -(f.N[k] + g * G.N[k]) / it.sec.A - ((f.Mz[k] + g * G.Mz[k]) * it.e[k]) / it.sec.I

  // 2. encurtamento elástico (peso próprio mobilizado)
  let st = solveTendons(ctx, items, (it) => stage[items.indexOf(it)].Panc)
  items.forEach((it, i) => {
    const f = alongPath(it.path, st.frames)
    const G = alongPath(it.path, dead)
    it.P0 = stage[i].Panc.map((p, k) => (it.active[k] ? Math.max(0, p - elasticShorteningLoss(sigmaC(it, f, G, it.swRatio, k), it.td, it.sec)) : 0))
  })
  // 3. perdas progressivas (carga permanente total)
  st = solveTendons(ctx, items, (it) => it.P0)
  items.forEach((it) => {
    it.f0 = alongPath(it.path, st.frames)
    const G = alongPath(it.path, dead)
    it.Pinf = it.P0.map((p, k) => (it.active[k] ? p - progressiveLoss(p, it.e[k], sigmaC(it, it.f0, G, 1, k), it.td, it.sec) : 0))
  })
  // 4. caso final
  st = solveTendons(ctx, items, (it) => it.Pinf)
  items.forEach((it) => (it.fInf = alongPath(it.path, st.frames)))

  // ---- resultados
  const atFrames: (PrestressAtFrame | null)[] = new Array(sys.frames.length).fill(null)
  const tendonsOut: TendonResult[] = items.map((it, i) => {
    const { path, profile, td } = it
    path.segs.forEach((seg, k) => {
      if (!segActive(path, profile, k)) return
      const Pm = 0.5 * (it.Pinf[k] + it.Pinf[k + 1])
      const em = profile.e(0.5 * (path.s[k] + path.s[k + 1]))
      let P: [number, number, number] = [it.Pinf[k], Pm, it.Pinf[k + 1]]
      let e: [number, number, number] = [it.e[k], em, it.e[k + 1]]
      if (seg.flip) {
        P = [P[2], P[1], P[0]]
        e = [e[2], e[1], e[0]]
      }
      const cur = atFrames[seg.frame]
      if (!cur) {
        atFrames[seg.frame] = { Ap: [td.Ap, td.Ap, td.Ap], e, P }
      } else {
        // vários cabos na mesma barra: soma as forças; excentricidade ponderada pela força
        for (let q = 0; q < 3; q++) {
          const Pt = cur.P[q] + P[q]
          cur.e[q] = Pt > 0 ? (cur.e[q] * cur.P[q] + e[q] * P[q]) / Pt : 0
          cur.P[q] = Pt
          cur.Ap[q] += td.Ap
        }
      }
    })
    const supports: number[] = []
    path.nodes.forEach((nd, k) => {
      if (sys.model.nodes[nd].fix?.[2]) supports.push(path.s[k])
    })
    const Miso = it.Pinf.map((p, k) => -p * it.e[k])
    // com vários cabos, o momento total é do conjunto: o hiperestático só é separável p/ um cabo
    const Mtot = it.fInf.Mz.slice()
    const pct = (v: number[]): number => (td.Pi > 0 ? 100 * (1 - mean(v, it.active) / td.Pi) : 0)
    return {
      id: it.tendon.id,
      name: it.tendon.name ?? `Cabo ${it.tendon.id}`,
      nStrands: it.tendon.nStrands,
      Ap: td.Ap, sigmaPi: td.sigmaPi, Pi: td.Pi,
      s: path.s.slice(), e: it.e.slice(),
      yTop: it.sec.yTop, yBot: it.sec.yBot,
      supports,
      Pjack: stage[i].Pjack, Panc: stage[i].Panc, P0: it.P0.slice(), Pinf: it.Pinf.slice(),
      lossImmediatePct: pct(it.P0),
      lossProgressivePct: pct(it.Pinf) - pct(it.P0),
      lossTotalPct: pct(it.Pinf),
      slipLength: stage[i].slipLength,
      elongation: stage[i].elongation,
      totalAngle: profile.totalAngle,
      Miso, Mtot,
      Mhyp: items.length === 1 ? Mtot.map((m, k) => m - Miso[k]) : Mtot.map(() => 0),
    }
  })

  for (const t of tendonsOut) {
    if (t.lossImmediatePct > 22) {
      ctx.warnings.push(
        `Cabo de protensão "${t.name}": perdas imediatas de ${t.lossImmediatePct.toFixed(0)}% — cabo longo e com muitas curvas ` +
          `(Σα = ${((t.totalAngle * 180) / Math.PI).toFixed(0)}°). Em obra, usa-se protensão por tramos com emendas ou cabos mais curtos.`,
      )
    }
  }
  res.prestress = { atFrames, tendons: tendonsOut }
  internals.set(res, items)
  const Pi = tendonsOut.reduce((a, t) => a + t.Pi, 0)
  const Pinf = items.reduce((a, it) => a + mean(it.Pinf, it.active), 0)
  ctx.cases.push({
    id: 'P',
    name: 'Protensão (t = ∞)',
    kind: 'prestress',
    sign: 'fixed',
    ...st,
    info: [
      { label: 'Força inicial no macaco Pi', value: Pi, unit: 'kN' },
      { label: 'Força média após todas as perdas P∞', value: Pinf, unit: 'kN' },
      { label: 'Perda total média', value: Pi > 0 ? 100 * (1 - Pinf / Pi) : 0, unit: '%' },
    ],
  })
  ctx.lap('protensao')
}

/* ------------------------------------------------------------------ verificações */

const PSI1 = 0.5
const PSI2 = 0.3

function envAt(path: TendonPath, k: number, frames: { N: { min: number[]; max: number[] }; Mz: { min: number[]; max: number[] } }[]): NMEnv {
  const n = path.segs.length
  const seg = path.segs[Math.min(k, n - 1)]
  const st = (k < n) !== seg.flip ? 0 : 2
  const f = frames[seg.frame]
  return { Nmin: f.N.min[st], Nmax: f.N.max[st], Mmin: f.Mz.min[st], Mmax: f.Mz.max[st] }
}

export function runPrestressChecks(ctx: AnalysisContext): void {
  const res = ctx.res
  const items = internals.get(res)
  if (!items || !res.prestress) return
  const dead: FrameForces[] = res.deadLoad.frames
  const combos = res.combos
  const mv = res.moving?.frames
  const hasP = (limit: LimitState): boolean =>
    !!combos && combos.list.some((c) => c.limit === limit && (c.factors.P ?? 0) !== 0)

  const checks: PrestressCheck[] = []
  res.prestress.tendons?.forEach((tr, i) => {
    const it = items[i]
    const { path, sec } = it
    const n = path.s.length
    const G = alongPath(path, dead)
    const fckj = it.tendon.fckj && it.tendon.fckj > 0 ? it.tendon.fckj : sec.fck
    const lim = serviceLimits(sec.fck, fckj)
    const level = it.tendon.level ?? 'limitada'

    /** envoltória de serviço no nó k: das combinações (somando P se elas não a incluem) ou G + ψ·Q + P */
    const service = (k: number, limit: LimitState, pick: (f: { elsQp: EnvForces; elsFreq: EnvForces; elsRare: EnvForces }) => EnvForces, psi: number): NMEnv => {
      let v: NMEnv
      let addP = true
      if (combos) {
        v = envAt(path, k, combos.frames.map(pick))
        addP = !hasP(limit)
      } else {
        v = { Nmin: G.N[k], Nmax: G.N[k], Mmin: G.Mz[k], Mmax: G.Mz[k] }
        if (mv) {
          const q = envAt(path, k, mv)
          v = { Nmin: v.Nmin + psi * q.Nmin, Nmax: v.Nmax + psi * q.Nmax, Mmin: v.Mmin + psi * q.Mmin, Mmax: v.Mmax + psi * q.Mmax }
        }
      }
      if (addP) {
        v = { Nmin: v.Nmin + it.fInf.N[k], Nmax: v.Nmax + it.fInf.N[k], Mmin: v.Mmin + it.fInf.Mz[k], Mmax: v.Mmax + it.fInf.Mz[k] }
      }
      return v
    }

    const situations: { key: TendonStress['key']; label: string; env: (k: number) => NMEnv; P: { N: number[]; Mz: number[] }; gp: number }[] = [
      {
        key: 'transfer', label: 'Ato da protensão (1,1·P0 + peso próprio)', gp: 1.1, P: it.f0,
        env: (k) => {
          const N = 1.1 * it.f0.N[k] + it.swRatio * G.N[k]
          const M = 1.1 * it.f0.Mz[k] + it.swRatio * G.Mz[k]
          return { Nmin: N, Nmax: N, Mmin: M, Mmax: M }
        },
      },
      { key: 'qp', label: 'Quase permanente', gp: 1, P: it.fInf, env: (k) => service(k, 'ELS-QP', (f) => f.elsQp, PSI2) },
      { key: 'freq', label: 'Frequente', gp: 1, P: it.fInf, env: (k) => service(k, 'ELS-F', (f) => f.elsFreq, PSI1) },
      { key: 'rare', label: 'Rara', gp: 1, P: it.fInf, env: (k) => service(k, 'ELS-R', (f) => f.elsRare, 1) },
    ]
    const stress: TendonStress[] = situations.map((sit) => {
      const out: TendonStress = { key: sit.key, label: sit.label, topMin: [], topMax: [], botMin: [], botMax: [] }
      for (let k = 0; k < n; k++) {
        const f = fibreStress(sec, sit.env(k))
        out.topMin.push(f.topMin)
        out.topMax.push(f.topMax)
        out.botMin.push(f.botMin)
        out.botMax.push(f.botMax)
      }
      return out
    })
    tr.stress = stress

    const add = (
      key: PrestressCheck['key'], name: string, clause: string, sitKey: TendonStress['key'],
      kind: 'tension' | 'compression', limit: number, informative = false,
    ): void => {
      const sit = situations.find((q) => q.key === sitKey)!
      const st = stress.find((q) => q.key === sitKey)!
      let best = -Infinity
      let kBest = 0
      let fibre: 'superior' | 'inferior' = 'superior'
      for (let k = 0; k < n; k++) {
        if (!it.active[k]) continue
        const top = kind === 'tension' ? st.topMax[k] : -st.topMin[k]
        const bot = kind === 'tension' ? st.botMax[k] : -st.botMin[k]
        if (top > best) {
          best = top
          kBest = k
          fibre = 'superior'
        }
        if (bot > best) {
          best = bot
          kBest = k
          fibre = 'inferior'
        }
      }
      if (!Number.isFinite(best)) return
      const fp = fibreStress(sec, {
        Nmin: sit.gp * sit.P.N[kBest], Nmax: sit.gp * sit.P.N[kBest],
        Mmin: sit.gp * sit.P.Mz[kBest], Mmax: sit.gp * sit.P.Mz[kBest],
      })
      const value = kind === 'tension' ? best : -best
      checks.push({
        tendon: tr.id, key, name, clause, combo: sit.label, kind, fibre,
        s: path.s[kBest], value,
        limit: kind === 'tension' ? limit : -limit,
        sigmaP: fibre === 'superior' ? fp.topMax : fp.botMax,
        ok: best <= limit + 1e-6 * Math.max(1, Math.abs(limit)),
        ...(informative ? { informative: true } : {}),
      })
    }
    add('transfer-c', 'Ato da protensão — compressão ≤ 0,7·fckj', 'NBR 6118 17.2.4.3.2-a', 'transfer', 'compression', lim.compTransfer)
    add('transfer-t', 'Ato da protensão — tração ≤ 1,2·fctm', 'NBR 6118 17.2.4.3.2-b', 'transfer', 'tension', lim.tensTransfer)
    add('els-d', 'ELS-D — descompressão (sem tração)', 'NBR 6118 Tabela 13.4', level === 'completa' ? 'freq' : 'qp', 'tension', 0)
    add('els-f', 'ELS-F — formação de fissuras (tração ≤ fct,f)', 'NBR 6118 Tabela 13.4 e 17.3.1', level === 'completa' ? 'rare' : 'freq', 'tension', lim.fctF)
    add('service-c', 'Compressão em serviço ≤ 0,6·fck', 'EN 1992-1-1 7.2(2) — referência', 'rare', 'compression', lim.compService, true)
  })

  res.prestress.checks = checks
  res.prestress.ok = checks.every((c) => c.ok || c.informative)
  const fails = checks.filter((c) => !c.ok && !c.informative)
  if (fails.length > 0) {
    ctx.warnings.push(
      `Protensão: ${fails.length} verificação(ões) de tensões não atendida(s) — ` +
        `${fails.map((c) => c.name.split(' — ')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}. Veja a aba Protensão.`,
    )
  }
  ctx.lap('protensaoVerif')
}
