/**
 * Passo de fluência e retração pelo MÉTODO DO MÓDULO EFETIVO AJUSTADO PELA IDADE
 * (AAEM — Trost 1967, Bažant 1972).
 *
 * Para um concreto carregado em t0 com tensão σ0 que depois varia de Δσ até t:
 *
 *     ε(t) = σ0/E·(1 + φ) + Δσ/E·(1 + χ·φ) + εcs          φ = φ(t, t0),  χ ≈ 0,8
 *
 * Logo o incremento de tensão é o de um material elástico de módulo E″ = E/(1 + χ·φ)
 * submetido à deformação livre ε_livre = φ·σ0/E + εcs:   Δσ = E″·(Δε − ε_livre).
 *
 * No modelo de barras isso é um caso linear (`LinearSolver`) em que:
 *  - cada barra de concreto recebe a deformação imposta axial φ·N/EA + εcs e as curvaturas
 *    φ·Mz/EIz e φ·My/EIy, com N, Mz, My = esforços SUSTENTADOS (permanentes) — a curvatura
 *    varia linearmente na barra e é corrigida para que sua média seja a de Simpson das 3
 *    estações (rotação relativa exata p/ momento parabólico);
 *  - a rigidez é montada com E″ nas barras de concreto e a rigidez geométrica dos esforços
 *    normais atuantes; aço e cabos mantêm o módulo (não fluem; a relaxação dos estais não entra);
 *  - o resultado são INCREMENTOS (deslocamentos, esforços, tração dos cabos, reações) entre
 *    t0 e t.
 *
 * Aproximações: geometria e rigidez geométrica do estado sustentado (linearização, como nas
 * demais ações); torção sem fluência própria (GJ reduzido junto com E); um único t0 por barra.
 */

import type { FrameForces } from '../analysis/types'
import { type ImposedStrain, type LinearState, LinearSolver } from '../analysis/linear'
import { SkylineMatrix } from '../analysis/skyline'
import { type BridgeSystem, type FrameEl, frameTangentLocal } from '../analysis/system'
import { addGeometricStiffness, equivalentNodalLoads, globalStiffness, localStiffness, stationForces } from '../analysis/frame'

/** o que cada barra sofre no intervalo: φ (0 = não flui), retração livre e χ */
export interface FrameCreep {
  phi: number
  /** retração livre no intervalo (negativa) */
  epsCs: number
}

/** esforços nas 3 estações de cada barra no estado ATUAL do sistema (como em analyze.ts) */
export function systemFrameForces(sys: BridgeSystem, nonlinear: boolean): FrameForces[] {
  const kt = new Float64Array(144)
  const fl = new Float64Array(12)
  const st = new Float64Array(18)
  return sys.frames.map((f) => {
    frameTangentLocal(f, nonlinear, false, kt)
    for (let i = 0; i < 12; i++) {
      let s = 0
      for (let j = 0; j < 12; j++) s += kt[i * 12 + j] * f.ul[j]
      fl[i] = s
    }
    const R = f.R
    const w = f.w
    const wx = R[0] * w[0] + R[1] * w[1] + R[2] * w[2]
    const wy = R[3] * w[0] + R[4] * w[1] + R[5] * w[2]
    const wz = R[6] * w[0] + R[7] * w[1] + R[8] * w[2]
    const feq = equivalentNodalLoads(f.L0, wx, wy, wz)
    for (let i = 0; i < 12; i++) fl[i] -= feq[i]
    stationForces(fl, f.L0, wx, wy, wz, st, 0)
    const pick = (o: number): [number, number, number] => [st[o], st[o + 1], st[o + 2]]
    return { id: f.id, L: f.L0, N: pick(0), Vy: pick(3), Vz: pick(6), T: pick(9), My: pick(12), Mz: pick(15) }
  })
}

