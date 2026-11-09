/**
 * Propriedades geométricas de seções transversais.
 *
 *  - A, momentos estáticos e de inércia: integração exata por polígonos (fórmulas de Green),
 *    com furos (factor −1) e homogeneização (factor 1/n);
 *  - torção de St. Venant: células fechadas pela 2ª fórmula de Bredt — nos caixões
 *    multicelulares resolve-se o sistema dos fluxos de cisalhamento das células
 *    (q_i·∮ds/t − Σ q_j·(s/t)_ij = 2·Ω_i) — mais Σ b·t³/3 das partes abertas (balanços);
 *    retângulos maciços: J = a·b³·[1/3 − 0,21·(b/a)·(1 − b⁴/(12·a⁴))].
 *
 * Convenção do motor: Iz = flexão vertical (em torno do eixo horizontal da seção),
 * Iy = flexão lateral. Unidades: m.
 */

import {
  type BoxGeometry,
  type SectionGeometry,
  type SectionPart,
  boxInnerWebs,
  sectionParts,
} from './geometry'

export interface DesignSection {
  /** largura e espessura da mesa SUPERIOR (comprimida no momento positivo) */
  bf: number
  hf: number
  /** soma das larguras das almas */
  bw: number
  h: number
  /** largura e espessura da mesa INFERIOR (comprimida no momento negativo); sem mesa: bw e 0 */
  bfBot: number
  hfBot: number
}

/** seção vazada equivalente p/ torção (NBR 6118 17.5.1.4) */
export interface TorsionSection {
  /** área limitada pela linha média das paredes (m²) */
  Ae: number
  /** espessura da parede equivalente (m) */
  he: number
  /** perímetro da linha média (m) */
  ue: number
}

export interface SectionProps {
  A: number
  Iy: number
  Iz: number
  J: number
  /** distância do centroide à fibra superior / inferior */
  yTop: number
  yBot: number
  depth: number
  width: number
  /** módulos resistentes Iz/yTop e Iz/yBot */
  Wtop: number
  Wbot: number
  /** perímetro externo em contato com a atmosfera (m) */
  perimeter: number
  design: DesignSection
  torsion?: TorsionSection
  /** seções mistas: áreas reais de aço e de concreto (m²) — a área A é a homogeneizada */
  steelArea?: number
  concreteArea?: number
  /** área de alma de aço p/ cisalhamento (m²) */
  Aw?: number
}

interface Integrals {
  A: number
  Sx: number
  Sy: number
  Ixx: number
  Iyy: number
}

/** ∫dA, ∫y dA, ∫x dA, ∫y² dA, ∫x² dA de um polígono simples (área sempre positiva) */
export function polygonIntegrals(pts: [number, number][]): Integrals {
  let A = 0
  let Sx = 0
  let Sy = 0
  let Ixx = 0
  let Iyy = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % n]
    const c = x0 * y1 - x1 * y0
    A += c
    Sx += (y0 + y1) * c
    Sy += (x0 + x1) * c
    Ixx += (y0 * y0 + y0 * y1 + y1 * y1) * c
    Iyy += (x0 * x0 + x0 * x1 + x1 * x1) * c
  }
  const s = A < 0 ? -1 : 1
  return { A: (s * A) / 2, Sx: (s * Sx) / 6, Sy: (s * Sy) / 6, Ixx: (s * Ixx) / 12, Iyy: (s * Iyy) / 12 }
}

function integrate(parts: SectionPart[]): Integrals & { yMin: number; yMax: number; xMin: number; xMax: number } {
  const t = { A: 0, Sx: 0, Sy: 0, Ixx: 0, Iyy: 0, yMin: Infinity, yMax: -Infinity, xMin: Infinity, xMax: -Infinity }
  for (const p of parts) {
    const q = polygonIntegrals(p.pts)
    t.A += p.factor * q.A
    t.Sx += p.factor * q.Sx
    t.Sy += p.factor * q.Sy
    t.Ixx += p.factor * q.Ixx
    t.Iyy += p.factor * q.Iyy
    if (p.factor > 0) {
      for (const [x, y] of p.pts) {
        t.yMin = Math.min(t.yMin, y)
        t.yMax = Math.max(t.yMax, y)
        t.xMin = Math.min(t.xMin, x)
        t.xMax = Math.max(t.xMax, x)
      }
    }
  }
  return t
}

/** constante de torção de um retângulo maciço a × b */
export function rectTorsion(a: number, b: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (!(lo > 0)) return 0
  const r = lo / hi
  return hi * lo ** 3 * (1 / 3 - 0.21 * r * (1 - r ** 4 / 12))
}

