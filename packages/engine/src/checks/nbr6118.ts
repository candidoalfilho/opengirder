/**
 * Dimensionamento de seções de concreto — ABNT NBR 6118:2023.
 *
 *  - materiais: 8.2.5 (fct,m), 8.2.10.1 e 17.2.2 (diagrama retangular: λ, αc, ηc; εc2, εcu);
 *  - flexão simples e composta reta de seção T/caixão: 17.2.2 (hipóteses), 14.6.4.3
 *    (x/d ≤ 0,45 p/ fck ≤ 50 MPa e ≤ 0,35 acima), 17.3.5.2.1 e Tabela 17.3 (armadura mínima),
 *    17.3.5.2.4 (As + As' ≤ 4 % Ac);
 *  - flexo-compressão de pilares e torres com armadura distribuída no contorno: 17.2.2 por
 *    compatibilidade de deformações (domínios 2 a 5), 17.2.5.2 (flexão oblíqua: expoente
 *    1,2 em seções retangulares), 17.3.5.3 (As,mín = 0,15·Nd/fyd ≥ 0,4 % Ac), 11.3.3.4.3
 *    (momento mínimo);
 *  - força cortante: 17.4.2.2 (modelo de cálculo I, estribos a 90°), 17.4.1.1.1 (Asw,mín);
 *  - torção: 17.5.1.5 e 17.5.1.6 (θ = 45°), interação V + T: 17.7.2.2.
 *
 * Unidades internas do motor: m, kN, kN·m, kPa. Força normal: tração positiva.
 * Áreas de aço em m² (1 m² = 10⁴ cm²).
 */

export const ES = 210e6 // kPa — módulo do aço passivo (8.3.5)
const GAMMA_C = 1.4
const GAMMA_S = 1.15

export interface ConcreteParams {
  fcd: number
  /** tensão do diagrama retangular: αc·ηc·fcd */
  sigmaCd: number
  lambda: number
  ecu: number
  ec2: number
  /** limite de x/d p/ garantir ductilidade (14.6.4.3) */
  xdLim: number
  fctm: number
  fctd: number
}

/** resistência média à tração (kPa) — 8.2.5 */
export function fctm(fck: number): number {
  const f = fck / 1000
  // fck > 50 MPa: expressão da edição de 2023 (a de 2014 era 2,12·ln(1 + 0,11·fck))
  return 1000 * (f <= 50 ? 0.3 * Math.pow(f, 2 / 3) : 2.12 * Math.log(1 + 0.1 * (f + 8)))
}

export function concreteParams(fck: number): ConcreteParams {
  const f = fck / 1000
  const fcd = fck / GAMMA_C
  const high = f > 50
  const alphaC = high ? 0.85 * (1 - (f - 50) / 200) : 0.85
  const lambda = high ? 0.8 - (f - 50) / 400 : 0.8
  // coeficiente de fragilidade ηc da revisão de 2023 (17.2.2-e)
  const etaC = f <= 40 ? 1 : Math.pow(40 / f, 1 / 3)
  const ecu = high ? 0.0026 + 0.035 * Math.pow((90 - f) / 100, 4) : 0.0035
  const ec2 = high ? 0.002 + 0.000085 * Math.pow(f - 50, 0.53) : 0.002
  const ft = fctm(fck)
  return {
    fcd, sigmaCd: alphaC * etaC * fcd, lambda, ecu, ec2,
    xdLim: high ? 0.35 : 0.45,
    fctm: ft, fctd: (0.7 * ft) / GAMMA_C,
  }
}

/** taxa mínima de armadura de flexão ρmín = As,mín/Ac — Tabela 17.3 (interpolação linear) */
export function rhoMin(fck: number): number {
  const f = fck / 1000
  const tab: [number, number][] = [
    [20, 0.15], [25, 0.15], [30, 0.15], [35, 0.164], [40, 0.179], [45, 0.194], [50, 0.208], [55, 0.211],
    [60, 0.219], [65, 0.226], [70, 0.233], [75, 0.239], [80, 0.245], [85, 0.251], [90, 0.256],
  ]
  if (f <= tab[0][0]) return tab[0][1] / 100
  for (let i = 1; i < tab.length; i++) {
    if (f <= tab[i][0]) {
      const t = (f - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0])
      return (tab[i - 1][1] + t * (tab[i][1] - tab[i - 1][1])) / 100
    }
  }
  return tab[tab.length - 1][1] / 100
}

