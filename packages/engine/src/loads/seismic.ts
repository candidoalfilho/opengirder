/**
 * Sismo — ABNT NBR 15421 (projeto de estruturas resistentes a sismos), método espectral.
 *
 * Espectro de resposta de projeto (item 6.3), em fração de g, amortecimento de 5 %:
 *   ags0 = Ca·ag      ags1 = Cv·ag            (Ca, Cv: Tabela 3, por classe do terreno e ag)
 *   0 ≤ T ≤ 0,08·Cv/Ca :           Sa = ags0·(18,75·T·Ca/Cv + 1,0)
 *   0,08·Cv/Ca ≤ T ≤ 0,4·Cv/Ca :   Sa = 2,5·ags0
 *   T ≥ 0,4·Cv/Ca :                Sa = ags1/T
 * Acelerações verticais: 50 % das horizontais (6.3).
 *
 * Análise espectral (item 10): cada modo de vibração (calculado sobre a rigidez tangente do
 * estado permanente, massa concentrada) responde com a amplitude Γ·Sa(T)·g/ω²; as respostas
 * modais são combinadas pela CQC com ξ = 5 % (Wilson, Der Kiureghian & Bayo, 1981) e as três
 * direções pela regra 100 % + 30 % + 30 % (o pior dos três arranjos). Os esforços são
 * multiplicados por I/R; os deslocamentos por Cd/R, com Cd = R (deslocamento elástico, sem o
 * fator I — na norma, δ = Cd·δe/I com δe já calculado com I/R).
 *
 * Massa faltante: a parcela da massa que os modos calculados não mobilizam em cada direção,
 * M·(ι − Σ Γk·φk), entra como resposta ESTÁTICA e soma-se à CQC por raiz da soma dos
 * quadrados (método da massa faltante — Gupta, "Response Spectrum Method", 1990; ASCE 4).
 * Como o modo mais alto calculado pode não estar na faixa rígida do espectro, a aceleração
 * usada é a MAIOR do espectro p/ períodos até o do último modo (a favor da segurança; com
 * poucos modos fica bem conservador). Assim a soma das massas é sempre 100 %; o critério de
 * 90 % de massa modal da NBR 15421 continua sendo informado e avisado.
 *
 * Limitações: a NBR 15421 trata de estruturas usuais de edifícios e não traz coeficientes R
 * para pontes — R e I são dados do usuário (padrões em loads/site.ts). O resultado é uma
 * envoltória em valor absoluto (sem sinal e sem concomitância entre esforços). A massa é só
 * a da carga permanente. Zonas, Tabela 3 (Ca, Cv) e ramos do espectro são os da edição de 2006,
 * conferidos em fontes públicas (docs/normas.md). A revisão de 2023 passou a ter seis classes de
 * terreno (A a F); só os fatores da classe E foram conferidos para ela.
 */

import type { FrameForces, LoadCaseResult, Reaction } from '../analysis/types'
import type { LinearState } from '../analysis/linear'
import type { AnalysisContext } from '../analysis/context'
import { G } from '../analysis/geometry'
import { resolveSite } from './site'

export interface SeismicParams {
  /** aceleração característica horizontal em rocha (classe B), fração de g */
  ag: number
  soil: 'A' | 'B' | 'C' | 'D' | 'E'
  R: number
  I: number
}

/** zonas sísmicas da NBR 15421 (Tabela 1 / Figura 1): faixa de ag em fração de g */
export const SEISMIC_ZONES: { zone: number; agMin: number; agMax: number; label: string }[] = [
  { zone: 0, agMin: 0.025, agMax: 0.025, label: 'Zona 0 — ag = 0,025 g' },
  { zone: 1, agMin: 0.025, agMax: 0.05, label: 'Zona 1 — 0,025 g ≤ ag ≤ 0,05 g' },
  { zone: 2, agMin: 0.05, agMax: 0.1, label: 'Zona 2 — 0,05 g ≤ ag ≤ 0,10 g' },
  { zone: 3, agMin: 0.1, agMax: 0.15, label: 'Zona 3 — 0,10 g ≤ ag ≤ 0,15 g' },
  { zone: 4, agMin: 0.15, agMax: 0.15, label: 'Zona 4 — ag = 0,15 g' },
]