/** resolve A·x = b (eliminação de Gauss com pivoteamento parcial; sistemas pequenos) */
function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let k = 0; k < n; k++) {
    let p = k
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i
    ;[M[k], M[p]] = [M[p], M[k]]
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k]
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n]
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]
    x[i] = s / M[i][i]
  }
  return x
}

/** torção do caixão: Bredt multicelular pelas linhas médias + balanços abertos */
function boxTorsion(g: BoxGeometry): { J: number; torsion: TorsionSection } {
  const n = Math.max(1, Math.round(g.cells))
  const hm = g.depth - g.topSlab / 2 - g.bottomSlab / 2
  // eixo das almas externas no nível das linhas médias das lajes
  const xt = g.topWidth / 2 - g.cantilever - g.web / 2
  const xb = g.bottomWidth / 2 - g.web / 2
  const inner = boxInnerWebs(g)
  const lenOuter = Math.hypot(hm, xt - xb)
  // espessura da alma inclinada medida na perpendicular
  const tOuter = (g.web * hm) / lenOuter
  const omega: number[] = []
  const M: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let j = 0; j < n; j++) {
    const lt = j === 0 ? -xt : inner[j - 1]
    const lb = j === 0 ? -xb : inner[j - 1]
    const rt = j === n - 1 ? xt : inner[j]
    const rb = j === n - 1 ? xb : inner[j]
    omega.push((hm * (rt - lt + (rb - lb))) / 2)
    const left = j === 0 ? lenOuter / tOuter : hm / g.web
    const right = j === n - 1 ? lenOuter / tOuter : hm / g.web
    M[j][j] = (rt - lt) / g.topSlab + (rb - lb) / g.bottomSlab + left + right
    if (j > 0) M[j][j - 1] = -hm / g.web
    if (j < n - 1) M[j][j + 1] = -hm / g.web
  }
  const q = solveDense(M, omega.map((o) => 2 * o))
  let J = 0
  for (let j = 0; j < n; j++) J += 2 * q[j] * omega[j]
  // balanços: retângulos abertos com a espessura média
  const tip = Math.min(g.topSlab, g.cantileverTip ?? 0.2)
  const tc = (g.topSlab + tip) / 2
  J += (2 * g.cantilever * tc ** 3) / 3
  const Ae = omega.reduce((a, b) => a + b, 0)
  return {
    J,
    torsion: { Ae, he: Math.min(g.topSlab, g.bottomSlab, tOuter), ue: 2 * xt + 2 * xb + 2 * lenOuter },
  }
}

function polygonPerimeter(pts: [number, number][]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return s
}

