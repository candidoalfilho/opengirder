/**
 * Perdas da força de protensão — NBR 6118:2023, item 9.6.3 (pós-tração).
 *
 * Imediatas (9.6.3.3.2):
 *  - atrito (9.6.3.3.2.2): P(x) = Pi·e^−(μ·Σα + k·x), com Σα = soma dos desvios angulares (rad)
 *    entre a ancoragem ativa e a seção, e k = 0,01·μ (1/m) na falta de dados experimentais;
 *  - acomodação da ancoragem (9.6.3.3.2.3): o recuo δ inverte o atrito num comprimento w junto
 *    à ancoragem ativa; w sai da igualdade entre a área do diagrama de perda de força e
 *    δ·Ep·Ap. Para atrito linear (perda p por metro), w = √(δ·Ep·Ap/p);
 *  - encurtamento imediato do concreto (9.6.3.3.2.1), n cabos tracionados em sequência:
 *    Δσp = αp·(σcp + σcg)·(n − 1)/(2n).
 *
 * Progressivas (9.6.3.4.2 — processo simplificado p/ fase única de operação):
 *
 *    Δσp(t,t0) = [εcs·Ep − αp·σc,p0g·φ − σp0·χ] / [χp + χc·αp·η·ρp]
 *
 *  com χ = −ln(1 − ψ(t,t0)), χc = 1 + 0,5·φ, χp = 1 + χ, η = 1 + ep²·Ac/Ic, ρp = Ap/Ac,
 *  αp = Ep/Ec, σc,p0g = tensão no concreto junto ao cabo por protensão + carga permanente
 *  (compressão +) e σp0 = tensão no aço após as perdas imediatas. A relaxação a tempo infinito
 *  é ψ(t∞,t0) = 2,5·ψ1000 (8.4.8), com ψ1000 da Tabela 8.4 (cordoalhas de relaxação baixa).
 *
 * Simplificações: αp usa o módulo do concreto do modelo (secante, Ecs) no lugar de Eci28 — a
 * favor da segurança (perda um pouco maior); uma única idade de protensão; φ e εcs informados
 * (padrões 2,5 e −2,5·10⁻⁴, ordem de grandeza da Tabela 8.2 p/ umidade de 75%).
 */

import type { TendonProfile } from './profile'
import type { PrestressSection, TendonData } from './types'

/** força após o atrito, com a ancoragem ativa no início ('start') ou no fim ('end') do traçado */
export function frictionForce(s: number[], profile: TendonProfile, td: TendonData, from: 'start' | 'end'): number[] {
  const sa = from === 'start' ? profile.s0 : profile.s1
  const aa = profile.angle(sa)
  return s.map((x) => {
    const xc = Math.min(profile.s1, Math.max(profile.s0, x))
    return td.Pi * Math.exp(-(td.mu * Math.abs(profile.angle(xc) - aa) + td.k * Math.abs(xc - sa)))
  })
}

/** ψ1000 (fração) de cordoalhas de relaxação baixa — NBR 6118 Tabela 8.4 */
export function psi1000RB(sigmaRatio: number): number {
  const r = sigmaRatio
  if (r <= 0.5) return 0
  if (r <= 0.6) return (0.013 * (r - 0.5)) / 0.1
  if (r <= 0.7) return 0.013 + (0.012 * (r - 0.6)) / 0.1
  if (r <= 0.8) return 0.025 + (0.01 * (r - 0.7)) / 0.1
  return 0.035 + 0.1 * (r - 0.8) // extrapolação acima de 0,8·fptk
}

export interface SlipResult {
  P: number[]
  /** comprimento afetado pela acomodação (m) */
  length: number
  /** queda de força na ancoragem (kN) */
  drop: number
}

/**
 * Acomodação da ancoragem. `x` = distância à ancoragem ativa (crescente), `P` = força após o
 * atrito nesses pontos (decrescente), `target` = δ·Ep·Ap (kN·m).
 */
