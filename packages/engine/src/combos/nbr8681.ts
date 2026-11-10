/**
 * Combinações de ações — ABNT NBR 8681 (Ações e segurança nas estruturas).
 *
 * Coeficientes (edição de 2003, conferidos em fontes públicas — docs/normas.md; a edição de
 * 2025 não foi conferida):
 *  - permanentes agrupadas, "pontes em geral" (Tabela 2): γg = 1,35 desfavorável / 1,0 favorável;
 *    excepcional 1,15 / 1,0. "Grandes pontes" (peso próprio > 75 % das permanentes) poderiam
 *    usar 1,30 / 1,10; aqui vale sempre o valor de pontes em geral, a favor da segurança;
 *  - protensão: γp = 1,2 desfavorável / 0,9 favorável no ELU; 1,0 nos ELS;
 *  - variáveis em separado (Tabela 4): carga móvel γq = 1,5; vento 1,4; temperatura γε = 1,2;
 *  - fatores de combinação e redução (Tabela 6):
 *        carga móvel de pontes rodoviárias  ψ0 = 0,7  ψ1 = 0,5  ψ2 = 0,3
 *        carga móvel de passarelas          ψ0 = 0,6  ψ1 = 0,4  ψ2 = 0,3
 *        vento                              ψ0 = 0,6  ψ1 = 0,3  ψ2 = 0
 *        temperatura                        ψ0 = 0,6  ψ1 = 0,5  ψ2 = 0,3
 *
 * Combinações geradas (cada ação variável como principal):
 *  - ELU normal (5.1.3.1):      γg·G + γp·P + γq1·Q1 + Σ γqj·ψ0j·Qj
 *  - ELU excepcional (5.1.3.3): γg·G + γp·P + E + ψ2·Q         (sismo, se houver caso 'seismic')
 *  - ELS rara (5.1.5.3):        G + P + Q1 + Σ ψ1j·Qj
 *  - ELS frequente (5.1.5.2):   G + P + ψ1·Q1 + Σ ψ2j·Qj
 *  - ELS quase permanente:      G + P + Σ ψ2j·Qj
 *
 * Regras de concomitância:
 *  - a frenagem ('FR') acompanha a carga móvel com os mesmos fatores;
 *  - vento com a ponte descarregada ('W') nunca entra com carga móvel; o vento com tráfego
 *    ('WT') só entra junto com ela;
 *  - casos de temperatura que diferem só pelo sinal final do id (TU+/TU−, TG+/TG−, TC+/TC−)
 *    são alternativas: de cada par entra no máximo um; os pares somam-se entre si (sem os
 *    fatores de simultaneidade ω da EN 1991-1-5 — a favor da segurança);
 *  - casos com `sign: 'both'` entram com o sinal mais desfavorável p/ cada resposta;
 *  - toda ação variável só entra onde é desfavorável (envoltória por resposta).
 *
 * Hipóteses:
 *  - O estado permanente é não linear e já está em equilíbrio; γg multiplica o ESFORÇO
 *    permanente de cada resposta (1,35 ou 1,0, o que for pior), não a carga — linearização
 *    usual em estaiadas e pênseis, onde majorar o peso sem reajustar os cabos não tem sentido.
 *  - As envoltórias são por esforço: máximos de esforços diferentes não são concomitantes.
 *    Só `NatMz` guarda a força normal concomitante com o Mz extremo do ELU — e nela a parcela
 *    da carga móvel é desconhecida (a envoltória de linhas de influência não guarda
 *    concomitantes) e entra como zero.
 *  - O ELU excepcional (sismo) entra na mesma envoltória `elu`.
 */

import type {
  CombinationDef,
  CombinationResult,
  EnvForces,
  Env3,
  LimitState,
  LoadCaseResult,
  Reaction,
} from '../analysis/types'
import type { AnalysisContext } from '../analysis/context'

