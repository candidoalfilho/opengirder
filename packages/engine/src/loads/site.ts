/**
 * Ações do local da obra — padrões e resolução de `model.site`.
 *
 * O que não estiver definido em `model.site` assume os valores de `DEFAULT_SITE`;
 * `false` desliga a ação. Os padrões são pontos de partida editáveis, não valores de norma
 * p/ um local específico:
 *  - temperatura: ΔT uniforme ±15 °C (NBR 6118 11.4.2.1: 10 a 15 °C em torno da média p/
 *    elementos com menor dimensão ≤ 50 cm); gradiente de 10 °C entre as faces do tabuleiro de
 *    concreto e 15 °C em tabuleiros de aço ou mistos; cabos ±10 °C em relação à estrutura
 *    (cabos respondem mais rápido à insolação — prática de projeto de estaiadas);
 *  - vento: V0 = 35 m/s, S1 = 1,0, categoria II, S3 = 1,11 (NBR 6123:2023, grupo 1, que passou
 *    a citar pontes rodoviárias e ferroviárias; na edição de 1988 o grupo 1 valia 1,10);
 *  - frenagem ligada; sismo desligado (NBR 15421, zona 0 dispensa verificação).
 */

import type { BridgeModel, SiteActions } from '../model/types'
import { type LongTermParams, resolveLongTerm } from '../timedep/params'

type On<T> = Exclude<T, false | undefined>

export interface ResolvedSite {
  temperature: On<SiteActions['temperature']> | false
  wind: On<SiteActions['wind']> | false
  braking: boolean
  seismic: On<SiteActions['seismic']> | false
  /** fluência e retração (timedep/params.ts); false = desligado ou modelo sem concreto */
  longTerm: LongTermParams | false
}

export const DEFAULT_SITE: {
  temperature: On<SiteActions['temperature']>
  wind: On<SiteActions['wind']>
  braking: boolean
  seismic: On<SiteActions['seismic']>
} = {
  temperature: { uniform: 15, gradient: 10, cables: 10 },
  wind: { V0: 35, S1: 1, category: 2, S3: 1.11 },
  braking: true,
  /** valores usados quando o sismo é ligado sem parâmetros (zona 1, terreno C) */
  seismic: { ag: 0.05, soil: 'C', R: 1.5, I: 1.25 },
}

/** gradiente térmico padrão conforme o material do tabuleiro (°C) */
export function defaultGradient(deckMaterial: 'concrete' | 'steel' | 'composite' | undefined): number {
  return deckMaterial === 'steel' || deckMaterial === 'composite' ? 15 : 10
}

export function resolveSite(model: BridgeModel): ResolvedSite {
  const s = model.site ?? {}
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  let temperature: ResolvedSite['temperature'] = false
  if (s.temperature !== false) {
    const t = s.temperature
    temperature = {
      uniform: Math.abs(num(t?.uniform, DEFAULT_SITE.temperature.uniform)),
      gradient: Math.abs(num(t?.gradient, defaultGradient(model.meta?.deckMaterial))),
      cables: Math.abs(num(t?.cables, DEFAULT_SITE.temperature.cables)),
    }
  }
  let wind: ResolvedSite['wind'] = false
  if (s.wind !== false) {
    const w = s.wind
    const cat = Math.round(num(w?.category, DEFAULT_SITE.wind.category))
    wind = {
      V0: Math.max(0, num(w?.V0, DEFAULT_SITE.wind.V0)),
      S1: num(w?.S1, DEFAULT_SITE.wind.S1),
      category: (cat >= 1 && cat <= 5 ? cat : 2) as 1 | 2 | 3 | 4 | 5,
      S3: num(w?.S3, DEFAULT_SITE.wind.S3),
    }
  }
  let seismic: ResolvedSite['seismic'] = false
  if (s.seismic) {
    seismic = {
      ag: num(s.seismic.ag, DEFAULT_SITE.seismic.ag),
      soil: s.seismic.soil ?? DEFAULT_SITE.seismic.soil,
      R: num(s.seismic.R, DEFAULT_SITE.seismic.R),
      I: num(s.seismic.I, DEFAULT_SITE.seismic.I),
    }
  }
  return { temperature, wind, braking: s.braking !== false, seismic, longTerm: resolveLongTerm(model) }
}
