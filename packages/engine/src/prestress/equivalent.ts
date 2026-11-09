/**
 * Cargas equivalentes da protensão no modelo de barras.
 *
 * O cabo é substituído pelas forças que exerce sobre o concreto. Em cada barra do caminho o
 * traçado é aproximado pela parábola que passa pelas excentricidades do início, do meio e do
 * fim (exata quando o traçado é parabólico dentro da barra), e a força é a média P da barra:
 *
 *   - carga transversal uniforme  w = −P·e''  (para cima quando o cabo é côncavo para cima);
 *   - no nó inicial: força axial +P (comprime a barra), transversal −P·e'(a), momento +P·e(a);
 *   - no nó final:   força axial −P, transversal +P·e'(b), momento −P·e(b).
 *
 * O conjunto de cada barra é autoequilibrado, logo a protensão não gera reações numa estrutura
 * isostática. Nos nós internos as parcelas de barras vizinhas se cancelam, sobrando a variação
 * de P (atrito transferido ao concreto) e as forças de desvio concentradas. Ângulos pequenos:
 * cos θ ≈ 1 e sen θ ≈ tg θ = e'.
 *
 * O caso resolvido com `LinearSolver` dá o efeito TOTAL da protensão (isostático +
 * hiperestático): N ≈ −P e Mz = −P·e + M_hiper (Mz > 0 traciona a fibra inferior).
 */

import type { Vec3 } from '../model/types'
import type { FrameForces } from '../analysis/types'
import type { BridgeSystem } from '../analysis/system'
import type { CaseLoad } from '../analysis/linear'
import type { Tendon } from './types'
import type { TendonProfile } from './profile'

export interface TendonPath {
  /** índices (ordem de model.nodes) dos nós do caminho */
  nodes: number[]
  /** estaca de cada nó, a partir do primeiro (m) */
  s: number[]
  /** trecho k liga nodes[k] → nodes[k+1]: índice da barra em sys.frames e se ela está invertida */
  segs: { frame: number; flip: boolean }[]
}

/** caminho do cabo: nós da faixa (ou lista explícita) ligados por barras */
export function tendonPath(sys: BridgeSystem, t: Tendon): TendonPath {
  const model = sys.model
  let ids = t.nodes
  if (!ids || ids.length < 2) {
    const lane = t.lane ? model.lanes.find((l) => l.id === t.lane) : model.lanes[0]
    if (!lane) throw new Error(`cabo ${t.id}: faixa "${t.lane ?? ''}" não encontrada`)
    ids = lane.nodes
  }
  const byPair = new Map<string, number>()
  sys.frames.forEach((f, e) => {
    const key = f.a < f.b ? `${f.a}:${f.b}` : `${f.b}:${f.a}`
    if (!byPair.has(key)) byPair.set(key, e)
  })
  const nodes: number[] = []
  const s: number[] = []
  const segs: TendonPath['segs'] = []
  const X = sys.X
  for (const id of ids) {
    const i = sys.nodeIndex.get(id)
    if (i === undefined) continue
    if (nodes.length === 0) {
      nodes.push(i)
      s.push(0)
      continue
    }
    const j = nodes[nodes.length - 1]
    if (i === j) continue
    const L = Math.hypot(X[3 * i] - X[3 * j], X[3 * i + 1] - X[3 * j + 1], X[3 * i + 2] - X[3 * j + 2])
    if (!(L > 1e-9)) continue // nós duplicados em junta
    const e = byPair.get(j < i ? `${j}:${i}` : `${i}:${j}`)
    if (e === undefined) throw new Error(`cabo ${t.id}: não há barra entre os nós ${model.nodes[j].id} e ${id}`)
    segs.push({ frame: e, flip: sys.frames[e].a !== j })
    nodes.push(i)
    s.push(s[s.length - 1] + L)
  }
  if (segs.length === 0) throw new Error(`cabo ${t.id}: caminho sem barras`)
  return { nodes, s, segs }
}

/** o trecho k tem cabo? (ponto médio dentro do traçado) */
export function segActive(path: TendonPath, profile: TendonProfile, k: number): boolean {
  const sm = 0.5 * (path.s[k] + path.s[k + 1])
  return sm >= profile.s0 && sm <= profile.s1
}

/**
 * Soma em `load` as cargas equivalentes de um cabo com força `P` (kN) em cada nó do caminho.
 * `load.nodal` e `load.uniform` precisam existir.
 */
export function addEquivalentLoads(
  sys: BridgeSystem,
  path: TendonPath,
  profile: TendonProfile,
  P: ArrayLike<number>,
  load: CaseLoad & { nodal: Float64Array; uniform: Map<number, Vec3> },
): void {
  for (let k = 0; k < path.segs.length; k++) {
    if (!segActive(path, profile, k)) continue
    const { frame, flip } = path.segs[k]
    const f = sys.frames[frame]
    const a = path.nodes[k]
    const b = path.nodes[k + 1]
    const L = path.s[k + 1] - path.s[k]
    const Pm = 0.5 * (P[k] + P[k + 1])
    if (!(Pm > 0)) continue
    const ea = profile.e(path.s[k])
    const em = profile.e(0.5 * (path.s[k] + path.s[k + 1]))
    const eb = profile.e(path.s[k + 1])
    const da = (-3 * ea + 4 * em - eb) / L
    const db = (ea - 4 * em + 3 * eb) / L
    const dd = (4 * (ea - 2 * em + eb)) / (L * L)
    // eixos: t ao longo do caminho, y = eixo local y da barra (para cima), z' = t × y
    const R = f.R
    const sg = flip ? -1 : 1
    const t: Vec3 = [sg * R[0], sg * R[1], sg * R[2]]
    const y: Vec3 = [R[3], R[4], R[5]]
    const z: Vec3 = [t[1] * y[2] - t[2] * y[1], t[2] * y[0] - t[0] * y[2], t[0] * y[1] - t[1] * y[0]]
    const put = (node: number, Ft: number, Fy: number, M: number): void => {
      for (let d = 0; d < 3; d++) {
        load.nodal[6 * node + d] += Ft * t[d] + Fy * y[d]
        load.nodal[6 * node + 3 + d] += M * z[d]
      }
    }
    put(a, Pm, -Pm * da, Pm * ea)
    put(b, -Pm, Pm * db, -Pm * eb)
    const w = -Pm * dd
    const cur = load.uniform.get(frame)
    if (cur) load.uniform.set(frame, [cur[0] + w * y[0], cur[1] + w * y[1], cur[2] + w * y[2]])
    else load.uniform.set(frame, [w * y[0], w * y[1], w * y[2]])
  }
}

/** valores de N e Mz nos nós do caminho (início de cada trecho; no último nó, fim do último) */
export function alongPath(path: TendonPath, frames: FrameForces[]): { N: number[]; Mz: number[] } {
  const N: number[] = []
  const Mz: number[] = []
  const n = path.segs.length
  for (let k = 0; k <= n; k++) {
    const seg = path.segs[Math.min(k, n - 1)]
    const f = frames[seg.frame]
    const start = k < n
    const st = start !== seg.flip ? 0 : 2
    N.push(f.N[st])
    Mz.push(f.Mz[st])
  }
  return { N, Mz }
}
