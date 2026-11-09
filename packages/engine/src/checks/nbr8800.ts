/**
 * Verificação ELÁSTICA simplificada de seções de aço — ABNT NBR 8800:2008.
 *
 *  - tensão normal nas fibras extremas: σ = |N|/A + |Mz|/Wz + |My|/Wy ≤ fy/γa1, com
 *    γa1 = 1,10 (4.8.2.3, escoamento);
 *  - cisalhamento médio na alma: τ = V/Aw ≤ 0,60·fy/γa1 (5.4.3.1, escoamento da alma).
 *
 * NÃO são verificados: flambagem local de mesas e almas (Anexos F e H), flambagem lateral
 * com torção (Anexo G), flambagem global de barras comprimidas (5.3), enrijecedores e
 * fadiga. Serve de triagem do nível de tensões; o dimensionamento de tabuleiros e torres de
 * aço exige essas verificações à parte.
 *
 * Unidades: m, kN, kN·m, kPa.
 */

export const GAMMA_A1 = 1.1

export interface SteelStressInput {
  A: number
  /** módulos resistentes p/ flexão vertical: fibra superior e inferior (m³) */
  Wtop: number
  Wbot: number
  /** módulo resistente p/ flexão lateral (m³); ausente = não entra */
  Wy?: number
  /** área de alma (m²); ausente = cisalhamento não verificado */
  Aw?: number
  fy: number
  /** esforços de cálculo: N tração +, momentos e cortante em valor absoluto ou com sinal */
  Nd: number
  Mzd: number
  Myd?: number
  Vd?: number
}

export interface SteelStressResult {
  /** maior tensão normal em módulo (kPa) */
  sigma: number
  /** σ / (fy/γa1) */
  ratio: number
  /** tensão de cisalhamento média na alma (kPa) e τ / (0,6·fy/γa1) */
  tau?: number
  shearRatio?: number
  ok: boolean
}

export function steelStressCheck(inp: SteelStressInput): SteelStressResult {
  const fyd = inp.fy / GAMMA_A1
  const axial = inp.Nd / inp.A
  const mz = Math.abs(inp.Mzd)
  const my = inp.Wy && inp.Wy > 0 ? Math.abs(inp.Myd ?? 0) / inp.Wy : 0
  // fibra superior e inferior, com o sinal real do momento vertical e o lateral a favor da segurança
  const sgn = inp.Mzd >= 0 ? 1 : -1
  const top = axial - (sgn * mz) / inp.Wtop
  const bot = axial + (sgn * mz) / inp.Wbot
  const sigma = Math.max(Math.abs(top), Math.abs(bot)) + my
  const out: SteelStressResult = { sigma, ratio: sigma / fyd, ok: sigma <= fyd }
  if (inp.Aw && inp.Aw > 0 && inp.Vd !== undefined) {
    out.tau = Math.abs(inp.Vd) / inp.Aw
    out.shearRatio = out.tau / (0.6 * fyd)
    if (out.shearRatio > 1) out.ok = false
  }
  return out
}