/** rigidez tangente do estado atual com as barras de `frames` (já com E″), fatorada */
function assemble(sys: BridgeSystem, frames: FrameEl[], nonlinear: boolean, tensionOnly: boolean): SkylineMatrix {
  const { eq } = sys
  const K = new SkylineMatrix(sys.minRow)
  const kt = new Float64Array(144)
  const kg = new Float64Array(144)
  for (const f of frames) {
    kt.set(f.kl)
    if (nonlinear && f.N !== 0 && !(tensionOnly && f.N < 0)) addGeometricStiffness(kt, f.L0, f.N)
    globalStiffness(f.R, kt, kg)
    const a6 = 6 * f.a
    const b6 = 6 * f.b
    for (let i = 0; i < 12; i++) {
      const gi = eq[i < 6 ? a6 + i : b6 + i - 6]
      if (gi < 0) continue
      for (let j = 0; j < 12; j++) {
        const gj = eq[j < 6 ? a6 + j : b6 + j - 6]
        if (gj < gi) continue
        K.add(gi, gj, kg[i * 12 + j])
      }
    }
  }
  for (const c of sys.cables) {
    const k = c.st.k3
    const a6 = 6 * c.a
    const b6 = 6 * c.b
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
          if (ga <= hb) K.add(ga, hb, -v)
          else K.add(hb, ga, -v)
        }
      }
    }
  }
  const sp = sys.springs
  for (let i = 0; i < sp.length; i++) if (sp[i] > 0 && eq[i] >= 0) K.add(eq[i], eq[i], sp[i])
  K.factorize()
  return K
}

export interface CreepStepResult extends LinearState {
  /** true se a rigidez geométrica de compressão precisou ser descartada (tangente não positiva) */
  kgReduced: boolean
}

/**
 * Um passo AAEM sobre o sistema `sys` (no estado sustentado: R, N e estado dos cabos da
 * última avaliação). `sustained` = esforços permanentes por barra (ordem de sys.frames);
 * `creep[e]` = φ e retração livre da barra e no intervalo (null/φ = 0 e εcs = 0: não participa).
 */
export function creepStep(
  sys: BridgeSystem,
  sustained: FrameForces[],
  creep: (FrameCreep | null)[],
  nonlinear: boolean,
  chi = 0.8,
): CreepStepResult {
  const strain = new Map<number, ImposedStrain>()
  const frames: FrameEl[] = sys.frames.map((f, e) => {
    const c = creep[e]
    if (!c || (!(c.phi > 0) && !c.epsCs)) return f
    const s = sustained[e]
    const phi = Math.max(c.phi, 0)
    const imp: ImposedStrain = {}
    const eps = (phi * (s.N[0] + 4 * s.N[1] + s.N[2])) / 6 / f.EA + c.epsCs
    if (eps) imp.eps = eps
    if (phi > 0) {
      const lin = (m: [number, number, number], EI: number): [number, number] | null => {
        if (!(EI > 0)) return null
        const ka = (phi * m[0]) / EI
        const kb = (phi * m[2]) / EI
        const km = (phi * m[1]) / EI
        // desloca a reta p/ que a média seja a de Simpson (parcela parabólica do momento)
        const d = (ka + 4 * km + kb) / 6 - (ka + kb) / 2
        return ka || kb || d ? [ka + d, kb + d] : null
      }
      const kz = lin(s.Mz, f.EIz)
      if (kz) {
        imp.kz = kz[0]
        imp.kzEnd = kz[1]
      }
      const ky = lin(s.My, f.EIy)
      if (ky) {
        imp.ky = ky[0]
        imp.kyEnd = ky[1]
      }
    }
    strain.set(e, imp)
    const r = 1 / (1 + chi * phi)
    const EA = f.EA * r
    const EIy = f.EIy * r
    const EIz = f.EIz * r
    const GJ = f.GJ * r
    return { ...f, EA, EIy, EIz, GJ, kl: localStiffness(f.L0, EA, EIy, EIz, GJ) }
  })
  // as deformações impostas usam a rigidez ORIGINAL p/ a deformação livre (φ·N/EA) e a
  // reduzida p/ a força de restrição — é o que o LinearSolver faz com f.EA do sistema ajustado
  const sys2: BridgeSystem = { ...sys, frames }
  let K: SkylineMatrix
  let kgReduced = false
  try {
    K = assemble(sys, frames, nonlinear, false)
  } catch {
    K = assemble(sys, frames, nonlinear, true)
    kgReduced = true
  }
  const lin = new LinearSolver(sys2, K, nonlinear)
  const out = lin.solve({ strain })
  return { ...out, kgReduced }
}
