import type { BridgeModel, Lane, Section } from '../model/types'
import type { CableStayedParams } from './types'
import {
  Builder,
  cableSteel,
  concrete,
  deckMaterial,
  deckSection,
  rigidMaterial,
  rigidSection,
  stations,
} from './builder'

interface Anchor {
  tower: number
  side: -1 | 1
  k: number
  /** estaca no eixo do tabuleiro */
  s: number
  /** distância à torre */
  dist: number
  /** comprimento de influência (m) */
  trib: number
  atSupport: boolean
}

/**
 * Ponte estaiada paramétrica.
 *
 * Tabuleiro como "espinha" de barras no eixo (reto ou em arco de círculo em planta), com
 * transversinas rígidas até as ancoragens dos estais quando há dois planos de cabos.
 * Torres: pilone único no eixo (tabuleiro monolítico com a torre) ou torre em X — duas
 * pernas inclinadas que se cruzam, tabuleiro passando livre entre elas (tipo Octávio Frias).
 * `twin` gera o 2º tabuleiro curvo espelhado, em outra cota, cruzando o 1º sob a torre.
 *
 * Os estais saem com a área dimensionada pela força estimada (reação de viga contínua) e
 * `pretension`; o form-finding do motor ajusta os comprimentos indeformados.
 */
