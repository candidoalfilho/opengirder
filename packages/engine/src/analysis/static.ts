/**
 * Análise estática não linear — Newton-Raphson completo com busca linear.
 *
 * A carga permanente é aplicada de uma vez a partir da configuração de projeto (onde os
 * cabos já têm o L0 do form-finding, logo o ponto de partida está perto do equilíbrio);
 * a busca linear dá a robustez que o passo de carga daria.
 */

import type { SkylineMatrix } from './skyline'
import { type BridgeSystem, evaluate, gather, scatter } from './system'

export interface StaticOptions {
  nonlinear: boolean
  maxIter?: number
  /** tolerância relativa do resíduo de forças */
  tol?: number
  /** forças externas (6 por nó); padrão: sys.fext */
  fext?: Float64Array
  /** depuração: chamado a cada iteração */
  trace?: (iteration: number, residual: number, alpha: number, kgReduced: boolean) => void
}

export interface StaticSolution {
  /** deslocamentos (6 por nó) */
  u: Float64Array
  converged: boolean
  iterations: number
  /** norma do resíduo final (kN) */
  residual: number
  /** rigidez tangente FATORADA no estado final */
  K: SkylineMatrix
  /** forças internas no estado final (6 por nó) */
  fint: Float64Array
  /** true se a tangente precisou descartar a rigidez geométrica de compressão */
  kgReduced: boolean
}

function norm2(v: Float64Array): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  return Math.sqrt(s)
}

export function solveStatic(sys: BridgeSystem, u0: Float64Array | null, opts: StaticOptions): StaticSolution {
  const nd = 6 * sys.nNodes
  const n = sys.nEq
  const fextFull = opts.fext ?? sys.fext
  const maxIter = opts.maxIter ?? 60
  const tol = opts.tol ?? 1e-8
  const u = u0 ? Float64Array.from(u0) : new Float64Array(nd)
  const fint = new Float64Array(nd)
  const fintTrial = new Float64Array(nd)
  const fext = gather(sys, fextFull, new Float64Array(n))
  const r = new Float64Array(n)
  const rTrial = new Float64Array(n)
  const fi = new Float64Array(n)
  const duFull = new Float64Array(nd)
  const uTrial = new Float64Array(nd)
  const uBest = new Float64Array(nd)
  const ev = { nonlinear: opts.nonlinear, kgTensionOnly: false }
  let kgReduced = false

  const residual = (uu: Float64Array, K: boolean, f: Float64Array, out: Float64Array): SkylineMatrix | null => {
    const Km = evaluate(sys, uu, K, ev, f)
    gather(sys, f, fi)
    for (let i = 0; i < n; i++) out[i] = fext[i] - fi[i]
    return Km
  }

  const factorized = (uu: Float64Array, Km: SkylineMatrix): SkylineMatrix => {
    try {
      Km.factorize()
      return Km
    } catch (e) {
      if (!opts.nonlinear) throw e
      // tangente indefinida: refaz só com a parcela de tração da rigidez geométrica
      ev.kgTensionOnly = true
      kgReduced = true
      const K2 = evaluate(sys, uu, true, ev, fintTrial) as SkylineMatrix
      ev.kgTensionOnly = false
      K2.factorize()
      return K2
    }
  }

  let iterations = 0
  let rn = 0
  let converged = false
  let K: SkylineMatrix | null = null
  let kFactorized: SkylineMatrix | null = null
  for (;;) {
    K = residual(u, true, fint, r) as SkylineMatrix
    rn = norm2(r)
    const fref = Math.max(norm2(fext), norm2(fi), 1)
    if (rn <= tol * fref) {
      converged = true
      break
    }
    if (iterations >= maxIter) {
      converged = rn <= 1e-5 * fref
      break
    }
    iterations++
    K = factorized(u, K)
    kFactorized = K
    const du = K.solve(r)
    // piso numérico: correção desprezível (< 0,01 μm) com resíduo já pequeno → convergiu
    let duMax = 0
    for (let i = 0; i < n; i++) if (Math.abs(du[i]) > duMax) duMax = Math.abs(du[i])
    if (duMax < 1e-8 && rn <= 1e-5 * fref) {
      converged = true
      iterations--
      break
    }
    scatter(sys, du, duFull)
    // Busca linear em energia (Crisfield): procura α com duᵀ·r(u + α·du) ≈ 0. A norma do
    // resíduo é má função de mérito aqui — as transversinas rígidas fazem-na subir num passo
    // que na verdade aproxima o equilíbrio.
    let s0 = 0
    for (let i = 0; i < n; i++) s0 += du[i] * r[i]
    let alpha = 1
    let lo = 0
    let sLo = s0
    let accepted = false
    for (let ls = 0; ls < 6; ls++) {
      for (let i = 0; i < nd; i++) uTrial[i] = u[i] + alpha * duFull[i]
      residual(uTrial, false, fintTrial, rTrial)
      let sA = 0
      for (let i = 0; i < n; i++) sA += du[i] * rTrial[i]
      if (!Number.isFinite(sA)) {
        alpha *= 0.25
        continue
      }
      uBest.set(uTrial)
      accepted = true
      if (Math.abs(sA) <= 0.8 * Math.abs(s0) || !(s0 > 0)) break
      // secante entre (lo, sLo) e (alpha, sA)
      let next: number
      if (sA < 0) {
        next = lo + ((alpha - lo) * sLo) / (sLo - sA)
        next = Math.min(Math.max(next, lo + 0.1 * (alpha - lo)), lo + 0.9 * (alpha - lo))
      } else {
        // ainda descendo: extrapola, com limite
        next = sA < sLo ? Math.min(alpha + ((alpha - lo) * sA) / (sLo - sA), 2 * alpha) : 0.5 * alpha
        lo = sA < sLo ? alpha : lo
        sLo = sA < sLo ? sA : sLo
      }
      if (next > 4) break
      alpha = next
    }
    if (!accepted) throw new Error('A análise não linear divergiu (resíduo não finito).')
    u.set(uBest)
    opts.trace?.(iterations, rn, alpha, kgReduced)
    if (!opts.nonlinear && sys.cables.length === 0) {
      // problema linear: uma iteração resolve
      K = residual(u, false, fint, r)
      rn = norm2(r)
      converged = true
      K = evaluate(sys, u, true, ev, fint) as SkylineMatrix
      break
    }
  }
  // (K pode já estar fatorada se a saída foi pelo piso numérico)
  const Kf = kFactorized === K ? (K as SkylineMatrix) : factorized(u, K as SkylineMatrix)
  return { u, converged, iterations, residual: rn, K: Kf, fint, kgReduced }
}
