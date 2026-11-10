/**
 * Registro das operações de modelagem (menu "Operações" do editor).
 *
 * Cada entrada descreve uma operação pura de `editor/ops.ts`: rótulo, parâmetros e a função
 * que devolve o modelo novo. A interface desenha o menu e o formulário a partir daqui.
 *
 * Parâmetros que dependem do modelo (material, seção, coordenadas dos nós selecionados) têm
 * `optionsFor`; além disso, `enabled()` atualiza `options` e `default` no próprio objeto, de
 * modo que um formulário que só leia `options`/`default` já mostra os valores do modelo atual.
 */

import type { BridgeModel, Dof6, ElementGroup } from '@opengirder/engine'
import type { EditAction, EditParam, EditSelection, EditValues } from './types'
import { applyAutoLanes } from './lanes'
import {
  type OpResult,
  type P3,
  assign,
  copySelection,
  deleteSelection,
  divideAtSpacing,
  divideFrames,
  generateHangers,
  generateStays,
  mergeCoincidentNodes,
  mirrorSelection,
  nodeLine,
  removeLooseNodes,
  renumber,
  rotateSelection,
  selectionNodes,
  translateNodes,
} from './ops'

type Opt = { value: string; label: string }

const num = (v: EditValues, k: string, d = 0): number => {
  const x = v[k]
  if (typeof x === 'number') return x
  if (typeof x === 'string') {
    const n = Number(x.replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : NaN
  }
  return d
}
const str = (v: EditValues, k: string): string => String(v[k] ?? '')
const bool = (v: EditValues, k: string): boolean => v[k] === true || v[k] === 'true'

const frameMaterials = (m: BridgeModel): Opt[] => m.materials.filter((x) => x.kind !== 'cable').map((x) => ({ value: x.id, label: x.name }))
const cableMaterials = (m: BridgeModel): Opt[] => {
  const cab = m.materials.filter((x) => x.kind === 'cable')
  return (cab.length ? cab : m.materials).map((x) => ({ value: x.id, label: x.name }))
}
const allMaterials = (m: BridgeModel): Opt[] => m.materials.map((x) => ({ value: x.id, label: x.name }))
const sections = (m: BridgeModel): Opt[] => m.sections.map((x) => ({ value: x.id, label: x.name }))

const FRAME_GROUPS: Opt[] = [
  { value: 'deck', label: 'Tabuleiro' },
  { value: 'tower', label: 'Torre' },
  { value: 'pier', label: 'Pilar' },
  { value: 'arch', label: 'Arco' },
  { value: 'crossbeam', label: 'Transversina' },
  { value: 'rigid', label: 'Ligação rígida' },
]
const ALL_GROUPS: Opt[] = [
  ...FRAME_GROUPS,
  { value: 'stay', label: 'Estai (cabo)' },
  { value: 'hanger', label: 'Pendural (cabo)' },
  { value: 'main-cable', label: 'Cabo principal (cabo)' },
]
const CABLE_GROUPS = new Set(['stay', 'hanger', 'main-cable'])

const SUPPORTS: { value: string; label: string; fix: Dof6<boolean> | null }[] = [
  { value: 'fixed', label: 'Engaste (6 restrições)', fix: [true, true, true, true, true, true] },
  { value: 'pin', label: 'Articulação fixa (ux, uy, uz)', fix: [true, true, true, false, false, false] },
  { value: 'deck-fixed', label: 'Apoio fixo de tabuleiro (ux, uy, uz e torção)', fix: [true, true, true, true, false, false] },
  { value: 'deck-roller', label: 'Apoio móvel de tabuleiro, livre em x (uy, uz e torção)', fix: [false, true, true, true, false, false] },
  { value: 'vertical', label: 'Só vertical (uz)', fix: [false, false, true, false, false, false] },
  { value: 'free', label: 'Sem apoio', fix: null },
]

/** atualiza opções e padrão de um parâmetro dependente do modelo */
function refresh(p: EditParam, model: BridgeModel): void {
  if (!p.optionsFor) return
  const opts = p.optionsFor(model)
  p.options = opts
  if (!opts.some((o) => o.value === p.default)) p.default = opts[0]?.value ?? ''
}
const refreshAll = (a: EditAction, model: BridgeModel): void => a.params.forEach((p) => refresh(p, model))

const need = (r: OpResult): OpResult => r

const hasNodes = (model: BridgeModel, sel: EditSelection): boolean => selectionNodes(model, sel).length > 0
const frameIds = (model: BridgeModel, sel: EditSelection): number[] => {
  const ids = new Set(sel.elements)
  return model.elements.filter((e) => ids.has(e.id) && e.kind === 'frame').map((e) => e.id)
}

function act(a: EditAction): EditAction {
  const enabled = a.enabled
  a.enabled = (model, sel) => {
    refreshAll(a, model)
    return enabled(model, sel)
  }
  return a
}

const fmt = (v: number): string => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

/* ------------------------------------------------------------------ gerar */

const line: EditAction = act({
  key: 'line',
  label: 'Linha de barras ou de nós',
  group: 'Gerar',
  description:
    'Cria n trechos iguais entre dois pontos (tabuleiro, torre, pilar). Com dois nós selecionados, as coordenadas já vêm deles.',
  params: [
    { key: 'x1', label: 'Início — x', unit: 'm', kind: 'number', default: 0 },
    { key: 'y1', label: 'Início — y', unit: 'm', kind: 'number', default: 0 },
    { key: 'z1', label: 'Início — z', unit: 'm', kind: 'number', default: 0 },
    { key: 'x2', label: 'Fim — x', unit: 'm', kind: 'number', default: 60 },
    { key: 'y2', label: 'Fim — y', unit: 'm', kind: 'number', default: 0 },
    { key: 'z2', label: 'Fim — z', unit: 'm', kind: 'number', default: 0 },
    { key: 'n', label: 'Número de trechos', kind: 'int', default: 6 },
    { key: 'what', label: 'Criar', kind: 'select', default: 'frames', options: [{ value: 'frames', label: 'Barras' }, { value: 'nodes', label: 'Só os nós' }] },
    { key: 'group', label: 'Grupo das barras', kind: 'select', default: 'deck', options: FRAME_GROUPS },
    { key: 'sec', label: 'Seção', kind: 'select', default: '', optionsFor: sections },
    { key: 'mat', label: 'Material', kind: 'select', default: '', optionsFor: frameMaterials },
  ],
  enabled: (model, sel) => {
    if (sel.nodes.length === 2) {
      const a = model.nodes.find((n) => n.id === sel.nodes[0])
      const b = model.nodes.find((n) => n.id === sel.nodes[1])
      if (a && b) {
        const set = (k: string, v: number): void => {
          const p = line.params.find((q) => q.key === k)
          if (p) p.default = v
        }
        set('x1', a.x); set('y1', a.y); set('z1', a.z)
        set('x2', b.x); set('y2', b.y); set('z2', b.z)
      }
    }
    return true
  },
  run: (model, _sel, v) => {
    const a: P3 = [num(v, 'x1'), num(v, 'y1'), num(v, 'z1')]
    const b: P3 = [num(v, 'x2'), num(v, 'y2'), num(v, 'z2')]
    const n = num(v, 'n')
    if (str(v, 'what') === 'nodes') return nodeLine(model, a, b, n)
    const sec = str(v, 'sec')
    const mat = str(v, 'mat')
    if (!sec || !mat) return 'O modelo ainda não tem seção ou material: adicione na aba Biblioteca (grupo Dados).'
    return nodeLine(model, a, b, n, { mat, sec, group: str(v, 'group') as ElementGroup })
  },
})

const stays: EditAction = act({
  key: 'stays',
  label: 'Estais',
  group: 'Gerar',
  description:
    'Selecione os nós (ou barras) do tabuleiro que recebem estai e os nós (ou barras) da torre acima do tabuleiro. ' +
    'De cada lado da torre, a ancoragem mais distante liga ao ponto mais alto. Leque: todos no nó mais alto selecionado; ' +
    'semi-leque e harpa: as ancoragens na torre são criadas dividindo as barras dela; pares: usa só os nós de torre selecionados. ' +
    'Com várias torres, cada ancoragem vai para a mais próxima. Os comprimentos dos estais saem do form-finding.',
  params: [
    {
      key: 'layout', label: 'Arranjo', kind: 'select', default: 'semi-fan',
      options: [
        { value: 'fan', label: 'Leque — todos no topo' },
        { value: 'semi-fan', label: 'Semi-leque — ancoragens espaçadas a partir do topo' },
        { value: 'harp', label: 'Harpa — estais paralelos' },
        { value: 'pair', label: 'Pares — só os nós de torre selecionados' },
      ],
    },
    { key: 'spacing', label: 'Espaçamento na torre (semi-leque)', unit: 'm', kind: 'number', default: 2 },
    { key: 'mat', label: 'Material do cabo', kind: 'select', default: '', optionsFor: cableMaterials },
    { key: 'strands', label: 'Cordoalhas por estai', kind: 'int', default: 30, hint: 'A análise redimensiona para ELS e ELU (só aumenta)' },
    {
      key: 'strandArea', label: 'Cordoalha', kind: 'select', default: '150',
      options: [
        { value: '150', label: 'Ø15,7 mm — 150 mm²' },
        { value: '140', label: 'Ø15,2 mm — 140 mm²' },
        { value: '98.7', label: 'Ø12,7 mm — 98,7 mm²' },
      ],
    },
  ],
  enabled: (model, sel) => {
    if (!model.materials.length) return 'Adicione um material de cabo (aba Biblioteca).'
    if (selectionNodes(model, sel).length < 2) return 'Selecione os nós do tabuleiro e os da torre.'
    return true
  },
  run: (model, sel, v) =>
    generateStays(model, sel, {
      layout: str(v, 'layout') as 'fan' | 'semi-fan' | 'harp' | 'pair',
      spacing: num(v, 'spacing', 2),
      mat: str(v, 'mat'),
      strands: Math.round(num(v, 'strands', 30)),
      strandArea: num(v, 'strandArea', 150) * 1e-6,
    }),
})

const hangers: EditAction = act({
  key: 'hangers',
  label: 'Pendurais',
  group: 'Gerar',
  description:
    'Selecione os nós do tabuleiro e os nós do arco (ou do cabo principal) acima deles: cada nó do tabuleiro é ligado ao nó que está na mesma vertical.',
  params: [
    { key: 'mat', label: 'Material do cabo', kind: 'select', default: '', optionsFor: cableMaterials },
    { key: 'A', label: 'Área de cada pendural', unit: 'mm²', kind: 'number', default: 3000 },
    { key: 'tol', label: 'Tolerância em planta', unit: 'm', kind: 'number', default: 0.1 },
  ],
  enabled: (model, sel) => {
    if (!model.materials.length) return 'Adicione um material de cabo (aba Biblioteca).'
    if (selectionNodes(model, sel).length < 2) return 'Selecione os nós de baixo e os de cima.'
    return true
  },
  run: (model, sel, v) => generateHangers(model, sel, { mat: str(v, 'mat'), A: num(v, 'A', 3000) * 1e-6, tol: num(v, 'tol', 0.1) }),
})

const autoLane: EditAction = {
  key: 'auto-lanes',
  label: 'Pista automática',
  group: 'Gerar',
  description: 'Cria as pistas de carga móvel seguindo as barras do grupo Tabuleiro e atualiza os vãos usados no coeficiente de impacto.',
  params: [],
  enabled: (model) => (model.elements.some((e) => e.kind === 'frame' && e.group === 'deck') ? true : 'Não há barras do grupo Tabuleiro.'),
  run: (model) => applyAutoLanes(model),
}

/* ------------------------------------------------------------------ transformar */

const delta: EditParam[] = [
  { key: 'dx', label: 'Δx', unit: 'm', kind: 'number', default: 0 },
  { key: 'dy', label: 'Δy', unit: 'm', kind: 'number', default: 0 },
  { key: 'dz', label: 'Δz', unit: 'm', kind: 'number', default: 0 },
]
const dOf = (v: EditValues): P3 => [num(v, 'dx'), num(v, 'dy'), num(v, 'dz')]
const needSel = (model: BridgeModel, sel: EditSelection): true | string => (hasNodes(model, sel) ? true : 'Selecione nós ou elementos.')

const move: EditAction = {
  key: 'move',
  label: 'Mover',
  group: 'Transformar',
  description: 'Desloca os nós selecionados (e os nós dos elementos selecionados).',
  params: delta.map((p) => ({ ...p })),
  enabled: needSel,
  run: (model, sel, v) => {
    const ids = selectionNodes(model, sel)
    const d = dOf(v)
    if (Math.hypot(d[0], d[1], d[2]) < 1e-9) return 'Informe um deslocamento diferente de zero.'
    const r = translateNodes(model, ids, d)
    return typeof r === 'string' ? r : { model: r, select: sel, message: `${ids.length} nó(s) movidos` }
  },
}

const copy: EditAction = {
  key: 'copy',
  label: 'Copiar e repetir',
  group: 'Transformar',
  description: 'Copia a seleção com o passo dado, uma ou várias vezes (cópia k fica a k·Δ). Nós que coincidirem com existentes são reaproveitados.',
  params: [...delta.map((p) => ({ ...p })), { key: 'times', label: 'Número de cópias', kind: 'int', default: 1 }],
  enabled: needSel,
  run: (model, sel, v) => copySelection(model, sel, dOf(v), Math.round(num(v, 'times', 1))),
}

const mirror: EditAction = {
  key: 'mirror',
  label: 'Espelhar',
  group: 'Transformar',
  description: 'Espelha a seleção em relação a um plano. Para espelhar meia ponte, use o plano transversal na posição da torre ou do meio do vão.',
  params: [
    {
      key: 'plane', label: 'Plano de espelhamento', kind: 'select', default: 'x',
      options: [
        { value: 'x', label: 'Transversal: x = posição' },
        { value: 'y', label: 'Longitudinal: y = posição' },
        { value: 'z', label: 'Horizontal: z = posição' },
      ],
    },
    { key: 'at', label: 'Posição do plano', unit: 'm', kind: 'number', default: 0 },
    { key: 'copy', label: 'Manter o original (criar cópia)', kind: 'bool', default: true },
  ],
  enabled: needSel,
  run: (model, sel, v) => mirrorSelection(model, sel, str(v, 'plane') as 'x' | 'y' | 'z', num(v, 'at'), bool(v, 'copy')),
}

const rotate: EditAction = {
  key: 'rotate',
  label: 'Girar em planta',
  group: 'Transformar',
  description: 'Gira a seleção em torno de um eixo vertical (ângulo positivo no sentido anti-horário, visto de cima).',
  params: [
    { key: 'cx', label: 'Centro — x', unit: 'm', kind: 'number', default: 0 },
    { key: 'cy', label: 'Centro — y', unit: 'm', kind: 'number', default: 0 },
    { key: 'angle', label: 'Ângulo', unit: '°', kind: 'number', default: 90 },
    { key: 'copy', label: 'Manter o original (criar cópia)', kind: 'bool', default: false },
  ],
  enabled: needSel,
  run: (model, sel, v) => rotateSelection(model, sel, [num(v, 'cx'), num(v, 'cy')], num(v, 'angle'), bool(v, 'copy')),
}

const needFrames = (model: BridgeModel, sel: EditSelection): true | string => (frameIds(model, sel).length ? true : 'Selecione ao menos uma barra.')

const divideN: EditAction = {
  key: 'divide-n',
  label: 'Dividir em n partes',
  group: 'Transformar',
  description: 'Divide cada barra selecionada em n trechos iguais, criando os nós intermediários (pistas e cargas acompanham).',
  params: [{ key: 'n', label: 'Número de partes', kind: 'int', default: 2 }],
  enabled: needFrames,
  run: (model, sel, v) => divideFrames(model, frameIds(model, sel), Math.round(num(v, 'n', 2))),
}

const divideS: EditAction = {
  key: 'divide-spacing',
  label: 'Dividir por espaçamento',
  group: 'Transformar',
  description: 'Divide cada barra selecionada em trechos iguais com o comprimento mais próximo do espaçamento dado (ex.: tabuleiro a cada 10 m para ancorar os estais).',
  params: [{ key: 'spacing', label: 'Espaçamento', unit: 'm', kind: 'number', default: 10 }],
  enabled: needFrames,
  run: (model, sel, v) => divideAtSpacing(model, frameIds(model, sel), num(v, 'spacing', 10)),
}

/* ------------------------------------------------------------------ atribuir */

const needEls = (_m: BridgeModel, sel: EditSelection): true | string => (sel.elements.length ? true : 'Selecione elementos.')

const assignGroup: EditAction = {
  key: 'assign-group',
  label: 'Grupo',
  group: 'Atribuir',
  description: 'Define o papel estrutural dos elementos selecionados. O grupo comanda o form-finding (estais e pendurais), a pista (tabuleiro) e as verificações.',
  params: [{ key: 'group', label: 'Grupo', kind: 'select', default: 'deck', options: ALL_GROUPS }],
  enabled: needEls,
  run: (model, sel, v) => {
    const g = str(v, 'group') as ElementGroup
    const ids = new Set(sel.elements)
    const picked = model.elements.filter((e) => ids.has(e.id))
    const cableGroup = CABLE_GROUPS.has(g)
    const wrong = picked.filter((e) => (e.kind === 'cable') !== cableGroup)
    if (wrong.length === picked.length) return cableGroup ? 'Este grupo é de cabos: selecione cabos.' : 'Este grupo é de barras: selecione barras.'
    const ok = picked.filter((e) => (e.kind === 'cable') === cableGroup).map((e) => e.id)
    const r = assign(model, { nodes: [], elements: ok }, { group: g })
    if (typeof r === 'string') return r
    return { ...r, select: sel, message: `${r.message}${wrong.length ? ` (${wrong.length} ignorado(s): tipo diferente)` : ''}` }
  },
}

const assignSection: EditAction = act({
  key: 'assign-section',
  label: 'Seção',
  group: 'Atribuir',
  description: 'Troca a seção das barras selecionadas.',
  params: [{ key: 'sec', label: 'Seção', kind: 'select', default: '', optionsFor: sections }],
  enabled: (model, sel) => (!model.sections.length ? 'O modelo não tem seções (aba Biblioteca).' : needFrames(model, sel)),
  run: (model, sel, v) => need(assign(model, { nodes: [], elements: frameIds(model, sel) }, { sec: str(v, 'sec') })),
})

const assignMaterial: EditAction = act({
  key: 'assign-material',
  label: 'Material',
  group: 'Atribuir',
  description: 'Troca o material dos elementos selecionados.',
  params: [{ key: 'mat', label: 'Material', kind: 'select', default: '', optionsFor: allMaterials }],
  enabled: (model, sel) => (!model.materials.length ? 'O modelo não tem materiais (aba Biblioteca).' : needEls(model, sel)),
  run: (model, sel, v) => assign(model, sel, { mat: str(v, 'mat') }),
})

const supports: EditAction = {
  key: 'supports',
  label: 'Apoios',
  group: 'Atribuir',
  description: 'Aplica um tipo de apoio aos nós selecionados (substitui as restrições que eles tinham).',
  params: [{ key: 'type', label: 'Tipo de apoio', kind: 'select', default: 'fixed', options: SUPPORTS.map(({ value, label }) => ({ value, label })) }],
  enabled: (_m, sel) => (sel.nodes.length ? true : 'Selecione nós.'),
  run: (model, sel, v) => {
    const s = SUPPORTS.find((x) => x.value === str(v, 'type'))
    if (!s) return 'Tipo de apoio desconhecido.'
    return assign(model, { nodes: sel.nodes, elements: [] }, { fix: s.fix })
  },
}

/* ------------------------------------------------------------------ limpar */

const merge: EditAction = {
  key: 'merge',
  label: 'Unir nós coincidentes',
  group: 'Limpar',
  description: 'Funde nós que estão no mesmo lugar (dentro da tolerância) e remove elementos de comprimento nulo ou duplicados.',
  params: [{ key: 'tol', label: 'Tolerância', unit: 'mm', kind: 'number', default: 1 }],
  enabled: () => true,
  run: (model, _sel, v) => {
    const tol = num(v, 'tol', 1) / 1000
    if (!(tol > 0)) return 'A tolerância deve ser positiva.'
    const r = mergeCoincidentNodes(model, tol)
    if (r.merged === 0 && r.removedElements === 0) return `Não há nós a menos de ${fmt(tol * 1000)} mm um do outro.`
    return { model: r.model, select: { nodes: [], elements: [] }, message: `${r.merged} nó(s) unidos${r.removedElements ? ` e ${r.removedElements} elemento(s) removidos` : ''}` }
  },
}

const del: EditAction = {
  key: 'delete',
  label: 'Apagar seleção',
  group: 'Limpar',
  description: 'Apaga os elementos e os nós selecionados. Um nó ainda usado por elemento não selecionado não é apagado.',
  params: [{ key: 'orphans', label: 'Apagar também as extremidades que ficarem soltas', kind: 'bool', default: true }],
  enabled: (_m, sel) => (sel.nodes.length || sel.elements.length ? true : 'Nada selecionado.'),
  run: (model, sel, v) => deleteSelection(model, sel, v.orphans === undefined ? true : bool(v, 'orphans')),
}

const loose: EditAction = {
  key: 'loose',
  label: 'Remover nós soltos',
  group: 'Limpar',
  description: 'Remove os nós que não pertencem a nenhum elemento.',
  params: [],
  enabled: () => true,
  run: (model) => removeLooseNodes(model),
}

const renum: EditAction = {
  key: 'renumber',
  label: 'Renumerar',
  group: 'Limpar',
  description: 'Renumera os nós por x, y e z e os elementos de 1 em diante.',
  params: [],
  enabled: (model) => (model.nodes.length ? true : 'Modelo vazio.'),
  run: (model) => renumber(model),
}

export const EDIT_ACTIONS: EditAction[] = [
  line, stays, hangers, autoLane,
  move, copy, mirror, rotate, divideN, divideS,
  assignGroup, assignSection, assignMaterial, supports,
  merge, del, loose, renum,
]

/** ação pelo identificador (usado pelo diagnóstico p/ "Corrigir") */
export const editAction = (key: string): EditAction | undefined => EDIT_ACTIONS.find((a) => a.key === key)

/** valores padrão de uma ação p/ o modelo atual */
export function defaultValues(a: EditAction, model: BridgeModel, sel: EditSelection = { nodes: [], elements: [] }): EditValues {
  a.enabled(model, sel)
  const out: EditValues = {}
  for (const p of a.params) out[p.key] = p.default
  return out
}
