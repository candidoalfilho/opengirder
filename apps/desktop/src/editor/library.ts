/**
 * Biblioteca de materiais e seções prontos para montar um modelo do zero.
 *
 * Materiais: concreto pela NBR 6118:2023 (Ecs do item 8.2.8, agregado granítico), aços
 * estruturais usuais em pontes (fy nominal; E = 200 GPa, NBR 8800) e aços de cabos.
 * Seções: geometrias típicas, com as propriedades calculadas por `sectionProperties` do motor
 * (polígonos; torção de Bredt nas células fechadas). São pontos de partida — ajuste na aba
 * Seções ou na aba Dados.
 */

import {
  cableSteel,
  concrete,
  defaultBox,
  sectionProperties,
  steel,
  validateGeometry,
  type BridgeModel,
  type Material,
  type Section,
  type SectionGeometry,
} from '@opengirder/engine'

export interface LibraryMaterial {
  key: string
  group: 'Concreto' | 'Aço estrutural' | 'Cabos'
  label: string
  detail: string
  make: () => Material
}

export interface LibrarySection {
  key: string
  group: 'Tabuleiro' | 'Torres, pilares e arcos'
  label: string
  detail: string
  make: () => Section
}

/* ------------------------------------------------------------------ materiais */

const conc = (fck: number): LibraryMaterial => ({
  key: `c${fck}`,
  group: 'Concreto',
  label: `Concreto C${fck}`,
  detail: `fck ${fck} MPa · Ecs ${(concrete('x', fck).E / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GPa · 25 kN/m³`,
  make: () => concrete(`c${fck}`, fck),
})

const st = (key: string, name: string, fy: number): LibraryMaterial => ({
  key,
  group: 'Aço estrutural',
  label: name,
  detail: `fy ${fy} MPa · E 200 GPa · 77 kN/m³`,
  make: () => ({ ...steel(key, fy), name: `${name} (fy ${fy} MPa)` }),
})

const cab = (key: string, name: string, fpk: number, E: number, gamma: number, note: string): LibraryMaterial => ({
  key,
  group: 'Cabos',
  label: name,
  detail: `fptk ${fpk.toLocaleString('pt-BR')} MPa · E ${E} GPa · ${note}`,
  make: () => cableSteel(key, `${name} — fptk ${fpk.toLocaleString('pt-BR')} MPa`, fpk, E * 1e6, gamma),
})

export const LIBRARY_MATERIALS: LibraryMaterial[] = [
  ...[25, 30, 35, 40, 45, 50, 60, 70, 80, 90].map(conc),
  st('a36', 'ASTM A36', 250),
  st('a572', 'ASTM A572 Gr. 50', 345),
  st('a588', 'ASTM A588 (patinável)', 345),
  st('sac350', 'USI-SAC 350 (patinável)', 350),
  cab('cp190', 'Cordoalhas CP 190 RB', 1900, 195, 80, 'estais e protensão; Ø12,7 = 98,7 mm², Ø15,2 = 140 mm², Ø15,7 = 150 mm²'),
  cab('cp177', 'Cordoalhas de estai 1 770', 1770, 195, 80, 'estais de cordoalhas paralelas'),
  cab('fios1770', 'Fios paralelos 1 770', 1770, 200, 82, 'cabos principais e estais de fios paralelos'),
  cab('fios1570', 'Fios paralelos 1 570', 1570, 200, 82, 'cabos principais de pontes pênseis'),
  cab('pendural', 'Cabo de aço de pendural 1 570', 1570, 140, 80, 'cabo de fios torcidos; módulo aparente menor'),
  cab('barra1030', 'Barra de alta resistência 1 030', 1030, 205, 78.5, 'pendurais e tirantes em barra'),
]

const sameMaterial = (a: Material, b: Material): boolean =>
  a.name === b.name && a.kind === b.kind && a.E === b.E && a.gamma === b.gamma && (a.fck ?? 0) === (b.fck ?? 0) && (a.fy ?? 0) === (b.fy ?? 0) && (a.fpk ?? 0) === (b.fpk ?? 0)

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

