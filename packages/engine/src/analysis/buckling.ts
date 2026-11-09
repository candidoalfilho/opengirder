/**
 * Flambagem linearizada no estado de carga permanente.
 *
 * Procura-se o fator λ que multiplica os esforços normais das barras no estado permanente
 * e torna a estrutura instável:
 *
 *     (Ke + λ·Kg)·φ = 0
 *
 * Kg = rigidez geométrica das barras com o N atual (compressão e tração — Przemieniecki,
 *      "Theory of Matrix Structural Analysis", cap. 15; a mesma de `addGeometricStiffness`);
 * Ke = rigidez elástica das barras + rigidez tangente COMPLETA dos cabos + molas.
 *
 * Hipótese simplificadora: a rigidez dos cabos (elástica + geométrica da catenária) é mantida
 * constante — não cresce com λ. Como a tração dos cabos enrijece a estrutura, o λ calculado
 * fica do lado da segurança p/ torres e tabuleiros estaiados/pênseis.
 *
 * Solução: com K1 = Ke + Kg (tangente do estado permanente, positiva definida se a obra é
 * estável), (K1 + (λ − 1)·Kg)·φ = 0 ⇒ K1⁻¹·(−Kg)·φ = μ·φ, μ = 1/(λ − 1). Iteração por subespaço
 * com vetores K1-ortonormais (Gram-Schmidt) e Rayleigh-Ritz (Bathe, "Finite Element
 * Procedures", 11.6) — o problema reduzido é simétrico (Jacobi). Os maiores μ > 0 são os
 * menores λ > 1. Se K1 não for positiva definida (obra já instável sob carga permanente,
 * λ < 1), fatora-se Ke e usa-se μ = 1/λ.
 *
 * λ refere-se SÓ à carga permanente característica (sem carga móvel nem coeficientes de
 * ponderação). Prática corrente em pontes estaiadas: estabilidade elástica global com
 * λ ≥ 4 (p. ex. JTG/T 3365-01, 5.5); pela EN 1993-1-1 5.2.1, efeitos de 2ª ordem são
 * desprezáveis só com λ ≥ 10 — aqui eles já estão na análise não linear.
 */

import type { ElementGroup } from '../model/types'
import type { BucklingMode, BucklingResult } from './types'
import { SkylineMatrix } from './skyline'
import type { BridgeSystem } from './system'
import { addGeometricStiffness, globalStiffness } from './frame'
import { jacobiEig } from './modal'

/** λ mínimo usual p/ a estabilidade elástica global (ver cabeçalho) */
export const BUCKLING_MIN_FACTOR = 4

export interface BucklingOptions {
  modes?: number
  maxIter?: number
  tol?: number
}

interface GeoEl {
  /** nº das equações (12; −1 = restrito) */
  dofs: Int32Array
  /** Kg global 12×12 */
  kg: Float64Array
  group: ElementGroup | undefined
}

/** maior compressão nas barras (kN, valor positivo) */
export function maxCompression(sys: BridgeSystem): number {
  let c = 0
  for (const f of sys.frames) if (-f.N > c) c = -f.N
  return c
}

