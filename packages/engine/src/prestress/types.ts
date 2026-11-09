/**
 * Protensão do tabuleiro — pós-tração com aderência posterior (NBR 6118:2023, seção 9.6).
 *
 * Um `Tendon` é uma FAMÍLIA de cabos (cabo resultante) ao longo de um caminho do tabuleiro:
 * todas as cordoalhas com o mesmo traçado, a mesma tensão inicial e as mesmas perdas.
 *
 * Convenções: estaca `s` medida ao longo do caminho a partir do 1º nó (m); excentricidade `e`
 * em relação ao CENTROIDE da seção, positiva PARA BAIXO (m); tensões em kPa; forças em kN.
 */

export interface TendonPoint {
  /** estaca ao longo do caminho (m) */
  s: number
  /** excentricidade em relação ao centroide, + para baixo (m) */
  e: number
  /**
   * 'anchor'  = ancoragem ou ponto de passagem com tangente livre;
   * 'span'    = ponto baixo de vão (tangente horizontal);
   * 'support' = ponto alto sobre apoio (tangente horizontal; a parábola curta fica deste lado).
   * Padrão: extremos do traçado = 'anchor'; internos = 'span'.
   */
  kind?: 'anchor' | 'span' | 'support'
}

export interface Tendon {
  id: string
  name?: string
  /** id da faixa (`model.lanes`) cujo caminho de nós define o eixo do cabo… */
  lane?: string
  /** …ou o caminho explícito: ids dos nós do tabuleiro, em ordem */
  nodes?: number[]
  /** nº total de cordoalhas da família */
  nStrands: number
  /** área de cada cordoalha (m²): Ø12,7 = 0,987e-4; Ø15,2 = 1,40e-4; Ø15,7 = 1,50e-4 */
  strandArea: number
  /** resistência característica à tração (kPa): CP 190 RB = 1,9e6; CP 210 RB = 2,1e6 */
  fptk: number
  /** resistência de escoamento convencional (kPa); padrão 0,9·fptk (aços RB) */
  fpyk?: number
  /** módulo de elasticidade (kPa); padrão 200e6 (NBR 6118 8.4.4) */
  Ep?: number
  /** tensão na saída do macaco (kPa); padrão mín(0,74·fptk; 0,82·fpyk) — 9.6.1.2.1-b, aço RB */
  sigmaPi?: number
  /** coeficiente de atrito aparente cabo–bainha; padrão 0,20 (cordoalha × bainha metálica) */
  mu?: number
  /** perda por metro por curvaturas não intencionais (1/m); padrão 0,01·μ — 9.6.3.3.2.2 */
  k?: number
  /** acomodação (recuo) da ancoragem na cravação (m); padrão 0,006 */
  slip?: number
  /** extremidade(s) ativa(s); padrão 'both' */
  jacking?: 'both' | 'start' | 'end'
  /** nº de cabos (bainhas) tracionados em sequência — perda por encurtamento elástico;
   *  padrão ⌈nStrands/12⌉ */
  nCables?: number
  /** pontos de controle do traçado, em ordem crescente de `s` */
  profile: TendonPoint[]
  /** posição da inflexão entre um ponto baixo e um ponto alto: distância ao ponto ALTO como
   *  fração do trecho; padrão 0,2 (≈ 0,1 do vão) */
  inflection?: number
  /** coeficiente de fluência φ(t∞, t0); padrão 2,5 */
  phi?: number
  /** retração εcs(t∞, t0), negativa; padrão −2,5e-4 */
  epsCs?: number
  /** relaxação de 1 000 h a 20 °C em fração (ex.: 0,025); padrão: Tabela 8.4 da NBR 6118
   *  (cordoalha RB) em função de σp0/fptk */
  psi1000?: number
  /** fck na data da protensão (kPa); padrão: fck do tabuleiro */
  fckj?: number
  /** nível de protensão p/ as verificações em serviço (Tabela 13.4); padrão 'limitada' */
  level?: 'limitada' | 'completa'
}

/** propriedades da seção de concreto usadas pela protensão */
export interface PrestressSection {
  A: number
  /** inércia p/ flexão vertical (m⁴) */
  I: number
  yTop: number
  yBot: number
  /** módulo de elasticidade do concreto (kPa) */
  Ec: number
  /** fck (kPa) */
  fck: number
}

export const TENDON_DEFAULTS = {
  strandArea: 1.4e-4,
  fptk: 1.9e6,
  Ep: 200e6,
  mu: 0.2,
  slip: 0.006,
  inflection: 0.2,
  phi: 2.5,
  epsCs: -2.5e-4,
} as const

/** tensão inicial padrão na pós-tração com aço RB — NBR 6118 9.6.1.2.1-b */
export function defaultSigmaPi(fptk: number, fpyk = 0.9 * fptk): number {
  return Math.min(0.74 * fptk, 0.82 * fpyk)
}

