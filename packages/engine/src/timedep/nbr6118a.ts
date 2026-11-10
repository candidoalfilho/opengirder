/**
 * Fluência e retração do concreto — ABNT NBR 6118:2023, Anexo A (itens A.2.2 e A.2.3).
 *
 * Expressões implementadas (para conferência — cada uma cita o item de onde foi tirada):
 *
 *  Idade fictícia (A.2.4.1):        t = α·Σ[(Ti + 10)/30]·Δtef,i
 *      α (Tabela A.2): fluência — 1 (CP III e IV), 2 (CP I e II), 3 (CP V-ARI); retração — 1.
 *  Espessura fictícia (A.2.4.2):    hfic = γ·2Ac/uar,   γ = 1 + exp(−7,8 + 0,1·U)
 *
 *  Fluência (A.2.2.3):   φ(t, t0) = φa + φf∞·[βf(t) − βf(t0)] + φd∞·βd
 *      φa   = 0,8·[1 − fc(t0)/fc(t∞)]  (C20 a C45);  1,4·[1 − fc(t0)/fc(t∞)]  (C50 a C90)
 *             fc(t0)/fc(t∞) = β1(t0)/β1(t∞), β1 = exp{s·[1 − (28/t)^½]} (item 12.3.3),
 *             s = 0,38 (CP III e IV); 0,25 (CP I e II); 0,20 (CP V-ARI)  →  razão = exp[−s·(28/t0)^½]
 *      φf∞  = φ1c·φ2c  (C20 a C45);  0,45·φ1c·φ2c  (C50 a C90)
 *      φ1c  = 4,45 − 0,035·U  (abatimento 5–9 cm, U ≤ 90 %; Tabela A.1);
 *             −25 % p/ abatimento 0–4 cm, +25 % p/ 10–15 cm
 *      φ2c  = (42 + hfic)/(20 + hfic),  hfic em cm
 *      βf(t) = (t² + A·t + B)/(t² + C·t + D),  t = idade fictícia em dias (≥ 3), h = hfic em m
 *             (0,05 ≤ h ≤ 1,6):
 *             A = 42h³ − 350h² + 588h + 113        B = 768h³ − 3060h² + 3234h − 23
 *             C = −200h³ + 13h² + 1090h + 183      D = 7579h³ − 31916h² + 35343h + 1931
 *      φd∞  = 0,4      βd(t) = (t − t0 + 20)/(t − t0 + 70)
 *
 *  Retração (A.2.3.2):   εcs(t, t0) = εcs∞·[βs(t) − βs(t0)],   εcs∞ = ε1s·ε2s
 *      10⁴·ε1s = −8,09 + U/15 − U²/2284 − U³/133765 + U⁴/7608150  (abatimento 5–9 cm,
 *             40 % ≤ U ≤ 90 %; Tabela A.1); ∓25 % conforme o abatimento, como em φ1c
 *      ε2s  = (33 + 2·hfic)/(20,8 + 3·hfic),  hfic em cm
 *      βs(t) = [(t/100)³ + A·(t/100)² + B·(t/100)] / [(t/100)³ + C·(t/100)² + D·(t/100) + E]
 *             A = 40                               B = 116h³ − 282h² + 220h − 4,8
 *             C = −8,8h + 40,7                     D = −75h³ + 585h² + 496h − 6,8
 *             E = −169h⁴ + 88h³ + 584h² − 39h + 0,8        (h = hfic em m, 0,05 ≤ h ≤ 1,6)
 *
 * Conferência: os polinômios de ε1s e φ1c reproduzem a Tabela A.1 (U = 40, 70, 90 %), e
 * φ(t∞, t0) e εcs(t∞, t0) reproduzem a Tabela 8.2 da norma dentro da tolerância da própria
 * tabela (teste em test/timedep.test.ts). As expressões foram escritas a partir de
 * bibliografia que reproduz o Anexo A; não foram conferidas contra o texto oficial.
 *
 * Unidades: tempo em dias; fck em kPa; áreas em m², perímetro em m; εcs adimensional (< 0).
 */

export type Cement = 'CP I-II' | 'CP III-IV' | 'CP V-ARI'
/** consistência do concreto: abatimento em cm */
export type Slump = '0-4' | '5-9' | '10-15'

export interface RheologyParams {
  /** umidade relativa do ambiente (%), 40 a 90 (≥ 99 = imerso) */
  humidity: number
  /** espessura fictícia hfic = γ·2Ac/u (m) */
  hfic: number
  /** fck (kPa) */
  fck: number
  slump?: Slump
  cement?: Cement
  /** temperatura média diária do ambiente (°C); padrão 20 */
  temperature?: number
}

const S_STRENGTH: Record<Cement, number> = { 'CP III-IV': 0.38, 'CP I-II': 0.25, 'CP V-ARI': 0.2 }
const ALPHA_CREEP: Record<Cement, number> = { 'CP III-IV': 1, 'CP I-II': 2, 'CP V-ARI': 3 }
const SLUMP_FACTOR: Record<Slump, number> = { '0-4': 0.75, '5-9': 1, '10-15': 1.25 }

const clampU = (U: number): number => Math.min(90, Math.max(40, U))
const clampH = (h: number): number => Math.min(1.6, Math.max(0.05, h))

/** γ da espessura fictícia (Tabela A.1): 1 + exp(−7,8 + 0,1·U); 30 p/ concreto imerso */
export function gammaHfic(humidity: number): number {
  if (humidity >= 99) return 30
  return 1 + Math.exp(-7.8 + 0.1 * Math.min(humidity, 90))
}