export function solveBuckling(sys: BridgeSystem, opts: BucklingOptions = {}): BucklingResult | null {
  const n = sys.nEq
  const { eq } = sys
  if (n === 0 || !(maxCompression(sys) > 1)) return null
  const p = Math.max(1, Math.min(opts.modes ?? 4, n))
  const tol = opts.tol ?? 1e-7
  const maxIter = opts.maxIter ?? 80

  // ---- matrizes de elemento
  const geo: GeoEl[] = []
  const kgl = new Float64Array(144)
  const keG = new Float64Array(144)
  const assemble = (withKg: boolean): SkylineMatrix => {
    const K = new SkylineMatrix(sys.minRow)
    sys.frames.forEach((f, e) => {
      globalStiffness(f.R, f.kl, keG)
      const g = geo[e]
      for (let i = 0; i < 12; i++) {
        const gi = g.dofs[i]
        if (gi < 0) continue
        for (let j = 0; j < 12; j++) {
          const gj = g.dofs[j]
          if (gj < gi) continue
          K.add(gi, gj, keG[i * 12 + j] + (withKg ? g.kg[i * 12 + j] : 0))
        }
      }
    })
    for (const c of sys.cables) {
      const a6 = 6 * c.a
      const b6 = 6 * c.b
      const k = c.st.k3
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
    return K
  }
  for (const f of sys.frames) {
    const dofs = new Int32Array(12)
    for (let d = 0; d < 6; d++) {
      dofs[d] = eq[6 * f.a + d]
      dofs[6 + d] = eq[6 * f.b + d]
    }
    kgl.fill(0)
    if (f.N !== 0) addGeometricStiffness(kgl, f.L0, f.N)
    geo.push({ dofs, kg: globalStiffness(f.R, kgl, new Float64Array(144)), group: f.group })
  }
  const loaded = geo.filter((g) => g.kg.some((v) => v !== 0))

  // ---- fatoração: K1 = Ke + Kg (deslocamento espectral em λ = 1) ou, se indefinida, Ke
  let shift = 1
  let K: SkylineMatrix
  try {
    K = assemble(true)
    K.factorize()
  } catch {
    shift = 0
    K = assemble(false)
    K.factorize()
  }

  /** out = −Kg·x */
  const ue = new Float64Array(12)
  const minusKg = (x: Float64Array, out: Float64Array): Float64Array => {
    out.fill(0)
    for (const g of loaded) {
      for (let i = 0; i < 12; i++) ue[i] = g.dofs[i] >= 0 ? x[g.dofs[i]] : 0
      for (let i = 0; i < 12; i++) {
        const gi = g.dofs[i]
        if (gi < 0) continue
        let s = 0
        const o = i * 12
        for (let j = 0; j < 12; j++) s += g.kg[o + j] * ue[j]
        out[gi] -= s
      }
    }
    return out
  }
  const dotv = (a: Float64Array, b: Float64Array): number => {
    let s = 0
    for (let i = 0; i < n; i++) s += a[i] * b[i]
    return s
  }

  // ---- iteração por subespaço
  let q = Math.min(n, Math.max(2 * p + 4, p + 12))
  let seed = 4711
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }
  // Z = −Kg·X (vetores iniciais pseudoaleatórios, determinísticos)
  let Z: Float64Array[] = []
  {
    const x = new Float64Array(n)
    for (let j = 0; j < q; j++) {
      for (let i = 0; i < n; i++) x[i] = rnd()
      Z.push(minusKg(x, new Float64Array(n)))
    }
  }
  let X: Float64Array[] = []
  let mu: Float64Array = new Float64Array(0)
  let prev: number[] = []
  let iterations = 0
  let converged = false
  for (; iterations < maxIter; iterations++) {
    // Y = K⁻¹·Z, com K·Y = Z guardado p/ o produto interno em K
    const Y: Float64Array[] = []
    const KY: Float64Array[] = []
    for (let j = 0; j < Z.length; j++) {
      const z = Z[j]
      const y = K.solve(z)
      const n0 = dotv(y, z)
      if (!(n0 > 0)) continue
      // Gram-Schmidt modificado (duas passadas) no produto interno de K
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < Y.length; i++) {
          const c = dotv(Y[i], z)
          if (c === 0) continue
          const yi = Y[i]
          const zi = KY[i]
          for (let k = 0; k < n; k++) {
            y[k] -= c * yi[k]
            z[k] -= c * zi[k]
          }
        }
      }
      const nn = dotv(y, z)
      if (!(nn > 1e-13 * n0)) continue // dependente dos anteriores: descarta
      const s = 1 / Math.sqrt(nn)
      for (let k = 0; k < n; k++) {
        y[k] *= s
        z[k] *= s
      }
      Y.push(y)
      KY.push(z)
    }
    q = Y.length
    if (q === 0) return null
    // Rayleigh-Ritz: A = Yᵀ·(−Kg)·Y (simétrica, base K-ortonormal)
    const W = Y.map((y) => minusKg(y, new Float64Array(n)))
    const A = new Float64Array(q * q)
    for (let a = 0; a < q; a++) {
      for (let b = a; b < q; b++) {
        const v = 0.5 * (dotv(Y[a], W[b]) + dotv(Y[b], W[a]))
        A[a * q + b] = v
        A[b * q + a] = v
      }
    }
    const { values, vectors } = jacobiEig(A, q)
    // ordena por μ decrescente
    const order = Array.from({ length: q }, (_, i) => q - 1 - i)
    mu = Float64Array.from(order.map((c) => values[c]))
    const rotate = (V: Float64Array[]): Float64Array[] =>
      order.map((c) => {
        const out = new Float64Array(n)
        for (let k = 0; k < q; k++) {
          const f = vectors[k * q + c]
          if (f === 0) continue
          const v = V[k]
          for (let i = 0; i < n; i++) out[i] += f * v[i]
        }
        return out
      })
    X = rotate(Y)
    Z = rotate(W)
    const top: number[] = []
    for (let k = 0; k < q && top.length < p; k++) if (mu[k] > 0) top.push(mu[k])
    let ok = top.length > 0 && top.length === prev.length
    if (ok) for (let k = 0; k < top.length; k++) if (Math.abs(top[k] - prev[k]) > tol * Math.abs(top[k])) ok = false
    prev = top
    if (ok) {
      converged = true
      iterations++
      break
    }
    if (top.length === 0 && iterations >= 6) break
  }

  // ---- pós-processamento
  const modes: BucklingMode[] = []
  for (let k = 0; k < X.length && modes.length < p; k++) {
    if (!(mu[k] > 1e-12 * Math.abs(mu[0] || 1))) continue
    const factor = shift + 1 / mu[k]
    if (!(factor > 0) || !Number.isFinite(factor)) continue
    const x = X[k]
    const shape = new Array<number>(6 * sys.nNodes).fill(0)
    let maxT = 0
    let maxA = 0
    for (let i = 0; i < eq.length; i++) {
      if (eq[i] < 0) continue
      const v = x[eq[i]]
      shape[i] = v
      if (i % 6 < 3 && Math.abs(v) > maxT) maxT = Math.abs(v)
      if (Math.abs(v) > maxA) maxA = Math.abs(v)
    }
    const s = maxT > 0 ? 1 / maxT : maxA > 0 ? 1 / maxA : 1
    // grupo que alimenta a instabilidade: trabalho −φᵀ·Kg·φ das barras comprimidas
    const share = new Map<string, number>()
    let total = 0
    for (const g of loaded) {
      for (let i = 0; i < 12; i++) ue[i] = g.dofs[i] >= 0 ? x[g.dofs[i]] : 0
      let w = 0
      for (let i = 0; i < 12; i++) {
        let r = 0
        for (let j = 0; j < 12; j++) r += g.kg[i * 12 + j] * ue[j]
        w -= ue[i] * r
      }
      if (w <= 0) continue
      const key = g.group ?? 'other'
      share.set(key, (share.get(key) ?? 0) + w)
      total += w
    }
    let group = 'other'
    let best = 0
    share.forEach((w, key) => {
      if (w > best) {
        best = w
        group = key
      }
    })
    modes.push({
      index: modes.length + 1,
      factor,
      shape: shape.map((v) => v * s),
      group,
      share: total > 0 ? best / total : 0,
    })
  }
  if (modes.length === 0) return null
  return { modes, iterations, converged, maxCompression: maxCompression(sys), minFactor: BUCKLING_MIN_FACTOR }
}

/** [ext:verificacoes] — `opts.buckling === false` desliga; sem barra comprimida não roda */
export function runBuckling(ctx: import('./context').AnalysisContext): void {
  const o = ctx.opts.buckling
  if (o === false) return
  ctx.progress('Flambagem', 0.985)
  const r = solveBuckling(ctx.sys, { modes: o?.modes ?? 4 })
  if (r) {
    ctx.res.buckling = r
    const l1 = r.modes[0].factor
    if (!r.converged) ctx.warnings.push('A iteração por subespaço da flambagem não convergiu para todos os modos pedidos.')
    if (l1 < 1) {
      ctx.warnings.push(
        `Flambagem: fator crítico λ = ${l1.toFixed(2)} < 1 — a estrutura é instável sob a própria carga permanente.`,
      )
    } else if (l1 < r.minFactor) {
      ctx.warnings.push(
        `Flambagem: fator crítico λ = ${l1.toFixed(2)} sobre a carga permanente, abaixo de ${r.minFactor} ` +
          '(referência usual de estabilidade elástica global).',
      )
    }
  }
  ctx.lap('flambagem')
}
