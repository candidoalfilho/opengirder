/**
 * Vento estático transversal — ABNT NBR 6123 (forças devidas ao vento).
 *
 *   Vk = V0·S1·S2·S3      q = 0,613·Vk²  (N/m², Vk em m/s)      F = Ca·q·Ae
 *
 * S2 = b·Fr·(z/10)^p (item 5.3.3, Tabela 1 da edição de 1988 / Tabela 2 de parâmetros
 * meteorológicos), com a categoria de rugosidade do local e a classe pela maior dimensão da
 * obra (A ≤ 20 m, B ≤ 50 m, C > 50 m). z é a cota do meio do elemento acima do ponto mais
 * baixo do modelo, com mínimo de 10 m (o modelo não conhece o nível do terreno/água).
 *
 * Coeficientes de arrasto adotados (a NBR 6123:1988 não traz tabuleiros de ponte; a revisão
 * de 2023 ganhou um capítulo próprio, item 11.3, que NÃO está implementado aqui):
 *  - tabuleiro: Ca = 2,5 − 0,3·(B/d), limitado a [1,3; 2,4], referido à altura exposta d
 *    (EN 1991-1-4, Fig. 8.3). d = altura da seção + 1,0 m de barreiras (ponte descarregada)
 *    ou + 2,0 m de veículos (ponte carregada — NB-2/NBR 7187 e EN 1991-1-4 8.3.1(5));
 *  - torres e pilares: Ca = 2,0 (prisma de seção retangular de cantos vivos, NBR 6123
 *    Tabela 10, sem redução por esbeltez — a favor da segurança);
 *  - cabos: Ca = 1,2 em regime subcrítico e 0,7 acima de Re = 4,2·10⁵ (NBR 6123, Tabela 10,
 *    cilindros lisos; Re = 70000·Vk·d). Diâmetro externo estimado da área de aço:
 *    estais 2,0·√(4A/π) (feixe de cordoalhas em tubo de PEAD), cabos principais 1,12·√(4A/π)
 *    (fios compactados, ~20 % de vazios), pendurais 1,3·√(4A/π).
 *
 * Dois casos, ambos com sentido indefinido (`sign: 'both'`):
 *  - 'W'  — ponte descarregada, vento pleno;
 *  - 'WT' — ponte carregada: pressão reduzida a 2/3 (1,0 kN/m² contra 1,5 kN/m² da NB-2,
 *    mantida na prática da NBR 7187) sobre a altura com veículos. Só combina com carga móvel.
 *
 * A força atua em Y global; em barras oblíquas ao vento vale só a componente normal
 * (q·sen²θ). Efeitos de sombra entre tabuleiros/planos de cabos e a sustentação e o momento
 * aerodinâmico do tabuleiro não são considerados.
 */

import type { Vec3 } from '../model/types'
import type { LoadCaseResult } from '../analysis/types'
import type { AnalysisContext } from '../analysis/context'
import type { ResolvedSite } from './site'
import { elementLookup } from './temperature'

/** parâmetros b e p por categoria (linhas) e classe A, B, C (colunas); Fr é o da categoria II */
const S2_B: number[][] = [
  [1.1, 1.11, 1.12],
  [1.0, 1.0, 1.0],
  [0.94, 0.94, 0.93],
  [0.86, 0.85, 0.84],
  [0.74, 0.73, 0.71],
]
const S2_P: number[][] = [
  [0.06, 0.065, 0.07],
  [0.085, 0.09, 0.1],
  [0.1, 0.105, 0.115],
  [0.12, 0.125, 0.135],
  [0.15, 0.16, 0.175],
]
const S2_FR = [1.0, 0.98, 0.95]

export type WindClass = 'A' | 'B' | 'C'

export function windClass(maxDimension: number): WindClass {
  return maxDimension <= 20 ? 'A' : maxDimension <= 50 ? 'B' : 'C'
}

/** fator S2 = b·Fr·(z/10)^p */
export function s2Factor(category: 1 | 2 | 3 | 4 | 5, cls: WindClass, z: number): number {
  const c = cls === 'A' ? 0 : cls === 'B' ? 1 : 2
  return S2_B[category - 1][c] * S2_FR[c] * Math.pow(Math.max(z, 1e-6) / 10, S2_P[category - 1][c])
}

/** pressão dinâmica (kN/m²) p/ a velocidade característica Vk (m/s) */
export function dynamicPressure(Vk: number): number {
  return (0.613 * Vk * Vk) / 1000
}

/** arrasto do tabuleiro referido à altura exposta d (EN 1991-1-4, Fig. 8.3) */
export function deckDrag(width: number, exposedDepth: number): number {
  if (!(exposedDepth > 0)) return 1.3
  return Math.min(2.4, Math.max(1.3, 2.5 - (0.3 * width) / exposedDepth))
}

/** arrasto de cabo de diâmetro d (m) sob Vk (m/s) */
export function cableDrag(Vk: number, d: number): number {
  return 70000 * Vk * d > 4.2e5 ? 0.7 : 1.2
}

const CABLE_DIAMETER: Record<string, number> = { stay: 2.0, 'main-cable': 1.12, hanger: 1.3 }