/** parâmetros do cabo com os padrões resolvidos */
export interface TendonData {
  Ap: number
  fptk: number
  fpyk: number
  Ep: number
  sigmaPi: number
  Pi: number
  mu: number
  k: number
  slip: number
  jacking: 'both' | 'start' | 'end'
  nCables: number
  phi: number
  epsCs: number
  psi1000?: number
}

export function tendonData(t: Tendon): TendonData {
  const fptk = t.fptk > 0 ? t.fptk : TENDON_DEFAULTS.fptk
  const fpyk = t.fpyk && t.fpyk > 0 ? t.fpyk : 0.9 * fptk
  const sigmaPi = t.sigmaPi && t.sigmaPi > 0 ? t.sigmaPi : defaultSigmaPi(fptk, fpyk)
  const mu = t.mu !== undefined && t.mu >= 0 ? t.mu : TENDON_DEFAULTS.mu
  const Ap = Math.max(0, t.nStrands) * (t.strandArea > 0 ? t.strandArea : TENDON_DEFAULTS.strandArea)
  return {
    Ap, fptk, fpyk,
    Ep: t.Ep && t.Ep > 0 ? t.Ep : TENDON_DEFAULTS.Ep,
    sigmaPi,
    Pi: sigmaPi * Ap,
    mu,
    k: t.k !== undefined && t.k >= 0 ? t.k : 0.01 * mu,
    slip: t.slip !== undefined && t.slip >= 0 ? t.slip : TENDON_DEFAULTS.slip,
    jacking: t.jacking ?? 'both',
    nCables: Math.max(1, Math.round(t.nCables ?? Math.ceil(Math.max(1, t.nStrands) / 12))),
    phi: t.phi !== undefined && t.phi >= 0 ? t.phi : TENDON_DEFAULTS.phi,
    epsCs: t.epsCs !== undefined ? -Math.abs(t.epsCs) : TENDON_DEFAULTS.epsCs,
    psi1000: t.psi1000,
  }
}

/* ------------------------------------------------------------------ resultados */

/** tensões normais no concreto (kPa, tração +) nas fibras extremas, por nó do caminho */
export interface TendonStress {
  key: 'transfer' | 'qp' | 'freq' | 'rare'
  label: string
  topMin: number[]
  topMax: number[]
  botMin: number[]
  botMax: number[]
}

export interface TendonResult {
  id: string
  name: string
  nStrands: number
  /** área total de aço de protensão (m²) */
  Ap: number
  /** tensão (kPa) e força (kN) na saída do macaco */
  sigmaPi: number
  Pi: number
  /** estacas dos nós do caminho (m) e excentricidade do cabo em cada uma (m, + p/ baixo) */
  s: number[]
  e: number[]
  /** distâncias do centroide às fibras extremas (m) — p/ desenhar a seção atrás do traçado */
  yTop: number
  yBot: number
  /** estacas dos apoios verticais ao longo do caminho */
  supports: number[]
  /** força durante o estiramento (só atrito), após a cravação (atrito + acomodação),
   *  após o encurtamento elástico (P0) e final (P∞), em kN; 0 fora do traçado */
  Pjack: number[]
  Panc: number[]
  P0: number[]
  Pinf: number[]
  /** perdas médias em % de Pi: imediatas, progressivas e totais */
  lossImmediatePct: number
  lossProgressivePct: number
  lossTotalPct: number
  /** comprimento afetado pela acomodação junto a cada ancoragem ativa [início, fim] (m) */
  slipLength: [number, number]
  /** alongamento teórico do cabo no estiramento (m) */
  elongation: number
  /** soma dos desvios angulares do traçado (rad) */
  totalAngle: number
  /** momentos de protensão em t = ∞ (kN·m): isostático −P·e, total (da análise) e hiperestático */
  Miso: number[]
  Mtot: number[]
  Mhyp: number[]
  /** tensões nas fibras por situação (preenchido nas verificações) */
  stress?: TendonStress[]
}

export interface PrestressCheck {
  tendon: string
  key: 'transfer-c' | 'transfer-t' | 'els-d' | 'els-f' | 'service-c'
  name: string
  /** item de norma */
  clause: string
  /** combinação/situação usada */
  combo: string
  kind: 'tension' | 'compression'
  fibre: 'superior' | 'inferior'
  /** estaca da seção crítica (m) */
  s: number
  /** tensão crítica e limite (kPa, tração +) */
  value: number
  limit: number
  /** parcela da protensão na tensão crítica (kPa) — usada no ajuste do nº de cordoalhas */
  sigmaP: number
  ok: boolean
  /** true = só referência (não entra no veredito) */
  informative?: boolean
}
