/**
 * Edição dos dados do modelo — funções PURAS: recebem o modelo e devolvem um modelo novo,
 * ou uma string com o motivo da recusa (mostrada ao usuário). Nada aqui toca em React/DOM.
 */

import type {
  BridgeModel,
  BridgeNode,
  CableElement,
  ElementGroup,
  FrameElement,
  LoadCase,
  Material,
  Section,
} from '@opengirder/engine'

export type Edit = BridgeModel | string

const nextId = (ids: number[]): number => ids.reduce((a, b) => Math.max(a, b), 0) + 1

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const k = `${base}-${i}`
    if (!taken.has(k)) return k
  }
}

/* ------------------------------------------------------------------ nós */

export function patchNode(model: BridgeModel, id: number, patch: Partial<Pick<BridgeNode, 'x' | 'y' | 'z'>>): Edit {
  for (const v of Object.values(patch)) if (!Number.isFinite(v)) return 'Coordenada inválida.'
  return { ...model, nodes: model.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }
}

export function setNodeFix(model: BridgeModel, id: number, dof: number, fixed: boolean): Edit {
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      if (n.id !== id) return n
      const fix = (n.fix ? [...n.fix] : [false, false, false, false, false, false]) as NonNullable<BridgeNode['fix']>
      fix[dof] = fixed
      const { fix: _old, ...rest } = n
      return fix.some(Boolean) ? { ...rest, fix } : rest
    }),
  }
}

/** novo nó: cópia do último, deslocado 1 m em X (ou na origem, se o modelo estiver vazio) */
export function addNode(model: BridgeModel): { model: BridgeModel; id: number } {
  const id = nextId(model.nodes.map((n) => n.id))
  const last = model.nodes[model.nodes.length - 1]
  const node: BridgeNode = last ? { id, x: last.x + 1, y: last.y, z: last.z, role: 'other' } : { id, x: 0, y: 0, z: 0, role: 'other' }
  return { model: { ...model, nodes: [...model.nodes, node] }, id }
}

export function removeNode(model: BridgeModel, id: number): Edit {
  const used = model.elements.filter((e) => e.n1 === id || e.n2 === id)
  if (used.length) {
    const ids = used.slice(0, 6).map((e) => e.id).join(', ')
    return `O nó ${id} é usado por ${used.length} elemento(s) (${ids}${used.length > 6 ? ', …' : ''}). Remova ou religue esses elementos antes.`
  }
  const lane = model.lanes.find((l) => l.nodes.includes(id))
  if (lane) return `O nó ${id} faz parte da faixa de carga móvel "${lane.name}".`
  if (model.loadCases.some((lc) => lc.nodal?.some((nl) => nl.node === id))) {
    return `O nó ${id} tem carga nodal aplicada. Remova a carga antes (aba Cargas).`
  }
  return { ...model, nodes: model.nodes.filter((n) => n.id !== id) }
}

/* ------------------------------------------------------------------ elementos */

const hasNode = (model: BridgeModel, id: number): boolean => model.nodes.some((n) => n.id === id)

export function patchFrame(model: BridgeModel, id: number, patch: Partial<Pick<FrameElement, 'n1' | 'n2' | 'mat' | 'sec' | 'group'>>): Edit {
  const cur = model.elements.find((e) => e.id === id)
  if (!cur || cur.kind !== 'frame') return `Barra ${id} não encontrada.`
  const next = { ...cur, ...patch }
  if (patch.n1 !== undefined && !hasNode(model, patch.n1)) return `O nó ${patch.n1} não existe.`
  if (patch.n2 !== undefined && !hasNode(model, patch.n2)) return `O nó ${patch.n2} não existe.`
  if (next.n1 === next.n2) return 'Os dois nós da barra devem ser diferentes.'
  return { ...model, elements: model.elements.map((e) => (e.id === id ? next : e)) }
}

