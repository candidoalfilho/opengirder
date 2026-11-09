/**
 * ABNT NBR 7188 — Carga móvel rodoviária e de pedestres em pontes, viadutos, passarelas
 * e outras estruturas (texto de 2013; o trem-tipo TB-450 e os coeficientes de ponderação
 * das cargas verticais permanecem na revisão de 2024).
 *
 * Q = P·CIV·CNF·CIA  e  q = p·CIV·CNF·CIA
 */

export type VehicleId = 'TB-450' | 'TB-240' | 'Pedestres'

export interface VehicleSpec {
  id: VehicleId
  /** carga por roda P (kN) — 6 rodas, 3 eixos; 0 = só carga distribuída (passarelas) */
  wheelLoad: number
  /** carga distribuída p (kN/m²) */
  distributed: number
  nAxles: number
  /** distância entre eixos (m) */
  axleSpacing: number
  /** distância entre centros de roda de um eixo (m) */
  track: number
  /** área ocupada pelo veículo: largura × comprimento (m) */
  width: number
  length: number
}

export const VEHICLES: Record<VehicleId, VehicleSpec> = {
  'TB-450': {
    id: 'TB-450', wheelLoad: 75, distributed: 5, nAxles: 3, axleSpacing: 1.5, track: 2.0, width: 3.0, length: 6.0,
  },
  /** estradas vicinais municipais de uma faixa e obras particulares (item 5.1, nota) */
  'TB-240': {
    id: 'TB-240', wheelLoad: 40, distributed: 4, nAxles: 3, axleSpacing: 1.5, track: 2.0, width: 3.0, length: 6.0,
  },
  /**
   * Passarelas (seção 6): carga uniformemente distribuída p = 5,0 kN/m² entre os guarda-corpos,
   * na posição mais desfavorável, NÃO majorada por CIV, CNF ou CIA. Sem veículo.
   */
  Pedestres: {
    id: 'Pedestres', wheelLoad: 0, distributed: 5, nAxles: 0, axleSpacing: 0, track: 0, width: 0, length: 0,
  },
}

/**
 * Coeficiente de impacto vertical (item 5.1.2.1).
 *  CIV = 1,35 p/ vãos < 10 m; CIV = 1 + 1,06·(20/(Liv + 50)) p/ 10 ≤ Liv ≤ 200 m.
 * Acima de 200 m a norma exige estudo específico de amplificação dinâmica; aqui se
 * mantém o valor de 200 m (o chamador deve emitir aviso).
 */
export function civ(Liv: number): number {
  if (!(Liv >= 10)) return 1.35
  const L = Math.min(Liv, 200)
  return 1 + 1.06 * (20 / (L + 50))
}

/**
 * Coeficiente do número de faixas (item 5.1.2.2): CNF = 1 − 0,05·(n − 2) > 0,9.
 * n = nº inteiro de faixas de tráfego carregadas (acostamentos e faixas de segurança
 * não contam). Não se aplica a elementos transversais ao tráfego (lajes, transversinas).
 */
export function cnf(nLanes: number): number {
  const n = Math.max(1, Math.floor(nLanes))
  return Math.max(0.9, 1 - 0.05 * (n - 2))
}

/**
 * Coeficiente de impacto adicional (item 5.1.2.3), p/ seções a menos de 5 m de juntas
 * estruturais e extremidades: 1,25 em obras de concreto ou mistas; 1,15 em obras de aço.
 */
export function ciaFactor(material: 'concrete' | 'steel' | 'composite' | undefined): number {
  return material === 'steel' ? 1.15 : 1.25
}

/** nº de faixas de tráfego p/ o CNF, a partir da largura da pista (faixa de 3,6 m) */
export function trafficLanes(carriageway: number): number {
  return Math.max(1, Math.floor(carriageway / 3.6 + 1e-9))
}
