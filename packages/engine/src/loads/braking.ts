/**
 * Frenagem e aceleração — ABNT NBR 7188:2013, item 5.2.1.
 *
 *   Hf = 0,25 · B · L · CNF  ≥  135 kN
 *
 * B = largura efetiva da carga distribuída de 5 kN/m² (m), L = comprimento concomitante da
 * carga distribuída (m). O fator 0,25 kN/m² é 5 % da carga distribuída; 135 kN é 30 % do
 * peso do veículo-tipo de 450 kN. A força atua na superfície de rolamento, na direção do
 * tráfego, em qualquer dos dois sentidos (`sign: 'both'`).
 *
 * Aqui: B = largura carregável da faixa do modelo, L = comprimento total do caminho da faixa
 * (carga distribuída em toda a obra — o valor máximo de Hf), e a força é distribuída ao longo
 * do eixo do tabuleiro, tangente a ele. A excentricidade vertical entre o pavimento e o
 * centroide da seção não é considerada.
 */

import type { Vec3 } from '../model/types'
import type { LoadCaseResult } from '../analysis/types'
import type { AnalysisContext } from '../analysis/context'
import { cnf, trafficLanes } from './nbr7188'

/** força longitudinal de frenagem/aceleração (kN) */
export function brakingForce(B: number, L: number, CNF: number): number {
  return Math.max(135, 0.25 * B * L * CNF)
}

export function brakingCase(ctx: AnalysisContext): LoadCaseResult | null {
  const { model, sys, lin } = ctx
  if (model.lanes.length === 0) return null
  const X = sys.X
  const F = new Float64Array(6 * sys.nNodes)
  const uniform = new Map<number, Vec3>()
  // barra que liga cada par de nós (a carga é distribuída na barra; sem barra, vai aos nós)
  const byPair = new Map<number, number>()
  const key = (i: number, j: number): number => Math.min(i, j) * sys.nNodes + Math.max(i, j)
  sys.frames.forEach((f, e) => {
    const k = key(f.a, f.b)
    if (!byPair.has(k)) byPair.set(k, e)
  })
  const info: NonNullable<LoadCaseResult['info']> = []
  let total = 0
  for (const lane of model.lanes) {
    const nodes = lane.nodes.map((id) => sys.nodeIndex.get(id)).filter((i): i is number => i !== undefined)
    const m = nodes.length
    if (m < 2) continue
    const seg: number[] = []
    let L = 0
    for (let k = 1; k < m; k++) {
      const i = nodes[k]
      const j = nodes[k - 1]
      const d = Math.hypot(X[3 * i] - X[3 * j], X[3 * i + 1] - X[3 * j + 1], X[3 * i + 2] - X[3 * j + 2])
      seg.push(d)
      L += d
    }
    if (!(L > 0)) continue
    const CNF = cnf(trafficLanes(lane.width))
    const Hf = brakingForce(lane.width, L, CNF)
    // sentido de referência: +X (todas as faixas freiam p/ o mesmo lado)
    const dir = X[3 * nodes[m - 1]] - X[3 * nodes[0]] >= 0 ? 1 : -1
    for (let k = 1; k < m; k++) {
      const d = seg[k - 1]
      if (!(d > 0)) continue
      const i = nodes[k]
      const j = nodes[k - 1]
      // força por comprimento Hf/L na direção da tangente (j → i)
      const w = (dir * Hf) / L / d
      const t: Vec3 = [(X[3 * i] - X[3 * j]) * w, (X[3 * i + 1] - X[3 * j + 1]) * w, (X[3 * i + 2] - X[3 * j + 2]) * w]
      const e = byPair.get(key(i, j))
      if (e !== undefined) {
        const cur = uniform.get(e)
        uniform.set(e, cur ? [cur[0] + t[0], cur[1] + t[1], cur[2] + t[2]] : t)
      } else {
        for (let c = 0; c < 3; c++) {
          F[6 * i + c] += (t[c] * d) / 2
          F[6 * j + c] += (t[c] * d) / 2
        }
      }
    }
    total += Hf
    info.push({ label: `Hf — ${lane.name}`, value: Hf, unit: 'kN' })
    info.push({ label: `B × L — ${lane.name}`, value: lane.width * L, unit: 'm²' })
  }
  if (!(total > 0)) return null
  const st = lin.solve({ nodal: F, uniform })
  return {
    id: 'FR',
    name: 'Frenagem e aceleração (NBR 7188)',
    kind: 'braking',
    sign: 'both',
    ...st,
    info,
  }
}
