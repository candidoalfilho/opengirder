/**
 * Ponte de vigas com o tabuleiro em GRELHA: n longarinas longitudinais, faixas de laje
 * transversais em cada estaca e transversinas — o modelo usual de tabuleiros de vigas
 * múltiplas (Hambly, "Bridge Deck Behaviour"). Dá a distribuição transversal das cargas
 * entre longarinas, o que a espinha (barra única) não dá.
 *
 * Como o modelo é montado
 *  - Longarinas (grupo 'deck'): seção T = alma + laje tributária (espaçamento nas internas;
 *    meio espaçamento + balanço nas de borda). Levam TODO o peso próprio do tabuleiro e a
 *    sobrecarga permanente, repartida pela largura tributária. Torção: J = alma + b·t³/6
 *    (a rigidez à torção da laje é dividida meio a meio entre as duas direções da grelha).
 *  - Faixas de laje (grupo 'crossbeam'), uma por estaca, de longarina a longarina: largura =
 *    comprimento tributário da estaca, Iz = b·t³/12 (flexão transversal), J = b·t³/6,
 *    Iy = t·b³/12 (rigidez no plano: a laje trabalha como diafragma horizontal). Material
 *    sem peso — o peso da laje já está nas longarinas.
 *  - Transversinas: na estaca em que existem, a faixa de laje vira uma seção T (laje +
 *    nervura); o peso da nervura entra como carga adicional da seção.
 *  - Apoios: um aparelho sob cada longarina (uz); uy numa longarina central; ux nas
 *    longarinas do primeiro encontro. Pilar monolítico: coluna-parede engastada na
 *    transversina de apoio, no eixo da obra.
 *  - Carga móvel: a pista traz `lines` (uma linha por longarina) e a carga é levada às duas
 *    longarinas vizinhas pela regra da alavanca (loads/transverse.ts).
 *
 * O que a grelha NÃO representa: flexão local da laje entre longarinas sob a roda (a laje
 * é dimensionada à parte), efeito de membrana/casca, largura colaborante variável
 * (shear lag) e os balanços da laje (o peso deles vai para a longarina de borda).
 */

import type { BridgeModel, Material, Section } from '../model/types'
import type { GirderBridgeParams, GrillageParams } from './types'
import { centered } from '../sections/geometry'
import { rectTorsion, sectionProperties } from '../sections/properties'
import { Builder, concrete, deckMaterial, rigidMaterial, rigidSection, stations } from './builder'