/* ------------------------------------------------------------------ flexão (seção T) */

export interface FlexureInput {
  /** largura e espessura da mesa COMPRIMIDA (m) */
  bf: number
  hf: number
  /** soma das larguras das almas (m) */
  bw: number
  h: number
  /** altura útil da armadura passiva tracionada (m) */
  d: number
  /** fck (kPa) e fyk (kPa; padrão CA-50) */
  fck: number
  fyk?: number
  /** momento de cálculo em valor absoluto, comprimindo a mesa (kN·m) */
  Md: number
  /** força normal de cálculo concomitante, tração + (kN), aplicada no centroide */
  Nd?: number
  /** distância do centroide à borda comprimida (m); padrão h/2 */
  yc?: number
  /** aço de protensão na zona tracionada: área (m²), altura útil (m) e tensão de cálculo
   *  disponível (kPa). Com a protensão já nos esforços (N = −P, M = P·e), passar só o
   *  ACRÉSCIMO de tensão até fpyd. */
  Ap?: number
  dp?: number
  sigmaPd?: number
  /** distância da armadura comprimida à borda comprimida (m); padrão h − d */
  dComp?: number
  /** área bruta de concreto p/ armadura mínima e máxima (m²); padrão: a da seção T */
  Ac?: number
}

export interface FlexureResult {
  /** armadura tracionada necessária pelo equilíbrio (m²) */
  AsCalc: number
  /** armadura tracionada a adotar: máx(AsCalc, AsMin) (m²) */
  As: number
  /** armadura comprimida necessária (armadura dupla) (m²) */
  AsComp: number
  AsMin: number
  /** linha neutra (m) e x/d */
  x: number
  xd: number
  /** domínio de deformação: 1 (tração), 2 ou 3 */
  domain: 1 | 2 | 3
  /** precisou de armadura dupla p/ respeitar o limite de x/d */
  doubly: boolean
  /** (As + As')/Ac */
  rho: number
  ok: boolean
  notes: string[]
}

/** resultante (kN) e momento em relação à borda comprimida (kN·m) do bloco retangular de altura y */
function blockT(bf: number, hf: number, bw: number, y: number, sigma: number): { R: number; M: number } {
  if (y <= hf) return { R: sigma * bf * y, M: (sigma * bf * y * y) / 2 }
  return {
    R: sigma * ((bf - bw) * hf + bw * y),
    M: sigma * (((bf - bw) * hf * hf) / 2 + (bw * y * y) / 2),
  }
}

/**
 * Armadura passiva de flexão simples ou composta reta de seção T (ou caixão) pelo diagrama
 * retangular. Equilíbrio de momentos em relação à armadura tracionada:
 *   Rc·(d − zc) = Md − Nd·(d − yc) + Ap·σpd·(d − dp),   As·fyd = Rc − Ap·σpd + Nd.
 * Se x/d passa do limite de ductilidade, fixa-se x = x_lim e o excedente vai p/ armadura dupla.
 */
