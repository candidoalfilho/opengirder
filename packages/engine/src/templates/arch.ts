import type { BridgeModel, Dof6, Section, Vec3 } from '../model/types'
import type { ArchParams } from './types'
import {
  Builder,
  cableSteel,
  concrete,
  deckMaterial,
  deckSection,
  rigidMaterial,
  rigidSection,
  stations,
  steel,
} from './builder'

/** distância vertical mínima arco–tabuleiro p/ haver pendural (arco acima) ou montante (arco abaixo) */
const MIN_HANGER = 1.0
const MIN_COLUMN = 0.8

/** parâmetro `a` da catenária z = f − a·(cosh((x − L/2)/a) − 1) com flecha f no vão L */
export function catenaryParameter(L: number, f: number): number {
  const g = (a: number): number => a * (Math.cosh(L / (2 * a)) - 1) - f
  let lo = L / 40
  let hi = (L * L) / (4 * f)
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi)
    if (g(mid) > 0) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/**
 * Polígono funicular de cargas verticais P[i] nos pontos x[i] (extremos sem carga), com a
 * flecha máxima `f`: h_i = M_i/H, com M o momento de viga biapoiada e H = M_máx/f.
 */
export function funicularPolygon(x: number[], P: number[], f: number): { h: number[]; H: number } {
  const n = x.length - 1
  const L = x[n] - x[0]
  let RA = 0
  for (let j = 1; j < n; j++) RA += (P[j] * (x[n] - x[j])) / L
  const M = new Array<number>(n + 1).fill(0)
  for (let i = 1; i < n; i++) {
    let m = RA * (x[i] - x[0])
    for (let j = 1; j < i; j++) m -= P[j] * (x[i] - x[j])
    M[i] = m
  }
  const H = Math.max(...M) / f
  return { h: M.map((m) => m / H), H }
}

/**
 * Ponte em arco paramétrica.
 *
 *  - 'deck': arco inferior; o tabuleiro (viga contínua) apoia-se em montantes sobre o arco
 *    e em aparelhos nas extremidades;
 *  - 'through': arco superior nascendo no nível do tabuleiro, que fica suspenso por pendurais.
 *    Com `tied` (bowstring) o arco nasce do próprio tabuleiro, que trabalha como tirante: um
 *    apoio fixo e os demais móveis, sem empuxo nas fundações;
 *  - 'half-through': tabuleiro em cota intermediária — pendurais no trecho central e
 *    montantes junto às nascenças.
 *
 * Tabuleiro como "espinha" no eixo, com transversinas rígidas até os planos dos arcos quando
 * há dois arcos. Pendurais são cabos do grupo 'hanger': o form-finding do motor ajusta seus
 * comprimentos p/ o tabuleiro ficar no greide. Montantes são barras monolíticas (grupo 'pier').
 *
 * Eixo do arco: parábola, catenária ou o funicular da carga permanente do próprio modelo
 * (peso do arco + quinhão do tabuleiro em cada pendural/montante) — neste último o arco
 * trabalha quase sem flexão sob carga permanente.
 */
