/**
 * Sistema global: numeração de GDL (com reordenação RCM), dados de elemento prontos p/
 * avaliação, cargas permanentes, massas concentradas, e a avaliação
 * (forças internas + rigidez tangente) no estado deformado.
 */

import type { BridgeModel, ElementGroup, Vec3 } from '../model/types'
import { SkylineMatrix, buildProfile } from './skyline'
import { rcmOrder } from './rcm'
import { G, frameAxes } from './geometry'
import {
  addGeometricStiffness,
  corotate,
  equivalentNodalLoads,
  globalStiffness,
  localStiffness,
  toGlobal,
  toLocal,
} from './frame'
import { type CableState, evalCable, newCableState, unstressedLengthForTension } from './catenary'

export interface FrameEl {
  id: number
  a: number
  b: number
  L0: number
  /** coordenadas iniciais [x1,y1,z1,x2,y2,z2] */
  x: Float64Array
  R0: Float64Array
  EA: number
  EIy: number
  EIz: number
  GJ: number
  kl: Float64Array
  /** carga permanente distribuída, eixos globais (kN/m) */
  w: Vec3
  /** massa por comprimento (t/m) e inércia polar de massa por comprimento (t·m²/m) */
  mass: number
  polar: number
  group?: ElementGroup
  // estado (última avaliação)
  R: Float64Array
  ul: Float64Array
  N: number
}

export interface CableEl {
  id: number
  a: number
  b: number
  EA: number
  A: number
  /** peso por comprimento indeformado (kN/m) */
  w: number
  L0: number
  fpk: number
  group?: ElementGroup
  strands?: number
  st: CableState
}

export interface BridgeSystem {
  model: BridgeModel
  nNodes: number
  nodeIndex: Map<number, number>
  /** coordenadas iniciais (3 por nó) */
  X: Float64Array
  /** nº da equação por GDL (6 por nó); −1 = restrito */
  eq: Int32Array
  nEq: number
  frames: FrameEl[]
  cables: CableEl[]
  /** forças externas permanentes (6 por nó) */
  fext: Float64Array
  /** massas concentradas (6 por nó) */
  mass: Float64Array
  /** molas de apoio (6 por nó) */
  springs: Float64Array
  minRow: Int32Array
  warnings: string[]
}