export function patchCable(
  model: BridgeModel,
  id: number,
  patch: Partial<Pick<CableElement, 'n1' | 'n2' | 'mat' | 'A' | 'group'>> & { strands?: number | null; L0?: number | null; pretension?: number | null },
): Edit {
  const cur = model.elements.find((e) => e.id === id)
  if (!cur || cur.kind !== 'cable') return `Cabo ${id} não encontrado.`
  if (patch.n1 !== undefined && !hasNode(model, patch.n1)) return `O nó ${patch.n1} não existe.`
  if (patch.n2 !== undefined && !hasNode(model, patch.n2)) return `O nó ${patch.n2} não existe.`
  if (patch.A !== undefined && !(patch.A > 0)) return 'A área do cabo deve ser positiva.'
  const next: CableElement = { ...cur }
  if (patch.n1 !== undefined) next.n1 = patch.n1
  if (patch.n2 !== undefined) next.n2 = patch.n2
  if (patch.mat !== undefined) next.mat = patch.mat
  if (patch.A !== undefined) next.A = patch.A
  if (patch.group !== undefined) next.group = patch.group
  const opt = (key: 'strands' | 'L0' | 'pretension'): string | null => {
    const v = patch[key]
    if (v === undefined) return null
    if (v === null) {
      delete next[key]
      return null
    }
    if (!(v > 0)) return 'O valor deve ser positivo (ou vazio para automático).'
    next[key] = key === 'strands' ? Math.round(v) : v
    return null
  }
  for (const k of ['strands', 'L0', 'pretension'] as const) {
    const err = opt(k)
    if (err) return err
  }
  if (next.n1 === next.n2) return 'Os dois nós do cabo devem ser diferentes.'
  return { ...model, elements: model.elements.map((e) => (e.id === id ? next : e)) }
}

export function addFrame(model: BridgeModel, n1: number, n2: number): string | { model: BridgeModel; id: number } {
  if (!hasNode(model, n1)) return `O nó ${n1} não existe.`
  if (!hasNode(model, n2)) return `O nó ${n2} não existe.`
  if (n1 === n2) return 'Os dois nós da barra devem ser diferentes.'
  const last = [...model.elements].reverse().find((e): e is FrameElement => e.kind === 'frame')
  const mat = last?.mat ?? model.materials.find((m) => m.kind !== 'cable')?.id ?? model.materials[0]?.id
  const sec = last?.sec ?? model.sections[0]?.id
  if (!mat) return 'Crie um material antes de adicionar barras.'
  if (!sec) return 'Crie uma seção antes de adicionar barras.'
  const id = nextId(model.elements.map((e) => e.id))
  const el: FrameElement = { kind: 'frame', id, n1, n2, mat, sec, group: last?.group ?? 'deck' }
  return { model: { ...model, elements: [...model.elements, el] }, id }
}

export function addCable(model: BridgeModel, n1: number, n2: number): string | { model: BridgeModel; id: number } {
  if (!hasNode(model, n1)) return `O nó ${n1} não existe.`
  if (!hasNode(model, n2)) return `O nó ${n2} não existe.`
  if (n1 === n2) return 'Os dois nós do cabo devem ser diferentes.'
  const last = [...model.elements].reverse().find((e): e is CableElement => e.kind === 'cable')
  const mat = last?.mat ?? model.materials.find((m) => m.kind === 'cable')?.id
  if (!mat) return 'Crie um material do tipo "Cabo" antes de adicionar cabos (aba Materiais).'
  const id = nextId(model.elements.map((e) => e.id))
  const el: CableElement = { kind: 'cable', id, n1, n2, mat, A: last?.A ?? 0.003, group: last?.group ?? 'stay' }
  if (last?.strands) el.strands = last.strands
  return { model: { ...model, elements: [...model.elements, el] }, id }
}

export function removeElement(model: BridgeModel, id: number): BridgeModel {
  return {
    ...model,
    elements: model.elements.filter((e) => e.id !== id),
    loadCases: model.loadCases.map((lc) => (lc.uniform?.some((u) => u.element === id) ? { ...lc, uniform: lc.uniform.filter((u) => u.element !== id) } : lc)),
  }
}

/* ------------------------------------------------------------------ seções */

export type SectionNum = 'A' | 'Iy' | 'Iz' | 'J' | 'extraDead' | 'depth' | 'width'

export function patchSection(model: BridgeModel, id: string, patch: { name?: string } & Partial<Record<SectionNum, number | null>>): Edit {
  const cur = model.sections.find((s) => s.id === id)
  if (!cur) return 'Seção não encontrada.'
  const next: Section = { ...cur }
  if (patch.name !== undefined) next.name = patch.name.trim() || cur.name
  for (const k of ['A', 'Iy', 'Iz', 'J'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null || !(v > 0)) return `${k} deve ser positivo.`
    next[k] = v
  }
  for (const k of ['extraDead', 'depth', 'width'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null) delete next[k]
    else if (!(v >= 0)) return 'O valor não pode ser negativo.'
    else next[k] = v
  }
  return { ...model, sections: model.sections.map((s) => (s.id === id ? next : s)) }
}