export const GAMMA = {
  gUnfav: 1.35,
  gFav: 1.0,
  gExcUnfav: 1.15,
  pUnfav: 1.2,
  pFav: 0.9,
  moving: 1.5,
  wind: 1.4,
  temperature: 1.2,
  other: 1.5,
  /** recalques e demais ações permanentes indiretas: 1,2 desfavorável / 0 favorável */
  settlement: 1.2,
}

export const PSI: Record<'moving' | 'pedestrian' | 'wind' | 'temperature' | 'other', [number, number, number]> = {
  moving: [0.7, 0.5, 0.3],
  /** passarelas de pedestres (Tabela 6) — usado quando a carga móvel é a multidão */
  pedestrian: [0.6, 0.4, 0.3],
  wind: [0.6, 0.3, 0],
  temperature: [0.6, 0.5, 0.3],
  other: [0.7, 0.6, 0.4],
}

const NF = 18

/** contribuição de uma família de ações a cada resposta: [mín ≤ 0, máx ≥ 0] e N concomitante */
interface Family {
  key: 'Q' | 'WT' | 'W' | 'T' | 'O' | 'E'
  max: Float64Array
  min: Float64Array
  /** N concomitante com a contribuição máx./mín. de Mz (3 por barra) */
  natMax: Float64Array
  natMin: Float64Array
  /** ids dos casos que compõem a família (p/ a lista de combinações) */
  ids: string[]
}

interface Layout {
  nFr: number
  nCb: number
  nNd: number
  nSup: number
  offC: number
  offU: number
  offR: number
  nR: number
  supSlot: Map<number, number>
}

const COMPS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'] as const

function caseVector(c: LoadCaseResult, lay: Layout): Float64Array {
  const v = new Float64Array(lay.nR)
  const n = Math.min(lay.nFr, c.frames.length)
  for (let e = 0; e < n; e++) {
    const f = c.frames[e]
    const o = e * NF
    for (let k = 0; k < 6; k++) {
      const t = f[COMPS[k]]
      v[o + 3 * k] = t[0]
      v[o + 3 * k + 1] = t[1]
      v[o + 3 * k + 2] = t[2]
    }
  }
  const nc = Math.min(lay.nCb, c.cables.length)
  for (let i = 0; i < nc; i++) v[lay.offC + i] = c.cables[i].dT
  const nn = Math.min(lay.nNd, Math.floor(c.u.length / 6))
  for (let i = 0; i < nn; i++) v[lay.offU + i] = c.u[6 * i + 2]
  for (const r of c.reactions) {
    const k = lay.supSlot.get(r.node)
    if (k === undefined) continue
    for (let d = 0; d < 6; d++) v[lay.offR + 6 * k + d] = r.R[d]
  }
  return v
}

function emptyFamily(key: Family['key'], lay: Layout): Family {
  return {
    key,
    max: new Float64Array(lay.nR),
    min: new Float64Array(lay.nR),
    natMax: new Float64Array(3 * lay.nFr),
    natMin: new Float64Array(3 * lay.nFr),
    ids: [],
  }
}

/**
 * Soma à família um grupo de casos ALTERNATIVOS (entra no máximo um, onde for desfavorável).
 * Membros com `both` valem com os dois sinais.
 */
