import type { BridgeModel, Section } from '../model/types'
import type { SuspensionParams } from './types'
import { catenaryFlex } from '../analysis/catenary'
import { Builder, cableSteel, deckMaterial, deckSection, rigidMaterial, rigidSection, steel, stations } from './builder'

/**
 * Forma de equilíbrio de um cabo com cargas concentradas nos pendurais + peso próprio.
 *
 * Cada trecho entre pendurais é uma catenária elástica com a mesma componente horizontal H.
 * Marcha-se da esquerda p/ a direita: em cada trecho, H e a componente vertical inicial V0
 * são conhecidos; acha-se o L0 que dá a projeção horizontal do painel; a projeção vertical
 * sai da catenária e o equilíbrio do nó dá o V0 do trecho seguinte (V0' = Vj + P).
 * V0 do 1º trecho é ajustado (secante) p/ o cabo chegar à cota final.
 */
export function cableProfile(
  xs: number[],
  zStart: number,
  zEnd: number,
  P: number[],
  w: number,
  EA: number,
  H: number,
): { z: number[]; L0: number[]; V0: number } {
  const nSeg = xs.length - 1
  const L0 = new Array<number>(nSeg).fill(0)
  const z = new Array<number>(nSeg + 1).fill(0)
  const march = (V0: number): number => {
    let V = V0
    z[0] = zStart
    for (let k = 0; k < nSeg; k++) {
      const lh = xs[k + 1] - xs[k]
      let L = lh * Math.sqrt(1 + (V / H) ** 2)
      let f = catenaryFlex(H, V, L, EA, w)
      for (let it = 0; it < 40; it++) {
        const g = f.lh - lh
        if (Math.abs(g) < 1e-13 * lh) break
        L -= g / f.dlhdL
        f = catenaryFlex(H, V, L, EA, w)
      }
      L0[k] = L
      z[k + 1] = z[k] + f.lz
      V = f.Vj + (P[k + 1] ?? 0)
    }
    return z[nSeg] - zEnd
  }
  const span = xs[nSeg] - xs[0]
  let total = w * span * 1.03
  for (const v of P) total += v
  let Va = -total / 2 + (H * (zEnd - zStart)) / span
  let ga = march(Va)
  let Vb = Va - (ga * H) / span
  for (let it = 0; it < 60; it++) {
    const gb = march(Vb)
    if (Math.abs(gb) < 1e-10) break
    const d = gb - ga
    if (Math.abs(d) < 1e-300) break
    const Vn = Vb - (gb * (Vb - Va)) / d
    Va = Vb
    ga = gb
    Vb = Vn
  }
  march(Vb)
  return { z: z.slice(), L0: L0.slice(), V0: Vb }
}

/**
 * Ponte pênsil paramétrica: vão central + dois vãos laterais suspensos, dois cabos
 * principais, pendurais verticais, torres em pórtico e viga de rigidez como "espinha" com
 * transversinas rígidas. Os três trechos do tabuleiro são biapoiados (juntas nas torres).
 *
 * A geometria do cabo é a de equilíbrio sob carga permanente com a flecha pedida; H dos
 * vãos laterais é igual ao do central (torre sem flexão sob carga permanente).
 */