export function buildSystem(model: BridgeModel): BridgeSystem {
  const warnings: string[] = []
  const n = model.nodes.length
  const nodeIndex = new Map<number, number>()
  model.nodes.forEach((nd, i) => nodeIndex.set(nd.id, i))
  const X = new Float64Array(3 * n)
  model.nodes.forEach((nd, i) => {
    X[3 * i] = nd.x
    X[3 * i + 1] = nd.y
    X[3 * i + 2] = nd.z
  })
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  const hasLoadCases = model.loadCases.length > 0
  const selfWeight = !hasLoadCases || model.loadCases.some((lc) => lc.selfWeight)

  const fext = new Float64Array(6 * n)
  const mass = new Float64Array(6 * n)
  const springs = new Float64Array(6 * n)
  const uniform = new Map<number, Vec3>()
  for (const lc of model.loadCases) {
    for (const nl of lc.nodal ?? []) {
      const i = nodeIndex.get(nl.node)
      if (i === undefined) continue
      for (let d = 0; d < 6; d++) fext[6 * i + d] += nl.F[d]
    }
    for (const ul of lc.uniform ?? []) {
      const w = uniform.get(ul.element) ?? [0, 0, 0]
      uniform.set(ul.element, [w[0] + ul.w[0], w[1] + ul.w[1], w[2] + ul.w[2]])
    }
  }

  const frames: FrameEl[] = []
  const cables: CableEl[] = []
  const hasFrame = new Uint8Array(n)
  const hasAny = new Uint8Array(n)
  const adj: number[][] = Array.from({ length: n }, () => [])
  const fg = new Float64Array(12)

  for (const el of model.elements) {
    const a = nodeIndex.get(el.n1)
    const b = nodeIndex.get(el.n2)
    const mat = mats.get(el.mat)
    if (a === undefined || b === undefined || !mat || a === b) continue
    const p1: Vec3 = [X[3 * a], X[3 * a + 1], X[3 * a + 2]]
    const p2: Vec3 = [X[3 * b], X[3 * b + 1], X[3 * b + 2]]
    adj[a].push(b)
    adj[b].push(a)
    hasAny[a] = 1
    hasAny[b] = 1

    if (el.kind === 'frame') {
      const sec = secs.get(el.sec)
      if (!sec) continue
      const ax = frameAxes(p1, p2, el.up)
      if (!(ax.L > 0)) continue
      hasFrame[a] = 1
      hasFrame[b] = 1
      const R0 = Float64Array.from([...ax.ex, ...ax.ey, ...ax.ez])
      const wDead = selfWeight ? mat.gamma * sec.A + (sec.extraDead ?? 0) : 0
      const wu = uniform.get(el.id) ?? [0, 0, 0]
      const w: Vec3 = [wu[0], wu[1], wu[2] - wDead]
      // cargas nodais equivalentes (geometria inicial)
      const wl = [
        R0[0] * w[0] + R0[1] * w[1] + R0[2] * w[2],
        R0[3] * w[0] + R0[4] * w[1] + R0[5] * w[2],
        R0[6] * w[0] + R0[7] * w[1] + R0[8] * w[2],
      ]
      toGlobal(R0, equivalentNodalLoads(ax.L, wl[0], wl[1], wl[2]), fg)
      for (let d = 0; d < 6; d++) {
        fext[6 * a + d] += fg[d]
        fext[6 * b + d] += fg[6 + d]
      }
      // massas: translação mL/2; rotação em torno do eixo = inércia polar; ⟂ ao eixo = HRZ mL³/78
      const m = (mat.gamma * sec.A + (sec.extraDead ?? 0)) / G
      const rg = sec.massRadius ?? (sec.A > 0 ? Math.sqrt((sec.Iy + sec.Iz) / sec.A) : 0)
      const polar = m * rg * rg
      const half = (m * ax.L) / 2
      const jAxis = (polar * ax.L) / 2
      const jBend = (m * ax.L ** 3) / 78
      for (const nd of [a, b]) {
        for (let d = 0; d < 3; d++) {
          mass[6 * nd + d] += half
          const e2 = ax.ex[d] * ax.ex[d]
          mass[6 * nd + 3 + d] += jAxis * e2 + jBend * (1 - e2)
        }
      }
      frames.push({
        id: el.id, a, b, L0: ax.L,
        x: Float64Array.from([...p1, ...p2]),
        R0,
        EA: mat.E * sec.A, EIy: mat.E * sec.Iy, EIz: mat.E * sec.Iz, GJ: mat.G * sec.J,
        kl: localStiffness(ax.L, mat.E * sec.A, mat.E * sec.Iy, mat.E * sec.Iz, mat.G * sec.J),
        w, mass: m, polar, group: el.group,
        R: Float64Array.from(R0), ul: new Float64Array(12), N: 0,
      })
    } else {
      const d: Vec3 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
      const lh = Math.hypot(d[0], d[1])
      const c = Math.hypot(lh, d[2])
      if (!(c > 0) || !(el.A > 0)) continue
      const EA = mat.E * el.A
      const w = mat.gamma * el.A
      let L0 = el.L0
      if (!(L0 !== undefined && L0 > 0)) {
        L0 = el.pretension && el.pretension > 0 ? unstressedLengthForTension(lh, d[2], EA, w, el.pretension) : c
      }
      const mc = (w * L0) / G / 2
      for (const nd of [a, b]) for (let k = 0; k < 3; k++) mass[6 * nd + k] += mc
      cables.push({
        id: el.id, a, b, EA, A: el.A, w, L0, fpk: mat.fpk ?? 0, group: el.group, strands: el.strands,
        st: newCableState(),
      })
    }
  }

  // restrições: apoios + rotações de nós sem barra (só cabos) + nós soltos
  const fixed = new Uint8Array(6 * n)
  model.nodes.forEach((nd, i) => {
    if (nd.fix) for (let d = 0; d < 6; d++) if (nd.fix[d]) fixed[6 * i + d] = 1
    if (nd.springs) for (let d = 0; d < 6; d++) springs[6 * i + d] = nd.springs[d] ?? 0
    if (!hasFrame[i]) for (let d = 3; d < 6; d++) fixed[6 * i + d] = 1
    if (!hasAny[i]) {
      for (let d = 0; d < 3; d++) fixed[6 * i + d] = 1
      warnings.push(`Nó ${nd.id} não está ligado a nenhum elemento — foi ignorado.`)
    }
  })

  // numeração RCM
  for (let i = 0; i < n; i++) adj[i] = Array.from(new Set(adj[i]))
  const order = rcmOrder(n, adj)
  const eq = new Int32Array(6 * n).fill(-1)
  let nEq = 0
  for (const i of order) {
    for (let d = 0; d < 6; d++) if (!fixed[6 * i + d]) eq[6 * i + d] = nEq++
  }

  // massa mínima em GDL livres sem massa (evita M singular na análise modal)
  let mMax = 0
  for (let i = 0; i < 6 * n; i++) if (mass[i] > mMax) mMax = mass[i]
  for (let i = 0; i < 6 * n; i++) if (eq[i] >= 0 && !(mass[i] > 0)) mass[i] = 1e-9 * (mMax || 1)

  const minRow = buildProfile(nEq, (cb) => {
    const dofs: number[] = []
    for (const f of frames) {
      dofs.length = 0
      for (let d = 0; d < 6; d++) dofs.push(eq[6 * f.a + d], eq[6 * f.b + d])
      cb(dofs)
    }
    for (const c of cables) {
      dofs.length = 0
      for (let d = 0; d < 3; d++) dofs.push(eq[6 * c.a + d], eq[6 * c.b + d])
      cb(dofs)
    }
  })

  return { model, nNodes: n, nodeIndex, X, eq, nEq, frames, cables, fext, mass, springs, minRow, warnings }
}