export function flexureELU(inp: FlexureInput): FlexureResult {
  const { bf, hf, h, d, fck } = inp
  const bw = Math.min(inp.bw, bf)
  const c = concreteParams(fck)
  const fyd = (inp.fyk ?? 500e3) / GAMMA_S
  const Nd = inp.Nd ?? 0
  const yc = inp.yc ?? h / 2
  const Fp = (inp.Ap ?? 0) * (inp.sigmaPd ?? 0)
  const dp = inp.dp ?? d
  const dComp = inp.dComp ?? Math.max(0.03, h - d)
  const Ac = inp.Ac ?? bf * Math.min(hf, h) + bw * Math.max(0, h - hf)
  const AsMin = rhoMin(fck) * Ac
  const notes: string[] = []
  const Mds = inp.Md - Nd * (d - yc) + Fp * (d - dp)

  const finish = (AsCalc: number, AsComp: number, x: number, domain: 1 | 2 | 3, doubly: boolean): FlexureResult => {
    const a = Math.max(0, AsCalc)
    const As = inp.Md > 0 || a > 0 ? Math.max(a, AsMin) : 0
    const rho = (As + AsComp) / Ac
    let ok = Number.isFinite(As) && Number.isFinite(AsComp)
    if (rho > 0.04) {
      ok = false
      notes.push('Taxa de armadura acima de 4 % de Ac (17.3.5.2.4).')
    }
    return { AsCalc: a, As, AsComp, AsMin, x, xd: x / d, domain, doubly, rho, ok, notes }
  }

  if (!(Mds > 0)) {
    // sem zona comprimida necessária: tração com pequena excentricidade (ou protensão dominante)
    if (Nd - Fp > 0) notes.push('Seção tracionada com pequena excentricidade: armadura só p/ a força normal.')
    return finish((Nd - Fp) / fyd, 0, 0, 1, false)
  }

  const s = c.sigmaCd
  // bloco na mesa
  let y = NaN
  const disc = d * d - (2 * Mds) / (s * bf)
  if (disc >= 0) y = d - Math.sqrt(disc)
  if (!(y <= hf)) {
    // bloco entra na alma
    const Mf = s * (bf - bw) * hf * (d - hf / 2)
    const dw = d * d - (2 * (Mds - Mf)) / (s * bw)
    y = dw >= 0 ? d - Math.sqrt(dw) : NaN
  }
  const xLim = c.xdLim * d
  let x = y / c.lambda
  if (Number.isFinite(x) && x <= xLim) {
    const { R } = blockT(bf, hf, bw, y, s)
    const x23 = (c.ecu / (c.ecu + 0.01)) * d
    return finish((R - Fp + Nd) / fyd, 0, x, x <= x23 ? 2 : 3, false)
  }
  // armadura dupla com x = x_lim
  x = xLim
  const yLim = Math.min(c.lambda * x, h)
  const blk = blockT(bf, hf, bw, yLim, s)
  const MLim = blk.R * d - blk.M
  const dM = Mds - MLim
  const eComp = (c.ecu * (x - dComp)) / x
  const sComp = Math.min(fyd, Math.max(0, ES * eComp))
  if (!(sComp > 0) || !(d - dComp > 0)) {
    notes.push('Seção insuficiente: a zona comprimida não comporta o momento.')
    return { ...finish(NaN, NaN, x, 3, true), ok: false }
  }
  const AsComp = dM / (sComp * (d - dComp))
  notes.push(`x/d limitado a ${c.xdLim.toFixed(2).replace('.', ',')} (14.6.4.3): armadura dupla.`)
  return finish((blk.R + AsComp * sComp - Fp + Nd) / fyd, AsComp, x, 3, true)
}

/* ------------------------------------------------------------------ flexo-compressão (pilares, torres) */

export interface ColumnSection {
  /** dimensão paralela à linha neutra (m) */
  b: number
  /** dimensão na direção da flexão (m) */
  h: number
  /** seção vazada: espessura das paredes paralelas à flexão (almas) e das perpendiculares (mesas) (m) */
  tw?: number
  tf?: number
  fck: number
  fyk?: number
  /** distância do eixo das barras à face (m); padrão 0,08 */
  cover?: number
}

interface Layer {
  /** profundidade a partir da borda mais comprimida (m) */
  y: number
  /** fração da armadura total */
  share: number
}

/** armadura uniformemente distribuída no contorno: faces extremas + 3 camadas nas laterais */
function perimeterLayers(b: number, h: number, cover: number): Layer[] {
  const face = b / (2 * (b + h))
  const side = h / (b + h) / 3
  return [
    { y: cover, share: face },
    { y: h / 4, share: side },
    { y: h / 2, share: side },
    { y: (3 * h) / 4, share: side },
    { y: h - cover, share: face },
  ]
}

