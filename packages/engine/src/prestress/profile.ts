/**
 * Traçado do cabo de protensão: pontos de controle ligados por parábolas do 2º grau.
 *
 *  - entre um ponto de tangente livre ('anchor') e um de tangente horizontal: uma parábola
 *    com vértice no ponto de tangente horizontal;
 *  - entre dois pontos de tangente horizontal (ponto baixo de vão ↔ ponto alto de apoio): duas
 *    parábolas com tangente comum na inflexão, que fica sobre a reta que une os dois pontos, a
 *    `inflection`·(comprimento do trecho) do ponto alto;
 *  - entre dois 'anchor': reta.
 *
 * Excentricidade positiva para baixo. O ângulo acumulado α(s) = Σ|Δθ| é a soma dos desvios
 * angulares (em parábolas, |e'(s2) − e'(s1)| em cada peça) usada na perda por atrito.
 */

import type { PrestressSection, TendonPoint } from './types'
import { TENDON_DEFAULTS } from './types'

/** peça parabólica: e(s) = e0 + b·(s − s0) + c·(s − s0)² em [s0, s1] */
interface Piece {
  s0: number
  s1: number
  e0: number
  b: number
  c: number
  /** ângulo acumulado no início da peça (rad) */
  a0: number
}

export interface TendonProfile {
  s0: number
  s1: number
  pieces: Piece[]
  /** excentricidade (m, + p/ baixo) */
  e(s: number): number
  /** de/ds */
  slope(s: number): number
  /** d²e/ds² */
  curvature(s: number): number
  /** soma dos desvios angulares desde o início do traçado (rad) */
  angle(s: number): number
  /** desvio angular total (rad) */
  totalAngle: number
}

export function buildProfile(points: TendonPoint[], inflection: number = TENDON_DEFAULTS.inflection): TendonProfile {
  const pts = points
    .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e))
    .slice()
    .sort((a, b) => a.s - b.s)
  if (pts.length < 2) throw new Error('O traçado do cabo precisa de pelo menos 2 pontos.')
  const last = pts.length - 1
  const kind = (i: number): 'anchor' | 'span' | 'support' => pts[i].kind ?? (i === 0 || i === last ? 'anchor' : 'span')
  const lam = Math.min(0.5, Math.max(0.05, inflection))
  const raw: Omit<Piece, 'a0'>[] = []
  for (let i = 0; i < last; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    const L = q.s - p.s
    if (!(L > 1e-9)) continue
    const d = q.e - p.e
    const kp = kind(i)
    const kq = kind(i + 1)
    if (kp === 'anchor' && kq === 'anchor') {
      raw.push({ s0: p.s, s1: q.s, e0: p.e, b: d / L, c: 0 })
    } else if (kp === 'anchor') {
      // vértice em q: e = q.e − d·((q.s − s)/L)²
      raw.push({ s0: p.s, s1: q.s, e0: p.e, b: (2 * d) / L, c: -d / (L * L) })
    } else if (kq === 'anchor') {
      // vértice em p
      raw.push({ s0: p.s, s1: q.s, e0: p.e, b: 0, c: d / (L * L) })
    } else {
      // dois vértices: parábola curta junto ao ponto alto ('support'); iguais → inflexão no meio
      let a = 0.5 * L
      if (kp === 'support' && kq !== 'support') a = lam * L
      else if (kq === 'support' && kp !== 'support') a = (1 - lam) * L
      // a = comprimento da 1ª parábola (vértice em p); inflexão sobre a reta p–q
      const ei = p.e + (d * a) / L
      raw.push({ s0: p.s, s1: p.s + a, e0: p.e, b: 0, c: (ei - p.e) / (a * a) })
      const r = L - a
      // 2ª parábola com vértice em q, escrita a partir da inflexão
      raw.push({ s0: p.s + a, s1: q.s, e0: ei, b: (2 * (q.e - ei)) / r, c: -(q.e - ei) / (r * r) })
    }
  }
  if (raw.length === 0) throw new Error('O traçado do cabo tem comprimento nulo.')
  const pieces: Piece[] = []
  let acc = 0
  let prevSlope: number | null = null
  for (const r of raw) {
    // quebra de tangente entre peças (ponto anguloso): o desvio concentrado também gera atrito
    if (prevSlope !== null) acc += Math.abs(Math.atan(r.b) - Math.atan(prevSlope))
    pieces.push({ ...r, a0: acc })
    const end = r.b + 2 * r.c * (r.s1 - r.s0)
    acc += Math.abs(Math.atan(end) - Math.atan(r.b))
    prevSlope = end
  }
  const s0 = pieces[0].s0
  const s1 = pieces[pieces.length - 1].s1
  const find = (s: number): Piece => {
    if (s <= s0) return pieces[0]
    for (const p of pieces) if (s <= p.s1) return p
    return pieces[pieces.length - 1]
  }
  const clamp = (s: number): number => Math.min(s1, Math.max(s0, s))
  return {
    s0, s1, pieces,
    totalAngle: acc,
    e: (s) => {
      const x = clamp(s)
      const p = find(x)
      const t = x - p.s0
      return p.e0 + p.b * t + p.c * t * t
    },
    slope: (s) => {
      const x = clamp(s)
      const p = find(x)
      return p.b + 2 * p.c * (x - p.s0)
    },
    curvature: (s) => 2 * find(clamp(s)).c,
    angle: (s) => {
      const x = clamp(s)
      const p = find(x)
      return p.a0 + Math.abs(Math.atan(p.b + 2 * p.c * (x - p.s0)) - Math.atan(p.b))
    },
  }
}

/**
 * Traçado automático p/ viga contínua: no centroide nas ancoragens, excentricidade máxima
 * embaixo nos vãos (a 0,4·L da ancoragem nos vãos extremos, no meio nos internos) e em cima
 * sobre os apoios internos. `cover` = distância do centro de gravidade do cabo resultante à
 * face do concreto (m).
 */
export function autoProfile(
  spans: number[],
  section: Pick<PrestressSection, 'yTop' | 'yBot'>,
  cover = 0.15,
): TendonPoint[] {
  const L = spans.filter((v) => v > 0)
  const eLow = Math.max(0, section.yBot - cover)
  const eHigh = -Math.max(0, section.yTop - cover)
  const pts: TendonPoint[] = [{ s: 0, e: 0, kind: 'anchor' }]
  let x = 0
  L.forEach((span, i) => {
    const first = i === 0
    const lastSpan = i === L.length - 1
    const single = L.length === 1
    const sLow = single ? 0.5 * span : first ? 0.4 * span : lastSpan ? 0.6 * span : 0.5 * span
    pts.push({ s: x + sLow, e: eLow, kind: 'span' })
    x += span
    pts.push(lastSpan ? { s: x, e: 0, kind: 'anchor' } : { s: x, e: eHigh, kind: 'support' })
  })
  return pts
}
