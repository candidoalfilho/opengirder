/**
 * Barra de pórtico espacial (Euler-Bernoulli, 12 GDL) com formulação corrotacional.
 *
 * GDL locais: [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj].
 * Flexão em torno de z (deslocamento em y) usa Iz; em torno de y (deslocamento em z), Iy.
 *
 * Não linearidade geométrica: o referencial local acompanha a CORDA deformada; as
 * deformações locais são o alongamento e as rotações das tríades nodais (rotação finita
 * exata) relativas à corda — pequenas, pois o movimento de corpo rígido é filtrado.
 * Força interna local f = (k + kg(N))·u_def; força global = Tᵀ(R atual)·f. A tangente
 * Tᵀ(k + kg(N))T reproduz a matriz geométrica clássica (termos 6/5·N/L, N/10, 2NL/15, −NL/30),
 * ou seja, efeitos P-Δ e P-δ.
 */

/** matriz de rigidez local 12×12 (simétrica, densa row-major) */
export function localStiffness(L: number, EA: number, EIy: number, EIz: number, GJ: number): Float64Array {
  const L2 = L * L
  const L3 = L2 * L
  const k = new Float64Array(144)
  const set = (i: number, j: number, v: number) => {
    k[i * 12 + j] = v
    k[j * 12 + i] = v
  }
  set(0, 0, EA / L)
  set(0, 6, -EA / L)
  set(6, 6, EA / L)
  set(3, 3, GJ / L)
  set(3, 9, -GJ / L)
  set(9, 9, GJ / L)
  // flexão em torno de z (v em y): gdl 1,5,7,11
  set(1, 1, (12 * EIz) / L3)
  set(1, 5, (6 * EIz) / L2)
  set(1, 7, (-12 * EIz) / L3)
  set(1, 11, (6 * EIz) / L2)
  set(5, 5, (4 * EIz) / L)
  set(5, 7, (-6 * EIz) / L2)
  set(5, 11, (2 * EIz) / L)
  set(7, 7, (12 * EIz) / L3)
  set(7, 11, (-6 * EIz) / L2)
  set(11, 11, (4 * EIz) / L)
  // flexão em torno de y (w em z): gdl 2,4,8,10
  set(2, 2, (12 * EIy) / L3)
  set(2, 4, (-6 * EIy) / L2)
  set(2, 8, (-12 * EIy) / L3)
  set(2, 10, (-6 * EIy) / L2)
  set(4, 4, (4 * EIy) / L)
  set(4, 8, (6 * EIy) / L2)
  set(4, 10, (2 * EIy) / L)
  set(8, 8, (12 * EIy) / L3)
  set(8, 10, (6 * EIy) / L2)
  set(10, 10, (4 * EIy) / L)
  return k
}

/** soma em `k` a matriz geométrica local p/ esforço normal N (tração +) */
export function addGeometricStiffness(k: Float64Array, L: number, N: number): void {
  const a = (6 * N) / (5 * L)
  const b = N / 10
  const c = (2 * N * L) / 15
  const d = (-N * L) / 30
  const add = (i: number, j: number, v: number) => {
    k[i * 12 + j] += v
    if (i !== j) k[j * 12 + i] += v
  }
  // plano x-y (gdl 1,5,7,11)
  add(1, 1, a)
  add(1, 5, b)
  add(1, 7, -a)
  add(1, 11, b)
  add(5, 5, c)
  add(5, 7, -b)
  add(5, 11, d)
  add(7, 7, a)
  add(7, 11, -b)
  add(11, 11, c)
  // plano x-z (gdl 2,4,8,10)
  add(2, 2, a)
  add(2, 4, -b)
  add(2, 8, -a)
  add(2, 10, -b)
  add(4, 4, c)
  add(4, 8, b)
  add(4, 10, d)
  add(8, 8, a)
  add(8, 10, b)
  add(10, 10, c)
}

/**
 * Cargas nodais equivalentes (vetor local, 12) p/ carga uniforme em todo o vão,
 * em kN/m nos eixos locais.
 */