export function anchorageSlip(x: number[], P: number[], target: number): SlipResult {
  const n = x.length
  if (!(target > 0) || n < 2) return { P: P.slice(), length: 0, drop: 0 }
  // área de perda até w: A(w) = 2·∫₀ʷ (P(x) − P(w)) dx, com P linear por trechos
  const cum: number[] = [0] // ∫₀^{x_i} P dx
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + (0.5 * (P[i] + P[i - 1])) * (x[i] - x[i - 1]))
  const at = (w: number): { Pw: number; area: number } => {
    let i = 1
    while (i < n - 1 && x[i] < w) i++
    const L = x[i] - x[i - 1]
    const t = L > 0 ? Math.min(1, Math.max(0, (w - x[i - 1]) / L)) : 0
    const Pw = P[i - 1] + t * (P[i] - P[i - 1])
    const int = cum[i - 1] + 0.5 * (P[i - 1] + Pw) * (w - x[i - 1])
    return { Pw, area: 2 * (int - Pw * (w - x[0])) }
  }
  const wMax = x[n - 1]
  const full = at(wMax)
  let w = wMax
  let Pw = full.Pw
  let extra = 0
  if (full.area < target) {
    // cabo curto: a acomodação alcança a outra ponta — queda adicional uniforme
    extra = (target - full.area) / (2 * (wMax - x[0] || 1))
  } else {
    let lo = x[0]
    let hi = wMax
    for (let it = 0; it < 80; it++) {
      const mid = 0.5 * (lo + hi)
      if (at(mid).area < target) lo = mid
      else hi = mid
    }
    w = 0.5 * (lo + hi)
    Pw = at(w).Pw
  }
  const out = P.map((p, i) => (x[i] < w || extra > 0 ? 2 * Pw - p - 2 * extra : p))
  return { P: out, length: w - x[0], drop: P[0] - out[0] }
}

export interface ImmediateResult {
  /** após atrito e acomodação (kN) */
  P: number[]
  /** só atrito — é a força durante o estiramento, usada no alongamento teórico */
  Pjack: number[]
  /** comprimento afetado pela acomodação em cada ancoragem ativa [início, fim] (m) */
  slipLength: [number, number]
  /** alongamento teórico total do cabo (m), somando as duas extremidades ativas */
  elongation: number
}

/** atrito + acomodação nas estacas `s` (crescentes), conforme a(s) extremidade(s) ativa(s) */
export function immediateLosses(s: number[], profile: TendonProfile, td: TendonData): ImmediateResult {
  const target = td.slip * td.Ep * td.Ap
  const n = s.length
  let A: number[] | null = null
  let B: number[] | null = null
  let fa: number[] | null = null
  let fb: number[] | null = null
  const slipLength: [number, number] = [0, 0]
  if (td.jacking !== 'end') {
    fa = frictionForce(s, profile, td, 'start')
    const r = anchorageSlip(s.map((v) => v - s[0]), fa, target)
    A = r.P
    slipLength[0] = r.length
  }
  if (td.jacking !== 'start') {
    fb = frictionForce(s, profile, td, 'end')
    const xr = s.map((v) => s[n - 1] - v).reverse()
    const r = anchorageSlip(xr, fb.slice().reverse(), target)
    B = r.P.reverse()
    slipLength[1] = r.length
  }
  const pick = (a: number[] | null, b: number[] | null): number[] =>
    a && b ? a.map((v, i) => Math.max(v, b[i])) : ((a ?? b) as number[])
  const P = pick(A, B)
  const Pjack = pick(fa, fb)
  let int = 0
  for (let i = 1; i < n; i++) int += 0.5 * (Pjack[i] + Pjack[i - 1]) * (s[i] - s[i - 1])
  return { P, Pjack, slipLength, elongation: td.Ap > 0 ? int / (td.Ep * td.Ap) : 0 }
}

/**
 * Perda por encurtamento imediato do concreto (kN, positiva) — 9.6.3.3.2.1.
 * `sigmaC` = tensão no concreto no nível do cabo por protensão + carga mobilizada
 * (kPa, compressão +).
 */
export function elasticShorteningLoss(sigmaC: number, td: TendonData, sec: PrestressSection): number {
  const n = td.nCables
  if (n <= 1) return 0
  const alpha = td.Ep / sec.Ec
  return alpha * Math.max(sigmaC, 0) * ((n - 1) / (2 * n)) * td.Ap
}

/**
 * Perda progressiva (kN, positiva) pelo processo simplificado — 9.6.3.4.2.
 * `P0` = força após as perdas imediatas; `e` = excentricidade do cabo; `sigmaC` = σc,p0g
 * (kPa, compressão +).
 */
export function progressiveLoss(P0: number, e: number, sigmaC: number, td: TendonData, sec: PrestressSection): number {
  if (!(td.Ap > 0) || !(P0 > 0)) return 0
  const sp0 = P0 / td.Ap
  const psi = Math.min(0.5, 2.5 * (td.psi1000 ?? psi1000RB(sp0 / td.fptk)))
  const chi = -Math.log(1 - psi)
  const chiC = 1 + 0.5 * td.phi
  const chiP = 1 + chi
  const alpha = td.Ep / sec.Ec
  const eta = 1 + (e * e * sec.A) / sec.I
  const rho = td.Ap / sec.A
  const dSigma = (td.epsCs * td.Ep - alpha * Math.max(sigmaC, 0) * td.phi - sp0 * chi) / (chiP + chiC * alpha * eta * rho)
  // dSigma < 0 (perda); limita a perda à própria força
  return Math.min(P0, Math.max(0, -dSigma * td.Ap))
}