export function generateCableStayed(p: CableStayedParams): BridgeModel {
  const b = new Builder()
  const R = p.planRadius > 0 ? p.planRadius : 0
  const xTower = p.towerShape === 'X'
  const twin = !!p.twin && R > 0 && p.towers === 1
  const n = Math.max(1, Math.round(p.staysPerSide))
  const f0 = Math.max(1, p.firstStayOffset)
  const sMin = -p.sideSpan
  const sMax = p.towers === 2 ? p.mainSpan + p.sideSpan : p.mainSpan
  const towerS = p.towers === 2 ? [0, p.mainSpan] : [0]
  const kappa = R > 0 ? -1 / R : 0
  // os dois tabuleiros gêmeos passam paralelos sob a torre e se afastam um do outro (")(")
  const theta0 = 0
  const zTop = p.deckLevel + p.towerHeight
  const zTopA = zTop - 1
  const levels = twin ? [p.deckLevel, p.twin!.level2] : [p.deckLevel]
  const nDecks = levels.length

  const path = (s: number, mirror: number): { x: number; y: number; th: number } => {
    const th = theta0 + kappa * s
    if (kappa === 0) return { x: s * Math.cos(theta0), y: mirror * s * Math.sin(theta0), th: mirror * th }
    return {
      x: (Math.sin(th) - Math.sin(theta0)) / kappa,
      y: (-mirror * (Math.cos(th) - Math.cos(theta0))) / kappa,
      th: mirror * th,
    }
  }

  // ---- ancoragens dos estais no tabuleiro
  const anchors: Anchor[] = []
  if (p.towers === 1) {
    // vãos desiguais (> 10%): o último estai do vão menor ancora no encontro e equilibra a torre
    const shorter = Math.min(p.sideSpan, p.mainSpan)
    const unequal = Math.abs(p.sideSpan - p.mainSpan) > 0.1 * shorter && n > 1 && !twin
    for (const side of [-1, 1] as const) {
      const span = side < 0 ? p.sideSpan : p.mainSpan
      const back = unequal && span === shorter
      const d = back ? (span - f0) / (n - 1) : (span - f0) / n
      for (let k = 0; k < n; k++) {
        const atSupport = back && k === n - 1
        anchors.push({
          tower: 0, side, k, s: side * (f0 + k * d), dist: f0 + k * d, trib: atSupport ? d / 2 : d, atSupport,
        })
      }
    }
  } else {
    const dS = n > 1 ? (p.sideSpan - f0) / (n - 1) : 0
    const dM = (p.mainSpan / 2 - f0) / (n - 0.5)
    for (let t = 0; t < 2; t++) {
      const s0 = towerS[t]
      const outer = t === 0 ? -1 : 1
      for (let k = 0; k < n; k++) {
        const distS = n > 1 ? f0 + k * dS : p.sideSpan
        anchors.push({
          tower: t, side: outer as -1 | 1, k, s: s0 + outer * distS, dist: distS,
          trib: k === n - 1 ? dS / 2 : dS, atSupport: k === n - 1,
        })
        anchors.push({
          tower: t, side: -outer as -1 | 1, k, s: s0 - outer * (f0 + k * dM), dist: f0 + k * dM,
          trib: dM, atSupport: false,
        })
      }
    }
  }

  // ---- cotas das ancoragens na torre
  const xl = p.xLegs ?? { base: 0.14 * zTop, top: 0.045 * zTop }
  const zCross = xTower ? (zTop * xl.base) / (xl.base + xl.top) : 0
  const layout = xTower && p.layout === 'harp' ? 'semi-fan' : p.layout
  const zLow = xTower ? Math.max(zCross + 2, Math.max(...levels) + 6) : p.deckLevel + 0.25 * p.towerHeight
  const aEff = n > 1 ? Math.min(p.towerAnchorSpacing, Math.max(0.2, (zTopA - zLow) / (n - 1))) : 0
  const distMax = (a: Anchor): number =>
    Math.max(...anchors.filter((o) => o.tower === a.tower && o.side === a.side).map((o) => o.dist))
  const anchorZraw = (a: Anchor): number => {
    if (layout === 'fan') return zTopA
    if (layout === 'semi-fan') return zTopA - (n - 1 - a.k) * aEff
    return p.deckLevel + (zTopA - p.deckLevel) * (a.dist / distMax(a))
  }
  // Na harpa com vãos desiguais as ancoragens dos dois lados caem em cotas quase iguais, o que
  // geraria barras de torre de milímetros (mal condicionadas). Cotas a menos de 0,6 m são
  // unificadas na média do grupo.
  const zSnap = new Map<number, number>()
  {
    const r3 = (z: number): number => Math.round(z * 1000) / 1000
    const zsRaw = Array.from(new Set(anchors.map((a) => r3(anchorZraw(a))))).sort((x, y) => x - y)
    let group: number[] = []
    const flush = (): void => {
      if (group.length === 0) return
      const mean = r3(group.reduce((x, y) => x + y, 0) / group.length)
      for (const z of group) zSnap.set(z, mean)
      group = []
    }
    for (const z of zsRaw) {
      if (group.length > 0 && z - group[0] > 0.6) flush()
      group.push(z)
    }
    flush()
  }
  const anchorZ = (a: Anchor): number => {
    const z = Math.round(anchorZraw(a) * 1000) / 1000
    return zSnap.get(z) ?? z
  }

  // ---- tabuleiro(s)
  const req = [sMin, sMax, ...towerS, ...anchors.map((a) => a.s)]
  const ss = stations(req, Math.max(1, p.elementLength))
  const key = (v: number): string => (Math.round(v * 1000) / 1000).toFixed(3)
  const e2 = p.deckWidth / 2 - 0.6
  const bearingOff = p.planes === 2 ? e2 : 0.3 * p.deckWidth
  const deckNodes: number[][] = []
  const spineAt: Map<string, number>[] = []
  const edgeAt = new Map<string, number>()
  const lanes: Lane[] = []
  const curved = R > 0

  const edgeNode = (di: number, s: number, ps: number, off: number): number => {
    const kk = `${di}:${key(s)}:${ps}`
    const got = edgeAt.get(kk)
    if (got) return got
    const mirror = di === 1 ? -1 : 1
    const q = path(s, mirror)
    const nd = b.node(q.x - ps * off * Math.sin(q.th), q.y + ps * off * Math.cos(q.th), levels[di], 'other')
    edgeAt.set(kk, nd)
    b.frame(spineAt[di].get(key(s))!, nd, 'rigid', 'rigid', 'crossbeam')
    return nd
  }

  for (let di = 0; di < nDecks; di++) {
    const mirror = di === 1 ? -1 : 1
    const ids: number[] = []
    const map = new Map<string, number>()
    for (const s of ss) {
      const q = path(s, mirror)
      const nd = b.node(q.x, q.y, levels[di], 'deck')
      ids.push(nd)
      map.set(key(s), nd)
    }
    deckNodes.push(ids)
    spineAt.push(map)
    for (let i = 1; i < ids.length; i++) b.frame(ids[i - 1], ids[i], 'deck', 'deck', 'deck')
    // apoios de extremidade: diafragma com dois aparelhos (vertical + torção)
    ;[sMin, sMax].forEach((s, iEnd) => {
      const spine = map.get(key(s))!
      for (const ps of [-1, 1]) b.fix(edgeNode(di, s, ps, bearingOff), { uz: true })
      const stayHere = anchors.some((a) => a.atSupport && Math.abs(a.s - s) < 1e-6)
      b.fix(spine, {
        uy: true,
        ux: curved || (xTower && iEnd === 0),
        uz: p.planes === 1 && stayHere,
      })
    })
    lanes.push({
      id: `pista${di + 1}`,
      name: nDecks > 1 ? `Pista ${di + 1} (cota ${levels[di].toLocaleString('pt-BR')} m)` : 'Pista',
      nodes: ids, width: p.carriageway, maxEccentricity: Math.max(0, p.carriageway / 2 - 1.5),
    })
  }

  // ---- torres
  const maxLen = Math.max(6, p.towerHeight / 10)
  const zAnch = Array.from(new Set(anchors.map((a) => Math.round(anchorZ(a) * 1000) / 1000)))
  /** nó da torre por (torre, perna, cota) */
  const towerNode = new Map<string, number>()
  const tKey = (t: number, leg: number, z: number): string => `${t}:${leg}:${key(z)}`
  const tilt = Math.tan(((p.towerTiltDeg || 0) * Math.PI) / 180)

  towerS.forEach((sT, t) => {
    if (!xTower) {
      const q = path(sT, 1)
      const zs = stations([0, zTop, ...levels, ...zAnch.filter((z) => z > 0 && z < zTop)], maxLen)
      let prev = -1
      for (const z of zs) {
        let nd: number
        const di = levels.findIndex((lv) => Math.abs(lv - z) < 1e-6)
        if (di >= 0) {
          // tabuleiro monolítico com o pilone
          nd = spineAt[di].get(key(sT))!
        } else {
          const lean = z > p.deckLevel ? -(z - p.deckLevel) * tilt : 0
          nd = b.node(
            q.x + lean * Math.cos(q.th), q.y + lean * Math.sin(q.th), z,
            'tower', z === 0 ? [true, true, true, true, true, true] : undefined,
          )
        }
        towerNode.set(tKey(t, 0, z), nd)
        if (prev > 0) b.frame(prev, nd, 'tower', 'tower', 'tower')
        prev = nd
      }
    } else {
      // travessas sob cada tabuleiro: o tabuleiro apoia-se nelas por um aparelho de apoio
      const zBeam = levels.map((lv) => lv - p.deck.depth / 2 - 1.5).filter((z) => z > 1 && z < zCross - 1)
      const zs = stations([0, zCross, zTop, ...zBeam, ...zAnch.filter((z) => z > 0 && z < zTop)], maxLen)
      const prev = [-1, -1]
      for (const z of zs) {
        const shared = Math.abs(z - zCross) < 1e-6
        let common = -1
        for (let leg = 0; leg < 2; leg++) {
          const sg = leg === 0 ? 1 : -1
          const y = sg * (xl.base - ((xl.base + xl.top) * z) / zTop)
          let nd: number
          if (shared && common > 0) nd = common
          else {
            nd = b.node(0, shared ? 0 : y, z, 'tower', z === 0 ? [true, true, true, true, true, true] : undefined)
            if (shared) common = nd
          }
          towerNode.set(tKey(t, leg, z), nd)
          if (prev[leg] > 0) b.frame(prev[leg], nd, 'tower', 'tower', 'tower')
          prev[leg] = nd
        }
      }
      // travessa de topo entre as pernas (fecha o X)
      const a = towerNode.get(tKey(t, 0, zs[zs.length - 1]))!
      const c = towerNode.get(tKey(t, 1, zs[zs.length - 1]))!
      b.frame(a, c, 'tower', 'tower', 'tower')
      zBeam.forEach((z, di) => {
        const n0 = towerNode.get(tKey(t, 0, z))!
        const n1 = towerNode.get(tKey(t, 1, z))!
        const mid = b.node(0, 0, z, 'tower')
        b.frame(n0, mid, 'tower', 'strut', 'tower')
        b.frame(mid, n1, 'tower', 'strut', 'tower')
        // aparelho de apoio: toco vertical rígido à compressão e flexível à flexão
        b.frame(mid, spineAt[di].get(key(sT))!, 'tower', 'bearing', 'pier')
      })
    }
  })

  // ---- estais
  const deckMat = deckMaterial(p.deckMaterial, p.fck)
  const wDeck = deckMat.gamma * p.deck.A + p.deck.extraDead
  const fuStrand = p.strandFpk * 1000 * p.strandArea
  const kLive = 1.1 + (5 * p.carriageway) / wDeck
  const planes = p.planes === 2 ? [-1, 1] : [0]
  interface StayDef { a: Anchor; nT: number; nD: number; c: number; sin: number; cos: number; T: number }
  const defs: StayDef[] = []
  for (let di = 0; di < nDecks; di++) {
    for (const a of anchors) {
      for (const ps of planes) {
        const nD = ps === 0 ? spineAt[di].get(key(a.s))! : edgeNode(di, a.s, ps, e2)
        const leg = !xTower ? 0 : twin ? di : ps > 0 ? 1 : 0
        const nT = towerNode.get(tKey(a.tower, leg, Math.round(anchorZ(a) * 1000) / 1000))!
        const pT = b.pos(nT)
        const pD = b.pos(nD)
        const c = Math.hypot(pT[0] - pD[0], pT[1] - pD[1], pT[2] - pD[2])
        const sin = (pT[2] - pD[2]) / c
        const cos = Math.sqrt(Math.max(0, 1 - sin * sin))
        const V = (wDeck * a.trib) / planes.length
        defs.push({ a, nT, nD, c, sin, cos, T: a.atSupport ? 0 : V / Math.max(sin, 0.05) })
      }
    }
  }
  // estais de ancoragem: equilibram a componente horizontal que sobra na torre
  for (const d of defs) {
    if (!d.a.atSupport) continue
    const same = defs.filter((o) => o.a.tower === d.a.tower && !o.a.atSupport)
    let hMain = 0
    let hSide = 0
    let avg = 0
    for (const o of same) {
      if (o.a.side === d.a.side) hSide += o.T * o.cos
      else hMain += o.T * o.cos
      avg += o.T / same.length
    }
    d.T = Math.max(hMain - hSide, 0) / planes.length / Math.max(d.cos, 0.1) + 0.5 * avg
  }
  for (const d of defs) {
    const strands = Math.min(p.strandsMax, Math.max(p.strandsMin, Math.ceil((d.T * kLive) / (0.45 * fuStrand))))
    b.cable(d.nT, d.nD, 'stay', strands * p.strandArea, 'stay', { pretension: d.T, strands })
  }

  const towerSec: Section = {
    id: 'tower', name: xTower ? 'Perna da torre' : 'Pilone',
    A: p.tower.A, Iy: p.tower.I, Iz: p.tower.I, J: p.tower.J,
    depth: p.tower.width, width: p.tower.width, shape: 'tower',
  }
  const nStays = defs.length
  return {
    schema: 'opengirder/1',
    name: p.name,
    type: 'cable-stayed',
    nodes: b.nodes,
    materials: [
      deckMat,
      { ...concrete('tower', p.tower.fck), name: `Concreto C${p.tower.fck} (torre)` },
      cableSteel('stay', `Cordoalhas fptk ${p.strandFpk} MPa`, p.strandFpk),
      rigidMaterial(),
    ],
    sections: [
      deckSection(p.deck, p.deckWidth),
      towerSec,
      {
        id: 'strut', name: 'Travessa da torre', A: 0.6 * p.tower.A, Iy: 0.4 * p.tower.I, Iz: 0.4 * p.tower.I,
        J: 0.4 * p.tower.J, depth: 0.6 * p.tower.width, width: 0.6 * p.tower.width, shape: 'tower',
      },
      {
        id: 'bearing', name: 'Aparelho de apoio', A: 2, Iy: 2e-4, Iz: 2e-4, J: 2e-4,
        depth: 0.8, width: 0.8, shape: 'generic',
      },
      rigidSection(),
    ],
    elements: b.elements,
    loadCases: [{ id: 'G', name: 'Permanente (peso próprio + sobrecarga permanente)', selfWeight: true }],
    lanes,
    template: { kind: 'cable-stayed', params: p },
    meta: {
      description:
        `Estaiada com ${p.towers} torre(s)${xTower ? ' em X' : ''}, ${nStays} estais` +
        (twin ? ', dois tabuleiros curvos' : curved ? ', tabuleiro curvo' : ''),
      mainSpan: p.towers === 2 ? p.mainSpan : Math.max(p.mainSpan, p.sideSpan),
      spans: p.towers === 2 ? [p.sideSpan, p.mainSpan, p.sideSpan] : [p.sideSpan, p.mainSpan],
      deckMaterial: p.deckMaterial,
    },
  }
}