function addGroup(fam: Family, members: { v: Float64Array; both: boolean }[], lay: Layout): void {
  if (members.length === 0) return
  const { nR, nFr } = lay
  for (let j = 0; j < nR; j++) {
    let hi = 0
    let lo = 0
    for (const m of members) {
      const x = m.v[j]
      if (m.both) {
        const a = Math.abs(x)
        if (a > hi) hi = a
        if (-a < lo) lo = -a
      } else {
        if (x > hi) hi = x
        if (x < lo) lo = x
      }
    }
    fam.max[j] += hi
    fam.min[j] += lo
  }
  // N concomitante com o Mz extremo do grupo
  for (let e = 0; e < nFr; e++) {
    for (let s = 0; s < 3; s++) {
      const jM = e * NF + 15 + s
      const jN = e * NF + s
      let hi = 0
      let lo = 0
      let nHi = 0
      let nLo = 0
      for (const m of members) {
        const x = m.v[jM]
        const nn = m.v[jN]
        if (m.both) {
          const sg = x >= 0 ? 1 : -1
          if (sg * x > hi) {
            hi = sg * x
            nHi = sg * nn
          }
          if (-sg * x < lo) {
            lo = -sg * x
            nLo = -sg * nn
          }
        } else {
          if (x > hi) {
            hi = x
            nHi = nn
          }
          if (x < lo) {
            lo = x
            nLo = nn
          }
        }
      }
      fam.natMax[3 * e + s] += nHi
      fam.natMin[3 * e + s] += nLo
    }
  }
}

interface Term {
  fam: Family
  factor: number
}

interface Combo {
  def: CombinationDef
  terms: Term[]
  exceptional?: boolean
}

/** id-base de um caso p/ agrupar alternativas: 'TU+' e 'TU−' → 'TU' */
function groupKey(id: string): string {
  return id.replace(/[+\-−]$/, '')
}