function columnArea(s: ColumnSection): number {
  const hollow = s.tw && s.tf && s.b - 2 * s.tw > 1e-9 && s.h - 2 * s.tf > 1e-9
  return hollow ? s.b * s.h - (s.b - 2 * s.tw!) * (s.h - 2 * s.tf!) : s.b * s.h
}

/**
 * Momento resistente (em relação ao meio da altura) de seção retangular maciça ou vazada com
 * armadura total `As` distribuída no contorno, p/ a força normal `Nd` (tração +).
 * Devolve NaN se a força normal sozinha já excede a capacidade.
 */
export function columnMRd(s: ColumnSection, As: number, Nd: number): number {
  const c = concreteParams(s.fck)
  const fyd = (s.fyk ?? 500e3) / GAMMA_S
  const { b, h } = s
  const hollow = !!(s.tw && s.tf && b - 2 * s.tw > 1e-9 && h - 2 * s.tf > 1e-9)
  const tf = hollow ? s.tf! : h / 2
  const bw = hollow ? 2 * s.tw! : b
  const cover = s.cover ?? 0.08
  const layers = perimeterLayers(b, h, cover)
  const d = h - cover
  const x23 = (c.ecu / (c.ecu + 0.01)) * d
  const yC = ((c.ecu - c.ec2) / c.ecu) * h

  /** resultante e momento (borda comprimida) do bloco de altura y na seção I */
  const block = (y: number): { R: number; M: number } => {
    const yy = Math.min(y, h)
    let R = 0
    let M = 0
    const add = (y0: number, y1: number, w: number): void => {
      const a = Math.max(y0, 0)
      const e = Math.min(y1, yy)
      if (e > a) {
        R += w * (e - a)
        M += (w * (e * e - a * a)) / 2
      }
    }
    add(0, tf, b)
    add(tf, h - tf, bw)
    add(h - tf, h, b)
    return { R: c.sigmaCd * R, M: c.sigmaCd * M }
  }
  /** força normal interna (tração +) e momento em torno de h/2 p/ a linha neutra x */
  const state = (x: number): { N: number; M: number } => {
    const strain = (y: number): number => {
      // encurtamento positivo
      if (x <= x23) return (0.01 * (x - y)) / (d - x)
      if (x <= h) return (c.ecu * (x - y)) / x
      return (c.ec2 * (x - y)) / (x - yC)
    }
    const blk = block(c.lambda * x)
    let N = -blk.R
    let M = blk.R * (h / 2) - blk.M
    for (const l of layers) {
      const sg = Math.max(-fyd, Math.min(fyd, ES * strain(l.y)))
      const F = As * l.share * sg // compressão +
      N -= F
      M += F * (h / 2 - l.y)
    }
    return { N, M }
  }
  // x < 0: linha neutra fora da seção, tudo tracionado (domínio 1)
  let lo = -1000 * h
  let hi = 60 * h
  if (Nd > state(lo).N + 1e-9 || Nd < state(hi).N - 1e-9) return NaN
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2
    // N interna decresce com x
    if (state(mid).N > Nd) lo = mid
    else hi = mid
  }
  return state((lo + hi) / 2).M
}

export interface ColumnInput extends ColumnSection {
  /** força normal de cálculo, tração + (kN) */
  Nd: number
  /** momento de cálculo na direção de h (kN·m), valor absoluto */
  Md: number
  /** momento de cálculo na outra direção (flexão oblíqua), valor absoluto */
  MdOther?: number
}

export interface ColumnResult {
  /** armadura total necessária (m²), já ≥ As,mín */
  As: number
  AsMin: number
  /** As / Ac */
  rho: number
  /** aproveitamento com a armadura adotada: (Mx/MRx)^1,2 + (My/MRy)^1,2 */
  ratio: number
  /** ν = |Nd| / (Ac·fcd) */
  nu: number
  ok: boolean
  notes: string[]
}

