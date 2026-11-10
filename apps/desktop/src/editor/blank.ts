/**
 * Modelo em branco p/ modelagem do zero: sem nós nem elementos, mas já com os materiais e
 * as seções usuais, para que a primeira barra desenhada tenha propriedades plausíveis.
 */

import {
  cableSteel,
  concrete,
  rigidMaterial,
  rigidSection,
  steel,
  type BridgeModel,
  type BridgeType,
  type Section,
} from '@opengirder/engine'

export const BLANK_SECTIONS: Section[] = [
  {
    id: 'deck', name: 'Tabuleiro', A: 8, Iy: 80, Iz: 6, J: 10, extraDead: 40,
    depth: 2.5, width: 14, shape: 'box',
  },
  { id: 'tower', name: 'Torre', A: 20, Iy: 60, Iz: 60, J: 80, depth: 5, width: 4, shape: 'tower' },
  { id: 'pier', name: 'Pilar', A: 6, Iy: 4.5, Iz: 2, J: 5, depth: 2, width: 3, shape: 'tower' },
  { ...rigidSection('rigid'), name: 'Ligação rígida' },
]

export function blankModel(name = 'Nova ponte', type: BridgeType = 'cable-stayed'): BridgeModel {
  const deckMat = concrete('concrete', 40)
  return {
    schema: 'opengirder/1',
    name,
    type,
    nodes: [],
    materials: [
      deckMat,
      steel('steel', 345),
      cableSteel('strand', 'Cordoalhas fptk 1770 MPa', 1770, 195e6, 80),
      rigidMaterial('rigid'),
    ],
    sections: BLANK_SECTIONS.map((s) => ({ ...s })),
    elements: [],
    loadCases: [],
    lanes: [],
    meta: { description: 'Modelo construído do zero no editor gráfico.', deckMaterial: 'concrete' },
  }
}