export function generateSuspension(p: SuspensionParams): BridgeModel {
  const b = new Builder()
  const half = p.cableSpacing / 2
  const zTop = p.deckLevel + p.towerHeight
  const zAnch = p.deckLevel
  const deckMat = { ...deckMaterial(p.deckMaterial, 50) }
  deckMat.name = `${deckMat.name} — viga de rigidez`
  const cableMat = cableSteel('cable', `Fios paralelos fpk ${p.cableFpk} MPa`, p.cableFpk, 200e6, 82)
  const hangerMat = cableSteel('hanger', 'Cabos de pendural', 1570, 140e6, 80)
  const wDeck = deckMat.gamma * p.deck.A + p.deck.extraDead
  const wCable = cableMat.gamma * p.cableArea
  const EA = cableMat.E * p.cableArea

  // painéis: nº par no vão central (pendural no meio do vão)
  const nMain = Math.max(2, 2 * Math.round(p.mainSpan / p.hangerSpacing / 2))
  const nSide = p.sideSpan > 0 ? Math.max(1, Math.round(p.sideSpan / p.hangerSpacing)) : 0
  const dMain = p.mainSpan / nMain
  const dSide = nSide > 0 ? p.sideSpan / nSide : 0
  const xsOf = (x0: number, n: number, d: number): number[] => Array.from({ length: n + 1 }, (_, i) => x0 + i * d)
  const loads = (n: number, d: number): number[] => {
    // carga por pendural: metade do tabuleiro (dois cabos) + peso aproximado do pendural
    const P = new Array<number>(n + 1).fill(0)
    for (let i = 1; i < n; i++) P[i] = (wDeck * d) / 2
    return P
  }

  // H do vão central p/ a flecha pedida (secante sobre H)
  const xsM = xsOf(0, nMain, dMain)
  const PM = loads(nMain, dMain)
  // o cabo não pode descer abaixo de 2,5 m acima do tabuleiro no meio do vão
  const sag = Math.min(p.sagRatio * p.mainSpan, p.towerHeight - 2.5)
  const sagLimited = sag < p.sagRatio * p.mainSpan - 1e-9
  const midSag = (H: number): number => zTop - cableProfile(xsM, zTop, zTop, PM, wCable, EA, H).z[nMain / 2] - sag
  let Ha = ((wDeck / 2 + wCable * 1.02) * p.mainSpan ** 2) / (8 * sag)
  let ga = midSag(Ha)
  let Hb = Ha * (1 + ga / sag)
  for (let it = 0; it < 50; it++) {
    const gb = midSag(Hb)
    if (Math.abs(gb) < 1e-9) break
    const Hn = Hb - (gb * (Hb - Ha)) / (gb - ga)
    Ha = Hb
    ga = gb
    Hb = Hn
  }
  const H = Hb
  const main = cableProfile(xsM, zTop, zTop, PM, wCable, EA, H)
  const xsL = xsOf(-p.sideSpan, nSide, dSide)
  const xsR = xsOf(p.mainSpan, nSide, dSide)
  const PS = loads(nSide, dSide)
  const left = nSide > 0 ? cableProfile(xsL, zAnch, zTop, PS, wCable, EA, H) : null
  const right = nSide > 0 ? cableProfile(xsR, zTop, zAnch, PS, wCable, EA, H) : null

  // ---- torres (pórtico: duas pernas + travessas)
  const towerSec: Section = {
    id: 'tower', name: 'Perna da torre', A: p.tower.A, Iy: p.tower.I, Iz: p.tower.I, J: p.tower.J,
    depth: p.tower.width, width: p.tower.width, shape: 'tower',
  }
  const strutSec: Section = {
    id: 'strut', name: 'Travessa da torre', A: 0.5 * p.tower.A, Iy: 0.3 * p.tower.I, Iz: 0.3 * p.tower.I,
    J: 0.3 * p.tower.J, depth: 0.7 * p.tower.width, width: 0.5 * p.tower.width, shape: 'tower',
  }
  const strutZ = [
    p.deckLevel - p.deck.depth - 2,
    p.deckLevel + 0.38 * p.towerHeight,
    p.deckLevel + 0.7 * p.towerHeight,
    zTop,
  ].filter((z) => z > 2)
  const zsT = stations([0, zTop, ...strutZ], Math.max(8, zTop / 14))
  const towerTop: number[][] = []
  for (const xT of [0, p.mainSpan]) {
    const legs: number[][] = []
    for (const sy of [-1, 1]) {
      const ids: number[] = []
      for (const z of zsT) {
        ids.push(b.node(xT, sy * half, z, 'tower', z === 0 ? [true, true, true, true, true, true] : undefined))
        if (ids.length > 1) b.frame(ids[ids.length - 2], ids[ids.length - 1], 'tower', 'tower', 'tower')
      }
      legs.push(ids)
    }
    for (const z of strutZ) {
      const i = zsT.findIndex((v) => Math.abs(v - z) < 1e-6)
      if (i >= 0) b.frame(legs[0][i], legs[1][i], 'tower', 'strut', 'tower')
    }
    towerTop.push([legs[0][zsT.length - 1], legs[1][zsT.length - 1]])
  }

  // ---- cabos principais e pendurais; tabuleiro em três trechos biapoiados
  const sub = Math.max(1, Math.round(p.subdivisions || 1))
  const laneNodes: number[] = []
  const joints: number[] = []
  const bearing = 0.8 * half
  let station = 0

  const span = (
    xs: number[],
    prof: { z: number[]; L0: number[] },
    startTop: number[] | null,
    endTop: number[] | null,
    fixX: 'start' | 'end' | 'none',
  ): void => {
    const nP = xs.length - 1
    // tabuleiro
    const spine: number[] = []
    const panel: number[] = []
    for (let i = 0; i <= nP; i++) {
      if (i > 0) {
        for (let k = 1; k < sub; k++) {
          spine.push(b.node(xs[i - 1] + ((xs[i] - xs[i - 1]) * k) / sub, 0, p.deckLevel, 'deck'))
        }
      }
      const nd = b.node(xs[i], 0, p.deckLevel, 'deck')
      spine.push(nd)
      panel.push(nd)
    }
    for (let i = 1; i < spine.length; i++) b.frame(spine[i - 1], spine[i], 'deck', 'deck', 'deck')
    // apoios nas extremidades do trecho
    for (const [i, which] of [[0, 'start'], [nP, 'end']] as const) {
      for (const sy of [-1, 1]) {
        const br = b.node(xs[i], sy * bearing, p.deckLevel, 'other', [false, false, true, false, false, false])
        b.frame(panel[i], br, 'rigid', 'rigid', 'crossbeam')
      }
      b.fix(panel[i], { uy: true, ux: which === fixX })
    }
    joints.push(station, station + xs[nP] - xs[0])
    station += xs[nP] - xs[0]
    laneNodes.push(...spine)

    // cabos (um de cada lado) e pendurais
    for (const [iy, sy] of [[0, -1], [1, 1]] as const) {
      const cn: number[] = []
      for (let i = 0; i <= nP; i++) {
        if (i === 0 && startTop) cn.push(startTop[iy])
        else if (i === nP && endTop) cn.push(endTop[iy])
        else if (i === 0 || i === nP) cn.push(b.node(xs[i], sy * half, prof.z[i], 'anchor', [true, true, true, true, true, true]))
        else cn.push(b.node(xs[i], sy * half, prof.z[i], 'cable'))
      }
      for (let i = 0; i < nP; i++) b.cable(cn[i], cn[i + 1], 'cable', p.cableArea, 'main-cable', { L0: prof.L0[i] })
      for (let i = 1; i < nP; i++) {
        if (prof.z[i] - p.deckLevel < 1) continue
        const dn = b.node(xs[i], sy * half, p.deckLevel, 'other')
        b.frame(panel[i], dn, 'rigid', 'rigid', 'crossbeam')
        b.cable(cn[i], dn, 'hanger', p.hangerArea, 'hanger', { pretension: (wDeck * (xs[i + 1] - xs[i - 1])) / 4 })
      }
    }
  }

  if (left) span(xsL, left, null, towerTop[0], 'start')
  // vão central pendular: juntas de dilatação nas duas torres; só os pendurais o seguram na longitudinal
  span(xsM, main, towerTop[0], towerTop[1], 'none')
  if (right) span(xsR, right, towerTop[1], null, 'end')

  return {
    schema: 'opengirder/1',
    name: p.name,
    type: 'suspension',
    nodes: b.nodes,
    materials: [deckMat, { ...steel('tower'), name: 'Aço fy 345 MPa — torres' }, cableMat, hangerMat, rigidMaterial()],
    sections: [deckSection(p.deck, p.cableSpacing, 'truss'), towerSec, strutSec, rigidSection()],
    elements: b.elements,
    loadCases: [{ id: 'G', name: 'Permanente (peso próprio + sobrecarga permanente)', selfWeight: true }],
    lanes: [
      {
        id: 'pista', name: 'Pista', nodes: laneNodes, width: p.carriageway,
        maxEccentricity: Math.max(0, p.carriageway / 2 - 1.5),
        joints: Array.from(new Set(joints)),
      },
    ],
    template: { kind: 'suspension', params: p },
    meta: {
      description:
        `Pênsil ${fmt(p.sideSpan)} + ${fmt(p.mainSpan)} + ${fmt(p.sideSpan)} m, flecha ${fmt(sag)} m, ` +
        `H ≈ ${fmt(H / 1000)} MN por cabo` +
        (sagLimited ? ' (flecha limitada pela altura da torre)' : ''),
      mainSpan: p.mainSpan,
      spans: nSide > 0 ? [p.sideSpan, p.mainSpan, p.sideSpan] : [p.mainSpan],
      deckMaterial: p.deckMaterial,
    },
  }
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}