/**
 * Armadura total de pilar/torre de seção retangular (maciça ou vazada), distribuída no
 * contorno, p/ flexo-compressão reta ou oblíqua (17.2.5.2, expoente 1,2).
 * Os efeitos locais de 2ª ordem (15.8) NÃO entram aqui — os globais já vêm da análise
 * não linear geométrica.
 */
export function columnELU(inp: ColumnInput): ColumnResult {
  const fyd = (inp.fyk ?? 500e3) / GAMMA_S
  const c = concreteParams(inp.fck)
  const Ac = columnArea(inp)
  const AsMin = Math.max((0.15 * Math.max(0, -inp.Nd)) / fyd, 0.004 * Ac)
  const AsMax = 0.08 * Ac
  const notes: string[] = []
  const other: ColumnSection = { ...inp, b: inp.h, h: inp.b, tw: inp.tf, tf: inp.tw }
  const My = inp.MdOther ?? 0
  const interaction = (As: number): number => {
    const mx = columnMRd(inp, As, inp.Nd)
    if (!(mx > 0)) return Infinity
    let r = Math.pow(inp.Md / mx, 1.2)
    if (My > 0) {
      const my = columnMRd(other, As, inp.Nd)
      if (!(my > 0)) return Infinity
      r += Math.pow(My / my, 1.2)
    }
    return r
  }
  let As = AsMin
  let ratio = interaction(As)
  if (ratio > 1) {
    if (interaction(AsMax) > 1) {
      As = AsMax
      ratio = interaction(As)
      notes.push('Seção insuficiente mesmo com 8 % de armadura.')
    } else {
      let lo = AsMin
      let hi = AsMax
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2
        if (interaction(mid) > 1) lo = mid
        else hi = mid
      }
      As = hi
      ratio = interaction(As)
    }
  }
  const rho = As / Ac
  let ok = ratio <= 1 + 1e-6
  if (rho > 0.04 + 1e-9) {
    ok = false
    notes.push('Taxa de armadura acima de 4 % de Ac (8 % na região de emendas — 17.3.5.3.2).')
  }
  return { As, AsMin, rho, ratio, nu: Math.abs(inp.Nd) / (Ac * c.fcd), ok, notes }
}

/** momento mínimo de 1ª ordem (11.3.3.4.3): M1d,mín = |Nd|·(0,015 + 0,03·h), h em m */
export function minMoment(Nd: number, h: number): number {
  return Math.abs(Math.min(Nd, 0)) * (0.015 + 0.03 * h)
}

/* ------------------------------------------------------------------ força cortante */

export interface ShearInput {
  bw: number
  d: number
  fck: number
  /** fywk (kPa); padrão CA-50. fywd é limitado a 435 MPa (17.4.2.2) */
  fywk?: number
  /** força cortante de cálculo, valor absoluto (kN) */
  Vsd: number
  /** força normal concomitante, tração + (kN) */
  Nd?: number
  /** M0/Msd,máx na flexo-compressão (17.4.2.2-b); ausente = 0 (a favor da segurança) */
  M0overMd?: number
}

export interface ShearResult {
  VRd2: number
  Vc: number
  /** estribos verticais necessários Asw/s (m²/m), já ≥ o mínimo */
  AswS: number
  AswSMin: number
  /** Vsd / VRd2 */
  ratio: number
  ok: boolean
}