export function generateArch(p: ArchParams): BridgeModel {
  const b = new Builder()
  const L = p.span
  const f = p.rise
  const n = Math.max(2, Math.round(p.panels))
  const d = L / n
  const tied = p.tied && p.layout === 'through'
  const zS = p.springLevel
  const zD =
    p.layout === 'through' ? zS
    : p.layout === 'half-through' ? zS + Math.min(Math.max(p.deckOffset, 0), f)
    : zS + f + Math.max(1, p.deckOffset)
  const two = p.planes === 2
  const sides = two ? [-1, 1] : [0]
  // sem distância informada, os arcos ficam nas bordas do tabuleiro
  const half = two ? (p.archSpacing > 0.5 ? p.archSpacing : p.deckWidth) / 2 : 0
  // inclinação p/ dentro (basket handle): só arcos superiores, sem deixar os arcos se cruzarem
  const tanI =
    two && p.layout !== 'deck' ? Math.max(0, Math.min(Math.tan((p.inclinationDeg * Math.PI) / 180), (half - 0.75) / f)) : 0

  const deckMat = deckMaterial(p.deckMaterial, p.fck)
  const archMat = p.arch.material === 'steel' ? steel('arch') : concrete('arch', p.arch.fck)
  archMat.name = `${archMat.name} — arco`
  const colMat = p.arch.material === 'steel' ? steel('column') : concrete('column', Math.min(p.arch.fck, 40))
  colMat.name = `${colMat.name} — montantes`
  const hangerMat = cableSteel('hanger', `Pendurais fptk ${p.hangerFpk} MPa`, p.hangerFpk)
  const wDeck = deckMat.gamma * p.deck.A + p.deck.extraDead
  const wArch = archMat.gamma * p.arch.A
  const wCol = colMat.gamma * p.column.A

  // ---- eixo do arco nos pontos de painel
  const xp = Array.from({ length: n + 1 }, (_, i) => i * d)
  const link = (h: number): 'hanger' | 'column' | null => {
    const dz = zS + h - zD
    return dz >= MIN_HANGER ? 'hanger' : dz <= -MIN_COLUMN ? 'column' : null
  }
  const parab = (x: number): number => (4 * f * x * (L - x)) / (L * L)
  const aCat = p.shape === 'catenary' ? catenaryParameter(L, f) : 0
  const caten = (x: number): number => f - aCat * (Math.cosh((x - L / 2) / aCat) - 1)
  let hp = xp.map(p.shape === 'catenary' ? caten : parab)
  let Hfun = 0
  if (p.shape === 'funicular') {
    for (let it = 0; it < 8; it++) {
      const P = new Array<number>(n + 1).fill(0)
      for (let i = 1; i < n; i++) {
        const seg = (k: number): number => Math.hypot(d, (hp[k + 1] - hp[k]) * Math.sqrt(1 + tanI * tanI))
        P[i] = (wArch * (seg(i - 1) + seg(i))) / 2
        const kind = link(hp[i])
        if (kind) P[i] += (wDeck * d) / sides.length
        if (kind === 'column') P[i] += wCol * (zD - zS - hp[i])
      }
      const fun = funicularPolygon(xp, P, f)
      hp = fun.h
      Hfun = fun.H
    }
  }
  /** altura do eixo acima das nascenças em x qualquer */
  const hAt = (x: number): number => {
    if (p.shape === 'parabola') return parab(x)
    if (p.shape === 'catenary') return caten(x)
    const i = Math.min(n - 1, Math.max(0, Math.floor(x / d + 1e-9)))
    return hp[i] + ((hp[i + 1] - hp[i]) * (x - xp[i])) / d
  }

  // ---- tabuleiro: viga contínua (acessos + vão do arco)
  const approach = p.approachSpans.filter((s) => s > 0)
  const supports: number[] = [0, L]
  let xa = 0
  for (const s of approach) supports.unshift((xa -= s))
  xa = L
  for (const s of approach) supports.push((xa += s))
  const xs = stations([...supports, ...xp], Math.max(0.5, p.elementLength))
  const deckNodes = xs.map((x) => b.node(x, 0, zD, 'deck'))
  for (let i = 1; i < deckNodes.length; i++) b.frame(deckNodes[i - 1], deckNodes[i], 'deck', 'deck', 'deck')
  const deckAt = (x: number): number => deckNodes[xs.findIndex((v) => Math.abs(v - x) < 1e-6)]

  // ---- arcos
  const up: Vec3[] = sides.map((sy) => (tanI > 0 ? [0, -sy * tanI, 1] : [0, 0, 1]))
  const yArch = (sy: number, h: number): number => sy * (half - h * tanI)
  const fixSpring: Dof6<boolean> =
    p.hinges === 'two-hinged' ? [true, true, true, true, false, true] : [true, true, true, true, true, true]
  /** nós do arco nos pontos de painel, por plano */
  const archPanel: number[][] = []
  sides.forEach((sy, k) => {
    const ids: number[] = []
    let prev = -1
    for (let i = 0; i <= n; i++) {
      let nd: number
      if (i === 0 || i === n) {
        if (tied) nd = two ? b.node(xp[i], sy * half, zS, 'other') : deckAt(xp[i])
        else nd = b.node(xp[i], sy * half, zS, 'anchor', [...fixSpring] as Dof6<boolean>)
      } else {
        nd = b.node(xp[i], yArch(sy, hp[i]), zS + hp[i], 'other')
      }
      if (i > 0) {
        // subdivide o trecho entre pontos de painel
        const len = Math.hypot(d, hp[i] - hp[i - 1])
        const sub = Math.max(1, Math.round(len / Math.max(0.5, p.elementLength)))
        for (let s = 1; s < sub; s++) {
          const x = xp[i - 1] + (d * s) / sub
          const h = hAt(x)
          const mid = b.node(x, yArch(sy, h), zS + h, 'other')
          b.frame(prev, mid, 'arch', 'arch', 'arch', up[k])
          prev = mid
        }
        b.frame(prev, nd, 'arch', 'arch', 'arch', up[k])
      }
      prev = nd
      ids.push(nd)
    }
    archPanel.push(ids)
  })

  // ---- apoios do tabuleiro
  supports.forEach((x, i) => {
    const nd = deckAt(x)
    const first = i === 0
    if (tied && two && (x === 0 || x === L)) {
      // arco atirantado: aparelhos sob as nascenças; a transversina de extremidade leva o empuxo ao tirante
      const iEnd = x === 0 ? 0 : n
      sides.forEach((_, k) => {
        b.frame(nd, archPanel[k][iEnd], 'rigid', 'rigid', 'crossbeam')
        b.fix(archPanel[k][iEnd], { uz: true })
      })
      b.fix(nd, { uy: true, ux: first })
    } else {
      b.fix(nd, { uy: true, uz: true, rx: true, ux: first })
    }
  })

  // ---- pendurais, montantes e contraventamento
  let nHangers = 0
  let nColumns = 0
  for (let i = 1; i < n; i++) {
    const kind = link(hp[i])
    const spine = deckAt(xp[i])
    if (kind) {
      sides.forEach((sy, k) => {
        let att = spine
        if (two) {
          att = b.node(xp[i], sy * half, zD, 'other')
          b.frame(spine, att, 'rigid', 'rigid', 'crossbeam')
        }
        if (kind === 'hanger') {
          b.cable(archPanel[k][i], att, 'hanger', p.hangerArea, 'hanger', { pretension: (wDeck * d) / sides.length })
          nHangers++
        } else {
          // montantes curtos (junto ao fecho) são muito rígidos e atrairiam os esforços do movimento
          // relativo arco–tabuleiro (temperatura, frenagem, encurtamento do arco): como na prática,
          // são pendulares (articulados nas duas extremidades)
          const hCol = zD - (zS + hp[i])
          b.frame(archPanel[k][i], att, 'column', hCol < 10 * p.column.width ? 'column-pin' : 'column', 'pier')
          nColumns++
        }
      })
    }
    // travessas: fora do gabarito da pista (arco ≥ 5,5 m acima do tabuleiro) ou abaixo dele
    const dz = zS + hp[i] - zD
    if (two && p.braced && (dz >= 5.5 || dz <= -MIN_COLUMN)) {
      b.frame(archPanel[0][i], archPanel[1][i], 'arch', 'strut', 'arch')
    }
  }

  const archSec: Section = {
    id: 'arch', name: 'Arco', A: p.arch.A, Iz: p.arch.I, Iy: p.arch.Iout, J: p.arch.J,
    depth: p.arch.depth, width: p.arch.width, shape: 'generic',
  }
  const strutSec: Section = {
    id: 'strut', name: 'Travessa de contraventamento', A: 0.4 * p.arch.A, Iz: 0.3 * p.arch.Iout, Iy: 0.3 * p.arch.Iout,
    J: 0.3 * p.arch.J, depth: 0.6 * p.arch.width, width: 0.6 * p.arch.width, shape: 'generic',
  }
  const colSec: Section = {
    id: 'column', name: 'Montante', A: p.column.A, Iz: p.column.I, Iy: p.column.I, J: p.column.J,
    depth: p.column.width, width: p.column.width, shape: 'tower',
  }

  const colPinSec: Section = {
    ...colSec, id: 'column-pin', name: 'Montante pendular (articulado)',
    Iz: 1e-3 * p.column.I, Iy: 1e-3 * p.column.I, J: 1e-3 * p.column.J,
  }

  const total = supports[supports.length - 1] - supports[0]
  const kindLabel =
    p.layout === 'deck' ? 'Arco inferior'
    : p.layout === 'half-through' ? 'Arco de tabuleiro intermediário'
    : tied ? 'Arco atirantado (bowstring)' : 'Arco superior'
  // empuxo estimado: carga permanente uniforme equivalente (por arco)
  const Hest = Hfun > 0 ? Hfun : ((wDeck / sides.length + wArch * (1 + (8 * f * f) / (3 * L * L))) * L * L) / (8 * f)
  return {
    schema: 'opengirder/1',
    name: p.name,
    type: 'arch',
    nodes: b.nodes,
    materials: [deckMat, archMat, colMat, hangerMat, rigidMaterial()],
    sections: [deckSection(p.deck, p.deckWidth), archSec, strutSec, colSec, colPinSec, rigidSection()],
    elements: b.elements,
    loadCases: [{ id: 'G', name: 'Permanente (peso próprio + sobrecarga permanente)', selfWeight: true }],
    lanes: [
      {
        id: 'pista', name: 'Pista', nodes: deckNodes, width: p.carriageway,
        maxEccentricity: Math.max(0, p.carriageway / 2 - 1.5),
        joints: [0, total],
      },
    ],
    template: { kind: 'arch', params: p },
    meta: {
      description:
        `${kindLabel}: vão ${fmt(L)} m, flecha ${fmt(f)} m (f/L = 1/${fmt(L / f)}), ` +
        `${sides.length} arco(s), ${nHangers} pendurais${nColumns ? `, ${nColumns} montantes` : ''}; ` +
        `empuxo estimado ${fmt(Hest / 1000)} MN por arco`,
      mainSpan: L,
      spans: [...approach.slice().reverse(), L, ...approach],
      deckMaterial: p.deckMaterial,
    },
  }
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}
