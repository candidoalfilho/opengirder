/**
 * Contrato do editor gráfico (modelagem do zero).
 *
 *  - O estado de edição (ferramenta, plano de trabalho, seleção múltipla) vive no store.
 *  - As OPERAÇÕES de modelagem são funções puras registradas em `EDIT_ACTIONS`
 *    (editor/actions.ts): recebem o modelo e a seleção e devolvem o modelo novo. A interface
 *    desenha o menu e o formulário de parâmetros a partir do registro, sem conhecer cada uma.
 */

import type { BridgeModel, ElementGroup } from '@opengirder/engine'

/** seleção múltipla do editor: ids de nós e de elementos (barras e cabos) */
export interface EditSelection {
  nodes: number[]
  elements: number[]
}

export const EMPTY_SELECTION: EditSelection = { nodes: [], elements: [] }

export type EditTool = 'select' | 'node' | 'frame' | 'cable' | 'move'

/**
 * Plano de trabalho onde os cliques criam pontos:
 *  'elevation' = plano X–Z em y = offset; 'plan' = plano X–Y em z = offset;
 *  'cross' = plano Y–Z em x = offset.
 */
export interface WorkPlane {
  kind: 'elevation' | 'plan' | 'cross'
  offset: number
}

/** o que os elementos novos recebem ao serem desenhados */
export interface EditDefaults {
  frameMat: string
  frameSec: string
  frameGroup: ElementGroup
  cableMat: string
  cableGroup: ElementGroup
  /** área do cabo (m²) e nº de cordoalhas (0 = não informado) */
  cableA: number
  cableStrands: number
}

export interface EditState {
  /** modo de edição ligado (mostra nós, plano de trabalho e barra de ferramentas) */
  active: boolean
  tool: EditTool
  plane: WorkPlane
  /** passo da malha de captura (m); 0 = sem captura na malha (só em nós existentes) */
  snap: number
  sel: EditSelection
  defaults: EditDefaults
}

/* ------------------------------------------------------------------ operações */

export interface EditParam {
  key: string
  label: string
  unit?: string
  kind: 'number' | 'int' | 'select' | 'bool' | 'text'
  default: number | string | boolean
  options?: { value: string; label: string }[]
  hint?: string
}

export type EditValues = Record<string, number | string | boolean>

export interface EditActionResult {
  model: BridgeModel
  /** nova seleção (ex.: os elementos criados) */
  select?: EditSelection
  /** mensagem curta p/ o toast ("12 estais criados") */
  message?: string
}

export interface EditAction {
  key: string
  label: string
  /** grupo do menu */
  group: 'Gerar' | 'Transformar' | 'Atribuir' | 'Limpar'
  /** uma frase: o que faz e o que precisa estar selecionado */
  description: string
  params: EditParam[]
  /** true se pode rodar com a seleção atual; senão o motivo (mostrado desabilitado) */
  enabled: (model: BridgeModel, sel: EditSelection) => true | string
  /** devolve o resultado ou uma mensagem de erro */
  run: (model: BridgeModel, sel: EditSelection, values: EditValues) => EditActionResult | string
}
