/**
 * Análise modal — iteração por subespaço (Bathe) sobre a rigidez TANGENTE no estado de
 * carga permanente (inclui a rigidez geométrica dos cabos e das barras — é ela que dá
 * frequência a uma ponte pênsil) com massa concentrada.
 */

import type { ModalResult, Mode, ModeKind } from './types'
import type { SkylineMatrix } from './skyline'
import type { BridgeSystem } from './system'

/** autovalores/autovetores de matriz simétrica densa n×n (Jacobi cíclico). Devolve em ordem crescente. */
export function jacobiEig(a: Float64Array, n: number): { values: Float64Array; vectors: Float64Array } {
  const v = new Float64Array(n * n)
  for (let i = 0; i < n; i++) v[i * n + i] = 1
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i * n + j] * a[i * n + j]
    let diag = 0
    for (let i = 0; i < n; i++) diag += a[i * n + i] * a[i * n + i]
    if (off <= 1e-28 * (diag + 1e-300)) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]
        if (Math.abs(apq) < 1e-300) continue
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]
          const akq = a[k * n + q]
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]
          const aqk = a[q * n + k]
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]
          const vkq = v[k * n + q]
          v[k * n + p] = c * vkp - s * vkq
          v[k * n + q] = s * vkp + c * vkq
        }
      }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i * n + i] - a[j * n + j])
  const values = new Float64Array(n)
  const vectors = new Float64Array(n * n)
  idx.forEach((src, dst) => {
    values[dst] = a[src * n + src]
    for (let k = 0; k < n; k++) vectors[k * n + dst] = v[k * n + src]
  })
  return { values, vectors }
}

/**
 * Problema generalizado reduzido Kr·Q = Mr·Q·Λ (q×q, simétricas, Mr positiva definida):
 * Cholesky de Mr e Jacobi. Devolve Q (colunas M-ortonormais) e Λ crescente.
 */
function reducedEig(Kr: Float64Array, Mr: Float64Array, q: number): { values: Float64Array; Q: Float64Array } {
  // Mr = L·Lᵀ
  const L = new Float64Array(q * q)
  for (let i = 0; i < q; i++) {
    for (let j = 0; j <= i; j++) {
      let s = Mr[i * q + j]
      for (let k = 0; k < j; k++) s -= L[i * q + k] * L[j * q + k]
      if (i === j) {
        if (!(s > 0)) throw new Error('Matriz de massa reduzida não é positiva definida.')
        L[i * q + i] = Math.sqrt(s)
      } else L[i * q + j] = s / L[j * q + j]
    }
  }
  // A = L⁻¹·Kr·L⁻ᵀ
  const B = new Float64Array(q * q) // B = L⁻¹·Kr
  for (let c = 0; c < q; c++) {
    for (let i = 0; i < q; i++) {
      let s = Kr[i * q + c]
      for (let k = 0; k < i; k++) s -= L[i * q + k] * B[k * q + c]
      B[i * q + c] = s / L[i * q + i]
    }
  }
  const A = new Float64Array(q * q) // A = B·L⁻ᵀ  ⇒ A·Lᵀ = B  (resolve por linhas)
  for (let r = 0; r < q; r++) {
    for (let j = 0; j < q; j++) {
      let s = B[r * q + j]
      for (let k = 0; k < j; k++) s -= A[r * q + k] * L[j * q + k]
      A[r * q + j] = s / L[j * q + j]
    }
  }
  for (let i = 0; i < q; i++) for (let j = i + 1; j < q; j++) {
    const m = 0.5 * (A[i * q + j] + A[j * q + i])
    A[i * q + j] = m
    A[j * q + i] = m
  }
  const { values, vectors } = jacobiEig(A, q)
  // Q = L⁻ᵀ·Z
  const Q = new Float64Array(q * q)
  for (let c = 0; c < q; c++) {
    for (let i = q - 1; i >= 0; i--) {
      let s = vectors[i * q + c]
      for (let k = i + 1; k < q; k++) s -= L[k * q + i] * Q[k * q + c]
      Q[i * q + c] = s / L[i * q + i]
    }
  }
  return { values, Q }
}

