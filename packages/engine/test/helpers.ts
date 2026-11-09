import type { BridgeModel, BridgeNode, Element, Material, Section } from '../src/model/types'

export const STEEL: Material = { id: 's', name: 'aço', kind: 'steel', E: 200e6, G: 77e6, gamma: 0 }
export const SEC: Section = { id: 'sec', name: 'seção', A: 0.02, Iy: 2e-4, Iz: 4e-4, J: 1e-4 }

export function model(
  nodes: BridgeNode[],
  elements: Element[],
  extra: Partial<BridgeModel> = {},
): BridgeModel {
  return {
    schema: 'opengirder/1', name: 'teste', type: 'girder', nodes,
    materials: [STEEL], sections: [SEC], elements, loadCases: [], lanes: [], ...extra,
  }
}

/** viga reta ao longo de X com n elementos */
export function beam(L: number, n: number, opts: { mat?: Material; sec?: Section } = {}): BridgeModel {
  const nodes: BridgeNode[] = []
  const elements: Element[] = []
  for (let i = 0; i <= n; i++) nodes.push({ id: i + 1, x: (L * i) / n, y: 0, z: 0, role: 'deck' })
  for (let i = 0; i < n; i++) elements.push({ kind: 'frame', id: i + 1, n1: i + 1, n2: i + 2, mat: 's', sec: 'sec', group: 'deck' })
  return model(nodes, elements, { materials: [opts.mat ?? STEEL], sections: [opts.sec ?? SEC] })
}