/** dados da grelha: os informados ou, na falta, os da geometria 't-girders' da seção */
export function resolveGrillage(p: GirderBridgeParams): GrillageParams {
  if (p.grillage) return p.grillage
  const g = p.deck.geometry
  if (g && g.kind === 't-girders' && g.n >= 2) {
    return { girders: Math.round(g.n), spacing: g.spacing, web: g.bw, depth: g.depth, slab: g.slab, diaphragms: 'supports+mid' }
  }
  // sem dados: 5 longarinas igualmente espaçadas com a altura da seção informada
  const n = Math.max(2, Math.min(8, Math.round(p.deckWidth / 2.6)))
  return {
    girders: n, spacing: Math.round((p.deckWidth / n) * 100) / 100, web: 0.25,
    depth: p.deck.depth, slab: 0.22, diaphragms: 'supports+mid',
  }
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

export function generateGrillage(p: GirderBridgeParams): BridgeModel {
  const gp = resolveGrillage(p)
  const n = Math.max(2, Math.round(gp.girders))
  const sp = gp.spacing
  const t = gp.slab
  if (!(sp > 0 && t > 0 && gp.depth > t && gp.web > 0)) {
    throw new Error('Grelha: espaçamento, laje, altura e alma das longarinas devem ser positivos (altura maior que a laje).')
  }
  if (p.deckMaterial !== 'concrete' && !gp.girder) {
    throw new Error('Grelha de tabuleiro de aço ou misto: informe as propriedades da longarina (A, Iz, Iy, J).')
  }
  const b = new Builder()
  const z = p.pierHeight > 0 ? p.pierHeight : 8
  const spans = p.spans.filter((s) => s > 0)
  const supports: number[] = [0]
  for (const s of spans) supports.push(supports[supports.length - 1] + s)
  const total = supports[supports.length - 1]

  // ---- estacas: apoios + transversinas intermediárias
  const diaX = new Set<number>(supports.map(key))
  if (gp.diaphragms === 'supports+mid') {
    for (let i = 1; i < supports.length; i++) diaX.add(key((supports[i - 1] + supports[i]) / 2))
  } else if (gp.diaphragms === 'spacing' && gp.diaphragmSpacing && gp.diaphragmSpacing > 0) {
    for (let i = 1; i < supports.length; i++) {
      const L = supports[i] - supports[i - 1]
      const k = Math.max(1, Math.round(L / gp.diaphragmSpacing))
      for (let j = 1; j < k; j++) diaX.add(key(supports[i - 1] + (L * j) / k))
    }
  }
  const xs = stations([...diaX], Math.max(0.5, p.elementLength))
  const ys = centered(n, sp)
  const width = Math.max(p.deckWidth, (n - 1) * sp + gp.web)
  const overhang = (width - (n - 1) * sp) / 2

  // ---- seções das longarinas
  const tribIn = sp
  const tribEdge = sp / 2 + overhang
  const girderSec = (id: string, name: string, trib: number): Section => {
    const geometry = { kind: 't-girders' as const, n: 1, width: trib, slab: t, bw: gp.web, depth: gp.depth, spacing: 0 }
    const sp1 = sectionProperties(geometry)
    const J = rectTorsion(gp.depth - t, gp.web) + (trib * t ** 3) / 6
    const base: Section = {
      id, name,
      A: sp1.A, Iz: sp1.Iz, Iy: sp1.Iy, J,
      extraDead: (p.deck.extraDead * trib) / width,
      depth: gp.depth, width: gp.web, shape: 'girder',
      yTop: sp1.yTop, yBot: sp1.yBot,
      // desenho: a alma, deslocada p/ o eixo do modelo ficar no centroide da seção T
      drawOffset: (sp1.yTop - sp1.yBot) / 2,
      // vento: a força do tabuleiro inteiro vai meio a meio p/ as duas longarinas de borda
      windWidth: width,
      windShare: 0,
    }
    if (gp.girder) {
      // propriedades informadas (aço, mista ou pré-moldada de catálogo): valem p/ todas as
      // longarinas; a geometria T fica só p/ o desenho
      return { ...base, A: gp.girder.A, Iz: gp.girder.Iz, Iy: gp.girder.Iy, J: gp.girder.J }
    }
    return { ...base, geometry }
  }
  const secIn = girderSec('deck', 'Longarina interna', tribIn)
  // bordas: uma seção por lado só p/ o desenho do balanço da laje (z local da barra = −Y)
  const edge = (id: string, name: string, side: 1 | -1): Section => {
    const sec = girderSec(id, name, tribEdge)
    const zTopE = sec.yTop ?? gp.depth / 2
    return {
      ...sec, windShare: 0.5,
      drawExtra: overhang > gp.web / 2 + 0.01
        ? { depth: t, width: overhang, offset: zTopE - t / 2, offsetZ: (-side * overhang) / 2 }
        : undefined,
    }
  }
  const secEdgeL = edge('deck-edge-l', 'Longarina de borda (y < 0)', -1)
  const secEdgeR = edge('deck-edge-r', 'Longarina de borda (y > 0)', 1)

  // ---- materiais
  const deckMat = deckMaterial(p.deckMaterial, p.fck)
  const slabMat: Material = {
    ...concrete('slab', p.fck), gamma: 0, name: `Laje C${p.fck} — só rigidez (peso nas longarinas)`,
  }

  // ---- nós e longarinas
  const lines: number[][] = ys.map((y) => xs.map((x) => b.node(x, y, z, 'deck')))
  lines.forEach((ln, l) => {
    const sec = l === 0 ? 'deck-edge-l' : l === n - 1 ? 'deck-edge-r' : 'deck'
    for (let i = 1; i < ln.length; i++) b.frame(ln[i - 1], ln[i], 'deck', sec, 'deck')
  })

  // ---- faixas de laje e transversinas
  const dia = gp.diaphragm ?? { width: 0.3, depth: Math.max(t + 0.3, 0.8 * gp.depth) }
  const zTop = secIn.yTop ?? gp.depth / 2
  const sections: Section[] = [secIn, secEdgeL, secEdgeR]
  const stripSec = new Map<string, string>()
  const strip = (bw: number, withDia: boolean): string => {
    const k = `${Math.round(bw * 1000)}:${withDia ? 1 : 0}`
    const hit = stripSec.get(k)
    if (hit) return hit
    const id = `${withDia ? 'dia' : 'slab'}-${stripSec.size + 1}`
    let sec: Section
    if (withDia) {
      const geo = { kind: 't-girders' as const, n: 1, width: Math.max(bw, dia.width), slab: t, bw: dia.width, depth: dia.depth, spacing: 0 }
      const q = sectionProperties(geo)
      sec = {
        id, name: `Transversina ${fmt(dia.width)} × ${fmt(dia.depth)} m + laje`,
        A: q.A, Iz: q.Iz, Iy: (t * bw ** 3) / 12, J: rectTorsion(dia.depth - t, dia.width) + (bw * t ** 3) / 6,
        // só a nervura pesa: a laje já está nas longarinas
        extraDead: deckMat.gamma * dia.width * (dia.depth - t),
        // desenho: a nervura abaixo da laje + a faixa de laje por cima
        depth: dia.depth - t, width: dia.width, shape: 'girder',
        drawOffset: zTop - t - (dia.depth - t) / 2,
        drawExtra: { depth: t, width: bw, offset: zTop - t / 2 },
      }
    } else {
      sec = {
        id, name: `Faixa de laje ${fmt(bw)} × ${fmt(t)} m`,
        A: bw * t, Iz: (bw * t ** 3) / 12, Iy: (t * bw ** 3) / 12, J: (bw * t ** 3) / 6,
        depth: t, width: bw, shape: 'generic',
        drawOffset: zTop - t / 2,
      }
    }
    sections.push(sec)
    stripSec.set(k, id)
    return id
  }
  /** nó no eixo da obra sobre a transversina de apoio (pilar monolítico com nº par de longarinas) */
  const axisNode = new Map<number, number>()
  const mid = Math.floor((n - 1) / 2)
  xs.forEach((x, i) => {
    const trib = ((i < xs.length - 1 ? xs[i + 1] : x) - (i > 0 ? xs[i - 1] : x)) / 2
    const withDia = diaX.has(key(x))
    const sec = strip(Math.max(trib, 0.05), withDia)
    // material sem peso também na transversina: o peso da nervura está em `extraDead` da seção
    const mat = 'slab'
    const pierHere = withDia && p.monolithic && p.pierHeight > 0 && i > 0 && i < xs.length - 1 && supports.some((s) => Math.abs(s - x) < 1e-6)
    for (let l = 1; l < n; l++) {
      if (pierHere && n % 2 === 0 && l === n / 2) {
        const c = b.node(x, 0, z, 'deck')
        axisNode.set(key(x), c)
        b.frame(lines[l - 1][i], c, mat, sec, 'crossbeam')
        b.frame(c, lines[l][i], mat, sec, 'crossbeam')
      } else {
        b.frame(lines[l - 1][i], lines[l][i], mat, sec, 'crossbeam')
      }
    }
  })

  // ---- apoios e pilares
  const pierW = Math.min(0.5 * width, 6)
  const pierT = Math.max(1, p.pierHeight / 12)
  const pierSec: Section = {
    id: 'pier', name: `Pilar-parede ${fmt(pierW)} × ${fmt(pierT)} m`,
    A: pierW * pierT,
    Iz: (pierW * pierT ** 3) / 12,
    Iy: (pierT * pierW ** 3) / 12,
    J: (pierW * pierT ** 3) / 3,
    depth: pierT, width: pierW, shape: 'tower',
  }
  const ix = (x: number): number => xs.findIndex((v) => Math.abs(v - x) < 1e-6)
  const frameBridge = p.monolithic && p.pierHeight > 0 && supports.length > 2
  supports.forEach((x, si) => {
    const i = ix(x)
    const end = si === 0 || si === supports.length - 1
    if (!end && p.pierHeight > 0 && p.monolithic) {
      const top = n % 2 === 1 ? lines[mid][i] : axisNode.get(key(x))!
      const base = b.node(x, 0, 0, 'pier', [true, true, true, true, true, true])
      const nPier = Math.max(2, Math.round(p.pierHeight / 4))
      let prev = base
      for (let k = 1; k < nPier; k++) {
        const nk = b.node(x, 0, (z * k) / nPier, 'pier')
        b.frame(prev, nk, 'pier', 'pier', 'pier')
        prev = nk
      }
      b.frame(prev, top, 'pier', 'pier', 'pier')
      return
    }
    // aparelhos de apoio: um por longarina
    for (let l = 0; l < n; l++) {
      b.fix(lines[l][i], { uz: true, uy: l === mid, ux: si === 0 && !frameBridge })
    }
    if (!end && p.pierHeight > 0) {
      const base = b.node(x, 0, 0, 'pier', [true, true, true, true, true, true])
      const top = b.node(x, 0, z - gp.depth - 0.15, 'pier')
      b.frame(base, top, 'pier', 'pier', 'pier')
    }
  })

  const maxSpan = Math.max(...spans)
  const diaLabel =
    gp.diaphragms === 'supports' ? 'transversinas nos apoios'
    : gp.diaphragms === 'supports+mid' ? 'transversinas nos apoios e no meio dos vãos'
    : `transversinas a cada ${fmt(gp.diaphragmSpacing ?? 0)} m`
  return {
    schema: 'opengirder/1',
    name: p.name,
    type: 'girder',
    nodes: b.nodes,
    materials: [deckMat, slabMat, concrete('pier', Math.min(p.fck, 40)), rigidMaterial()],
    sections: [...sections, pierSec, rigidSection()],
    elements: b.elements,
    loadCases: [{ id: 'G', name: 'Permanente (peso próprio + sobrecarga permanente)', selfWeight: true }],
    lanes: [
      {
        id: 'pista', name: 'Pista', nodes: lines[mid], width: p.carriageway,
        maxEccentricity: Math.max(0, p.carriageway / 2 - 1.5),
        joints: [0, total],
        lines: lines.map((ln, l) => ({ y: ys[l], nodes: ln })),
      },
    ],
    template: { kind: 'girder', params: p },
    meta: {
      description:
        `Grelha de ${n} longarinas a cada ${fmt(sp)} m, laje de ${fmt(t * 100)} cm, ${diaLabel}; ` +
        `${spans.length} vão(s): ${spans.map(fmt).join(' + ')} m`,
      mainSpan: maxSpan,
      spans,
      deckMaterial: p.deckMaterial,
    },
  }
}

function key(x: number): number {
  return Math.round(x * 1e6) / 1e6
}
