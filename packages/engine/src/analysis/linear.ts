/**
 * Casos de carga LINEARIZADOS em torno do estado de carga permanente.
 *
 * Todas as ações variáveis (temperatura, vento, frenagem, protensão, recalques…) são
 * resolvidas sobre a rigidez tangente fatorada do estado deformado — a mesma hipótese da
 * carga móvel. Em estaiadas e pênseis isso já inclui a rigidez geométrica dos cabos e das
 * barras comprimidas (teoria de 2ª ordem linearizada).
 *
 * Um caso é descrito por um `CaseLoad`; o `LinearSolver` devolve deslocamentos, esforços nas
 * 3 estações de cada barra, variação de tração de cada cabo e reações — INCREMENTOS em
 * relação ao estado permanente.
 */

import type { Vec3 } from '../model/types'
import type { FrameForces, Reaction } from './types'
import type { SkylineMatrix } from './skyline'
import { type BridgeSystem, frameTangentLocal } from './system'
import { equivalentNodalLoads, stationForces, toGlobal, toLocal } from './frame'
import { evalCable, newCableState } from './catenary'

export interface ImposedStrain {
  /** deformação axial livre (alongamento +), ex.: α·ΔT */
  eps?: number
  /** curvatura livre no plano vertical local (x–y), 1/m; + = côncava p/ cima (como Mz > 0).
   *  Gradiente térmico com o topo mais quente: kz = −α·ΔT/h */
  kz?: number
  /** curvatura livre no plano lateral local (x–z), 1/m; mesmo sinal de My/EIy */
  ky?: number
  /** curvaturas livres na extremidade 2, p/ variação LINEAR ao longo da barra (fluência sob
   *  momento variável): `kz`/`ky` passam a ser os valores na extremidade 1. Ausentes = constante */
  kzEnd?: number
  kyEnd?: number
}

export interface CaseLoad {
  /** forças nodais em eixos globais (6 por nó, ordem de model.nodes) */
  nodal?: Float64Array
  /** carga distribuída em eixos GLOBAIS por barra — chave: índice em sys.frames (kN/m) */
  uniform?: Map<number, Vec3>
  /** carga distribuída em eixos LOCAIS da barra — chave: índice em sys.frames (kN/m) */
  uniformLocal?: Map<number, Vec3>
  /** deformações impostas por barra — chave: índice em sys.frames */
  strain?: Map<number, ImposedStrain>
  /** variação do comprimento indeformado dos cabos — chave: índice em sys.cables (m).
   *  Aquecimento: +α·ΔT·L0; retensionamento: negativo */
  cableDL0?: Map<number, number>
  /** deslocamentos impostos em GDL restritos (recalques) — chave: 6·índiceDoNó + gdl (m, rad) */
  settlement?: Map<number, number>
}

export interface LinearState {
  /** deslocamentos (6 por nó) */
  u: number[]
  /** esforços incrementais, na ordem de sys.frames */
  frames: FrameForces[]
  /** variação de tração, na ordem de sys.cables */
  cables: { id: number; dT: number }[]
  reactions: Reaction[]
}

export class LinearSolver {
  private readonly kts: Float64Array[]
  /** versor da tração (extremidade mais tracionada) de cada cabo */
  private readonly tdir: Float64Array
  private readonly useJ: Uint8Array

  constructor(
    readonly sys: BridgeSystem,
    /** rigidez tangente FATORADA do estado de carga permanente */
    readonly K: SkylineMatrix,
    readonly nonlinear: boolean,
  ) {
    this.kts = sys.frames.map((f) => frameTangentLocal(f, nonlinear, false, new Float64Array(144)))
    const nCb = sys.cables.length
    this.tdir = new Float64Array(3 * nCb)
    this.useJ = new Uint8Array(nCb)
    sys.cables.forEach((c, i) => {
      const st = c.st
      const useJ = st.Tj >= st.Ti
      this.useJ[i] = useJ ? 1 : 0
      const T = useJ ? st.Tj : st.Ti
      const V = useJ ? st.Vj : st.V0
      if (T > 0) {
        this.tdir[3 * i] = (st.H * st.ex) / T
        this.tdir[3 * i + 1] = (st.H * st.ey) / T
        this.tdir[3 * i + 2] = V / T
      }
    })
  }