// Tabela 3 — fatores de amplificação sísmica no solo: [ag ≤ 0,10 g, ag = 0,15 g]
const CA: Record<SeismicParams['soil'], [number, number]> = {
  A: [0.8, 0.8], B: [1.0, 1.0], C: [1.2, 1.2], D: [1.6, 1.5], E: [2.5, 2.1],
}
const CV: Record<SeismicParams['soil'], [number, number]> = {
  A: [0.8, 0.8], B: [1.0, 1.0], C: [1.7, 1.7], D: [2.4, 2.2], E: [3.5, 3.4],
}

/** Ca e Cv (Tabela 3), com interpolação linear entre 0,10 g e 0,15 g */
export function soilFactors(soil: SeismicParams['soil'], ag: number): { Ca: number; Cv: number } {
  const t = Math.min(1, Math.max(0, (ag - 0.1) / 0.05))
  const ca = CA[soil] ?? CA.B
  const cv = CV[soil] ?? CV.B
  return { Ca: ca[0] + t * (ca[1] - ca[0]), Cv: cv[0] + t * (cv[1] - cv[0]) }
}

/** aceleração espectral ELÁSTICA horizontal Sa(T), em fração de g (sem I nem R) */
export function designSpectrum(p: Pick<SeismicParams, 'ag' | 'soil'>, T: number): number {
  const { Ca, Cv } = soilFactors(p.soil, p.ag)
  const ags0 = Ca * p.ag
  const ags1 = Cv * p.ag
  const r = Cv / Ca
  if (!(T > 0)) return ags0
  if (T <= 0.08 * r) return ags0 * ((18.75 * T) / r + 1)
  if (T <= 0.4 * r) return 2.5 * ags0
  return ags1 / T
}

/** maior Sa(T') p/ T' ≤ T, em fração de g — aceleração da massa faltante */
export function spectrumMaxBelow(p: Pick<SeismicParams, 'ag' | 'soil'>, T: number): number {
  const { Ca, Cv } = soilFactors(p.soil, p.ag)
  return T >= (0.08 * Cv) / Ca ? 2.5 * Ca * p.ag : designSpectrum(p, T)
}

/** coeficiente de correlação da CQC entre modos de frequências wi e wj (amortecimento ξ igual) */
export function cqcCoefficient(wi: number, wj: number, xi = 0.05): number {
  if (!(wi > 0) || !(wj > 0)) return 0
  const r = wj / wi
  const d = (1 - r * r) ** 2 + 4 * xi * xi * r * (1 + r) ** 2
  return (8 * xi * xi * (1 + r) * Math.pow(r, 1.5)) / d
}

const VERTICAL_FACTOR = 0.5

