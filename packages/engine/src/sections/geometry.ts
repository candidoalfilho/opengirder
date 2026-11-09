/**
 * Geometria paramétrica de seções transversais.
 *
 * Cada tipo gera um conjunto de polígonos (`sectionParts`) num sistema (x, y) da seção:
 * x horizontal (eixo z local da barra), y vertical p/ cima (eixo y local), com y = 0 na
 * face superior. Polígonos com `factor` −1 são furos; em seções mistas o concreto entra
 * com factor = 1/n (homogeneização em aço, n = Es/Ec).
 *
 * Unidades: m.
 */

export type Pt = [number, number]

/** caixão de concreto uni ou multicelular, com balanços */
export interface BoxGeometry {
  kind: 'box'
  /** largura total da laje superior (m) */
  topWidth: number
  /** largura externa do fundo (m) */
  bottomWidth: number
  /** altura total (m) */
  depth: number
  /** espessura da laje superior (m) */
  topSlab: number
  /** espessura da laje inferior (m) */
  bottomSlab: number
  /** espessura de cada alma, medida na horizontal (m) */
  web: number
  /** nº de células */
  cells: number
  /** comprimento de cada balanço lateral (m) */
  cantilever: number
  /** espessura na ponta do balanço (m); padrão 0,20 */
  cantileverTip?: number
}

/** longarinas (pré-moldadas ou moldadas no local) + laje — homogeneizada num único concreto */
export interface TGirdersGeometry {
  kind: 't-girders'
  /** largura da laje (m) */
  width: number
  /** espessura da laje (m) */
  slab: number
  /** nº de longarinas */
  n: number
  /** largura da alma de cada longarina (m) */
  bw: number
  /** altura total, laje incluída (m) */
  depth: number
  /** distância entre eixos de longarinas (m) */
  spacing: number
}

export interface SlabGeometry {
  kind: 'slab'
  width: number
  depth: number
}

/** vigas I de aço + laje de concreto (seção mista), homogeneizada em aço */
export interface SteelIGeometry {
  kind: 'steel-i-composite'
  /** largura da laje (m) */
  width: number
  /** espessura da laje (m) */
  slab: number
  /** nº de vigas */
  n: number
  spacing: number
  topFlangeWidth: number
  topFlangeThickness: number
  bottomFlangeWidth: number
  bottomFlangeThickness: number
  /** altura da alma (m) */
  webHeight: number
  webThickness: number
  /** razão modular n = Es/Ec */
  modularRatio: number
}

/** caixão de aço em U (fundo + 2 almas + mesas superiores) fechado pela laje de concreto */
export interface SteelBoxGeometry {
  kind: 'steel-box'
  /** largura da laje (m) */
  width: number
  slab: number
  /** distância entre almas no topo e largura da chapa de fundo (m) */
  topWidth: number
  bottomWidth: number
  /** altura da parte de aço (m) */
  steelDepth: number
  webThickness: number
  bottomPlate: number
  topFlangeWidth: number
  topFlangeThickness: number
  modularRatio: number
}

/** retangular vazada (torres, pilares) */
export interface HollowRectGeometry {
  kind: 'hollow-rect'
  /** dimensão em x — eixo z local (m) */
  width: number
  /** dimensão em y — eixo y local (m) */
  depth: number
  /** espessura das paredes laterais, paralelas a y (m) */
  wall: number
  /** espessura das paredes superior e inferior (m); padrão = wall */
  wallDepth?: number
}

export interface SolidRectGeometry {
  kind: 'solid-rect'
  width: number
  depth: number
}

export interface CircleGeometry {
  kind: 'circle'
  diameter: number
  /** espessura da parede (m); ausente ou 0 = maciça */
  wall?: number
}

export type SectionGeometry =
  | BoxGeometry
  | TGirdersGeometry
  | SlabGeometry
  | SteelIGeometry
  | SteelBoxGeometry
  | HollowRectGeometry
  | SolidRectGeometry
  | CircleGeometry