  /** resolve K·du = p (p nos GDL livres) e devolve du espalhado em 6·n */
  solveFree(p: Float64Array): Float64Array {
    const { eq } = this.sys
    const du = this.K.solve(p)
    const full = new Float64Array(eq.length)
    for (let i = 0; i < eq.length; i++) full[i] = eq[i] >= 0 ? du[eq[i]] : 0
    return full
  }

  solve(load: CaseLoad): LinearState {
    const sys = this.sys
    const { eq, X } = sys
    const nNd = sys.nNodes
    const nFr = sys.frames.length
    const nCb = sys.cables.length
    // forças aplicadas (6 por nó): nodais + equivalentes das barras − parcela fixa dos cabos
    const F = new Float64Array(6 * nNd)
    if (load.nodal) F.set(load.nodal)

    // ---- barras: cargas locais e forças equivalentes
    const wl = new Float64Array(3 * nFr)
    const feq: (Float64Array | null)[] = new Array(nFr).fill(null)
    const fg = new Float64Array(12)
    const addEq = (e: number, f: Float64Array): void => {
      const cur = feq[e]
      if (cur) for (let i = 0; i < 12; i++) cur[i] += f[i]
      else feq[e] = Float64Array.from(f)
    }
    const local = (e: number, w: Vec3, isLocal: boolean): void => {
      const f = sys.frames[e]
      const R = f.R
      const l = isLocal
        ? w
        : [
            R[0] * w[0] + R[1] * w[1] + R[2] * w[2],
            R[3] * w[0] + R[4] * w[1] + R[5] * w[2],
            R[6] * w[0] + R[7] * w[1] + R[8] * w[2],
          ]
      wl[3 * e] += l[0]
      wl[3 * e + 1] += l[1]
      wl[3 * e + 2] += l[2]
      addEq(e, equivalentNodalLoads(f.L0, l[0], l[1], l[2]))
    }
    load.uniform?.forEach((w, e) => local(e, w, false))
    load.uniformLocal?.forEach((w, e) => local(e, w, true))
    load.strain?.forEach((s, e) => {
      const f = sys.frames[e]
      const q = new Float64Array(12)
      if (s.eps) {
        q[0] = -f.EA * s.eps
        q[6] = f.EA * s.eps
      }
      if (s.kz || s.kzEnd) {
        // ∫ Bᵀ·EI·κ0, κ0 linear de κa a κb: momentos −EI·κa (nó 1) e +EI·κb (nó 2) em rz e o
        // binário de forças ±EI·(κb − κa)/L em y
        const ka = s.kz ?? 0
        const kb = s.kzEnd ?? ka
        q[5] = -f.EIz * ka
        q[11] = f.EIz * kb
        q[1] = (f.EIz * (kb - ka)) / f.L0
        q[7] = -q[1]
      }
      if (s.ky || s.kyEnd) {
        const ka = s.ky ?? 0
        const kb = s.kyEnd ?? ka
        q[4] = f.EIy * ka
        q[10] = -f.EIy * kb
        q[2] = (f.EIy * (kb - ka)) / f.L0
        q[8] = -q[2]
      }
      addEq(e, q)
    })
    for (let e = 0; e < nFr; e++) {
      const q = feq[e]
      if (!q) continue
      const f = sys.frames[e]
      toGlobal(f.R, q, fg)
      for (let d = 0; d < 6; d++) {
        F[6 * f.a + d] += fg[d]
        F[6 * f.b + d] += fg[6 + d]
      }
    }

    // ---- cabos: variação de L0 com a geometria travada
    const dTfix = new Float64Array(nCb)
    const dFcab: (Float64Array | null)[] = new Array(nCb).fill(null)
    load.cableDL0?.forEach((dL0, i) => {
      if (!dL0) return
      const c = sys.cables[i]
      const dx = X[3 * c.b] - X[3 * c.a]
      const dy = X[3 * c.b + 1] - X[3 * c.a + 1]
      const dz = X[3 * c.b + 2] - X[3 * c.a + 2]
      // geometria deformada do estado permanente
      const st0 = c.st
      const lx = st0.lh * st0.ex
      const ly = st0.lh * st0.ey
      const lz = st0.lz
      const useDef = st0.lh > 0 || st0.lz !== 0
      const st = newCableState()
      evalCable(useDef ? lx : dx, useDef ? ly : dy, useDef ? lz : dz, { EA: c.EA, w: c.w, L0: c.L0 + dL0 }, st)
      const d = new Float64Array(6)
      for (let k = 0; k < 3; k++) {
        d[k] = st.fI[k] - st0.fI[k]
        d[3 + k] = st.fJ[k] - st0.fJ[k]
        F[6 * c.a + k] -= d[k]
        F[6 * c.b + k] -= d[3 + k]
      }
      dFcab[i] = d
      dTfix[i] = (this.useJ[i] ? st.Tj : st.Ti) - (this.useJ[i] ? st0.Tj : st0.Ti)
    })

    // ---- recalques: u prescrito nos GDL restritos → forças −K_fp·u_p pelos elementos
    const up = new Float64Array(6 * nNd)
    let hasSettle = false
    load.settlement?.forEach((v, g) => {
      if (eq[g] < 0 && v) {
        up[g] = v
        hasSettle = true
      }
    })
    if (hasSettle) {
      const fp = this.internal(up, null, null)
      for (let i = 0; i < F.length; i++) F[i] -= fp[i]
    }

    // ---- solução
    const p = new Float64Array(sys.nEq)
    for (let i = 0; i < eq.length; i++) if (eq[i] >= 0) p[eq[i]] = F[i]
    const u = sys.nEq > 0 ? this.solveFree(p) : new Float64Array(6 * nNd)
    if (hasSettle) for (let i = 0; i < u.length; i++) u[i] += up[i]

    // ---- pós-processamento
    const frames: FrameForces[] = new Array(nFr)
    const cabT = new Float64Array(nCb)
    const fint = this.internal(u, (e, fl) => {
      const f = sys.frames[e]
      const q = feq[e]
      if (q) for (let i = 0; i < 12; i++) fl[i] -= q[i]
      const st = new Float64Array(18)
      stationForces(fl, f.L0, wl[3 * e], wl[3 * e + 1], wl[3 * e + 2], st, 0)
      const pick = (o: number): [number, number, number] => [st[o], st[o + 1], st[o + 2]]
      frames[e] = { id: f.id, L: f.L0, N: pick(0), Vy: pick(3), Vz: pick(6), T: pick(9), My: pick(12), Mz: pick(15) }
    }, (i, f3) => {
      cabT[i] = this.tdir[3 * i] * f3[0] + this.tdir[3 * i + 1] * f3[1] + this.tdir[3 * i + 2] * f3[2]
    })
    // parcela fixa dos cabos nas forças internas
    for (let i = 0; i < nCb; i++) {
      const d = dFcab[i]
      if (!d) continue
      const c = sys.cables[i]
      for (let k = 0; k < 3; k++) {
        fint[6 * c.a + k] += d[k]
        fint[6 * c.b + k] += d[3 + k]
      }
    }
    const cables = sys.cables.map((c, i) => ({ id: c.id, dT: cabT[i] + dTfix[i] }))

    const reactions: Reaction[] = []
    sys.model.nodes.forEach((nd, i) => {
      const hasFix = nd.fix?.some(Boolean)
      const hasSpring = nd.springs?.some((k) => k > 0)
      if (!hasFix && !hasSpring) return
      const R: Reaction['R'] = [0, 0, 0, 0, 0, 0]
      for (let d = 0; d < 6; d++) {
        const g = 6 * i + d
        if (nd.fix?.[d]) R[d] = fint[g] - (load.nodal ? load.nodal[g] : 0)
        else if (sys.springs[g] > 0) R[d] = -sys.springs[g] * u[g]
      }
      reactions.push({ node: nd.id, R })
    })
    return { u: Array.from(u), frames, cables, reactions }
  }