export interface EvalOptions {
  /** barras corrotacionais + rigidez geométrica */
  nonlinear: boolean
  /** na tangente, usa só a parcela de tração da rigidez geométrica das barras */
  kgTensionOnly?: boolean
}

const UG = new Float64Array(12)
const FL = new Float64Array(12)
const FG = new Float64Array(12)
const KT = new Float64Array(144)
const KG = new Float64Array(144)
const KIN: { R: Float64Array; ul: Float64Array } = { R: new Float64Array(9), ul: new Float64Array(12) }

/** f_local = k·u_local (12×12 densa) */
function mul12(k: Float64Array, u: ArrayLike<number>, out: Float64Array): void {
  for (let i = 0; i < 12; i++) {
    let s = 0
    const o = i * 12
    for (let j = 0; j < 12; j++) s += k[o + j] * u[j]
    out[i] = s
  }
}

/** rigidez tangente local da barra no estado atual: k + kg(N) */
export function frameTangentLocal(f: FrameEl, nonlinear: boolean, tensionOnly: boolean, out: Float64Array): Float64Array {
  out.set(f.kl)
  if (nonlinear) {
    const N = tensionOnly ? Math.max(f.N, 0) : f.N
    if (N !== 0) addGeometricStiffness(out, f.L0, N)
  }
  return out
}

/**
 * Avalia o sistema no estado `u` (6 por nó): devolve as forças internas (6 por nó) e,
 * se pedido, a rigidez tangente montada (não fatorada). Atualiza o estado dos elementos.
 */
