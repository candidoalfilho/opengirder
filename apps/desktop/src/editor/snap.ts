/**
 * Geometria da captura do cursor (funções puras, sem three.js): malha do plano de trabalho,
 * ponto mais próximo sobre uma barra, seleção por janela. As coordenadas aqui são as do
 * MODELO (m), salvo indicação.
 */

import type { Vec3 } from '@opengirder/engine'
import type { WorkPlane } from './types'

/** eixos do plano de trabalho: índices das 2 coordenadas livres e da coordenada fixa */
export function planeAxes(kind: WorkPlane['kind']): { u: 0 | 1 | 2; v: 0 | 1 | 2; n: 0 | 1 | 2 } {
  if (kind === 'elevation') return { u: 0, v: 2, n: 1 }
  if (kind === 'plan') return { u: 0, v: 1, n: 2 }
  return { u: 1, v: 2, n: 0 }
}

export const PLANE_LABEL: Record<WorkPlane['kind'], { name: string; fixed: string }> = {
  elevation: { name: 'Elevação (X–Z)', fixed: 'y' },
  plan: { name: 'Planta (X–Y)', fixed: 'z' },
  cross: { name: 'Transversal (Y–Z)', fixed: 'x' },
}

/** arredonda um ponto do plano para a malha de passo `step` (0 = sem malha) */
export function snapToGrid(p: Vec3, plane: WorkPlane, step: number): Vec3 {
  const { u, v, n } = planeAxes(plane.kind)
  const out: Vec3 = [p[0], p[1], p[2]]
  out[n] = plane.offset
  if (step > 0) {
    out[u] = Math.round(p[u] / step) * step
    out[v] = Math.round(p[v] / step) * step
  }
  // evita -0 e ruído de ponto flutuante
  for (let i = 0; i < 3; i++) out[i] = Math.round(out[i] * 1e6) / 1e6 + 0
  return out
}

/**
 * Interseção de um raio com o plano de trabalho. `o` e `d` em coordenadas do modelo.
 * Devolve null se o raio é quase paralelo ao plano ou aponta para longe dele.
 */
export function rayPlane(o: Vec3, d: Vec3, plane: WorkPlane): Vec3 | null {
  const { n } = planeAxes(plane.kind)
  if (Math.abs(d[n]) < 1e-6) return null
  const t = (plane.offset - o[n]) / d[n]
  if (!(t > 0)) return null
  return [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]]
}

/**
 * Parâmetro (0–1) do ponto do segmento a–b mais próximo do raio (o, d), com d unitário.
 */
export function raySegmentParam(o: Vec3, d: Vec3, a: Vec3, b: Vec3): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const wx = a[0] - o[0], wy = a[1] - o[1], wz = a[2] - o[2]
  const A = ux * ux + uy * uy + uz * uz
  const B = ux * d[0] + uy * d[1] + uz * d[2]
  const D = ux * wx + uy * wy + uz * wz
  const E = d[0] * wx + d[1] * wy + d[2] * wz
  const den = A - B * B // d unitário → C = 1
  if (den < 1e-12 * Math.max(A, 1)) return 0.5
  return Math.min(1, Math.max(0, (B * E - D) / den))
}

/** distância (px) de um ponto ao segmento na tela, e o parâmetro do ponto mais próximo */
export function pointSegment2D(px: number, py: number, ax: number, ay: number, bx: number, by: number): { dist: number; t: number } {
  const dx = bx - ax
  const dy = by - ay
  const L2 = dx * dx + dy * dy
  const t = L2 > 1e-12 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0
  return { dist: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t }
}

/**
 * Arredonda a posição ao longo de uma barra de comprimento L para múltiplos de `step` a partir
 * do nó inicial. Devolve t (0–1); 0 ou 1 quando cai numa extremidade.
 */
export function snapAlong(t: number, L: number, step: number): number {
  if (!(L > 0)) return 0
  let s = t * L
  if (step > 0) s = Math.round(s / step) * step
  if (s <= 1e-6) return 0
  if (s >= L - 1e-6) return 1
  return s / L
}

export interface ScreenPoint {
  x: number
  y: number
  /** false = atrás da câmera ou fora do volume de recorte */
  ok: boolean
}

/**
 * Seleção por janela. Da esquerda para a direita pega só o que está inteiro dentro; da direita
 * para a esquerda, também o que a janela cruza (qualquer extremidade dentro).
 */
export function boxSelect(
  nodes: { id: number; s: ScreenPoint }[],
  elements: { id: number; a: ScreenPoint; b: ScreenPoint }[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { nodes: number[]; elements: number[] } {
  const crossing = x1 < x0
  const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1)
  const inside = (p: ScreenPoint): boolean => p.ok && p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy
  return {
    nodes: nodes.filter((n) => inside(n.s)).map((n) => n.id),
    elements: elements
      .filter((e) => (crossing ? inside(e.a) || inside(e.b) : inside(e.a) && inside(e.b)))
      .map((e) => e.id),
  }
}