  /**
   * Resposta a um campo de deslocamentos IMPOSTO (6 por nó), sem cargas nos elementos:
   * esforços nas barras, variação de tração dos cabos e forças nos apoios pela rigidez
   * tangente. Usado pela análise espectral (cada modo de vibração é um campo `u`).
   */
  fromDisplacements(u: ArrayLike<number>): LinearState {
    const sys = this.sys
    const uu = Float64Array.from(u)
    const frames: FrameForces[] = new Array(sys.frames.length)
    const cabT = new Float64Array(sys.cables.length)
    const st = new Float64Array(18)
    const fint = this.internal(uu, (e, fl) => {
      const f = sys.frames[e]
      stationForces(fl, f.L0, 0, 0, 0, st, 0)
      const pick = (o: number): [number, number, number] => [st[o], st[o + 1], st[o + 2]]
      frames[e] = { id: f.id, L: f.L0, N: pick(0), Vy: pick(3), Vz: pick(6), T: pick(9), My: pick(12), Mz: pick(15) }
    }, (i, f3) => {
      cabT[i] = this.tdir[3 * i] * f3[0] + this.tdir[3 * i + 1] * f3[1] + this.tdir[3 * i + 2] * f3[2]
    })
    const reactions: Reaction[] = []
    sys.model.nodes.forEach((nd, i) => {
      const hasFix = nd.fix?.some(Boolean)
      const hasSpring = nd.springs?.some((k) => k > 0)
      if (!hasFix && !hasSpring) return
      const R: Reaction['R'] = [0, 0, 0, 0, 0, 0]
      for (let d = 0; d < 6; d++) {
        const g = 6 * i + d
        if (nd.fix?.[d]) R[d] = fint[g]
        else if (sys.springs[g] > 0) R[d] = -sys.springs[g] * uu[g]
      }
      reactions.push({ node: nd.id, R })
    })
    return { u: Array.from(uu), frames, cables: sys.cables.map((c, i) => ({ id: c.id, dT: cabT[i] })), reactions }
  }

