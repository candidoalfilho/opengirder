import type { BridgeModel, Section } from '../model/types'
import type { GirderBridgeParams } from './types'
import { Builder, concrete, deckMaterial, deckSection, rigidMaterial, rigidSection, stations } from './builder'

/**
 * Ponte/viaduto de vigas (seção caixão, vigas múltiplas homogeneizadas ou mista) como
 * viga contínua espacial ("espinha"): tabuleiro em barras ao longo de X, apoios nos
 * encontros e pilares. Pilares monolíticos entram no modelo como pórtico.
 */
export function generateGirder(p: GirderBridgeParams): BridgeModel {
  const b = new Builder()
  const z = p.pierHeight > 0 ? p.pierHeight : 8
  const spans = p.spans.filter((s) => s > 0)
  const supports: number[] = [0]
  for (const s of spans) supports.push(supports[supports.length - 1] + s)
  const xs = stations(supports, Math.max(0.5, p.elementLength))

  const pierW = Math.min(0.5 * p.deckWidth, 6)
  const pierT = Math.max(1, p.pierHeight / 12)
  const pierSec: Section = {
    id: 'pier', name: `Pilar-parede ${fmt(pierW)} × ${fmt(pierT)} m`,
    A: pierW * pierT,
    Iz: (pierW * pierT ** 3) / 12, // flexão longitudinal (eixo fraco)
    Iy: (pierT * pierW ** 3) / 12,
    J: (pierW * pierT ** 3) / 3,
    depth: pierT, width: pierW, shape: 'tower',
  }

  const deckNodes: number[] = []
  for (const x of xs) deckNodes.push(b.node(x, 0, z, 'deck'))
  for (let i = 1; i < deckNodes.length; i++) b.frame(deckNodes[i - 1], deckNodes[i], 'deck', 'deck', 'deck')

  const nodeAt = (x: number): number => deckNodes[xs.findIndex((v) => Math.abs(v - x) < 1e-6)]
  supports.forEach((x, i) => {
    const nd = nodeAt(x)
    const end = i === 0 || i === supports.length - 1
    if (end) {
      // encontros: aparelhos de apoio (vertical, transversal, torção)
      b.fix(nd, { uy: true, uz: true, rx: true, ux: i === 0 && !(p.monolithic && p.pierHeight > 0 && supports.length > 2) })
      return
    }
    if (p.pierHeight > 0 && p.monolithic) {
      const base = b.node(x, 0, 0, 'pier', [true, true, true, true, true, true])
      const nPier = Math.max(2, Math.round(p.pierHeight / 4))
      let prev = base
      for (let k = 1; k < nPier; k++) {
        const nk = b.node(x, 0, (z * k) / nPier, 'pier')
        b.frame(prev, nk, 'pier', 'pier', 'pier')
        prev = nk
      }
      b.frame(prev, nd, 'pier', 'pier', 'pier')
    } else {
      b.fix(nd, { uy: true, uz: true, rx: true })
      if (p.pierHeight > 0) {
        // pilar sob aparelho de apoio: desenhado como balanço independente
        const base = b.node(x, 0, 0, 'pier', [true, true, true, true, true, true])
        const top = b.node(x, 0, z - p.deck.depth / 2 - 0.15, 'pier')
        b.frame(base, top, 'pier', 'pier', 'pier')
      }
    }
  })

  const maxSpan = Math.max(...spans)
  return {
    schema: 'opengirder/1',
    name: p.name,
    type: 'girder',
    nodes: b.nodes,
    materials: [deckMaterial(p.deckMaterial, p.fck), concrete('pier', Math.min(p.fck, 40)), rigidMaterial()],
    sections: [deckSection(p.deck, p.deckWidth), pierSec, rigidSection()],
    elements: b.elements,
    loadCases: [{ id: 'G', name: 'Permanente (peso próprio + sobrecarga permanente)', selfWeight: true }],
    lanes: [
      {
        id: 'pista', name: 'Pista', nodes: deckNodes, width: p.carriageway,
        maxEccentricity: Math.max(0, p.carriageway / 2 - 1.5),
        joints: [0, supports[supports.length - 1]],
      },
    ],
    template: { kind: 'girder', params: p },
    meta: {
      description: `Viga contínua de ${spans.length} vão(s): ${spans.map(fmt).join(' + ')} m`,
      mainSpan: maxSpan,
      spans,
      deckMaterial: p.deckMaterial,
    },
  }
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