export function runCombinations(ctx: AnalysisContext): void {
  const { res, sys } = ctx
  const dead = res.deadLoad
  const nFr = dead.frames.length
  const nCb = dead.cables.length
  const nNd = sys.nNodes
  const supSlot = new Map<number, number>()
  dead.reactions.forEach((r, k) => supSlot.set(r.node, k))
  const nSup = dead.reactions.length
  const lay: Layout = {
    nFr, nCb, nNd, nSup,
    offC: nFr * NF,
    offU: nFr * NF + nCb,
    offR: nFr * NF + nCb + nNd,
    nR: nFr * NF + nCb + nNd + 6 * nSup,
    supSlot,
  }
  const { nR, offC, offU, offR } = lay

  // ---- permanente
  const g = new Float64Array(nR)
  dead.frames.forEach((f, e) => {
    const o = e * NF
    for (let k = 0; k < 6; k++) {
      const t = f[COMPS[k]]
      g[o + 3 * k] = t[0]
      g[o + 3 * k + 1] = t[1]
      g[o + 3 * k + 2] = t[2]
    }
  })
  dead.cables.forEach((c, i) => (g[offC + i] = Math.max(c.Ti, c.Tj)))
  dead.reactions.forEach((r, k) => {
    for (let d = 0; d < 6; d++) g[offR + 6 * k + d] = r.R[d]
  })

  const cases = ctx.cases
  const vec = new Map<string, Float64Array>()
  for (const c of cases) vec.set(c.id, caseVector(c, lay))
  const noUz = (v: Float64Array): Float64Array => {
    v.fill(0, offU, offR)
    return v
  }
  const prestress = cases.filter((c) => c.kind === 'prestress').map((c) => ({ id: c.id, v: noUz(vec.get(c.id)!) }))
  // fluência e retração ('creep') são ações permanentes indiretas, como os recalques
  const settle = cases.filter((c) => c.kind === 'settlement' || c.kind === 'creep').map((c) => ({ id: c.id, v: noUz(vec.get(c.id)!), both: c.sign === 'both' }))

  // ---- famílias de ações variáveis
  const mv = res.moving
  let Q: Family | null = null
  if (mv) {
    Q = emptyFamily('Q', lay)
    Q.ids.push('Q')
    const put = (env: Env3, o: number): void => {
      for (let s = 0; s < 3; s++) {
        Q!.max[o + s] = Math.max(0, env.max[s])
        Q!.min[o + s] = Math.min(0, env.min[s])
      }
    }
    mv.frames.forEach((f, e) => {
      if (e >= nFr) return
      const o = e * NF
      put(f.N, o)
      put(f.Vy, o + 3)
      put(f.T, o + 9)
      put(f.My, o + 12)
      put(f.Mz, o + 15)
    })
    mv.cables.forEach((c, i) => {
      if (i >= nCb) return
      Q!.max[offC + i] = Math.max(0, c.max)
      Q!.min[offC + i] = Math.min(0, c.min)
    })
    for (let i = 0; i < nNd; i++) {
      Q.max[offU + i] = Math.max(0, mv.uzMax[i] ?? 0)
      Q.min[offU + i] = Math.min(0, mv.uzMin[i] ?? 0)
    }
    for (const r of mv.reactions ?? []) {
      const k = supSlot.get(r.node)
      if (k === undefined) continue
      for (let d = 0; d < 6; d++) {
        Q.max[offR + 6 * k + d] = Math.max(0, r.max[d])
        Q.min[offR + 6 * k + d] = Math.min(0, r.min[d])
      }
    }
    for (const c of cases) {
      if (c.kind !== 'braking') continue
      addGroup(Q, [{ v: vec.get(c.id)!, both: c.sign === 'both' }], lay)
      Q.ids.push(c.id)
    }
  }

  const family = (key: Family['key'], list: LoadCaseResult[], grouped: boolean): Family | null => {
    if (list.length === 0) return null
    const fam = emptyFamily(key, lay)
    const groups = new Map<string, LoadCaseResult[]>()
    for (const c of list) {
      const k = grouped ? groupKey(c.id) : c.id
      const arr = groups.get(k)
      if (arr) arr.push(c)
      else groups.set(k, [c])
      fam.ids.push(c.id)
    }
    for (const arr of groups.values()) addGroup(fam, arr.map((c) => ({ v: vec.get(c.id)!, both: c.sign === 'both' })), lay)
    return fam
  }
  const wind = cases.filter((c) => c.kind === 'wind')
  // vento com tráfego só existe junto com a carga móvel
  const WT = Q ? family('WT', wind.filter((c) => c.id === 'WT'), false) : null
  // os casos de vento sem tráfego são alternativas entre si
  const wFree = wind.filter((c) => c.id !== 'WT')
  let W: Family | null = null
  if (wFree.length > 0) {
    W = emptyFamily('W', lay)
    W.ids.push(...wFree.map((c) => c.id))
    addGroup(W, wFree.map((c) => ({ v: vec.get(c.id)!, both: c.sign === 'both' })), lay)
  }
  const T = family('T', cases.filter((c) => c.kind === 'temperature'), true)
  const O = family('O', cases.filter((c) => c.kind === 'other'), false)
  const E = family('E', cases.filter((c) => c.kind === 'seismic'), false)

  // ---- definição das combinações
  const combos: Combo[] = []
  const add = (
    id: string,
    name: string,
    limit: LimitState,
    parts: [Family | null, number][],
    exceptional = false,
  ): void => {
    const terms: Term[] = []
    for (const [fam, factor] of parts) if (fam && factor > 0) terms.push({ fam, factor })
    // sem ação variável nenhuma só ficam a de ações permanentes (ELU-0) e a quase permanente
    if (terms.length === 0 && id !== 'ELU-0' && limit !== 'ELS-QP') return
    const factors: Record<string, number> = {}
    if (limit === 'ELU') factors.G = GAMMA.gUnfav
    else if (limit === 'ELU-EXC') factors.G = GAMMA.gExcUnfav
    else factors.G = 1
    for (const p of prestress) factors[p.id] = limit === 'ELU' || limit === 'ELU-EXC' ? GAMMA.pUnfav : 1
    for (const s of settle) factors[s.id] = limit === 'ELU' || limit === 'ELU-EXC' ? GAMMA.settlement : 1
    for (const t of terms) for (const cid of t.fam.ids) factors[cid] = Math.round(t.factor * 1e6) / 1e6
    combos.push({ def: { id, name, limit, factors }, terms, exceptional })
  }
  const gq = GAMMA.moving
  const gw = GAMMA.wind
  const gt = GAMMA.temperature
  const go = GAMMA.other
  const [q0, q1, q2] = res.moving?.vehicle === 'Pedestres' ? PSI.pedestrian : PSI.moving
  const [w0, w1, w2] = PSI.wind
  const [t0, t1, t2] = PSI.temperature
  const [o0, o1, o2] = PSI.other

  // ELU normal
  if (!Q && !W && !T && !O) add('ELU-0', 'ELU — só ações permanentes', 'ELU', [])
  if (Q) add('ELU-1', 'ELU — carga móvel principal', 'ELU', [[Q, gq], [WT, gw * w0], [T, gt * t0], [O, go * o0]])
  if (Q && WT) add('ELU-2', 'ELU — vento principal, ponte carregada', 'ELU', [[WT, gw], [Q, gq * q0], [T, gt * t0], [O, go * o0]])
  if (W) add('ELU-3', 'ELU — vento principal, ponte descarregada', 'ELU', [[W, gw], [T, gt * t0], [O, go * o0]])
  if (T && Q) add('ELU-4', 'ELU — temperatura principal, ponte carregada', 'ELU', [[T, gt], [Q, gq * q0], [WT, gw * w0], [O, go * o0]])
  if (T) add('ELU-5', 'ELU — temperatura principal, ponte descarregada', 'ELU', [[T, gt], [W, gw * w0], [O, go * o0]])
  if (O) add('ELU-6', 'ELU — outras ações variáveis principais', 'ELU', [[O, go], [Q, gq * q0], [WT, gw * w0], [T, gt * t0]])
  if (E) add('EXC-1', 'ELU excepcional — sismo', 'ELU-EXC', [[E, 1], [Q, q2]], true)
  // ELS rara
  if (Q) add('ELS-R1', 'ELS rara — carga móvel principal', 'ELS-R', [[Q, 1], [WT, w1], [T, t1], [O, o1]])
  if (Q && WT) add('ELS-R2', 'ELS rara — vento principal, ponte carregada', 'ELS-R', [[WT, 1], [Q, q1], [T, t1], [O, o1]])
  if (W) add('ELS-R3', 'ELS rara — vento principal, ponte descarregada', 'ELS-R', [[W, 1], [T, t1], [O, o1]])
  if (T && Q) add('ELS-R4', 'ELS rara — temperatura principal, ponte carregada', 'ELS-R', [[T, 1], [Q, q1], [WT, w1], [O, o1]])
  if (T) add('ELS-R5', 'ELS rara — temperatura principal, ponte descarregada', 'ELS-R', [[T, 1], [W, w1], [O, o1]])
  if (O) add('ELS-R6', 'ELS rara — outras ações variáveis principais', 'ELS-R', [[O, 1], [Q, q1], [WT, w1], [T, t1]])
  // ELS frequente
  if (Q) add('ELS-F1', 'ELS frequente — carga móvel principal', 'ELS-F', [[Q, q1], [WT, w2], [T, t2], [O, o2]])
  if (Q && WT) add('ELS-F2', 'ELS frequente — vento principal, ponte carregada', 'ELS-F', [[WT, w1], [Q, q2], [T, t2], [O, o2]])
  if (W) add('ELS-F3', 'ELS frequente — vento principal, ponte descarregada', 'ELS-F', [[W, w1], [T, t2], [O, o2]])
  if (T && Q) add('ELS-F4', 'ELS frequente — temperatura principal, ponte carregada', 'ELS-F', [[T, t1], [Q, q2], [WT, w2], [O, o2]])
  if (T) add('ELS-F5', 'ELS frequente — temperatura principal, ponte descarregada', 'ELS-F', [[T, t1], [W, w2], [O, o2]])
  if (O) add('ELS-F6', 'ELS frequente — outras ações variáveis principais', 'ELS-F', [[O, o1], [Q, q2], [WT, w2], [T, t2]])
  // ELS quase permanente
  add('ELS-QP', 'ELS quase permanente', 'ELS-QP', [[Q, q2], [WT, w2], [T, t2], [O, o2]])

  // ---- envoltórias
  /** parcela permanente (G + protensão + recalques) de cada estado-limite: [mín, máx] por resposta */
  const permanent = (kind: 'ELU' | 'EXC' | 'ELS'): { max: Float64Array; min: Float64Array; nMax: Float64Array; nMin: Float64Array } => {
    const max = new Float64Array(nR)
    const min = new Float64Array(nR)
    const gu = kind === 'ELU' ? GAMMA.gUnfav : kind === 'EXC' ? GAMMA.gExcUnfav : 1
    const gf = kind === 'ELS' ? 1 : GAMMA.gFav
    const pu = kind === 'ELS' ? 1 : GAMMA.pUnfav
    const pf = kind === 'ELS' ? 1 : GAMMA.pFav
    const su = kind === 'ELS' ? 1 : GAMMA.settlement
    for (let j = 0; j < nR; j++) {
      const x = g[j]
      let hi = Math.max(gu * x, gf * x)
      let lo = Math.min(gu * x, gf * x)
      for (const p of prestress) {
        const y = p.v[j]
        hi += Math.max(pu * y, pf * y)
        lo += Math.min(pu * y, pf * y)
      }
      for (const s of settle) {
        const y = su * (s.both ? Math.abs(s.v[j]) : s.v[j])
        if (s.both) {
          hi += y
          lo -= y
        } else {
          hi += Math.max(0, y)
          lo += Math.min(0, y)
        }
      }
      max[j] = hi
      min[j] = lo
    }
    // N concomitante com o Mz extremo: o fator de cada ação permanente é o escolhido pelo Mz
    const nMax = new Float64Array(3 * nFr)
    const nMin = new Float64Array(3 * nFr)
    for (let e = 0; e < nFr; e++) {
      for (let s = 0; s < 3; s++) {
        const jM = e * NF + 15 + s
        const jN = e * NF + s
        const x = g[jM]
        let a = (x >= 0 ? gu : gf) * g[jN]
        let b = (x >= 0 ? gf : gu) * g[jN]
        for (const p of prestress) {
          const y = p.v[jM]
          a += (y >= 0 ? pu : pf) * p.v[jN]
          b += (y >= 0 ? pf : pu) * p.v[jN]
        }
        for (const st of settle) {
          const y = st.v[jM]
          if (st.both) {
            const sg = y >= 0 ? 1 : -1
            a += su * sg * st.v[jN]
            b -= su * sg * st.v[jN]
          } else if (y > 0) a += su * st.v[jN]
          else if (y < 0) b += su * st.v[jN]
        }
        nMax[3 * e + s] = a
        nMin[3 * e + s] = b
      }
    }
    return { max, min, nMax, nMin }
  }

  interface Envelope {
    max: Float64Array
    min: Float64Array
    nAtMax: Float64Array
    nAtMin: Float64Array
  }
  const envelope = (limits: LimitState[], base: 'ELU' | 'ELS'): Envelope => {
    // ponto de partida: só as ações permanentes (toda combinação com variáveis a contém)
    const perms = new Map<string, ReturnType<typeof permanent>>()
    const p0 = permanent(base)
    perms.set(base, p0)
    const max = Float64Array.from(p0.max)
    const min = Float64Array.from(p0.min)
    const nAtMax = Float64Array.from(p0.nMax)
    const nAtMin = Float64Array.from(p0.nMin)
    const hi = new Float64Array(nR)
    const lo = new Float64Array(nR)
    const nHi = new Float64Array(3 * nFr)
    const nLo = new Float64Array(3 * nFr)
    for (const c of combos) {
      if (!limits.includes(c.def.limit) || c.terms.length === 0) continue
      const pk = c.def.limit === 'ELU' ? 'ELU' : c.def.limit === 'ELU-EXC' ? 'EXC' : 'ELS'
      let perm = perms.get(pk)
      if (!perm) {
        perm = permanent(pk)
        perms.set(pk, perm)
      }
      hi.set(perm.max)
      lo.set(perm.min)
      nHi.set(perm.nMax)
      nLo.set(perm.nMin)
      for (const t of c.terms) {
        const f = t.factor
        const fm = t.fam.max
        const fn = t.fam.min
        for (let j = 0; j < nR; j++) {
          hi[j] += f * fm[j]
          lo[j] += f * fn[j]
        }
        const am = t.fam.natMax
        const an = t.fam.natMin
        for (let k = 0; k < nHi.length; k++) {
          nHi[k] += f * am[k]
          nLo[k] += f * an[k]
        }
      }
      for (let e = 0; e < nFr; e++) {
        for (let s = 0; s < 3; s++) {
          const jM = e * NF + 15 + s
          if (hi[jM] > max[jM]) nAtMax[3 * e + s] = nHi[3 * e + s]
          if (lo[jM] < min[jM]) nAtMin[3 * e + s] = nLo[3 * e + s]
        }
      }
      for (let j = 0; j < nR; j++) {
        if (hi[j] > max[j]) max[j] = hi[j]
        if (lo[j] < min[j]) min[j] = lo[j]
      }
    }
    return { max, min, nAtMax, nAtMin }
  }

  const elu = envelope(['ELU', 'ELU-EXC'], 'ELU')
  const rare = envelope(['ELS-R'], 'ELS')
  const freq = envelope(['ELS-F'], 'ELS')
  const qp = envelope(['ELS-QP'], 'ELS')

  type V3 = [number, number, number]
  const env3 = (en: Envelope, o: number): Env3 => ({
    min: [en.min[o], en.min[o + 1], en.min[o + 2]],
    max: [en.max[o], en.max[o + 1], en.max[o + 2]],
  })
  const forces = (en: Envelope, e: number): EnvForces => {
    const o = e * NF
    return {
      N: env3(en, o), Vy: env3(en, o + 3), Vz: env3(en, o + 6), T: env3(en, o + 9), My: env3(en, o + 12), Mz: env3(en, o + 15),
    }
  }
  const frames: CombinationResult['frames'] = dead.frames.map((f, e) => ({
    id: f.id,
    elu: forces(elu, e),
    elsRare: forces(rare, e),
    elsFreq: forces(freq, e),
    elsQp: forces(qp, e),
    NatMz: {
      min: [elu.nAtMin[3 * e], elu.nAtMin[3 * e + 1], elu.nAtMin[3 * e + 2]] as V3,
      max: [elu.nAtMax[3 * e], elu.nAtMax[3 * e + 1], elu.nAtMax[3 * e + 2]] as V3,
    },
  }))
  const pair = (en: Envelope, j: number): [number, number] => [en.min[j], en.max[j]]
  const cables: CombinationResult['cables'] = dead.cables.map((c, i) => ({
    id: c.id,
    elu: pair(elu, offC + i),
    elsRare: pair(rare, offC + i),
    elsFreq: pair(freq, offC + i),
    elsQp: pair(qp, offC + i),
  }))
  const r6 = (v: Float64Array, o: number): Reaction['R'] => [v[o], v[o + 1], v[o + 2], v[o + 3], v[o + 4], v[o + 5]]
  const reactions: CombinationResult['reactions'] = dead.reactions.map((r, k) => ({
    node: r.node,
    elu: { min: r6(elu.min, offR + 6 * k), max: r6(elu.max, offR + 6 * k) },
    elsRare: { min: r6(rare.min, offR + 6 * k), max: r6(rare.max, offR + 6 * k) },
  }))

  res.combos = {
    list: combos.map((c) => c.def),
    frames,
    cables,
    uzFreq: {
      min: Array.from(freq.min.subarray(offU, offR)),
      max: Array.from(freq.max.subarray(offU, offR)),
    },
    reactions,
  }
  ctx.lap('combinacoes')
}
