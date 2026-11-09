/**
 * Cabo de catenária elástica (Irvine, 1981) — elemento exato p/ estais, cabos principais
 * e pendurais. Formulação em flexibilidade (Jayaraman & Knudson, 1981):
 *
 * Coordenada lagrangiana s ∈ [0, L0] medida no cabo indeformado, do nó I ao nó J; peso w
 * por unidade de comprimento indeformado (gravidade em −z). A tração tem componente
 * horizontal H (constante) e vertical V(s) = V0 + w·s. As projeções do cabo são
 *
 *   lh = H·L0/EA + (H/w)·[asinh(Vj/H) − asinh(V0/H)]
 *   lz = (V0·L0 + w·L0²/2)/EA + (Tj − Ti)/w,      Vj = V0 + w·L0,  T = √(H² + V²)
 *
 * Dadas as projeções (posição dos nós), resolve-se (H, V0) por Newton com a matriz de
 * flexibilidade F = ∂(lh, lz)/∂(H, V0); a rigidez tangente é F⁻¹ mais o termo geométrico
 * fora do plano H/lh.
 *
 * O cabo exerce (H·e_h, V0) no nó I e −(H·e_h, Vj) no nó J (e_h = versor horizontal I→J).
 */

export interface CableProps {
  EA: number
  /** peso por comprimento indeformado (kN/m); 0 = barra de treliça só-tração */
  w: number
  L0: number
}

export interface CableState {
  /** componente horizontal (kN) */
  H: number
  V0: number
  Vj: number
  Ti: number
  Tj: number
  /** projeção horizontal e vertical (m) */
  lh: number
  lz: number
  /** versor horizontal I→J */
  ex: number
  ey: number
  /** força interna no nó I (3) — o nó J recebe o oposto, mais o peso total em z */
  fI: [number, number, number]
  fJ: [number, number, number]
  /** rigidez tangente 3×3 (row-major): K = [[k3, −k3], [−k3, k3]] */
  k3: Float64Array
  slack: boolean
  converged: boolean
}

export function newCableState(): CableState {
  return {
    H: 0, V0: 0, Vj: 0, Ti: 0, Tj: 0, lh: 0, lz: 0, ex: 1, ey: 0,
    fI: [0, 0, 0], fJ: [0, 0, 0], k3: new Float64Array(9), slack: false, converged: true,
  }
}

interface Flex {
  lh: number
  lz: number
  F11: number
  F12: number
  F22: number
  Ti: number
  Tj: number
  Vj: number
  /** ∂lh/∂L0, ∂lz/∂L0 */
  dlhdL: number
  dlzdL: number
}

const FX: Flex = { lh: 0, lz: 0, F11: 0, F12: 0, F22: 0, Ti: 0, Tj: 0, Vj: 0, dlhdL: 0, dlzdL: 0 }

/** projeções e flexibilidade da catenária p/ (H, V0) dados — formas sem cancelamento */
export function catenaryFlex(H: number, V0: number, L0: number, EA: number, w: number, out: Flex = FX): Flex {
  const Vj = V0 + w * L0
  const Ti = Math.hypot(H, V0)
  const Tj = Math.hypot(H, Vj)
  const sumT = Ti + Tj
  // q = [Vj·Ti − V0·Tj]/(w·L0) = [H² + (Ti·Tj − V0·Vj)]/(Ti + Tj), escrito como H²·(1 + D)/(Ti + Tj)
  // com D = (Ti·Tj − V0·Vj)/H² — sem cancelamento nem p/ w → 0 nem p/ H → 0 (cabo vertical)
  const vv = V0 * Vj
  const H2 = H * H
  const D = vv > 0 ? (H2 + V0 * V0 + Vj * Vj) / (Ti * Tj + vv) : (Ti * Tj - vv) / H2
  const qh = (1 + D) / sumT
  const q = H2 * qh
  // asinh(Vj/H) − asinh(V0/H) = asinh((Vj·Ti − V0·Tj)/H²)
  const as = Math.asinh(w * L0 * qh)
  const asw = as / w
  // (Vj/Tj − V0/Ti)/w
  const g = (L0 * q) / (Ti * Tj)
  out.lh = (H * L0) / EA + H * asw
  // (Tj − Ti)/w = L0·(Vj + V0)/(Ti + Tj)
  out.lz = (V0 * L0 + 0.5 * w * L0 * L0) / EA + (L0 * (Vj + V0)) / sumT
  out.F11 = L0 / EA + asw - g
  // (H/w)(1/Tj − 1/Ti) = −H·L0·(Vj + V0)/((Ti + Tj)·Ti·Tj)
  out.F12 = (-H * L0 * (Vj + V0)) / (sumT * Ti * Tj)
  out.F22 = L0 / EA + g
  out.Ti = Ti
  out.Tj = Tj
  out.Vj = Vj
  out.dlhdL = H / EA + H / Tj
  out.dlzdL = Vj / EA + Vj / Tj
  return out
}