export function equivalentNodalLoads(L: number, wx: number, wy: number, wz: number): Float64Array {
  const f = new Float64Array(12)
  const L2 = L * L
  f[0] = (wx * L) / 2
  f[6] = (wx * L) / 2
  f[1] = (wy * L) / 2
  f[5] = (wy * L2) / 12
  f[7] = (wy * L) / 2
  f[11] = -(wy * L2) / 12
  f[2] = (wz * L) / 2
  f[4] = -(wz * L2) / 12
  f[8] = (wz * L) / 2
  f[10] = (wz * L2) / 12
  return f
}

/** u_local = T·u_global, T = blocdiag(R,R,R,R); R (9) com linhas = ex, ey, ez */
export function toLocal(r: ArrayLike<number>, ug: ArrayLike<number>, out: Float64Array): Float64Array {
  for (let b = 0; b < 4; b++) {
    const o = b * 3
    for (let i = 0; i < 3; i++) {
      out[o + i] = r[i * 3] * ug[o] + r[i * 3 + 1] * ug[o + 1] + r[i * 3 + 2] * ug[o + 2]
    }
  }
  return out
}

/** f_global = Tᵀ·f_local */
export function toGlobal(r: ArrayLike<number>, fl: ArrayLike<number>, out: Float64Array): Float64Array {
  for (let b = 0; b < 4; b++) {
    const o = b * 3
    for (let i = 0; i < 3; i++) {
      out[o + i] = r[i] * fl[o] + r[3 + i] * fl[o + 1] + r[6 + i] * fl[o + 2]
    }
  }
  return out
}

const TMP9 = new Float64Array(9)

/** K_global = Tᵀ·k_local·T (12×12 densas) */
export function globalStiffness(r: ArrayLike<number>, kl: Float64Array, kg: Float64Array): Float64Array {
  for (let bi = 0; bi < 4; bi++) {
    for (let bj = 0; bj < 4; bj++) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0
          for (let m = 0; m < 3; m++) s += r[m * 3 + i] * kl[(bi * 3 + m) * 12 + (bj * 3 + j)]
          TMP9[i * 3 + j] = s
        }
      }
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0
          for (let m = 0; m < 3; m++) s += TMP9[i * 3 + m] * r[m * 3 + j]
          kg[(bi * 3 + i) * 12 + (bj * 3 + j)] = s
        }
      }
    }
  }
  return kg
}

export interface FrameKinematics {
  /** referencial atual (9): linhas ex, ey, ez */
  R: Float64Array
  /** deformações locais (12) */
  ul: Float64Array
}

/**
 * Cinemática corrotacional: dado o estado global dos dois nós (12: translações e rotações
 * pequenas), devolve o referencial da corda deformada e as deformações locais.
 *
 * @param x  coordenadas iniciais [x1,y1,z1,x2,y2,z2]
 * @param R0 referencial inicial (9)
 * @param L0 comprimento inicial
 * @param ug deslocamentos globais (12)
 */