export interface SectionPart {
  pts: Pt[]
  /** +1 maciço, −1 furo, 1/n concreto homogeneizado em aço */
  factor: number
  material: 'concrete' | 'steel'
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

/** posição da face externa da alma externa do caixão na profundidade y (y ≤ 0) */
function boxOuterX(g: BoxGeometry, y: number): number {
  const xt = g.topWidth / 2 - g.cantilever
  const xb = g.bottomWidth / 2
  const t = Math.min(1, Math.max(0, (-y - g.topSlab) / Math.max(1e-9, g.depth - g.topSlab)))
  return xt + (xb - xt) * t
}

/** eixos (x) das almas internas do caixão multicelular: verticais, dividindo a largura média */
export function boxInnerWebs(g: BoxGeometry): number[] {
  const n = Math.max(1, Math.round(g.cells))
  const yMid = -(g.topSlab + (g.depth - g.topSlab - g.bottomSlab) / 2)
  const w = boxOuterX(g, yMid) - g.web / 2
  const out: number[] = []
  for (let k = 1; k < n; k++) out.push(-w + (2 * w * k) / n)
  return out
}

/** posições (x) dos eixos de n peças com espaçamento s, centradas */
export function centered(n: number, s: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((i - (n - 1) / 2) * s)
  return out
}

export function sectionParts(g: SectionGeometry): SectionPart[] {
  switch (g.kind) {
    case 'box': {
      const B = g.topWidth / 2
      const tip = Math.min(g.topSlab, g.cantileverTip ?? 0.2)
      const xt = B - g.cantilever
      const xb = g.bottomWidth / 2
      const h = g.depth
      const outer: Pt[] = [
        [-B, 0], [B, 0], [B, -tip], [xt, -g.topSlab], [xb, -h], [-xb, -h], [-xt, -g.topSlab], [-B, -tip],
      ]
      const parts: SectionPart[] = [{ pts: outer, factor: 1, material: 'concrete' }]
      const yT = -g.topSlab
      const yB = -(h - g.bottomSlab)
      const n = Math.max(1, Math.round(g.cells))
      const inner = boxInnerWebs(g)
      for (let j = 0; j < n; j++) {
        const lt = j === 0 ? -(boxOuterX(g, yT) - g.web) : inner[j - 1] + g.web / 2
        const lb = j === 0 ? -(boxOuterX(g, yB) - g.web) : inner[j - 1] + g.web / 2
        const rt = j === n - 1 ? boxOuterX(g, yT) - g.web : inner[j] - g.web / 2
        const rb = j === n - 1 ? boxOuterX(g, yB) - g.web : inner[j] - g.web / 2
        if (rt - lt > 1e-6 && rb - lb > 1e-6 && yT - yB > 1e-6) {
          parts.push({ pts: [[lt, yT], [rt, yT], [rb, yB], [lb, yB]], factor: -1, material: 'concrete' })
        }
      }
      return parts
    }
    case 't-girders': {
      const parts: SectionPart[] = [
        { pts: rect(-g.width / 2, -g.slab, g.width / 2, 0), factor: 1, material: 'concrete' },
      ]
      for (const x of centered(Math.max(1, Math.round(g.n)), g.spacing)) {
        parts.push({ pts: rect(x - g.bw / 2, -g.depth, x + g.bw / 2, -g.slab), factor: 1, material: 'concrete' })
      }
      return parts
    }
    case 'slab':
    case 'solid-rect':
      return [{ pts: rect(-g.width / 2, -g.depth, g.width / 2, 0), factor: 1, material: 'concrete' }]
    case 'hollow-rect': {
      const tw = g.wall
      const tf = g.wallDepth ?? g.wall
      const parts: SectionPart[] = [
        { pts: rect(-g.width / 2, -g.depth, g.width / 2, 0), factor: 1, material: 'concrete' },
      ]
      if (g.width - 2 * tw > 1e-6 && g.depth - 2 * tf > 1e-6) {
        parts.push({ pts: rect(-g.width / 2 + tw, -g.depth + tf, g.width / 2 - tw, -tf), factor: -1, material: 'concrete' })
      }
      return parts
    }
    case 'circle': {
      const ring = (r: number): Pt[] => {
        const pts: Pt[] = []
        for (let i = 0; i < 72; i++) {
          const a = (2 * Math.PI * i) / 72
          pts.push([r * Math.cos(a), -g.diameter / 2 + r * Math.sin(a)])
        }
        return pts
      }
      const parts: SectionPart[] = [{ pts: ring(g.diameter / 2), factor: 1, material: 'concrete' }]
      const t = g.wall ?? 0
      if (t > 0 && t < g.diameter / 2) parts.push({ pts: ring(g.diameter / 2 - t), factor: -1, material: 'concrete' })
      return parts
    }
    case 'steel-i-composite': {
      const parts: SectionPart[] = [
        { pts: rect(-g.width / 2, -g.slab, g.width / 2, 0), factor: 1 / g.modularRatio, material: 'concrete' },
      ]
      const y1 = -g.slab
      const y2 = y1 - g.topFlangeThickness
      const y3 = y2 - g.webHeight
      const y4 = y3 - g.bottomFlangeThickness
      for (const x of centered(Math.max(1, Math.round(g.n)), g.spacing)) {
        parts.push({ pts: rect(x - g.topFlangeWidth / 2, y2, x + g.topFlangeWidth / 2, y1), factor: 1, material: 'steel' })
        parts.push({ pts: rect(x - g.webThickness / 2, y3, x + g.webThickness / 2, y2), factor: 1, material: 'steel' })
        parts.push({ pts: rect(x - g.bottomFlangeWidth / 2, y4, x + g.bottomFlangeWidth / 2, y3), factor: 1, material: 'steel' })
      }
      return parts
    }
    case 'steel-box': {
      const parts: SectionPart[] = [
        { pts: rect(-g.width / 2, -g.slab, g.width / 2, 0), factor: 1 / g.modularRatio, material: 'concrete' },
      ]
      const y1 = -g.slab
      const y2 = y1 - g.topFlangeThickness
      const y4 = y1 - g.steelDepth
      const y3 = y4 + g.bottomPlate
      const xt = g.topWidth / 2
      const xb = g.bottomWidth / 2
      const tw = g.webThickness
      for (const sgn of [-1, 1]) {
        parts.push({
          pts: rect(sgn * xt - g.topFlangeWidth / 2, y2, sgn * xt + g.topFlangeWidth / 2, y1),
          factor: 1, material: 'steel',
        })
        // alma inclinada: paralelogramo de espessura horizontal tw
        const a: Pt[] = [
          [sgn * xt - tw / 2, y2], [sgn * xt + tw / 2, y2], [sgn * xb + tw / 2, y3], [sgn * xb - tw / 2, y3],
        ]
        parts.push({ pts: a, factor: 1, material: 'steel' })
      }
      parts.push({ pts: rect(-xb - tw / 2, y4, xb + tw / 2, y3), factor: 1, material: 'steel' })
      return parts
    }
  }
}

/** erros de consistência da geometria (lista vazia = válida) */
export function validateGeometry(g: SectionGeometry): string[] {
  const e: string[] = []
  const pos = (v: number | undefined, name: string): void => {
    if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) e.push(`${name} deve ser maior que zero.`)
  }
  switch (g.kind) {
    case 'box':
      pos(g.topWidth, 'Largura da laje superior')
      pos(g.bottomWidth, 'Largura do fundo')
      pos(g.depth, 'Altura')
      pos(g.topSlab, 'Espessura da laje superior')
      pos(g.bottomSlab, 'Espessura da laje inferior')
      pos(g.web, 'Espessura da alma')
      if (!(g.cells >= 1)) e.push('O caixão precisa de pelo menos uma célula.')
      if (!(g.cantilever >= 0)) e.push('O balanço não pode ser negativo.')
      if (e.length === 0) {
        if (g.topSlab + g.bottomSlab >= g.depth) e.push('As lajes somam mais que a altura da seção.')
        if (2 * g.cantilever >= g.topWidth) e.push('Os balanços somam mais que a largura da laje.')
        const n = Math.round(g.cells)
        if ((n + 1) * g.web >= Math.min(g.bottomWidth, g.topWidth - 2 * g.cantilever)) {
          e.push('As almas não cabem na largura do caixão.')
        }
      }
      break
    case 't-girders':
      pos(g.width, 'Largura da laje')
      pos(g.slab, 'Espessura da laje')
      pos(g.bw, 'Largura da alma')
      pos(g.depth, 'Altura total')
      if (!(g.n >= 1)) e.push('É preciso pelo menos uma longarina.')
      if (g.n > 1) pos(g.spacing, 'Espaçamento das longarinas')
      if (e.length === 0) {
        if (g.slab >= g.depth) e.push('A laje é mais espessa que a altura total.')
        if ((g.n - 1) * g.spacing + g.bw > g.width + 1e-9) e.push('As longarinas não cabem sob a laje.')
        if (g.n > 1 && g.spacing < g.bw) e.push('O espaçamento é menor que a largura da alma.')
      }
      break
    case 'slab':
    case 'solid-rect':
      pos(g.width, 'Largura')
      pos(g.depth, 'Altura')
      break
    case 'hollow-rect':
      pos(g.width, 'Largura')
      pos(g.depth, 'Altura')
      pos(g.wall, 'Espessura da parede')
      if (e.length === 0 && (2 * g.wall > g.width || 2 * (g.wallDepth ?? g.wall) > g.depth)) {
        e.push('As paredes são mais espessas que a seção.')
      }
      break
    case 'circle':
      pos(g.diameter, 'Diâmetro')
      if (g.wall !== undefined && g.wall < 0) e.push('A espessura da parede não pode ser negativa.')
      break
    case 'steel-i-composite':
      pos(g.width, 'Largura da laje')
      pos(g.slab, 'Espessura da laje')
      pos(g.topFlangeWidth, 'Largura da mesa superior')
      pos(g.topFlangeThickness, 'Espessura da mesa superior')
      pos(g.bottomFlangeWidth, 'Largura da mesa inferior')
      pos(g.bottomFlangeThickness, 'Espessura da mesa inferior')
      pos(g.webHeight, 'Altura da alma')
      pos(g.webThickness, 'Espessura da alma')
      pos(g.modularRatio, 'Razão modular')
      if (!(g.n >= 1)) e.push('É preciso pelo menos uma viga.')
      if (g.n > 1) pos(g.spacing, 'Espaçamento das vigas')
      break
    case 'steel-box':
      pos(g.width, 'Largura da laje')
      pos(g.slab, 'Espessura da laje')
      pos(g.topWidth, 'Distância entre almas no topo')
      pos(g.bottomWidth, 'Largura do fundo')
      pos(g.steelDepth, 'Altura do caixão de aço')
      pos(g.webThickness, 'Espessura da alma')
      pos(g.bottomPlate, 'Espessura da chapa de fundo')
      pos(g.topFlangeWidth, 'Largura da mesa superior')
      pos(g.topFlangeThickness, 'Espessura da mesa superior')
      pos(g.modularRatio, 'Razão modular')
      break
  }
  return e
}

/** caixão unicelular com proporções usuais p/ uma largura e altura dadas */
export function defaultBox(width: number, depth: number): BoxGeometry {
  const cant = Math.round(0.22 * width * 10) / 10
  const web = Math.max(0.3, Math.round(0.2 * depth * 20) / 20)
  return {
    kind: 'box',
    topWidth: width,
    bottomWidth: Math.max(2 * web + 0.5, Math.round((width - 2 * cant - 0.8) * 10) / 10),
    depth,
    topSlab: Math.min(0.45 * depth, 0.25),
    bottomSlab: Math.min(0.45 * depth, 0.2),
    web,
    cells: 1,
    cantilever: cant,
    cantileverTip: 0.2,
  }
}