export function evaluate(
  sys: BridgeSystem,
  u: Float64Array,
  wantK: boolean,
  opts: EvalOptions,
  fint: Float64Array,
): SkylineMatrix | null {
  const { eq, X } = sys
  const K = wantK ? new SkylineMatrix(sys.minRow) : null
  fint.fill(0)

  for (const f of sys.frames) {
    const a6 = 6 * f.a
    const b6 = 6 * f.b
    for (let d = 0; d < 6; d++) {
      UG[d] = u[a6 + d]
      UG[6 + d] = u[b6 + d]
    }
    if (opts.nonlinear) {
      KIN.R = f.R
      KIN.ul = f.ul
      corotate(f.x, f.R0, f.L0, UG, KIN)
      f.N = (f.EA * f.ul[6]) / f.L0
      KT.set(f.kl)
      if (f.N !== 0) addGeometricStiffness(KT, f.L0, f.N)
      mul12(KT, f.ul, FL)
    } else {
      f.R.set(f.R0)
      toLocal(f.R0, UG, f.ul)
      mul12(f.kl, f.ul, FL)
      f.N = FL[6]
      KT.set(f.kl)
    }
    toGlobal(f.R, FL, FG)
    for (let d = 0; d < 6; d++) {
      fint[a6 + d] += FG[d]
      fint[b6 + d] += FG[6 + d]
    }
    if (K) {
      if (opts.nonlinear && opts.kgTensionOnly && f.N < 0) KT.set(f.kl)
      globalStiffness(f.R, KT, KG)
      for (let i = 0; i < 12; i++) {
        const gi = eq[i < 6 ? a6 + i : b6 + i - 6]
        if (gi < 0) continue
        for (let j = 0; j < 12; j++) {
          const gj = eq[j < 6 ? a6 + j : b6 + j - 6]
          if (gj < gi) continue
          K.add(gi, gj, KG[i * 12 + j])
        }
      }
    }
  }

  for (const c of sys.cables) {
    const a3 = 3 * c.a
    const b3 = 3 * c.b
    const a6 = 6 * c.a
    const b6 = 6 * c.b
    const dx = X[b3] + u[b6] - X[a3] - u[a6]
    const dy = X[b3 + 1] + u[b6 + 1] - X[a3 + 1] - u[a6 + 1]
    const dz = X[b3 + 2] + u[b6 + 2] - X[a3 + 2] - u[a6 + 2]
    evalCable(dx, dy, dz, c, c.st)
    const st = c.st
    for (let d = 0; d < 3; d++) {
      fint[a6 + d] += st.fI[d]
      fint[b6 + d] += st.fJ[d]
    }
    if (K) {
      const k = st.k3
      for (let i = 0; i < 3; i++) {
        const ga = eq[a6 + i]
        const gb = eq[b6 + i]
        for (let j = 0; j < 3; j++) {
          const v = k[i * 3 + j]
          const ha = eq[a6 + j]
          const hb = eq[b6 + j]
          if (ga >= 0 && ha >= ga) K.add(ga, ha, v)
          if (gb >= 0 && hb >= gb) K.add(gb, hb, v)
          if (ga >= 0 && hb >= 0) {
            // bloco fora da diagonal (−k3): cada par (a_i, b_j) aparece uma única vez
            if (ga <= hb) K.add(ga, hb, -v)
            else K.add(hb, ga, -v)
          }
        }
      }
    }
  }

  // molas de apoio
  const sp = sys.springs
  for (let i = 0; i < sp.length; i++) {
    if (sp[i] > 0) {
      fint[i] += sp[i] * u[i]
      if (K && eq[i] >= 0) K.add(eq[i], eq[i], sp[i])
    }
  }
  return K
}

/** restringe um vetor de 6·n aos GDL livres */
export function gather(sys: BridgeSystem, full: ArrayLike<number>, out: Float64Array): Float64Array {
  const { eq } = sys
  for (let i = 0; i < eq.length; i++) if (eq[i] >= 0) out[eq[i]] = full[i]
  return out
}

/** espalha um vetor de GDL livres em 6·n (restritos = 0) */
export function scatter(sys: BridgeSystem, free: ArrayLike<number>, out: Float64Array): Float64Array {
  const { eq } = sys
  for (let i = 0; i < eq.length; i++) out[i] = eq[i] >= 0 ? free[eq[i]] : 0
  return out
}
