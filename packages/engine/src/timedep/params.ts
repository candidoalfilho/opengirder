/**
 * Parâmetros dos efeitos diferidos (`model.site.longTerm`) e coeficientes por seção.
 *
 * Padrões (pontos de partida editáveis): umidade 70 % ("ao ar livre em geral", Tabela A.1 da
 * NBR 6118), carregamento aos 28 dias, cimento CP I-II, abatimento 5–9 cm, 20 °C,
 * t∞ = 10 000 dias e coeficiente de envelhecimento χ = 0,8 (Trost-Bažant).
 */

import type { BridgeModel, Material, Section } from '../model/types'
import { sectionProperties } from '../sections/properties'
import { type Cement, type RheologyParams, type Slump, T_INF, creepCoefficient, fictitiousThickness, shrinkageStrain } from './nbr6118a'

export interface LongTermParams {
  humidity: number
  /** idade do concreto (dias) quando a carga permanente passa a atuar */
  t0: number
  cement: Cement
  slump: Slump
  temperature: number
  /** idade final de referência (dias) */
  tInf: number
  /** coeficiente de envelhecimento do método do módulo efetivo ajustado pela idade */
  chi: number
}

export const DEFAULT_LONG_TERM: LongTermParams = {
  humidity: 70, t0: 28, cement: 'CP I-II', slump: '5-9', temperature: 20, tInf: T_INF, chi: 0.8,
}

const CEMENTS: Cement[] = ['CP I-II', 'CP III-IV', 'CP V-ARI']
const SLUMPS: Slump[] = ['0-4', '5-9', '10-15']

/** barras de concreto que participam da análise diferida */
export function hasConcreteFrames(model: BridgeModel): boolean {
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  return model.elements.some((e) => e.kind === 'frame' && mats.get(e.mat)?.kind === 'concrete')
}

/** parâmetros resolvidos, ou `false` se desligado (ou se o modelo não tem concreto) */
export function resolveLongTerm(model: BridgeModel): LongTermParams | false {
  const s = model.site?.longTerm
  if (s === false || s?.enabled === false) return false
  if (!hasConcreteFrames(model)) return false
  const num = (v: unknown, d: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
  const d = DEFAULT_LONG_TERM
  const t0 = num(s?.t0, d.t0, 1, 3650)
  return {
    humidity: num(s?.humidity, d.humidity, 40, 100),
    t0,
    cement: s?.cement && CEMENTS.includes(s.cement) ? s.cement : d.cement,
    slump: s?.slump && SLUMPS.includes(s.slump) ? s.slump : d.slump,
    temperature: num(s?.temperature, d.temperature, 0, 40),
    tInf: Math.max(t0 + 1, num(s?.tInf, d.tInf, 30, 1e6)),
    chi: num(s?.chi, d.chi, 0.5, 1),
  }
}

/** área e perímetro em contato com o ar de uma seção (geometria detalhada ou caixa envolvente) */
export function sectionAirPerimeter(sec: Section): { Ac: number; u: number; approx: boolean } {
  if (sec.geometry) {
    try {
      const p = sectionProperties(sec.geometry)
      if (p.A > 0 && p.perimeter > 0) return { Ac: p.A, u: p.perimeter, approx: false }
    } catch {
      /* cai na estimativa */
    }
  }
  const b = sec.width && sec.width > 0 ? sec.width : Math.sqrt(sec.A)
  const h = sec.depth && sec.depth > 0 ? sec.depth : Math.sqrt(sec.A)
  return { Ac: sec.A, u: 2 * (b + h), approx: true }
}

export function rheologyOf(sec: Section, mat: Material, p: LongTermParams): RheologyParams {
  const { Ac, u } = sectionAirPerimeter(sec)
  return {
    humidity: p.humidity,
    hfic: fictitiousThickness(Ac, u, p.humidity),
    fck: mat.fck ?? 30e3,
    slump: p.slump,
    cement: p.cement,
    temperature: p.temperature,
  }
}

export interface SectionRheology {
  sec: string
  mat: string
  name: string
  /** espessura fictícia (m) */
  hfic: number
  /** true = perímetro estimado pela caixa envolvente (seção sem geometria detalhada) */
  approx: boolean
  /** fck (kPa) */
  fck: number
  /** φ(t∞, t0) */
  phi: number
  /** εcs(t∞, t0), negativa */
  epsCs: number
  /** nº de barras */
  nFrames: number
  rheo: RheologyParams
}

/** coeficientes por par (seção, material de concreto) usado em barras do modelo */
export function sectionRheology(model: BridgeModel, p: LongTermParams): Map<string, SectionRheology> {
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  const out = new Map<string, SectionRheology>()
  for (const e of model.elements) {
    if (e.kind !== 'frame') continue
    const mat = mats.get(e.mat)
    const sec = secs.get(e.sec)
    if (!mat || !sec || mat.kind !== 'concrete') continue
    const key = `${e.sec}|${e.mat}`
    const cur = out.get(key)
    if (cur) {
      cur.nFrames++
      continue
    }
    const rheo = rheologyOf(sec, mat, p)
    out.set(key, {
      sec: sec.id, mat: mat.id, name: sec.name, hfic: rheo.hfic, approx: sectionAirPerimeter(sec).approx, fck: rheo.fck,
      phi: creepCoefficient(rheo, p.tInf, p.t0),
      epsCs: shrinkageStrain(rheo, p.tInf, p.t0),
      nFrames: 1, rheo,
    })
  }
  return out
}

/**
 * φ(t∞, t0) e εcs(t∞, t0) do Anexo A para a barra `frameId` (seção e material dela), com os
 * parâmetros de `model.site.longTerm` — usado pelas perdas progressivas de protensão quando o
 * cabo não informa os seus. `null` se os efeitos diferidos estiverem desligados.
 */
export function annexAForFrame(model: BridgeModel, frameId: number): { phi: number; epsCs: number } | null {
  const p = resolveLongTerm(model)
  if (!p) return null
  const el = model.elements.find((e) => e.id === frameId)
  if (!el || el.kind !== 'frame') return null
  const sec = model.sections.find((q) => q.id === el.sec)
  const mat = model.materials.find((q) => q.id === el.mat)
  if (!sec || !mat || mat.kind !== 'concrete') return null
  const rheo = rheologyOf(sec, mat, p)
  return { phi: creepCoefficient(rheo, p.tInf, p.t0), epsCs: shrinkageStrain(rheo, p.tInf, p.t0) }
}