/** acrescenta o material ao modelo; se já houver um igual, devolve o existente */
export function addLibraryMaterial(model: BridgeModel, item: LibraryMaterial): { model: BridgeModel; id: string; added: boolean } {
  const mat = item.make()
  const same = model.materials.find((m) => sameMaterial(m, mat))
  if (same) return { model, id: same.id, added: false }
  const id = uniqueId(mat.id, new Set(model.materials.map((m) => m.id)))
  return { model: { ...model, materials: [...model.materials, { ...mat, id }] }, id, added: true }
}

/* ------------------------------------------------------------------ seções */

const SHAPE: Record<SectionGeometry['kind'], Section['shape']> = {
  box: 'box',
  't-girders': 'girder',
  slab: 'girder',
  'steel-i-composite': 'girder',
  'steel-box': 'box',
  'hollow-rect': 'tower',
  'solid-rect': 'tower',
  circle: 'tower',
}

/** seção do modelo a partir de uma geometria (propriedades calculadas pelo motor) */
export function sectionFromGeometry(id: string, name: string, geometry: SectionGeometry, extraDead = 0): Section {
  const bad = validateGeometry(geometry)
  if (bad.length) throw new Error(bad.join(' '))
  const p = sectionProperties(geometry)
  let extra = extraDead
  // seção mista homogeneizada em aço: a diferença entre o peso real e γ_aço·A_hom vira carga adicional
  if (p.steelArea !== undefined && p.concreteArea !== undefined) extra += 25 * p.concreteArea + 77 * p.steelArea - 77 * p.A
  const deck = SHAPE[geometry.kind] === 'box' || SHAPE[geometry.kind] === 'girder'
  const sec: Section = {
    id, name, A: p.A, Iy: p.Iy, Iz: p.Iz, J: p.J,
    depth: p.depth, width: p.width, yTop: p.yTop, yBot: p.yBot,
    shape: SHAPE[geometry.kind], geometry,
  }
  if (extra > 0) sec.extraDead = Math.round(extra * 100) / 100
  if (deck) sec.massRadius = Math.sqrt((p.width * p.width + p.depth * p.depth) / 12)
  return sec
}

/** retângulo vazado: `b` transversal, `h` na direção da flexão principal (altura), parede `t` */
export function hollowRectSection(b: number, h: number, t: number, id = 'vazada', name?: string): Section {
  return sectionFromGeometry(id, name ?? `Retangular vazada ${fmt(b)} × ${fmt(h)} m, parede ${fmt(t * 100)} cm`, { kind: 'hollow-rect', width: b, depth: h, wall: t })
}

