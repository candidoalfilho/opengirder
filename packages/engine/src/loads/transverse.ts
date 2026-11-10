/**
 * Distribuição transversal da carga móvel em tabuleiro de grelha.
 *
 * No modelo de espinha a carga excêntrica entra como força + torçor no eixo. Numa grelha
 * isso não serve: um torçor aplicado num nó da laje carrega as longarinas VIZINHAS desse nó,
 * e não a longarina que de fato está sob a roda. Aqui cada linha longitudinal (longarina)
 * tem a sua linha de influência de força unitária e a carga é levada às duas linhas
 * vizinhas pela regra da alavanca (interpolação linear em y; nos balanços, extrapolação —
 * a longarina de borda recebe mais que 1 e a seguinte, alívio). A repartição ENTRE
 * longarinas a partir daí é a do próprio modelo de grelha (laje e transversinas).
 *
 *  - carga distribuída p (kN/m²): em cada estaca, só as faixas transversais desfavoráveis da
 *    largura carregável são carregadas (integral exata da parte positiva / negativa da
 *    linha de influência transversal, que é linear por trechos);
 *  - veículo: duas rodas por eixo afastadas de `track`; a posição transversal do veículo
 *    varre os pontos onde o máximo pode ocorrer (limites da pista e roda sobre longarina).
 */

export interface LoadLine {
  /** posição transversal em relação ao eixo da pista (m) */
  y: number
  /** índices (em model.nodes) dos nós da linha, um por estaca */
  nodes: number[]
  /** resposta a uma força vertical unitária em cada estaca */
  RF: Float64Array[]
}

/** pesos da regra da alavanca p/ uma carga unitária em `y` (linhas em ordem crescente de y) */
export function leverWeights(ys: ArrayLike<number>, y: number, out: Float64Array, o = 0): void {
  const n = ys.length
  for (let l = 0; l < n; l++) out[o + l] = 0
  if (n === 1) {
    out[o] = 1
    return
  }
  let a = 0
  while (a < n - 2 && y > ys[a + 1]) a++
  const t = (y - ys[a]) / (ys[a + 1] - ys[a])
  out[o + a] = 1 - t
  out[o + a + 1] = t
}

export interface TransverseEnvelope {
  /** escreve em `out` [dMáx, dMín, vMáx, vMín] da resposta `j`: carga distribuída e veículo */
  (j: number, out: Float64Array): void
}

export interface TransverseOptions {
  /** área de influência longitudinal de cada estaca (m) */
  trib: Float64Array
  /** largura carregável (m) e excentricidade máxima do eixo do veículo (m) */
  width: number
  ecc: number
  /** carga distribuída (kN/m²) */
  q: number
  /** carga por eixo já descontada da distribuída (kN) e distância entre rodas (m) */
  axleLoad: number
  track: number
  /** posições candidatas do veículo ao longo da pista: nAx2 pares (índice, peso) por posição */
  candIdx: Int32Array
  candW: Float64Array
  nCand: number
  nAx2: number
}

export function transverseEnvelope(linesIn: LoadLine[], o: TransverseOptions): TransverseEnvelope {
  const lines = [...linesIn].sort((a, b) => a.y - b.y)
  const L = lines.length
  const m = o.trib.length
  const ys = Float64Array.from(lines.map((l) => l.y))
  const half = o.width / 2

  // ---- carga distribuída: pontos de quebra da LI transversal dentro da largura carregável
  const bps: number[] = [-half]
  for (let l = 0; l < L; l++) if (ys[l] > -half + 1e-9 && ys[l] < half - 1e-9) bps.push(ys[l])
  bps.push(half)
  const nB = bps.length
  const WB = new Float64Array(nB * L)
  for (let b = 0; b < nB; b++) leverWeights(ys, bps[b], WB, b * L)

  // ---- veículo: posições transversais candidatas do eixo do veículo
  const ecc = Math.max(0, o.ecc)
  const ht = o.track / 2
  const cand = new Set<number>([-ecc, ecc, 0])
  for (let l = 0; l < L; l++) {
    for (const y of [ys[l] - ht, ys[l] + ht]) if (y > -ecc && y < ecc) cand.add(Math.round(y * 1e6) / 1e6)
  }
  const yv = [...cand].sort((a, b) => a - b)
  const nY = o.axleLoad !== 0 ? yv.length : 0
  const VW = new Float64Array(nY * L)
  const w1 = new Float64Array(L)
  const w2 = new Float64Array(L)
  for (let c = 0; c < nY; c++) {
    leverWeights(ys, yv[c] - ht, w1)
    leverWeights(ys, yv[c] + ht, w2)
    for (let l = 0; l < L; l++) VW[c * L + l] = 0.5 * (w1[l] + w2[l])
  }

  const eta = new Float64Array(L * m)
  const g = new Float64Array(nB)
  const S = new Float64Array(L)

  return (j, out) => {
    for (let l = 0; l < L; l++) {
      const R = lines[l].RF
      const ol = l * m
      for (let k = 0; k < m; k++) eta[ol + k] = R[k][j]
    }
    // carga distribuída
    let dMax = 0
    let dMin = 0
    for (let k = 0; k < m; k++) {
      for (let b = 0; b < nB; b++) {
        let s = 0
        const ob = b * L
        for (let l = 0; l < L; l++) s += WB[ob + l] * eta[l * m + k]
        g[b] = s
      }
      let pos = 0
      let neg = 0
      for (let b = 1; b < nB; b++) {
        const h = bps[b] - bps[b - 1]
        const a = g[b - 1]
        const c = g[b]
        if (a >= 0 && c >= 0) pos += 0.5 * (a + c) * h
        else if (a <= 0 && c <= 0) neg += 0.5 * (a + c) * h
        else {
          // troca de sinal no trecho: zero em t = a/(a − c)
          const t = a / (a - c)
          const p1 = 0.5 * a * t * h
          const p2 = 0.5 * c * (1 - t) * h
          if (a > 0) {
            pos += p1
            neg += p2
          } else {
            neg += p1
            pos += p2
          }
        }
      }
      dMax += o.q * pos * o.trib[k]
      dMin += o.q * neg * o.trib[k]
    }
    // veículo
    let vMax = 0
    let vMin = 0
    if (nY > 0) {
      const ci = o.candIdx
      const cw = o.candW
      for (let c = 0; c < o.nCand; c++) {
        const oc = c * o.nAx2
        for (let l = 0; l < L; l++) {
          let s = 0
          const ol = l * m
          for (let t = 0; t < o.nAx2; t++) {
            const w = cw[oc + t]
            if (w !== 0) s += w * eta[ol + ci[oc + t]]
          }
          S[l] = s
        }
        for (let y = 0; y < nY; y++) {
          let v = 0
          const oy = y * L
          for (let l = 0; l < L; l++) v += VW[oy + l] * S[l]
          v *= o.axleLoad
          if (v > vMax) vMax = v
          if (v < vMin) vMin = v
        }
      }
    }
    out[0] = dMax
    out[1] = dMin
    out[2] = vMax
    out[3] = vMin
  }
}