/** diâmetro externo estimado de um cabo de área metálica A (m²) */
export function cableDiameter(A: number, group: string | undefined): number {
  return (CABLE_DIAMETER[group ?? ''] ?? 1.3) * Math.sqrt((4 * A) / Math.PI)
}

const TOWER_DRAG = 2.0
const BARRIER_HEIGHT = 1.0
const VEHICLE_HEIGHT = 2.0
const LOADED_PRESSURE_FACTOR = 2 / 3

export function windCases(ctx: AnalysisContext, w: Exclude<ResolvedSite['wind'], false>): LoadCaseResult[] {
  const { sys, lin } = ctx
  if (!(w.V0 > 0)) return []
  const lk = elementLookup(ctx)
  const X = sys.X
  const n = sys.nNodes
  let lo: Vec3 = [Infinity, Infinity, Infinity]
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], X[3 * i + c])
      hi[c] = Math.max(hi[c], X[3 * i + c])
    }
  }
  const cls = windClass(Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))
  const zOf = (a: number, b: number): number => Math.max(10, (X[3 * a + 2] + X[3 * b + 2]) / 2 - lo[2])
  const vk = (z: number): number => w.V0 * w.S1 * s2Factor(w.category, cls, z) * w.S3

  const build = (loaded: boolean): { uniform: Map<number, Vec3>; nodal: Float64Array; info: NonNullable<LoadCaseResult['info']> } => {
    const kq = loaded ? LOADED_PRESSURE_FACTOR : 1
    const uniform = new Map<number, Vec3>()
    const nodal = new Float64Array(6 * n)
    let deckV = 0
    let deckQ = 0
    let deckCa = 0
    let deckF = 0
    let deckLen = 0
    let total = 0
    sys.frames.forEach((f, e) => {
      const sec = lk.frameSec[e]
      if (!sec || f.group === 'rigid' || f.group === 'crossbeam' || sec.shape === 'rigid') return
      const R = f.R
      // t = versor ⟂ à barra e ao vento (Y); sen²θ = 1 − ex_y²
      const sin2 = 1 - R[1] * R[1]
      if (sin2 < 1e-6) return
      const V = vk(zOf(f.a, f.b))
      const q = kq * dynamicPressure(V)
      let fy: number
      if (f.group === 'deck') {
        const d = (sec.depth ?? 0) + (loaded ? VEHICLE_HEIGHT : BARRIER_HEIGHT)
        const Ca = deckDrag(sec.width ?? 0, d)
        fy = q * Ca * d * sin2
        deckV += V * f.L0
        deckQ += q * f.L0
        deckCa += Ca * f.L0
        deckF += fy * f.L0
        deckLen += f.L0
      } else {
        // dimensão da seção vista pelo vento: altura (eixo y local) e largura (eixo z local)
        const s = Math.sqrt(sin2)
        const tx = -R[2] / s
        const tz = R[0] / s
        const h = sec.depth ?? Math.sqrt(sec.A)
        const b = sec.width ?? Math.sqrt(sec.A)
        const exposed = h * Math.abs(R[3] * tx + R[5] * tz) + b * Math.abs(R[6] * tx + R[8] * tz)
        fy = q * TOWER_DRAG * exposed * sin2
      }
      if (!(fy > 0)) return
      uniform.set(e, [0, fy, 0])
      total += fy * f.L0
    })
    sys.cables.forEach((c) => {
      const dx = X[3 * c.b] - X[3 * c.a]
      const dy = X[3 * c.b + 1] - X[3 * c.a + 1]
      const dz = X[3 * c.b + 2] - X[3 * c.a + 2]
      const L = Math.hypot(dx, dy, dz)
      if (!(L > 0)) return
      const sin2 = 1 - (dy / L) ** 2
      const V = vk(zOf(c.a, c.b))
      const d = cableDiameter(c.A, c.group)
      const F = kq * dynamicPressure(V) * cableDrag(V, d) * d * L * sin2
      nodal[6 * c.a + 1] += F / 2
      nodal[6 * c.b + 1] += F / 2
      total += F
    })
    const info: NonNullable<LoadCaseResult['info']> = []
    if (deckLen > 0) {
      info.push({ label: 'Vk no tabuleiro', value: deckV / deckLen, unit: 'm/s' })
      info.push({ label: loaded ? 'Pressão no tabuleiro (2/3·q)' : 'Pressão dinâmica no tabuleiro', value: deckQ / deckLen, unit: 'kN/m²' })
      info.push({ label: 'Ca do tabuleiro', value: deckCa / deckLen, unit: '' })
      info.push({ label: 'Força no tabuleiro', value: deckF / deckLen, unit: 'kN/m' })
    }
    info.push({ label: 'Força transversal total', value: total, unit: 'kN' })
    return { uniform, nodal, info }
  }

  const out: LoadCaseResult[] = []
  const a = build(false)
  out.push({
    id: 'W', name: 'Vento transversal — ponte descarregada (NBR 6123)', kind: 'wind', sign: 'both',
    ...lin.solve({ uniform: a.uniform, nodal: a.nodal }), info: a.info,
  })
  if (ctx.model.lanes.length > 0) {
    const b = build(true)
    out.push({
      id: 'WT', name: 'Vento transversal — ponte carregada', kind: 'wind', sign: 'both',
      ...lin.solve({ uniform: b.uniform, nodal: b.nodal }), info: b.info,
    })
  }
  return out
}