export function sectionProperties(g: SectionGeometry): SectionProps {
  const parts = sectionParts(g)
  const t = integrate(parts)
  let A = t.A
  const yc = t.Sx / A
  const xc = t.Sy / A
  let Iz = t.Ixx - A * yc * yc
  let Iy = t.Iyy - A * xc * xc
  const depth = t.yMax - t.yMin
  const width = t.xMax - t.xMin
  let J = 0
  let perimeter = 0
  let design: DesignSection
  let torsion: TorsionSection | undefined
  let steelArea: number | undefined
  let concreteArea: number | undefined
  let Aw: number | undefined

  switch (g.kind) {
    case 'box': {
      const bt = boxTorsion(g)
      J = bt.J
      torsion = bt.torsion
      perimeter = polygonPerimeter(parts[0].pts)
      design = {
        bf: g.topWidth, hf: g.topSlab, bw: (Math.round(g.cells) + 1) * g.web, h: g.depth,
        bfBot: g.bottomWidth, hfBot: g.bottomSlab,
      }
      break
    }
    case 't-girders': {
      const n = Math.max(1, Math.round(g.n))
      J = rectTorsion(g.width, g.slab) + n * rectTorsion(g.depth - g.slab, g.bw)
      perimeter = 2 * g.width + 2 * g.slab + 2 * n * (g.depth - g.slab)
      design = { bf: g.width, hf: g.slab, bw: n * g.bw, h: g.depth, bfBot: n * g.bw, hfBot: 0 }
      break
    }
    case 'slab':
    case 'solid-rect': {
      J = rectTorsion(g.width, g.depth)
      perimeter = 2 * (g.width + g.depth)
      design = { bf: g.width, hf: g.depth, bw: g.width, h: g.depth, bfBot: g.width, hfBot: g.depth }
      const he = (g.width * g.depth) / perimeter
      torsion = { Ae: (g.width - he) * (g.depth - he), he, ue: 2 * (g.width + g.depth - 2 * he) }
      break
    }
    case 'hollow-rect': {
      const tw = g.wall
      const tf = g.wallDepth ?? g.wall
      const bm = g.width - tw
      const hm = g.depth - tf
      const hollow = g.width - 2 * tw > 1e-6 && g.depth - 2 * tf > 1e-6
      J = hollow ? (4 * (bm * hm) ** 2) / (2 * bm / tf + 2 * hm / tw) : rectTorsion(g.width, g.depth)
      perimeter = 2 * (g.width + g.depth)
      design = { bf: g.width, hf: tf, bw: hollow ? 2 * tw : g.width, h: g.depth, bfBot: g.width, hfBot: tf }
      torsion = { Ae: bm * hm, he: Math.min(tw, tf), ue: 2 * (bm + hm) }
      break
    }
    case 'circle': {
      // valores analíticos (o polígono de 72 lados serve só p/ desenho)
      const ro = g.diameter / 2
      const ri = g.wall && g.wall > 0 && g.wall < ro ? ro - g.wall : 0
      A = Math.PI * (ro * ro - ri * ri)
      Iz = (Math.PI * (ro ** 4 - ri ** 4)) / 4
      Iy = Iz
      J = 2 * Iz
      perimeter = 2 * Math.PI * ro
      // retângulo de mesma área e altura p/ dimensionamento simplificado
      const b = A / g.diameter
      design = { bf: b, hf: g.diameter, bw: b, h: g.diameter, bfBot: b, hfBot: g.diameter }
      const he = ri > 0 ? ro - ri : ro / 2
      torsion = { Ae: Math.PI * (ro - he / 2) ** 2, he, ue: 2 * Math.PI * (ro - he / 2) }
      break
    }
    case 'steel-i-composite': {
      const n = Math.max(1, Math.round(g.n))
      const steel =
        g.topFlangeWidth * g.topFlangeThickness + g.bottomFlangeWidth * g.bottomFlangeThickness + g.webHeight * g.webThickness
      steelArea = n * steel
      concreteArea = g.width * g.slab
      Aw = n * g.webHeight * g.webThickness
      J =
        rectTorsion(g.width, g.slab) / g.modularRatio +
        (n *
          (g.topFlangeWidth * g.topFlangeThickness ** 3 +
            g.bottomFlangeWidth * g.bottomFlangeThickness ** 3 +
            g.webHeight * g.webThickness ** 3)) /
          3
      perimeter = 2 * g.width + 2 * g.slab
      design = { bf: g.width, hf: g.slab, bw: n * g.webThickness, h: depth, bfBot: n * g.bottomFlangeWidth, hfBot: g.bottomFlangeThickness }
      break
    }
    case 'steel-box': {
      const hw = g.steelDepth - g.bottomPlate - g.topFlangeThickness
      const lenWeb = Math.hypot(hw, (g.topWidth - g.bottomWidth) / 2)
      steelArea =
        2 * g.topFlangeWidth * g.topFlangeThickness + 2 * hw * g.webThickness + (g.bottomWidth + g.webThickness) * g.bottomPlate
      concreteArea = g.width * g.slab
      Aw = 2 * hw * g.webThickness
      // célula fechada pela laje (espessura homogeneizada slab/n)
      const hm = g.steelDepth - g.bottomPlate / 2 + g.slab / 2
      const omega = (hm * (g.topWidth + g.bottomWidth)) / 2
      const tWeb = (g.webThickness * hw) / lenWeb
      const lenM = Math.hypot(hm, (g.topWidth - g.bottomWidth) / 2)
      J = (4 * omega * omega) / (g.topWidth / (g.slab / g.modularRatio) + g.bottomWidth / g.bottomPlate + (2 * lenM) / tWeb)
      perimeter = 2 * g.width + 2 * g.slab + g.bottomWidth + 2 * lenWeb
      design = { bf: g.width, hf: g.slab, bw: 2 * g.webThickness, h: depth, bfBot: g.bottomWidth, hfBot: g.bottomPlate }
      break
    }
  }

  const yTop = g.kind === 'circle' ? g.diameter / 2 : t.yMax - yc
  const yBot = g.kind === 'circle' ? g.diameter / 2 : yc - t.yMin
  return {
    A, Iy, Iz, J, yTop, yBot, depth, width,
    Wtop: Iz / yTop, Wbot: Iz / yBot,
    perimeter, design, torsion, steelArea, concreteArea, Aw,
  }
}