/** tubo circular de diâmetro externo `D` e parede `t` (t = 0 → maciço) */
export function tubeSection(D: number, t = 0, id = 'tubo', name?: string): Section {
  const geometry: SectionGeometry = t > 0 ? { kind: 'circle', diameter: D, wall: t } : { kind: 'circle', diameter: D }
  return sectionFromGeometry(id, name ?? (t > 0 ? `Tubo circular Ø${fmt(D)} m, parede ${fmt(t * 1000)} mm` : `Circular maciça Ø${fmt(D)} m`), geometry)
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

const props = (s: Section): string =>
  `A ${s.A.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m² · Iz ${s.Iz.toLocaleString('pt-BR', { maximumSignificantDigits: 3 })} m⁴`

function item(key: string, group: LibrarySection['group'], label: string, make: () => Section): LibrarySection {
  let detail = ''
  try {
    detail = props(make())
  } catch {
    detail = 'geometria inválida'
  }
  return { key, group, label, detail, make }
}

const box = (w: number, h: number, cells = 1, extra = 0): (() => Section) => () =>
  sectionFromGeometry(`caixao-${w}x${String(h).replace('.', '_')}${cells > 1 ? `-${cells}c` : ''}`, `Caixão ${fmt(w)} × ${fmt(h)} m${cells > 1 ? `, ${cells} células` : ''}`, { ...defaultBox(w, h), cells }, extra)

export const LIBRARY_SECTIONS: LibrarySection[] = [
  item('box-10', 'Tabuleiro', 'Caixão unicelular 10 × 2,0 m', box(10, 2.0, 1, 30)),
  item('box-13', 'Tabuleiro', 'Caixão unicelular 13 × 2,2 m', box(13, 2.2, 1, 35)),
  item('box-16', 'Tabuleiro', 'Caixão unicelular 16 × 2,8 m', box(16, 2.8, 1, 45)),
  item('box-22', 'Tabuleiro', 'Caixão bicelular 22 × 3,0 m', box(22, 3.0, 2, 60)),
  item('t-12', 'Tabuleiro', '5 vigas T, largura 12 m, altura 1,8 m', () =>
    sectionFromGeometry('vigas-t-12', '5 vigas T — 12 × 1,8 m', { kind: 't-girders', width: 12, slab: 0.22, n: 5, bw: 0.4, depth: 1.8, spacing: 2.4 }, 30)),
  item('slab-10', 'Tabuleiro', 'Laje maciça 10 × 0,80 m', () => sectionFromGeometry('laje-10', 'Laje maciça 10 × 0,80 m', { kind: 'slab', width: 10, depth: 0.8 }, 25)),
  item('mista-12', 'Tabuleiro', 'Mista: 4 vigas I de aço + laje, 12 m', () =>
    sectionFromGeometry('mista-12', 'Mista — 4 vigas I + laje de 12 m (homogeneizada em aço)', {
      kind: 'steel-i-composite', width: 12, slab: 0.22, n: 4, spacing: 3,
      topFlangeWidth: 0.4, topFlangeThickness: 0.025, bottomFlangeWidth: 0.6, bottomFlangeThickness: 0.04,
      webHeight: 1.6, webThickness: 0.016, modularRatio: 6.5,
    }, 30)),
  item('torre-4x6', 'Torres, pilares e arcos', 'Torre vazada 4 × 6 m, parede 50 cm', () => hollowRectSection(4, 6, 0.5, 'torre-4x6', 'Torre vazada 4 × 6 m, parede 50 cm')),
  item('torre-5x8', 'Torres, pilares e arcos', 'Torre vazada 5 × 8 m, parede 60 cm', () => hollowRectSection(5, 8, 0.6, 'torre-5x8', 'Torre vazada 5 × 8 m, parede 60 cm')),
  item('pilar-parede', 'Torres, pilares e arcos', 'Pilar-parede 6 × 1,0 m', () =>
    sectionFromGeometry('pilar-6x1', 'Pilar-parede 6 × 1,0 m', { kind: 'solid-rect', width: 6, depth: 1 })),
  item('pilar-vazado', 'Torres, pilares e arcos', 'Pilar vazado 3 × 5 m, parede 35 cm', () => hollowRectSection(3, 5, 0.35, 'pilar-3x5', 'Pilar vazado 3 × 5 m, parede 35 cm')),
  item('circ-18', 'Torres, pilares e arcos', 'Pilar circular Ø1,8 m', () => tubeSection(1.8, 0, 'circ-1_8', 'Pilar circular Ø1,8 m')),
  item('arco-aco', 'Torres, pilares e arcos', 'Arco: caixão de aço 1,2 × 1,6 m, chapa 30 mm', () => hollowRectSection(1.2, 1.6, 0.03, 'arco-1_2x1_6', 'Caixão de aço 1,2 × 1,6 m, chapa 30 mm')),
  item('tubo-12', 'Torres, pilares e arcos', 'Tubo de aço Ø1,2 m, parede 25 mm', () => tubeSection(1.2, 0.025, 'tubo-1_2', 'Tubo de aço Ø1,2 m, parede 25 mm')),
]

const sameSection = (a: Section, b: Section): boolean =>
  Math.abs(a.A - b.A) < 1e-9 && Math.abs(a.Iz - b.Iz) < 1e-9 && Math.abs(a.Iy - b.Iy) < 1e-9 && Math.abs(a.J - b.J) < 1e-9 && (a.extraDead ?? 0) === (b.extraDead ?? 0)

/** acrescenta uma seção ao modelo; se já houver uma igual, devolve a existente */
export function addSectionToModel(model: BridgeModel, sec: Section): { model: BridgeModel; id: string; added: boolean } {
  const same = model.sections.find((s) => sameSection(s, sec))
  if (same) return { model, id: same.id, added: false }
  const id = uniqueId(sec.id, new Set(model.sections.map((s) => s.id)))
  return { model: { ...model, sections: [...model.sections, { ...sec, id }] }, id, added: true }
}

export function addLibrarySection(model: BridgeModel, it: LibrarySection): { model: BridgeModel; id: string; added: boolean } {
  return addSectionToModel(model, it.make())
}
