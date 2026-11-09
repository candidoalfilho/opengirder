import type { Vec3 } from '../model/types'

export const G = 9.80665

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
export function cross(a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
export function norm(a: ArrayLike<number>): number {
  return Math.hypot(a[0], a[1], a[2])
}
export function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0]
}

/**
 * Eixos locais de uma barra: ex = p1→p2; ey = projeção de `up` ⟂ ex (padrão +Z global;
 * p/ barras verticais, +X global); ez = ex × ey. Os diagramas Mz/Vy são desenhados em ey.
 */
export function frameAxes(p1: Vec3, p2: Vec3, up?: Vec3): { ex: Vec3; ey: Vec3; ez: Vec3; L: number } {
  const d = sub(p2, p1)
  const L = norm(d)
  if (!(L > 0)) return { ex: [1, 0, 0], ey: [0, 0, 1], ez: [0, -1, 0], L: 0 }
  const ex: Vec3 = [d[0] / L, d[1] / L, d[2] / L]
  let ref: Vec3 = up ?? [0, 0, 1]
  let ez = cross(ex, ref)
  if (norm(ez) < 1e-3) {
    ref = [1, 0, 0]
    ez = cross(ex, ref)
    if (norm(ez) < 1e-3) ez = cross(ex, [0, 1, 0])
  }
  ez = normalize(ez)
  const ey = cross(ez, ex)
  return { ex, ey, ez, L }
}

/**
 * Polilinha de um cabo com flecha `sag` (vertical, no meio do vão) — parábola sob a corda.
 * Só p/ desenho.
 */
export function cablePolyline(p1: Vec3, p2: Vec3, sag: number, n = 12): Vec3[] {
  const pts: Vec3[] = []
  const s = Number.isFinite(sag) && sag > 0 ? sag : 0
  const m = s > 1e-4 ? Math.max(2, n) : 1
  for (let i = 0; i <= m; i++) {
    const t = i / m
    pts.push([
      p1[0] + (p2[0] - p1[0]) * t,
      p1[1] + (p2[1] - p1[1]) * t,
      p1[2] + (p2[2] - p1[2]) * t - 4 * s * t * (1 - t),
    ])
  }
  return pts
}
