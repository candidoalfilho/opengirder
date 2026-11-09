import type {
  BridgeNode,
  CableElement,
  Dof6,
  Element,
  ElementGroup,
  FrameElement,
  Material,
  Section,
  Vec3,
} from '../model/types'
import type { DeckSectionInput } from './types'
import { sectionProperties } from '../sections/properties'
import { validateGeometry } from '../sections/geometry'

/** concreto — módulo secante da NBR 6118:2023 (item 8.2.8), agregado granítico (αE = 1,0) */
export function concrete(id: string, fck: number): Material {
  const Eci = fck <= 50 ? 5600 * Math.sqrt(fck) : 21500 * Math.cbrt(fck / 10 + 1.25)
  const ai = Math.min(1, 0.8 + (0.2 * fck) / 80)
  const E = ai * Eci * 1000
  return { id, name: `Concreto C${fck}`, kind: 'concrete', E, G: E / 2.4, gamma: 25, fck: fck * 1000 }
}

/** aço estrutural — NBR 8800: E = 200 GPa, G = 77 GPa, γ = 77 kN/m³ */
export function steel(id: string, fy = 345): Material {
  return { id, name: `Aço fy ${fy} MPa`, kind: 'steel', E: 200e6, G: 77e6, gamma: 77, fy: fy * 1000 }
}

/** cordoalhas/fios de aço p/ cabos; γ inclui bainha, cera e acessórios */
export function cableSteel(id: string, name: string, fpk: number, E = 195e6, gamma = 80): Material {
  return { id, name, kind: 'cable', E, G: E / 2.6, gamma, fpk: fpk * 1000 }
}

export function rigidMaterial(id = 'rigid'): Material {
  return { id, name: 'Ligação rígida (sem peso)', kind: 'rigid', E: 200e6, G: 77e6, gamma: 0 }
}

export function deckMaterial(kind: 'concrete' | 'steel' | 'composite', fck: number): Material {
  if (kind === 'concrete') return concrete('deck', fck)
  const m = steel('deck')
  if (kind === 'composite') m.name = 'Seção mista homogeneizada em aço'
  return m
}

export function deckSection(d: DeckSectionInput, width: number, shape: Section['shape'] = 'box'): Section {
  const base: Section = {
    id: 'deck', name: 'Tabuleiro', A: d.A, Iy: d.Iy, Iz: d.Iz, J: d.J, extraDead: d.extraDead,
    // a massa do tabuleiro está espalhada na largura: raio de giração ≈ √((b² + h²)/12)
    massRadius: d.massRadius ?? Math.sqrt((width * width + d.depth * d.depth) / 12),
    depth: d.depth, width, shape,
  }
  if (!d.geometry) return base
  // seção definida por geometria: as propriedades saem dela
  const bad = validateGeometry(d.geometry)
  if (bad.length > 0) throw new Error(`Seção do tabuleiro: ${bad.join(' ')}`)
  const p = sectionProperties(d.geometry)
  let extraDead = d.extraDead
  if (p.steelArea !== undefined && p.concreteArea !== undefined) {
    // seção mista homogeneizada em aço: o peso próprio γ_aço·A_hom não é o real —
    // a diferença (25·Ac + 77·As − 77·A_hom) entra na carga permanente adicional
    extraDead += 25 * p.concreteArea + 77 * p.steelArea - 77 * p.A
  }
  return {
    ...base,
    A: p.A, Iy: p.Iy, Iz: p.Iz, J: p.J, extraDead,
    massRadius: d.massRadius ?? Math.sqrt((p.width * p.width + p.depth * p.depth) / 12),
    depth: p.depth, width: p.width, yTop: p.yTop, yBot: p.yBot, geometry: d.geometry,
  }
}

export function rigidSection(id = 'rigid'): Section {
  return { id, name: 'Transversina rígida', A: 2, Iy: 8, Iz: 8, J: 8, depth: 0.6, width: 0.6, shape: 'rigid' }
}

export class Builder {
  nodes: BridgeNode[] = []
  elements: Element[] = []
  private nid = 0
  private eid = 0

  node(x: number, y: number, z: number, role: BridgeNode['role'] = 'other', fix?: Dof6<boolean>): number {
    const id = ++this.nid
    const nd: BridgeNode = { id, x: round(x), y: round(y), z: round(z), role }
    if (fix) nd.fix = fix
    this.nodes.push(nd)
    return id
  }

  fix(id: number, dofs: Partial<Record<'ux' | 'uy' | 'uz' | 'rx' | 'ry' | 'rz', boolean>>): void {
    const nd = this.nodes[id - 1]
    const f: Dof6<boolean> = nd.fix ?? [false, false, false, false, false, false]
    const names = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const
    names.forEach((k, i) => {
      if (dofs[k]) f[i] = true
    })
    nd.fix = f
  }

  frame(n1: number, n2: number, mat: string, sec: string, group: ElementGroup, up?: Vec3): number {
    const id = ++this.eid
    const el: FrameElement = { kind: 'frame', id, n1, n2, mat, sec, group }
    if (up) el.up = up
    this.elements.push(el)
    return id
  }

  cable(n1: number, n2: number, mat: string, A: number, group: ElementGroup, extra: Partial<CableElement> = {}): number {
    const id = ++this.eid
    this.elements.push({ kind: 'cable', id, n1, n2, mat, A, group, ...extra })
    return id
  }

  pos(id: number): Vec3 {
    const nd = this.nodes[id - 1]
    return [nd.x, nd.y, nd.z]
  }
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

/** divide [a, b] em trechos de comprimento ≈ `target`; devolve os pontos internos e o final */
export function subdivide(a: number, b: number, target: number): number[] {
  const n = Math.max(1, Math.round(Math.abs(b - a) / target))
  const out: number[] = []
  for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / n)
  return out
}

/** estacas ordenadas e sem repetição, cobrindo os pontos obrigatórios com malha ≈ `target` */
export function stations(required: number[], target: number): number[] {
  const req = Array.from(new Set(required.map((v) => Math.round(v * 1e6) / 1e6))).sort((a, b) => a - b)
  const out: number[] = [req[0]]
  for (let i = 1; i < req.length; i++) {
    if (req[i] - req[i - 1] < 1e-6) continue
    out.push(...subdivide(req[i - 1], req[i], target))
  }
  return out
}