/**
 * Resolve (H, V0) p/ projeções dadas. `guess` = estado anterior (warm start).
 * Devolve false se não convergir (cabo dobrado/frouxo na vertical).
 */
export function solveCatenary(
  lh: number,
  lz: number,
  p: CableProps,
  guess: { H: number; V0: number } | null,
  out: { H: number; V0: number; iterations: number },
): boolean {
  const { EA, w, L0 } = p
  const c = Math.hypot(lh, lz)
  const W = w * L0
  const tol = 1e-12 * Math.max(L0, c)
  const hMin = 1e-14 * (EA + W)

  let H: number
  let V0: number
  if (guess && guess.H > 0 && Number.isFinite(guess.H) && Number.isFinite(guess.V0)) {
    H = guess.H
    V0 = guess.V0
  } else {
    // chute de Jayaraman–Knudson, com piso elástico p/ cabos tensos
    let lam: number
    if (L0 <= c) lam = 0.2
    else if (lh < 1e-9 * L0) lam = 1e6
    else lam = Math.sqrt(Math.max(3 * ((L0 * L0 - lz * lz) / (lh * lh) - 1), 1e-6))
    const coth = lam > 20 ? 1 : Math.cosh(lam) / Math.sinh(lam)
    H = (w * lh) / (2 * lam)
    V0 = 0.5 * w * (lz * coth - L0)
    const Te = (EA * (c - L0)) / L0
    if (Te > Math.hypot(H, V0)) {
      H = (Te * lh) / c
      V0 = (Te * lz) / c - 0.5 * W
    }
  }
  if (!(H > hMin)) H = hMin

  let f = catenaryFlex(H, V0, L0, EA, w)
  let g1 = f.lh - lh
  let g2 = f.lz - lz
  let gn = Math.hypot(g1, g2)
  let it = 0
  for (; it < 80 && gn > tol; it++) {
    const det = f.F11 * f.F22 - f.F12 * f.F12
    if (!(Math.abs(det) > 0) || !Number.isFinite(det)) break
    const dH = -(f.F22 * g1 - f.F12 * g2) / det
    const dV = -(-f.F12 * g1 + f.F11 * g2) / det
    // busca linear: H > 0 e resíduo decrescente
    let a = 1
    let ok = false
    let Hn = H
    let Vn = V0
    let gnn = gn
    for (let ls = 0; ls < 40; ls++) {
      Hn = H + a * dH
      Vn = V0 + a * dV
      if (!(Hn > hMin)) Hn = hMin
      f = catenaryFlex(Hn, Vn, L0, EA, w)
      const r1 = f.lh - lh
      const r2 = f.lz - lz
      gnn = Math.hypot(r1, r2)
      if (gnn < gn || gnn <= tol) {
        g1 = r1
        g2 = r2
        ok = true
        break
      }
      a *= 0.5
    }
    if (!ok) {
      // estagnou: reavalia no ponto atual e sai
      f = catenaryFlex(H, V0, L0, EA, w)
      break
    }
    H = Hn
    V0 = Vn
    gn = gnn
  }
  out.H = H
  out.V0 = V0
  out.iterations = it
  return gn <= Math.max(tol, 1e-9 * Math.max(L0, c))
}

/**
 * Avalia o elemento de cabo p/ o vetor I→J (dx, dy, dz) na configuração atual:
 * forças internas nos nós e rigidez tangente 3×3.
 */