export function seismicCase(ctx: AnalysisContext, p: SeismicParams): LoadCaseResult | null {
  const { sys, lin, res } = ctx
  const modes = res.modal?.modes ?? []
  if (modes.length === 0) {
    ctx.warnings.push('Sismo não calculado: a análise espectral exige a análise modal.')
    return null
  }
  if (!(p.ag > 0) || !(p.R > 0) || !(p.I > 0)) return null
  const { eq, mass } = sys
  const nNd = sys.nNodes
  const nM = modes.length

  // massa livre por direção
  const mFree = [0, 0, 0]
  for (let i = 0; i < nNd; i++) for (let d = 0; d < 3; d++) if (eq[6 * i + d] >= 0) mFree[d] += mass[6 * i + d]

  // ---- por modo: participação, amplitude por direção e resposta da forma unitária
  const omega = new Float64Array(nM)
  const amp = [new Float64Array(nM), new Float64Array(nM), new Float64Array(nM)]
  const shear = [new Float64Array(nM), new Float64Array(nM), new Float64Array(nM)]
  const meff = [0, 0, 0]
  const gammas = [new Float64Array(nM), new Float64Array(nM), new Float64Array(nM)]
  /** menor período calculado: a massa faltante responde com o maior Sa até tCut */
  let tCut = Infinity
  const nFr = sys.frames.length
  const nCb = sys.cables.length
  let nRe = 0
  const resp: Float64Array[] = []
  const offC = 18 * nFr
  let offR = 0
  let offU = 0
  const COMP = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'] as const
  let reactionNodes: number[] = []
  let frameMeta: { id: number; L: number }[] = []
  const flatten = (st: LinearState): Float64Array => {
    const r = new Float64Array(offU + 6 * nNd)
    st.frames.forEach((f, e) => {
      COMP.forEach((c, ci) => {
        for (let s = 0; s < 3; s++) r[18 * e + 3 * ci + s] = f[c][s]
      })
    })
    st.cables.forEach((c, i) => (r[offC + i] = c.dT))
    st.reactions.forEach((x, i) => {
      for (let d = 0; d < 6; d++) r[offR + 6 * i + d] = x.R[d]
    })
    for (let i = 0; i < 6 * nNd; i++) r[offU + i] = st.u[i]
    return r
  }
  modes.forEach((m, k) => {
    const w = 2 * Math.PI * m.frequency
    omega[k] = w
    let mgen = 0
    const L = [0, 0, 0]
    for (let i = 0; i < nNd; i++) {
      for (let d = 0; d < 6; d++) {
        if (eq[6 * i + d] < 0) continue
        const v = m.shape[6 * i + d]
        mgen += mass[6 * i + d] * v * v
        if (d < 3) L[d] += mass[6 * i + d] * v
      }
    }
    const Sa = designSpectrum(p, m.period)
    if (m.period < tCut) tCut = m.period
    for (let d = 0; d < 3; d++) {
      const gamma = mgen > 0 ? L[d] / mgen : 0
      gammas[d][k] = gamma
      const sa = (d === 2 ? VERTICAL_FACTOR : 1) * Sa * G
      amp[d][k] = (gamma * sa) / (w * w)
      const me = gamma * gamma * mgen
      meff[d] += me
      shear[d][k] = me * sa
    }
    const st = lin.fromDisplacements(m.shape)
    if (k === 0) {
      nRe = st.reactions.length
      offR = offC + nCb
      offU = offR + 6 * nRe
      reactionNodes = st.reactions.map((r) => r.node)
      frameMeta = st.frames.map((f) => ({ id: f.id, L: f.L }))
    }
    resp.push(flatten(st))
  })

  // ---- CQC por direção
  const rho = new Float64Array(nM * nM)
  for (let i = 0; i < nM; i++) for (let j = 0; j < nM; j++) rho[i * nM + j] = cqcCoefficient(omega[i], omega[j])
  const nResp = resp[0].length
  const dir: Float64Array[] = []
  const vBase = [0, 0, 0]
  const col = new Float64Array(nM)
  for (let d = 0; d < 3; d++) {
    const a = amp[d]
    const out = new Float64Array(nResp)
    for (let j = 0; j < nResp; j++) {
      for (let k = 0; k < nM; k++) col[k] = a[k] * resp[k][j]
      let s = 0
      for (let i = 0; i < nM; i++) {
        if (col[i] === 0) continue
        for (let l = 0; l < nM; l++) s += rho[i * nM + l] * col[i] * col[l]
      }
      out[j] = Math.sqrt(Math.max(s, 0))
    }
    let s = 0
    for (let i = 0; i < nM; i++) for (let l = 0; l < nM; l++) s += rho[i * nM + l] * shear[d][i] * shear[d][l]
    // massa faltante: resposta estática a M·(ι − Σ Γk·φk)·Sa(tCut)
    const saCut = (d === 2 ? VERTICAL_FACTOR : 1) * spectrumMaxBelow(p, tCut) * G
    const F = new Float64Array(6 * nNd)
    let fmax = 0
    let mMiss = 0
    for (let i = 0; i < nNd; i++) {
      for (let c = 0; c < 6; c++) {
        const g = 6 * i + c
        if (eq[g] < 0) continue
        let part = 0
        for (let k = 0; k < nM; k++) part += gammas[d][k] * modes[k].shape[g]
        const mres = mass[g] * ((c === d ? 1 : 0) - part)
        F[g] = mres * saCut
        if (c === d) mMiss += mres
        if (Math.abs(F[g]) > fmax) fmax = Math.abs(F[g])
      }
    }
    if (fmax > 1e-9 * Math.max(mFree[d] * saCut, 1e-12)) {
      const rs = flatten(lin.solve({ nodal: F }))
      for (let j = 0; j < nResp; j++) out[j] = Math.hypot(out[j], rs[j])
      s += (mMiss * saCut) ** 2
    }
    dir.push(out)
    vBase[d] = Math.sqrt(Math.max(s, 0))
  }

  // ---- direções: 100 % + 30 % + 30 %
  const kF = p.I / p.R
  // deslocamentos: a norma usa Cd/R sobre a resposta elástica; sem Cd informado vale Cd = R (fator 1)
  const kU = 1
  const env = new Float64Array(nResp)
  for (let j = 0; j < nResp; j++) {
    const x = dir[0][j]
    const y = dir[1][j]
    const z = dir[2][j]
    const e = Math.max(x + 0.3 * y + 0.3 * z, 0.3 * x + y + 0.3 * z, 0.3 * x + 0.3 * y + z)
    env[j] = e * (j >= offU ? kU : kF)
  }

  const t3 = (o: number): [number, number, number] => [env[o], env[o + 1], env[o + 2]]
  const frames: FrameForces[] = frameMeta.map((f, e) => ({
    id: f.id, L: f.L,
    N: t3(18 * e), Vy: t3(18 * e + 3), Vz: t3(18 * e + 6), T: t3(18 * e + 9), My: t3(18 * e + 12), Mz: t3(18 * e + 15),
  }))
  const reactions: Reaction[] = reactionNodes.map((node, i) => ({
    node,
    R: [0, 1, 2, 3, 4, 5].map((d) => env[offR + 6 * i + d]) as Reaction['R'],
  }))
  const { Ca, Cv } = soilFactors(p.soil, p.ag)
  const pct = meff.map((m, d) => (mFree[d] > 0 ? (100 * m) / mFree[d] : 0))
  if (pct[0] < 90 || pct[1] < 90) {
    ctx.warnings.push(
      `Sismo: os ${nM} modos calculados mobilizam ${pct[0].toFixed(0)} % da massa em X e ${pct[1].toFixed(0)} % em Y ` +
        '(a NBR 15421 pede ao menos 90 %). O restante entrou como resposta estática (massa faltante); ' +
        'para atender ao critério, aumente o número de modos da análise modal.',
    )
  }
  return {
    id: 'E',
    name: 'Sismo (NBR 15421, análise espectral)',
    kind: 'seismic',
    sign: 'both',
    u: Array.from(env.subarray(offU)),
    frames,
    cables: sys.cables.map((c, i) => ({ id: c.id, dT: env[offC + i] })),
    reactions,
    info: [
      { label: 'ags0 = Ca·ag', value: Ca * p.ag, unit: 'g' },
      { label: 'ags1 = Cv·ag', value: Cv * p.ag, unit: 'g' },
      { label: 'Cortante na base em X (I/R aplicado)', value: vBase[0] * kF, unit: 'kN' },
      { label: 'Cortante na base em Y (I/R aplicado)', value: vBase[1] * kF, unit: 'kN' },
      { label: 'Força vertical na base (I/R aplicado)', value: vBase[2] * kF, unit: 'kN' },
      { label: 'Massa participante em X', value: pct[0], unit: '%' },
      { label: 'Massa participante em Y', value: pct[1], unit: '%' },
      { label: 'Massa participante em Z', value: pct[2], unit: '%' },
      { label: 'Modos combinados (CQC)', value: nM, unit: '' },
      { label: 'Período de corte da massa faltante', value: tCut, unit: 's' },
    ],
  }
}

/** [ext:casos] — só quando `model.site.seismic` está ligado */
export function runSeismic(ctx: AnalysisContext): void {
  const s = ctx.model.site?.seismic
  if (!s || typeof s !== 'object') return
  const p = resolveSite(ctx.model).seismic
  if (!p) return
  ctx.progress('Sismo NBR 15421', 0.965)
  const c = seismicCase(ctx, p)
  if (c) ctx.cases.push(c)
  ctx.lap('sismo')
}
