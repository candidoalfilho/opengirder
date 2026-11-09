/**
 * Variações de temperatura — NBR 6118:2023 item 11.4.2 (variação uniforme e não uniforme)
 * e NBR 7187 (pontes de concreto).
 *
 * Casos (incrementos lineares sobre o estado permanente):
 *  - TU+ / TU−: variação uniforme ±ΔT em todas as barras (ε = α·ΔT) e cabos (ΔL0 = α·ΔT·L0);
 *  - TG+ / TG−: variação não uniforme no tabuleiro — gradiente linear na altura, face
 *    superior mais quente em TG+ (curvatura livre κ = −α·ΔT/h, a viga arqueia p/ cima);
 *    TG− = −0,5·TG+ (face superior mais fria, metade da amplitude — proporção usual entre
 *    aquecimento e resfriamento diferencial, cf. EN 1991-1-5 e AASHTO);
 *  - TC+ / TC−: só os cabos ±ΔT em relação à estrutura (estais e pendurais respondem à
 *    insolação muito mais depressa que o concreto).
 *
 * α: concreto 1,0·10⁻⁵ /°C (NBR 6118 8.2.3); aço e cabos 1,2·10⁻⁵ /°C (NBR 8800 4.5.2.9).
 * Barras de ligação rígida acompanham o concreto.
 */

import type { LoadCaseResult } from '../analysis/types'
import type { AnalysisContext } from '../analysis/context'
import type { CaseLoad, ImposedStrain } from '../analysis/linear'
import type { Material, Section } from '../model/types'
import type { ResolvedSite } from './site'

export function thermalAlpha(mat: Material | undefined): number {
  return mat && (mat.kind === 'steel' || mat.kind === 'cable') ? 1.2e-5 : 1.0e-5
}

interface Lookup {
  frameMat: (Material | undefined)[]
  frameSec: (Section | undefined)[]
  cableMat: (Material | undefined)[]
}

export function elementLookup(ctx: AnalysisContext): Lookup {
  const { model, sys } = ctx
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  const byId = new Map(model.elements.map((e) => [e.id, e]))
  const frameMat: Lookup['frameMat'] = []
  const frameSec: Lookup['frameSec'] = []
  for (const f of sys.frames) {
    const el = byId.get(f.id)
    frameMat.push(el ? mats.get(el.mat) : undefined)
    frameSec.push(el && el.kind === 'frame' ? secs.get(el.sec) : undefined)
  }
  const cableMat = sys.cables.map((c) => {
    const el = byId.get(c.id)
    return el ? mats.get(el.mat) : undefined
  })
  return { frameMat, frameSec, cableMat }
}

export function temperatureCases(ctx: AnalysisContext, t: Exclude<ResolvedSite['temperature'], false>): LoadCaseResult[] {
  const { sys, lin } = ctx
  const lk = elementLookup(ctx)
  const out: LoadCaseResult[] = []
  const push = (id: string, name: string, load: CaseLoad, info: LoadCaseResult['info']): void => {
    const st = lin.solve(load)
    out.push({ id, name, kind: 'temperature', sign: 'fixed', ...st, info })
  }
  const hasCables = sys.cables.length > 0

  // ---- variação uniforme
  if (t.uniform > 0) {
    for (const sgn of [1, -1]) {
      const dT = sgn * t.uniform
      const strain = new Map<number, ImposedStrain>()
      sys.frames.forEach((_, e) => strain.set(e, { eps: thermalAlpha(lk.frameMat[e]) * dT }))
      const cableDL0 = new Map<number, number>()
      sys.cables.forEach((c, i) => cableDL0.set(i, thermalAlpha(lk.cableMat[i]) * dT * c.L0))
      push(
        sgn > 0 ? 'TU+' : 'TU−',
        `Temperatura uniforme ${sgn > 0 ? '+' : '−'}${t.uniform} °C`,
        { strain, cableDL0 },
        [{ label: 'Variação uniforme', value: dT, unit: '°C' }],
      )
    }
  }

  // ---- gradiente no tabuleiro
  if (t.gradient > 0) {
    const deck: { e: number; k: number }[] = []
    sys.frames.forEach((f, e) => {
      const h = lk.frameSec[e]?.depth
      if (f.group !== 'deck' || !(h !== undefined && h > 0)) return
      deck.push({ e, k: thermalAlpha(lk.frameMat[e]) / h })
    })
    if (deck.length > 0) {
      for (const [id, dT] of [['TG+', t.gradient], ['TG−', -0.5 * t.gradient]] as const) {
        const strain = new Map<number, ImposedStrain>()
        for (const d of deck) strain.set(d.e, { kz: -d.k * dT })
        push(
          id,
          dT > 0 ? `Gradiente térmico: face superior +${t.gradient} °C` : `Gradiente térmico: face superior −${0.5 * t.gradient} °C`,
          { strain },
          [{ label: 'Face superior − inferior', value: dT, unit: '°C' }],
        )
      }
    }
  }

  // ---- cabos em relação à estrutura
  if (t.cables > 0 && hasCables) {
    for (const sgn of [1, -1]) {
      const dT = sgn * t.cables
      const cableDL0 = new Map<number, number>()
      sys.cables.forEach((c, i) => cableDL0.set(i, thermalAlpha(lk.cableMat[i]) * dT * c.L0))
      push(
        sgn > 0 ? 'TC+' : 'TC−',
        `Cabos ${sgn > 0 ? '+' : '−'}${t.cables} °C em relação à estrutura`,
        { cableDL0 },
        [{ label: 'Diferença cabos − estrutura', value: dT, unit: '°C' }],
      )
    }
  }
  return out
}