export function corotate(
  x: ArrayLike<number>,
  R0: ArrayLike<number>,
  L0: number,
  ug: ArrayLike<number>,
  out: FrameKinematics,
): void {
  const dx = x[3] + ug[6] - x[0] - ug[0]
  const dy = x[4] + ug[7] - x[1] - ug[1]
  const dz = x[5] + ug[8] - x[2] - ug[2]
  const Ln = Math.hypot(dx, dy, dz)
  const exx = dx / Ln
  const exy = dy / Ln
  const exz = dz / Ln
  // alongamento, calculado sem cancelamento: (Ln² − L0²)/(Ln + L0)
  const ddx = ug[6] - ug[0]
  const ddy = ug[7] - ug[1]
  const ddz = ug[8] - ug[2]
  const x0 = x[3] - x[0]
  const y0 = x[4] - x[1]
  const z0 = x[5] - x[2]
  const e = (2 * (x0 * ddx + y0 * ddy + z0 * ddz) + ddx * ddx + ddy * ddy + ddz * ddz) / (Ln + L0)

  // tríades nodais: R(θi)·[ex0, ey0, ez0] com rotação finita exata (Rodrigues). Assim um
  // movimento de corpo rígido de qualquer amplitude não gera deformação — essencial com
  // transversinas rígidas, onde um erro de 2ª ordem na rotação vira um momento enorme.
  rotateTriad(ug[3], ug[4], ug[5], R0, N1)
  rotateTriad(ug[9], ug[10], ug[11], R0, N2)
  // referencial do elemento: ex = corda; ey = média dos ey nodais, projetada ⟂ ex
  const rx = 0.5 * (N1[3] + N2[3])
  const ry = 0.5 * (N1[4] + N2[4])
  const rz = 0.5 * (N1[5] + N2[5])
  let zx = exy * rz - exz * ry
  let zy = exz * rx - exx * rz
  let zz = exx * ry - exy * rx
  const zn = Math.hypot(zx, zy, zz)
  zx /= zn
  zy /= zn
  zz /= zn
  const yx = zy * exz - zz * exy
  const yy = zz * exx - zx * exz
  const yz = zx * exy - zy * exx
  const R = out.R
  R[0] = exx; R[1] = exy; R[2] = exz
  R[3] = yx; R[4] = yy; R[5] = yz
  R[6] = zx; R[7] = zy; R[8] = zz

  // rotações locais = vetor axial da parte antissimétrica de Reᵀ·Ni (Crisfield)
  const ul = out.ul
  ul.fill(0)
  ul[6] = e
  for (let k = 0; k < 2; k++) {
    const N = k === 0 ? N1 : N2
    const o = k === 0 ? 3 : 9
    // N = [t (0..2), s (3..5), r (6..8)]
    const tY = N[0] * yx + N[1] * yy + N[2] * yz
    const tZ = N[0] * zx + N[1] * zy + N[2] * zz
    const sX = N[3] * exx + N[4] * exy + N[5] * exz
    const sZ = N[3] * zx + N[4] * zy + N[5] * zz
    const rX = N[6] * exx + N[7] * exy + N[8] * exz
    const rY = N[6] * yx + N[7] * yy + N[8] * yz
    ul[o] = 0.5 * (sZ - rY)
    ul[o + 1] = 0.5 * (rX - tZ)
    ul[o + 2] = 0.5 * (tY - sX)
  }
}

const N1 = new Float64Array(9)
const N2 = new Float64Array(9)

/** out = R(θ)·[linhas de R0], R(θ) = exp(θ^) (fórmula de Rodrigues) */
function rotateTriad(ax: number, ay: number, az: number, R0: ArrayLike<number>, out: Float64Array): void {
  const p2 = ax * ax + ay * ay + az * az
  let a: number
  let b: number
  if (p2 < 1e-8) {
    a = 1 - p2 / 6
    b = 0.5 - p2 / 24
  } else {
    const p = Math.sqrt(p2)
    a = Math.sin(p) / p
    b = (1 - Math.cos(p)) / p2
  }
  for (let k = 0; k < 3; k++) {
    const vx = R0[3 * k]
    const vy = R0[3 * k + 1]
    const vz = R0[3 * k + 2]
    // c = θ × v ; d = θ × c
    const cx = ay * vz - az * vy
    const cy = az * vx - ax * vz
    const cz = ax * vy - ay * vx
    const dx = ay * cz - az * cy
    const dy = az * cx - ax * cz
    const dz = ax * cy - ay * cx
    out[3 * k] = vx + a * cx + b * dx
    out[3 * k + 1] = vy + a * cy + b * dy
    out[3 * k + 2] = vz + a * cz + b * dz
  }
}

/**
 * Esforços em 3 estações (0, L/2, L) a partir das forças de extremidade locais
 * f = k·u − f_eq e das cargas distribuídas locais. Convenções:
 *  N tração +; Vy = Fyi + wy·x; Mz = −Mzi + Fyi·x + wy·x²/2 (positivo traciona a fibra −y);
 *  Vz = Fzi + wz·x; My = Myi + Fzi·x + wz·x²/2; T = −Mxi.
 */
export function stationForces(
  f: ArrayLike<number>,
  L: number,
  wx: number,
  wy: number,
  wz: number,
  out: Float64Array,
  o: number,
): void {
  for (let s = 0; s < 3; s++) {
    const x = (L * s) / 2
    out[o + s] = -(f[0] + wx * x) // N
    out[o + 3 + s] = f[1] + wy * x // Vy
    out[o + 6 + s] = f[2] + wz * x // Vz
    out[o + 9 + s] = -f[3] // T
    out[o + 12 + s] = f[4] + f[2] * x + (wz * x * x) / 2 // My
    out[o + 15 + s] = -f[5] + f[1] * x + (wy * x * x) / 2 // Mz
  }
}