export function addSection(model: BridgeModel, from?: string): { model: BridgeModel; id: string } {
  const taken = new Set(model.sections.map((s) => s.id))
  const src = from ? model.sections.find((s) => s.id === from) : undefined
  const id = uniqueKey(src ? `${src.id}-copia` : 'secao', taken)
  const sec: Section = src
    ? { ...src, id, name: `${src.name} (cópia)` }
    : { id, name: 'Nova seção', A: 1, Iy: 0.1, Iz: 0.1, J: 0.1, depth: 1, width: 1, shape: 'generic' }
  return { model: { ...model, sections: [...model.sections, sec] }, id }
}

export function removeSection(model: BridgeModel, id: string): Edit {
  const n = model.elements.filter((e) => e.kind === 'frame' && e.sec === id).length
  if (n) return `A seção é usada por ${n} barra(s). Troque a seção dessas barras antes.`
  return { ...model, sections: model.sections.filter((s) => s.id !== id) }
}

/* ------------------------------------------------------------------ materiais */

export type MaterialNum = 'E' | 'G' | 'gamma' | 'fck' | 'fy' | 'fpk'

export function patchMaterial(
  model: BridgeModel,
  id: string,
  patch: { name?: string; kind?: Material['kind'] } & Partial<Record<MaterialNum, number | null>>,
): Edit {
  const cur = model.materials.find((m) => m.id === id)
  if (!cur) return 'Material não encontrado.'
  const next: Material = { ...cur }
  if (patch.name !== undefined) next.name = patch.name.trim() || cur.name
  if (patch.kind !== undefined) next.kind = patch.kind
  for (const k of ['E', 'G'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null || !(v > 0)) return `${k} deve ser positivo.`
    next[k] = v
  }
  if (patch.gamma !== undefined) {
    if (patch.gamma === null || !(patch.gamma >= 0)) return 'O peso específico não pode ser negativo.'
    next.gamma = patch.gamma
  }
  for (const k of ['fck', 'fy', 'fpk'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null) delete next[k]
    else if (!(v > 0)) return 'A resistência deve ser positiva (ou vazia).'
    else next[k] = v
  }
  return { ...model, materials: model.materials.map((m) => (m.id === id ? next : m)) }
}

export function addMaterial(model: BridgeModel, from?: string): { model: BridgeModel; id: string } {
  const taken = new Set(model.materials.map((m) => m.id))
  const src = from ? model.materials.find((m) => m.id === from) : undefined
  const id = uniqueKey(src ? `${src.id}-copia` : 'material', taken)
  const mat: Material = src
    ? { ...src, id, name: `${src.name} (cópia)` }
    : { id, name: 'Novo material', kind: 'steel', E: 200e6, G: 77e6, gamma: 77, fy: 345e3 }
  return { model: { ...model, materials: [...model.materials, mat] }, id }
}

export function removeMaterial(model: BridgeModel, id: string): Edit {
  const n = model.elements.filter((e) => e.mat === id).length
  if (n) return `O material é usado por ${n} elemento(s). Troque o material desses elementos antes.`
  return { ...model, materials: model.materials.filter((m) => m.id !== id) }
}

/* ------------------------------------------------------------------ cargas */

const mapCase = (model: BridgeModel, id: string, fn: (lc: LoadCase) => LoadCase): BridgeModel => ({
  ...model,
  loadCases: model.loadCases.map((lc) => (lc.id === id ? fn(lc) : lc)),
})

/**
 * Novo caso de carga. Atenção à regra do motor: havendo casos, o peso próprio só entra se
 * ALGUM caso tiver `selfWeight`. Por isso, ao criar o 1º caso num modelo sem casos, cria-se
 * junto o caso de peso próprio.
 */
export function addLoadCase(model: BridgeModel): { model: BridgeModel; id: string } {
  const cases: LoadCase[] = [...model.loadCases]
  if (cases.length === 0) cases.push({ id: 'G', name: 'Permanente (peso próprio + sobrecarga permanente)', selfWeight: true })
  const taken = new Set(cases.map((lc) => lc.id))
  let k = cases.length + 1
  let id = `C${k}`
  while (taken.has(id)) id = `C${++k}`
  cases.push({ id, name: 'Carga permanente adicional', nodal: [], uniform: [] })
  return { model: { ...model, loadCases: cases }, id }
}