export function evalCable(dx: number, dy: number, dz: number, p: CableProps, st: CableState): void {
  const { EA, w, L0 } = p
  const lh = Math.hypot(dx, dy)
  const c = Math.hypot(lh, dz)
  const k = st.k3
  st.lh = lh
  st.lz = dz
  st.slack = false
  st.converged = true

  // barra de treliça só-tração: cabo sem peso
  if (!(w > 0)) {
    const ex = dx / c
    const ey = dy / c
    const ez = dz / c
    let T = (EA * (c - L0)) / L0
    let ka = EA / L0
    if (T <= 0) {
      T = 0
      ka = 1e-8 * ka
      st.slack = true
    }
    const kg = T / c
    const e = [ex, ey, ez]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) k[i * 3 + j] = (ka - kg) * e[i] * e[j] + (i === j ? kg : 0)
    }
    st.H = (T * lh) / c
    st.V0 = T * ez
    st.Vj = T * ez
    st.Ti = T
    st.Tj = T
    st.ex = lh > 0 ? dx / lh : 1
    st.ey = lh > 0 ? dy / lh : 0
    st.fI[0] = -T * ex; st.fI[1] = -T * ey; st.fI[2] = -T * ez
    st.fJ[0] = T * ex; st.fJ[1] = T * ey; st.fJ[2] = T * ez
    return
  }

  const sol = SOL
  const guess = st.H > 0 ? st : null
  let ok = solveCatenary(lh, dz, p, guess, sol)
  if (!ok && guess) ok = solveCatenary(lh, dz, p, null, sol)
  const hx = lh > 1e-12 * c ? dx / lh : 1
  const hy = lh > 1e-12 * c ? dy / lh : 0
  st.ex = hx
  st.ey = hy
  if (!ok) {
    // cabo frouxo dobrado (ex.: pendural vertical com L0 > distância entre nós):
    // só o peso, dividido entre os nós, e uma rigidez residual
    st.slack = true
    st.converged = false
    st.H = 0
    st.V0 = -0.5 * w * L0
    st.Vj = 0.5 * w * L0
    st.Ti = 0.5 * w * L0
    st.Tj = 0.5 * w * L0
    st.fI[0] = 0; st.fI[1] = 0; st.fI[2] = 0.5 * w * L0
    st.fJ[0] = 0; st.fJ[1] = 0; st.fJ[2] = 0.5 * w * L0
    const kr = (1e-8 * EA) / L0
    k.fill(0)
    k[0] = kr; k[4] = kr; k[8] = kr
    return
  }
  const H = sol.H
  const V0 = sol.V0
  const f = catenaryFlex(H, V0, L0, EA, w)
  const det = f.F11 * f.F22 - f.F12 * f.F12
  const k11 = f.F22 / det
  const k12 = -f.F12 / det
  const k22 = f.F11 / det
  // termo fora do plano: H/lh (→ k11 quando o cabo é vertical)
  const kt = lh > 1e-9 * c ? H / lh : k11
  k[0] = k11 * hx * hx + kt * (1 - hx * hx)
  k[1] = (k11 - kt) * hx * hy
  k[2] = k12 * hx
  k[3] = k[1]
  k[4] = k11 * hy * hy + kt * (1 - hy * hy)
  k[5] = k12 * hy
  k[6] = k[2]
  k[7] = k[5]
  k[8] = k22
  st.H = H
  st.V0 = V0
  st.Vj = f.Vj
  st.Ti = f.Ti
  st.Tj = f.Tj
  st.fI[0] = -H * hx; st.fI[1] = -H * hy; st.fI[2] = -V0
  st.fJ[0] = H * hx; st.fJ[1] = H * hy; st.fJ[2] = f.Vj
  // frouxo "de verdade": tração da ordem do peso próprio
  st.slack = Math.max(f.Ti, f.Tj) < 1.5 * w * L0 && L0 > c
}

const SOL = { H: 0, V0: 0, iterations: 0 }

/**
 * Comprimento indeformado que produz a tração-alvo T (na extremidade mais tracionada)
 * p/ as projeções dadas — usado p/ converter protensão em L0.
 */
export function unstressedLengthForTension(lh: number, lz: number, EA: number, w: number, T: number): number {
  const c = Math.hypot(lh, lz)
  if (!(T > 0)) return c
  // 1ª aproximação: elástica + correção de flecha (parábola): L ≈ c·(1 + (w·lh)²/(24·T²))/(1 + T/EA)
  let L0 = (c * (1 + (w * lh) ** 2 / (24 * T * T))) / (1 + T / EA)
  if (!(w > 0)) return c / (1 + T / EA)
  const sol = { H: 0, V0: 0, iterations: 0 }
  const tension = (L: number): number => {
    if (!solveCatenary(lh, lz, { EA, w, L0: L }, null, sol)) return NaN
    const f = catenaryFlex(sol.H, sol.V0, L, EA, w)
    return Math.max(f.Ti, f.Tj)
  }
  // secante em L0
  let La = L0
  let Ta = tension(La)
  if (!Number.isFinite(Ta)) return L0
  let Lb = La * (1 + (Ta - T) / EA)
  for (let it = 0; it < 30; it++) {
    const Tb = tension(Lb)
    if (!Number.isFinite(Tb)) break
    if (Math.abs(Tb - T) < 1e-9 * T) return Lb
    const d = Tb - Ta
    if (Math.abs(d) < 1e-14 * T) break
    const Ln = Lb - ((Tb - T) * (Lb - La)) / d
    La = Lb
    Ta = Tb
    Lb = Ln
  }
  L0 = Lb
  return L0
}