/** Modelo de cálculo I (bielas a 45°, estribos a 90°) — 17.4.2.2 */
export function shearELU(inp: ShearInput): ShearResult {
  const c = concreteParams(inp.fck)
  const f = inp.fck / 1000
  const fywk = inp.fywk ?? 500e3
  const fywd = Math.min(fywk / GAMMA_S, 435e3)
  const av2 = 1 - f / 250
  const VRd2 = 0.27 * av2 * c.fcd * inp.bw * inp.d
  const Vc0 = 0.6 * c.fctd * inp.bw * inp.d
  const Nd = inp.Nd ?? 0
  let Vc = Vc0
  // flexo-tração: Vc = 0 (a favor da segurança, sem verificar a posição da linha neutra)
  if (Nd > 0) Vc = 0
  else if (Nd < 0 && inp.M0overMd) Vc = Math.min(2 * Vc0, Vc0 * (1 + inp.M0overMd))
  const AswSMin = ((0.2 * c.fctm) / fywk) * inp.bw
  const need = Math.max(0, inp.Vsd - Vc) / (0.9 * inp.d * fywd)
  return { VRd2, Vc, AswS: Math.max(need, AswSMin), AswSMin, ratio: inp.Vsd / VRd2, ok: inp.Vsd <= VRd2 }
}

/* ------------------------------------------------------------------ torção */

export interface TorsionInput {
  /** área limitada pela linha média da parede (m²), espessura da parede equivalente (m) e
   *  perímetro da linha média (m) — 17.5.1.4 */
  Ae: number
  he: number
  ue: number
  fck: number
  fywk?: number
  /** momento torçor de cálculo, valor absoluto (kN·m) */
  Tsd: number
}

export interface TorsionResult {
  TRd2: number
  /** estribos de torção por parede A90/s (m²/m) */
  A90S: number
  /** armadura longitudinal total de torção (m²) */
  Asl: number
  ratio: number
  ok: boolean
}

/** Torção de seção vazada (ou vazada equivalente) com bielas a 45° — 17.5.1.5 e 17.5.1.6 */
export function torsionELU(inp: TorsionInput): TorsionResult {
  const c = concreteParams(inp.fck)
  const av2 = 1 - inp.fck / 1000 / 250
  const fywd = Math.min((inp.fywk ?? 500e3) / GAMMA_S, 435e3)
  const TRd2 = 0.5 * av2 * c.fcd * inp.Ae * inp.he
  const A90S = inp.Tsd / (2 * inp.Ae * fywd)
  const Asl = (inp.Tsd * inp.ue) / (2 * inp.Ae * fywd)
  return { TRd2, A90S, Asl, ratio: inp.Tsd / TRd2, ok: inp.Tsd <= TRd2 }
}

/** interação cortante + torção nas bielas (17.7.2.2): Vsd/VRd2 + Tsd/TRd2 ≤ 1 */
export function shearTorsionRatio(Vsd: number, VRd2: number, Tsd: number, TRd2: number): number {
  return (VRd2 > 0 ? Vsd / VRd2 : 0) + (TRd2 > 0 ? Tsd / TRd2 : 0)
}

/* ------------------------------------------------------------------ tensões em serviço */

export interface FiberStress {
  /** tensão na fibra superior e inferior (kPa), tração + */
  top: number
  bot: number
}

/** tensões normais nas fibras extremas: σ = N/A ∓ M/W (M > 0 traciona a fibra inferior) */
export function fiberStresses(A: number, Wtop: number, Wbot: number, N: number, M: number): FiberStress {
  return { top: N / A - M / Wtop, bot: N / A + M / Wbot }
}

export interface StressLimits {
  /** compressão máxima admitida (kPa, valor positivo), ex.: 0,6·fck */
  compression?: number
  /** tração máxima admitida (kPa), ex.: fct,f na formação de fissuras; 0 = descompressão */
  tension?: number
}

/** verificação de tensões em serviço contra limites; `ratio` > 1 reprova */
export function stressELS(s: FiberStress, lim: StressLimits): { ratio: number; ok: boolean } {
  let ratio = 0
  const maxC = Math.max(-s.top, -s.bot, 0)
  const maxT = Math.max(s.top, s.bot, 0)
  if (lim.compression !== undefined && lim.compression > 0) ratio = Math.max(ratio, maxC / lim.compression)
  if (lim.tension !== undefined) ratio = Math.max(ratio, lim.tension > 0 ? maxT / lim.tension : maxT > 1e-6 ? Infinity : 0)
  return { ratio, ok: ratio <= 1 }
}