  /**
   * Forças internas globais (6 por nó) p/ o campo de deslocamentos `u`, pela rigidez tangente.
   * `onFrame` recebe as forças de extremidade locais k·u (pode alterá-las: o que ficar é o que
   * entra nas forças internas); `onCable` recebe a força incremental k3·Δ.
   */
  private internal(
    u: Float64Array,
    onFrame: ((e: number, fl: Float64Array) => void) | null,
    onCable: ((i: number, f3: Float64Array) => void) | null,
  ): Float64Array {
    const sys = this.sys
    const out = new Float64Array(6 * sys.nNodes)
    const UG = new Float64Array(12)
    const UL = new Float64Array(12)
    const FL = new Float64Array(12)
    const FG = new Float64Array(12)
    sys.frames.forEach((f, e) => {
      for (let d = 0; d < 6; d++) {
        UG[d] = u[6 * f.a + d]
        UG[6 + d] = u[6 * f.b + d]
      }
      toLocal(f.R, UG, UL)
      const kt = this.kts[e]
      for (let i = 0; i < 12; i++) {
        let s = 0
        for (let j = 0; j < 12; j++) s += kt[i * 12 + j] * UL[j]
        FL[i] = s
      }
      onFrame?.(e, FL)
      toGlobal(f.R, FL, FG)
      for (let d = 0; d < 6; d++) {
        out[6 * f.a + d] += FG[d]
        out[6 * f.b + d] += FG[6 + d]
      }
    })
    const f3 = new Float64Array(3)
    sys.cables.forEach((c, i) => {
      const k = c.st.k3
      const dx = u[6 * c.b] - u[6 * c.a]
      const dy = u[6 * c.b + 1] - u[6 * c.a + 1]
      const dz = u[6 * c.b + 2] - u[6 * c.a + 2]
      f3[0] = k[0] * dx + k[1] * dy + k[2] * dz
      f3[1] = k[3] * dx + k[4] * dy + k[5] * dz
      f3[2] = k[6] * dx + k[7] * dy + k[8] * dz
      onCable?.(i, f3)
      for (let d = 0; d < 3; d++) {
        out[6 * c.a + d] -= f3[d]
        out[6 * c.b + d] += f3[d]
      }
    })
    const sp = sys.springs
    for (let i = 0; i < sp.length; i++) if (sp[i] > 0) out[i] += sp[i] * u[i]
    return out
  }
}
