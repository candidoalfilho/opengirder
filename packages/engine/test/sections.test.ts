import { describe, expect, it } from 'vitest'
import { sectionParts, validateGeometry } from '../src/sections/geometry'
import { rectTorsion, sectionProperties } from '../src/sections/properties'
import { deckSection } from '../src/templates/builder'

describe('propriedades de seções', () => {
  it('retângulo maciço: A, I, centroide e torção de St. Venant', () => {
    const p = sectionProperties({ kind: 'solid-rect', width: 0.4, depth: 1.0 })
    expect(p.A).toBeCloseTo(0.4, 12)
    expect(p.Iz).toBeCloseTo((0.4 * 1 ** 3) / 12, 12)
    expect(p.Iy).toBeCloseTo((1 * 0.4 ** 3) / 12, 12)
    expect(p.yTop).toBeCloseTo(0.5, 12)
    expect(p.yBot).toBeCloseTo(0.5, 12)
    expect(p.Wtop).toBeCloseTo((0.4 * 1) / 6, 12)
    // tabelas de Timoshenko: β(a/b = 2,5) = 0,249; quadrado: 0,1406
    expect(p.J / (1.0 * 0.4 ** 3)).toBeCloseTo(0.249, 2)
    expect(rectTorsion(1, 1)).toBeCloseTo(0.1406, 3)
    // faixa fina: b·t³/3
    expect(rectTorsion(100, 0.1) / ((100 * 0.1 ** 3) / 3)).toBeCloseTo(1 - 0.63 * 0.001, 6)
  })

  it('seção T (1 longarina + laje): centroide e inércia por Steiner', () => {
    const p = sectionProperties({ kind: 't-girders', width: 1.2, slab: 0.15, n: 1, bw: 0.3, depth: 0.9, spacing: 0 })
    expect(p.A).toBeCloseTo(0.405, 12)
    expect(p.yTop).toBeCloseTo(0.325, 10)
    expect(p.yBot).toBeCloseTo(0.575, 10)
    expect(p.Iz).toBeCloseTo(0.031134375, 10)
    expect(p.Iy).toBeCloseTo((0.15 * 1.2 ** 3) / 12 + (0.75 * 0.3 ** 3) / 12, 10)
    expect(p.design).toMatchObject({ bf: 1.2, hf: 0.15, bw: 0.3, h: 0.9 })
  })

  it('várias longarinas: n almas afastadas somam Steiner na inércia lateral', () => {
    const g = { kind: 't-girders' as const, width: 10, slab: 0.2, n: 4, bw: 0.4, depth: 1.8, spacing: 2.5 }
    const p = sectionProperties(g)
    expect(p.A).toBeCloseTo(10 * 0.2 + 4 * 0.4 * 1.6, 10)
    const xs = [-3.75, -1.25, 1.25, 3.75]
    const Iy = (0.2 * 10 ** 3) / 12 + xs.reduce((s, x) => s + (1.6 * 0.4 ** 3) / 12 + 1.6 * 0.4 * x * x, 0)
    expect(p.Iy).toBeCloseTo(Iy, 9)
    expect(p.design.bw).toBeCloseTo(1.6, 12)
    expect(validateGeometry(g)).toEqual([])
    expect(validateGeometry({ ...g, spacing: 4 })).not.toEqual([])
  })

  it('tubo retangular de parede fina: 2ª fórmula de Bredt', () => {
    const p = sectionProperties({ kind: 'hollow-rect', width: 4, depth: 3, wall: 0.1 })
    expect(p.A).toBeCloseTo(12 - 3.8 * 2.8, 12)
    expect(p.Iz).toBeCloseTo((4 * 27 - 3.8 * 2.8 ** 3) / 12, 10)
    expect(p.Iy).toBeCloseTo((3 * 64 - 2.8 * 3.8 ** 3) / 12, 10)
    expect(p.J).toBeCloseTo((4 * (3.9 * 2.9) ** 2) / ((2 * 3.9 + 2 * 2.9) / 0.1), 10)
    expect(p.torsion).toMatchObject({ he: 0.1 })
    expect(p.torsion!.Ae).toBeCloseTo(3.9 * 2.9, 12)
  })

  it('caixão unicelular de almas verticais sem balanços = tubo retangular', () => {
    const box = sectionProperties({
      kind: 'box', topWidth: 6, bottomWidth: 6, depth: 2.5, topSlab: 0.25, bottomSlab: 0.25, web: 0.3, cells: 1, cantilever: 0,
    })
    const tube = sectionProperties({ kind: 'hollow-rect', width: 6, depth: 2.5, wall: 0.3, wallDepth: 0.25 })
    expect(box.A).toBeCloseTo(tube.A, 10)
    expect(box.Iz).toBeCloseTo(tube.Iz, 10)
    expect(box.Iy).toBeCloseTo(tube.Iy, 10)
    expect(box.J).toBeCloseTo(tube.J, 10)
    expect(box.yTop).toBeCloseTo(1.25, 10)
  })

  it('caixão com balanços: área por partes e centroide acima do meio da altura', () => {
    const g = {
      kind: 'box' as const, topWidth: 12, bottomWidth: 6, depth: 2, topSlab: 0.25, bottomSlab: 0.2, web: 0.4,
      cells: 1, cantilever: 3, cantileverTip: 0.25,
    }
    const p = sectionProperties(g)
    // laje superior 12×0,25 + 2 almas verticais 0,4×1,55 + laje de fundo 6×0,2
    expect(p.A).toBeCloseTo(12 * 0.25 + 2 * 0.4 * 1.55 + 6 * 0.2, 10)
    const yc = (3 * 0.125 + 1.24 * (0.25 + 0.775) + 1.2 * 1.9) / p.A
    expect(p.yTop).toBeCloseTo(yc, 10)
    expect(p.yTop).toBeLessThan(1)
    // Bredt da célula + balanços abertos
    const cell = (4 * (5.6 * 1.775) ** 2) / (5.6 / 0.25 + 5.6 / 0.2 + (2 * 1.775) / 0.4)
    expect(p.J).toBeCloseTo(cell + (2 * 3 * 0.25 ** 3) / 3, 10)
    expect(validateGeometry(g)).toEqual([])
  })

  it('caixão bicelular simétrico: a alma central não leva fluxo — J igual ao unicelular', () => {
    const base = { kind: 'box' as const, topWidth: 14, bottomWidth: 8, depth: 2.4, topSlab: 0.25, bottomSlab: 0.2, web: 0.4, cantilever: 2.5 }
    const one = sectionProperties({ ...base, cells: 1 })
    const two = sectionProperties({ ...base, cells: 2 })
    expect(two.J).toBeCloseTo(one.J, 9)
    expect(two.A - one.A).toBeCloseTo(0.4 * (2.4 - 0.45), 10)
    // três células: as almas internas levam fluxo e J cresce um pouco
    const three = sectionProperties({ ...base, cells: 3 })
    expect(three.J).toBeGreaterThan(one.J)
    expect(three.J).toBeLessThan(1.1 * one.J)
    expect(sectionParts({ ...base, cells: 3 }).filter((q) => q.factor < 0)).toHaveLength(3)
  })

  it('seção circular maciça e vazada', () => {
    const s = sectionProperties({ kind: 'circle', diameter: 2 })
    expect(s.A).toBeCloseTo(Math.PI, 12)
    expect(s.Iz).toBeCloseTo(Math.PI / 4, 12)
    expect(s.J).toBeCloseTo(Math.PI / 2, 12)
    const h = sectionProperties({ kind: 'circle', diameter: 2, wall: 0.2 })
    expect(h.A).toBeCloseTo(Math.PI * (1 - 0.64), 12)
    expect(h.Iz).toBeCloseTo((Math.PI * (1 - 0.8 ** 4)) / 4, 12)
  })

  it('viga I de aço + laje homogeneizada (n = 8): centroide e inércia', () => {
    const p = sectionProperties({
      kind: 'steel-i-composite', width: 2, slab: 0.2, n: 1, spacing: 0, topFlangeWidth: 0.3, topFlangeThickness: 0.02,
      bottomFlangeWidth: 0.3, bottomFlangeThickness: 0.02, webHeight: 1.0, webThickness: 0.012, modularRatio: 8,
    })
    const parts: [number, number, number][] = [
      // área homogeneizada, profundidade do centroide, inércia própria
      [0.05, 0.1, (0.25 * 0.2 ** 3) / 12],
      [0.006, 0.21, (0.3 * 0.02 ** 3) / 12],
      [0.012, 0.72, (0.012 * 1 ** 3) / 12],
      [0.006, 1.23, (0.3 * 0.02 ** 3) / 12],
    ]
    const A = parts.reduce((s, q) => s + q[0], 0)
    const yc = parts.reduce((s, q) => s + q[0] * q[1], 0) / A
    const I = parts.reduce((s, q) => s + q[2] + q[0] * (q[1] - yc) ** 2, 0)
    expect(p.A).toBeCloseTo(0.074, 12)
    expect(p.yTop).toBeCloseTo(yc, 10)
    expect(p.Iz).toBeCloseTo(I, 10)
    expect(p.steelArea).toBeCloseTo(0.024, 12)
    expect(p.concreteArea).toBeCloseTo(0.4, 12)
    expect(p.depth).toBeCloseTo(1.24, 12)
  })

  it('deckSection: com geometria, as propriedades da seção saem dela', () => {
    const geometry = {
      kind: 'box' as const, topWidth: 13, bottomWidth: 6, depth: 2, topSlab: 0.28, bottomSlab: 0.22, web: 0.55, cells: 1, cantilever: 3,
    }
    const p = sectionProperties(geometry)
    const sec = deckSection({ A: 1, Iz: 1, Iy: 1, J: 1, depth: 9, extraDead: 35, geometry }, 13)
    expect(sec.A).toBeCloseTo(p.A, 12)
    expect(sec.Iz).toBeCloseTo(p.Iz, 12)
    expect(sec.depth).toBe(2)
    expect(sec.yTop! + sec.yBot!).toBeCloseTo(2, 12)
    expect(sec.extraDead).toBe(35)
    expect(sec.geometry).toBe(geometry)
    // sem geometria: campos explícitos
    const plain = deckSection({ A: 6.5, Iz: 3.4, Iy: 60, J: 5.5, depth: 2, extraDead: 35 }, 13)
    expect(plain.A).toBe(6.5)
    expect(plain.geometry).toBeUndefined()
  })

  it('seção mista: a diferença entre o peso real e γ_aço·A_hom vai p/ a carga permanente', () => {
    const geometry = {
      kind: 'steel-i-composite' as const, width: 10, slab: 0.22, n: 4, spacing: 2.6, topFlangeWidth: 0.4, topFlangeThickness: 0.025,
      bottomFlangeWidth: 0.6, bottomFlangeThickness: 0.04, webHeight: 1.6, webThickness: 0.014, modularRatio: 7,
    }
    const p = sectionProperties(geometry)
    const sec = deckSection({ A: 0, Iz: 0, Iy: 0, J: 0, depth: 0, extraDead: 20, geometry }, 10)
    const real = 25 * p.concreteArea! + 77 * p.steelArea!
    expect(77 * sec.A + sec.extraDead! - 20).toBeCloseTo(real, 9)
  })
})
