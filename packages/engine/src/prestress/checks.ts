/**
 * Verificações de tensões normais no concreto protendido (estádio I, seção bruta).
 *
 *   σ_sup = N/A − Mz·y_sup/I      σ_inf = N/A + Mz·y_inf/I      (tração +; Mz > 0 traciona embaixo)
 *
 *  - Ato da protensão (NBR 6118 17.2.4.3.2): com γp = 1,1 sobre P0 e γf = 1,0 sobre o peso
 *    próprio, compressão ≤ 0,7·fckj e tração ≤ 1,2·fctm(fckj).
 *  - Em serviço (Tabela 13.4): protensão limitada (nível 2) — ELS-D (sem tração) na combinação
 *    quase permanente e ELS-F (tração ≤ fct,f) na frequente; protensão completa (nível 3) —
 *    ELS-D na frequente e ELS-F na rara. fct,f = α·fctk,inf com α = 1,2 (seções T, duplo T e
 *    caixão) e fctk,inf = 0,7·fctm (17.3.1).
 *  - Compressão em serviço ≤ 0,6·fck na combinação rara: a NBR 6118 só limita a compressão no
 *    ato da protensão; este limite é o do EN 1992-1-1 7.2(2), mostrado como referência.
 *
 * As envoltórias de N e Mz não são concomitantes; a tensão extrema combina o extremo de cada
 * uma (a favor da segurança).
 */

import type { PrestressSection } from './types'

/** fctm (kPa) p/ fck em kPa — NBR 6118 8.2.5 */
export function fctm(fck: number): number {
  const f = fck / 1000
  // fck > 50 MPa: expressão da edição de 2023 (a de 2014 era 2,12·ln(1 + 0,11·fck))
  return 1000 * (f <= 50 ? 0.3 * Math.pow(f, 2 / 3) : 2.12 * Math.log(1 + 0.1 * (f + 8)))
}

export interface NMEnv {
  Nmin: number
  Nmax: number
  Mmin: number
  Mmax: number
}

export interface FibreEnv {
  topMin: number
  topMax: number
  botMin: number
  botMax: number
}

/** tensões extremas nas duas fibras p/ envoltórias de N e Mz (kPa, tração +) */
export function fibreStress(sec: PrestressSection, v: NMEnv): FibreEnv {
  const kt = sec.yTop / sec.I
  const kb = sec.yBot / sec.I
  return {
    topMax: v.Nmax / sec.A - v.Mmin * kt,
    topMin: v.Nmin / sec.A - v.Mmax * kt,
    botMax: v.Nmax / sec.A + v.Mmax * kb,
    botMin: v.Nmin / sec.A + v.Mmin * kb,
  }
}

export interface ServiceLimits {
  /** tração máxima no ELS-F (kPa) */
  fctF: number
  /** compressão máxima de referência em serviço (kPa, positiva) */
  compService: number
  /** ato da protensão: compressão (kPa, positiva) e tração (kPa) */
  compTransfer: number
  tensTransfer: number
}

export function serviceLimits(fck: number, fckj: number, alpha = 1.2): ServiceLimits {
  return {
    fctF: alpha * 0.7 * fctm(fck),
    compService: 0.6 * fck,
    compTransfer: 0.7 * fckj,
    tensTransfer: 1.2 * fctm(fckj),
  }
}