export function solveModal(sys: BridgeSystem, K: SkylineMatrix, nModes: number): ModalResult {
  const n = sys.nEq
  const { eq, mass } = sys
  const p = Math.max(1, Math.min(nModes, n))
  const q = Math.min(n, Math.max(2 * p, p + 8))
  const m = new Float64Array(n)
  for (let i = 0; i < eq.length; i++) if (eq[i] >= 0) m[eq[i]] = mass[i]

  // vetores iniciais determinísticos (pseudoaleatórios) — o 1º é uniforme
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }
  let X: Float64Array[] = []
  for (let j = 0; j < q; j++) {
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = j === 0 ? 1 : rnd()
    X.push(x)
  }

  let lam: Float64Array = new Float64Array(q)
  let prev = new Float64Array(q).fill(Infinity)
  let iterations = 0
  let converged = false
  const Y: Float64Array[] = X.map(() => new Float64Array(n))
  const Kr = new Float64Array(q * q)
  const Mr = new Float64Array(q * q)
  for (; iterations < 80; iterations++) {
    const Xb: Float64Array[] = []
    for (let j = 0; j < q; j++) {
      const y = Y[j]
      const x = X[j]
      for (let i = 0; i < n; i++) y[i] = m[i] * x[i]
      Xb.push(K.solve(y))
    }
    for (let a = 0; a < q; a++) {
      for (let b = a; b < q; b++) {
        let sk = 0
        let sm = 0
        const xa = Xb[a]
        const xb = Xb[b]
        const yb = Y[b]
        for (let i = 0; i < n; i++) {
          sk += xa[i] * yb[i]
          sm += xa[i] * m[i] * xb[i]
        }
        Kr[a * q + b] = sk
        Kr[b * q + a] = sk
        Mr[a * q + b] = sm
        Mr[b * q + a] = sm
      }
    }
    const red = reducedEig(Kr, Mr, q)
    lam = red.values
    const Xn: Float64Array[] = []
    for (let c = 0; c < q; c++) {
      const x = new Float64Array(n)
      for (let k = 0; k < q; k++) {
        const f = red.Q[k * q + c]
        if (f === 0) continue
        const xb = Xb[k]
        for (let i = 0; i < n; i++) x[i] += f * xb[i]
      }
      Xn.push(x)
    }
    X = Xn
    let ok = true
    for (let i = 0; i < p; i++) {
      if (Math.abs(lam[i] - prev[i]) > 1e-9 * Math.abs(lam[i])) ok = false
    }
    prev = Float64Array.from(lam)
    if (ok) {
      converged = true
      iterations++
      break
    }
  }

  // pós-processamento
  let totalMass = 0
  for (let i = 0; i < sys.nNodes; i++) totalMass += mass[6 * i + 2]
  const deckNode = new Uint8Array(sys.nNodes)
  sys.model.nodes.forEach((nd, i) => {
    if (nd.role === 'deck') deckNode[i] = 1
  })
  const modes: Mode[] = []
  for (let k = 0; k < p; k++) {
    const x = X[k]
    const w2 = lam[k]
    if (!(w2 > 0)) continue
    const omega = Math.sqrt(w2)
    const shape = new Array<number>(6 * sys.nNodes).fill(0)
    let maxT = 0
    for (let i = 0; i < eq.length; i++) {
      if (eq[i] < 0) continue
      const v = x[eq[i]]
      shape[i] = v
      if (i % 6 < 3 && Math.abs(v) > maxT) maxT = Math.abs(v)
    }
    // massas efetivas e energia cinética por direção
    const gamma = [0, 0, 0]
    const ke = [0, 0, 0]
    let mgen = 0
    let keRot = 0
    let keDeckTrans = 0
    let keDeckTwist = 0
    for (let i = 0; i < sys.nNodes; i++) {
      for (let d = 0; d < 6; d++) {
        const g = eq[6 * i + d]
        if (g < 0) continue
        const v = x[g]
        const e = mass[6 * i + d] * v * v
        mgen += e
        if (d < 3) {
          gamma[d] += mass[6 * i + d] * v
          ke[d] += e
          if (deckNode[i]) keDeckTrans += e
        } else {
          keRot += e
          if (deckNode[i]) keDeckTwist += e
        }
      }
    }
    const massPct: [number, number, number] = [0, 0, 0]
    for (let d = 0; d < 3; d++) massPct[d] = totalMass > 0 ? (100 * gamma[d] * gamma[d]) / (mgen * totalMass) : 0
    const keT = ke[0] + ke[1] + ke[2]
    let kind: ModeKind = 'misto'
    if (keDeckTwist > keDeckTrans && keRot > 0.15 * mgen) kind = 'torcional'
    else if (ke[1] > 0.6 * keT) kind = 'transversal'
    else if (ke[2] > 0.6 * keT) kind = 'vertical'
    else if (ke[0] > 0.6 * keT) kind = 'longitudinal'
    const s = maxT > 0 ? 1 / maxT : 1
    modes.push({
      index: modes.length + 1,
      period: (2 * Math.PI) / omega,
      frequency: omega / (2 * Math.PI),
      shape: shape.map((v) => v * s),
      massPct,
      kind,
    })
  }
  return { modes, totalMass, iterations, converged }
}