/** espessura fictícia hfic = γ·2Ac/uar (m) — A.2.4.2 */
export function fictitiousThickness(Ac: number, u: number, humidity: number): number {
  if (!(Ac > 0) || !(u > 0)) return 0.3
  return (gammaHfic(humidity) * 2 * Ac) / u
}

/** idade fictícia (dias) p/ temperatura constante — A.2.4.1 */
export function fictitiousAge(days: number, temperature = 20, alpha = 1): number {
  return alpha * ((temperature + 10) / 30) * Math.max(days, 0)
}

/** φ1c (Tabela A.1) */
export function phi1c(humidity: number, slump: Slump = '5-9'): number {
  if (humidity >= 99) return 0.8 * SLUMP_FACTOR[slump]
  return (4.45 - 0.035 * clampU(humidity)) * SLUMP_FACTOR[slump]
}

/** ε1s (Tabela A.1), adimensional, negativo (retração); +1,0e-4 p/ concreto imerso */
export function eps1s(humidity: number, slump: Slump = '5-9'): number {
  if (humidity >= 99) return 1e-4
  const U = clampU(humidity)
  const v = -8.09 + U / 15 - (U * U) / 2284 - U ** 3 / 133765 + U ** 4 / 7608150
  return v * 1e-4 * SLUMP_FACTOR[slump]
}

/** βf(t): fluência irreversível lenta; t = idade fictícia (dias), h = hfic (m) */
export function betaF(t: number, hfic: number): number {
  const h = clampH(hfic)
  const A = 42 * h ** 3 - 350 * h * h + 588 * h + 113
  const B = 768 * h ** 3 - 3060 * h * h + 3234 * h - 23
  const C = -200 * h ** 3 + 13 * h * h + 1090 * h + 183
  const D = 7579 * h ** 3 - 31916 * h * h + 35343 * h + 1931
  const x = Math.max(t, 3)
  return (x * x + A * x + B) / (x * x + C * x + D)
}

/** βd(t): fluência reversível; Δ = t − t0 em dias */
export function betaD(dt: number): number {
  const d = Math.max(dt, 0)
  return (d + 20) / (d + 70)
}

/** βs(t): desenvolvimento da retração; t = idade fictícia (dias), h = hfic (m) */
export function betaS(t: number, hfic: number): number {
  const h = clampH(hfic)
  const A = 40
  const B = 116 * h ** 3 - 282 * h * h + 220 * h - 4.8
  const C = -8.8 * h + 40.7
  const D = -75 * h ** 3 + 585 * h * h + 496 * h - 6.8
  const E = -169 * h ** 4 + 88 * h ** 3 + 584 * h * h - 39 * h + 0.8
  const x = Math.max(t, 0) / 100
  // o quociente dos polinômios passa ligeiramente de 1 em idades muito altas: limita-se a 1
  return Math.min(1, (x ** 3 + A * x * x + B * x) / (x ** 3 + C * x * x + D * x + E))
}

/** razão fc(t0)/fc(t∞) pela função β1 do item 12.3.3 (t0 em dias reais) */
export function strengthRatio(t0: number, cement: Cement = 'CP I-II'): number {
  return Math.exp(-S_STRENGTH[cement] * Math.sqrt(28 / Math.max(t0, 1)))
}

export interface CreepParts {
  /** fluência rápida */
  phiA: number
  /** fluência lenta irreversível */
  phiF: number
  /** fluência lenta reversível */
  phiD: number
  phi: number
}

/**
 * Coeficiente de fluência φ(t, t0) — t e t0 em dias REAIS desde a concretagem (t0 = idade do
 * concreto ao ser carregado); a idade fictícia é aplicada internamente.
 */
export function creepParts(p: RheologyParams, t: number, t0: number): CreepParts {
  const cement = p.cement ?? 'CP I-II'
  const high = p.fck >= 50e3 - 1e-6
  const T = p.temperature ?? 20
  const tf = fictitiousAge(t, T, ALPHA_CREEP[cement])
  const tf0 = fictitiousAge(t0, T, ALPHA_CREEP[cement])
  if (!(t > t0)) return { phiA: 0, phiF: 0, phiD: 0, phi: 0 }
  const phiA = (high ? 1.4 : 0.8) * (1 - strengthRatio(t0, cement))
  const phi2c = (42 + 100 * p.hfic) / (20 + 100 * p.hfic)
  const phiFinf = (high ? 0.45 : 1) * phi1c(p.humidity, p.slump) * phi2c
  const phiF = phiFinf * Math.max(0, betaF(tf, p.hfic) - betaF(tf0, p.hfic))
  // o termo reversível usa o tempo real decorrido sob carga
  const phiD = 0.4 * betaD(t - t0)
  return { phiA, phiF, phiD, phi: phiA + phiF + phiD }
}

export function creepCoefficient(p: RheologyParams, t: number, t0: number): number {
  return creepParts(p, t, t0).phi
}

/** valor final da retração εcs∞ = ε1s·ε2s (negativo) */
export function shrinkageFinal(p: RheologyParams): number {
  const eps2s = (33 + 2 * 100 * p.hfic) / (20.8 + 3 * 100 * p.hfic)
  return eps1s(p.humidity, p.slump) * eps2s
}

/** retração εcs(t, t0) entre as idades t0 e t (dias reais; α = 1 na idade fictícia) — negativa */
export function shrinkageStrain(p: RheologyParams, t: number, t0: number): number {
  if (!(t > t0)) return 0
  const T = p.temperature ?? 20
  const tf = fictitiousAge(t, T, 1)
  const tf0 = fictitiousAge(t0, T, 1)
  return shrinkageFinal(p) * (betaS(tf, p.hfic) - betaS(tf0, p.hfic))
}

/** idade "infinita" de referência (dias) — 10 000 d ≈ 27 anos, como é usual */
export const T_INF = 10000