export function removeLoadCase(model: BridgeModel, id: string): BridgeModel {
  return { ...model, loadCases: model.loadCases.filter((lc) => lc.id !== id) }
}

export function patchLoadCase(model: BridgeModel, id: string, patch: { name?: string; selfWeight?: boolean }): BridgeModel {
  return mapCase(model, id, (lc) => {
    const next = { ...lc }
    if (patch.name !== undefined) next.name = patch.name
    if (patch.selfWeight !== undefined) {
      if (patch.selfWeight) next.selfWeight = true
      else delete next.selfWeight
    }
    return next
  })
}

export function addNodalLoad(model: BridgeModel, caseId: string, node: number): Edit {
  if (!hasNode(model, node)) return `O nó ${node} não existe.`
  return mapCase(model, caseId, (lc) => ({ ...lc, nodal: [...(lc.nodal ?? []), { node, F: [0, 0, 0, 0, 0, 0] }] }))
}

export function patchNodalLoad(model: BridgeModel, caseId: string, index: number, patch: { node?: number; dof?: number; value?: number }): Edit {
  if (patch.node !== undefined && !hasNode(model, patch.node)) return `O nó ${patch.node} não existe.`
  if (patch.value !== undefined && !Number.isFinite(patch.value)) return 'Valor inválido.'
  return mapCase(model, caseId, (lc) => ({
    ...lc,
    nodal: (lc.nodal ?? []).map((nl, i) => {
      if (i !== index) return nl
      const F = [...nl.F] as typeof nl.F
      if (patch.dof !== undefined && patch.value !== undefined) F[patch.dof] = patch.value
      return { node: patch.node ?? nl.node, F }
    }),
  }))
}

export function removeNodalLoad(model: BridgeModel, caseId: string, index: number): BridgeModel {
  return mapCase(model, caseId, (lc) => ({ ...lc, nodal: (lc.nodal ?? []).filter((_, i) => i !== index) }))
}

const isFrame = (model: BridgeModel, id: number): boolean => model.elements.some((e) => e.id === id && e.kind === 'frame')

export function addUniformLoad(model: BridgeModel, caseId: string, element: number): Edit {
  if (!isFrame(model, element)) return `A barra ${element} não existe (cargas distribuídas só se aplicam a barras).`
  return mapCase(model, caseId, (lc) => ({ ...lc, uniform: [...(lc.uniform ?? []), { element, w: [0, 0, 0] }] }))
}

export function patchUniformLoad(model: BridgeModel, caseId: string, index: number, patch: { element?: number; axis?: number; value?: number }): Edit {
  if (patch.element !== undefined && !isFrame(model, patch.element)) return `A barra ${patch.element} não existe.`
  if (patch.value !== undefined && !Number.isFinite(patch.value)) return 'Valor inválido.'
  return mapCase(model, caseId, (lc) => ({
    ...lc,
    uniform: (lc.uniform ?? []).map((ul, i) => {
      if (i !== index) return ul
      const w = [...ul.w] as typeof ul.w
      if (patch.axis !== undefined && patch.value !== undefined) w[patch.axis] = patch.value
      return { element: patch.element ?? ul.element, w }
    }),
  }))
}

export function removeUniformLoad(model: BridgeModel, caseId: string, index: number): BridgeModel {
  return mapCase(model, caseId, (lc) => ({ ...lc, uniform: (lc.uniform ?? []).filter((_, i) => i !== index) }))
}

/** aplica a mesma carga distribuída a todas as barras de um grupo (substitui as existentes do grupo nesse caso) */
export function setGroupUniformLoad(model: BridgeModel, caseId: string, group: ElementGroup, w: [number, number, number]): BridgeModel {
  const ids = new Set(model.elements.filter((e) => e.kind === 'frame' && e.group === group).map((e) => e.id))
  return mapCase(model, caseId, (lc) => ({
    ...lc,
    uniform: [...(lc.uniform ?? []).filter((u) => !ids.has(u.element)), ...[...ids].map((element) => ({ element, w: [...w] as [number, number, number] }))],
  }))
}
