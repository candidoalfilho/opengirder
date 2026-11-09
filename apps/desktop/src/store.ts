import { create } from 'zustand'
import {
  applyCableL0,
  generateModel,
  validateModel,
  type AnalysisOptions,
  type BridgeModel,
  type BridgeResults,
  type Preset,
  type TemplateParams,
} from '@opengirder/engine'
import type { AnalysisMessage, AnalysisRequest } from './workers/analysis.worker'

export type Screen = 'start' | 'wizard' | 'workspace'
export type ViewMode = 'model' | 'deformed' | 'cables' | 'diagram' | 'mode' | 'custom'
export type DiagramKind = 'Mz' | 'Vy' | 'N'
export type CableColorBy = 'T' | 'els'
/** chave da aba do painel direito — ver panels/registry.tsx */
export type RightTab = string
export type Theme = 'dark' | 'light'

export interface Selection {
  kind: 'element' | 'node'
  id: number
}

export interface ViewState {
  mode: ViewMode
  diagram: DiagramKind
  cableBy: CableColorBy
  /** multiplicador sobre a escala automática (deformada, diagramas, modos) */
  scaleMul: number
  modeIndex: number
  showNodes: boolean
  /** grupos de elementos ocultos */
  hidden: string[]
}

/**
 * Campo de deslocamentos qualquer p/ mostrar no 3D (modo de flambagem, caso de carga,
 * fase construtiva…). Ativado por `showOverlay`, que põe a vista no modo 'custom'.
 */
export interface Overlay {
  /** título mostrado na legenda */
  label: string
  /** deslocamentos (6 por nó, ordem de model.nodes) */
  u: number[]
  /** true = anima como um modo de vibração (forma normalizada); false = deformada estática */
  animate: boolean
  /** ids de elementos a esconder (ex.: ainda não montados na fase) */
  hideElements?: number[]
  /** texto livre na legenda (ex.: "λ = 4,2") */
  note?: string
}

export interface UiOptions {
  formFinding: boolean
  /** pré-dimensiona o nº de cordoalhas dos estais (ELS/ELU) e reanalisa */
  sizeCables: boolean
  nonlinear: boolean
  modal: boolean
  modes: number
  moving: boolean
  vehicle: 'TB-450' | 'TB-240' | 'Pedestres'
  /** fases construtivas de estaiadas (análise regressiva) */
  stages: boolean
  /** carga de equipamento na ponta de cada balanço durante a execução (kN) */
  stageEquipment: number
}

export interface AnalysisStatus {
  running: boolean
  stage: string
  fraction: number
  error: string | null
  /** duração total da última análise (ms), medida no worker */
  elapsed: number | null
}

export interface Toast {
  text: string
  kind: 'info' | 'err'
  key: number
}

interface State {
  screen: Screen
  theme: Theme
  model: BridgeModel | null
  results: BridgeResults | null
  /** erros de validação do modelo atual (bloqueiam a análise) */
  modelErrors: string[]
  filePath: string | null
  dirty: boolean
  /** muda quando um modelo NOVO é carregado (reenquadra a câmera) */
  fitKey: number
  wizard: TemplateParams | null
  selection: Selection | null
  view: ViewState
  options: UiOptions
  analysis: AnalysisStatus
  rightTab: RightTab
  overlay: Overlay | null
  /** pilhas de desfazer/refazer do modelo (até 30 estados) */
  past: BridgeModel[]
  future: BridgeModel[]
  toast: Toast | null

  /** altera o modelo (dados de entrada): marca como modificado e descarta os resultados */
  updateModel: (fn: (m: BridgeModel) => BridgeModel) => void
  /** desfaz / refaz a última edição do modelo feita por `updateModel` */
  undo: () => void
  redo: () => void
  /** mostra um campo de deslocamentos no 3D (null volta à vista do modelo) */
  showOverlay: (o: Overlay | null) => void
  setTheme: (t: Theme) => void
  goStart: () => void
  openWizard: (t: TemplateParams) => void
  closeWizard: () => void
  loadModel: (m: BridgeModel, filePath?: string | null) => void
  loadPreset: (p: Preset) => void
  applyWizard: (t: TemplateParams) => void
  renameModel: (name: string) => void
  setFilePath: (p: string | null) => void
  markSaved: () => void
  select: (s: Selection | null) => void
  setView: (patch: Partial<ViewState>) => void
  toggleGroup: (g: string) => void
  setOptions: (patch: Partial<UiOptions>) => void
  setRightTab: (t: RightTab) => void
  showMode: (index: number) => void
  runAnalysis: () => void
  cancelAnalysis: () => void
  notify: (text: string, kind?: 'info' | 'err') => void
}

const DEFAULT_VIEW: ViewState = {
  mode: 'model',
  diagram: 'Mz',
  cableBy: 'T',
  scaleMul: 1,
  modeIndex: 0,
  showNodes: false,
  hidden: [],
}

const IDLE: AnalysisStatus = { running: false, stage: '', fraction: 0, error: null, elapsed: null }

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('opengirder:theme')
    if (t === 'light' || t === 'dark') return t
  } catch {
    /* armazenamento indisponível: segue no padrão */
  }
  return 'dark'
}

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
}

/** garante `template` e `meta.reference` no modelo gerado, sem alterar o que o engine já preencheu */
function withTemplate(model: BridgeModel, t: TemplateParams, reference?: Preset['reference']): BridgeModel {
  const out: BridgeModel = { ...model }
  if (!out.template) out.template = { kind: t.kind, params: t.params }
  if (reference && reference.length && !out.meta?.reference?.length) {
    out.meta = { ...out.meta, reference }
  }
  return out
}

function safeValidate(model: BridgeModel): string[] {
  try {
    return validateModel(model)
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)]
  }
}

function toEngineOptions(o: UiOptions): AnalysisOptions {
  return {
    formFinding: o.formFinding,
    sizeCables: o.sizeCables && o.moving && o.formFinding,
    nonlinear: o.nonlinear,
    modal: o.modal ? { modes: Math.max(1, Math.round(o.modes)) } : false,
    moving: o.moving ? { vehicle: o.vehicle } : false,
    stages: o.stages ? { equipment: Math.max(0, o.stageEquipment || 0) } : false,
  }
}

let worker: Worker | null = null
let toastKey = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

function stopWorker() {
  if (worker) {
    worker.terminate()
    worker = null
  }
}

export const useStore = create<State>((set, get) => {
  const theme = initialTheme()
  applyTheme(theme)

  const freshModel = (model: BridgeModel, filePath: string | null, dirty: boolean) => {
    stopWorker()
    set((s) => ({
      screen: 'workspace',
      model,
      results: null,
      modelErrors: safeValidate(model),
      filePath,
      dirty,
      fitKey: s.fitKey + 1,
      wizard: null,
      selection: null,
      view: { ...DEFAULT_VIEW },
      analysis: IDLE,
      rightTab: 'summary',
      overlay: null,
      past: [],
      future: [],
      // carga móvel de projeto do modelo (passarelas: pedestres); sem indicação, volta ao trem-tipo rodoviário
      options: {
        ...s.options,
        vehicle: model.meta?.liveLoad ?? (s.options.vehicle === 'Pedestres' ? 'TB-450' : s.options.vehicle),
      },
    }))
  }

  return {
    screen: 'start',
    theme,
    model: null,
    results: null,
    modelErrors: [],
    filePath: null,
    dirty: false,
    fitKey: 0,
    wizard: null,
    selection: null,
    view: { ...DEFAULT_VIEW },
    options: { formFinding: true, sizeCables: true, nonlinear: true, modal: true, modes: 12, moving: true, stages: false, stageEquipment: 0, vehicle: 'TB-450' },
    analysis: IDLE,
    rightTab: 'summary',
    overlay: null,
    past: [],
    future: [],
    toast: null,

    updateModel: (fn) => {
      const cur = get().model
      if (!cur) return
      const model = fn(cur)
      if (model === cur) return
      stopWorker()
      set((s) => ({
        model,
        results: null,
        modelErrors: safeValidate(model),
        dirty: true,
        analysis: IDLE,
        overlay: null,
        past: [...s.past, cur].slice(-30),
        future: [],
        view: { ...s.view, mode: 'model' },
      }))
    },

    undo: () => {
      const { past, future, model: cur } = get()
      const prev = past[past.length - 1]
      if (!prev || !cur) return
      stopWorker()
      set((s) => ({
        model: prev,
        past: past.slice(0, -1),
        future: [cur, ...future].slice(0, 30),
        results: null,
        modelErrors: safeValidate(prev),
        dirty: true,
        analysis: IDLE,
        overlay: null,
        selection: null,
        view: { ...s.view, mode: 'model' },
      }))
    },

    redo: () => {
      const { past, future, model: cur } = get()
      const next = future[0]
      if (!next || !cur) return
      stopWorker()
      set((s) => ({
        model: next,
        past: [...past, cur].slice(-30),
        future: future.slice(1),
        results: null,
        modelErrors: safeValidate(next),
        dirty: true,
        analysis: IDLE,
        overlay: null,
        selection: null,
        view: { ...s.view, mode: 'model' },
      }))
    },

    showOverlay: (o) =>
      set((s) => ({ overlay: o, view: { ...s.view, mode: o ? 'custom' : s.view.mode === 'custom' ? 'model' : s.view.mode } })),

    setTheme: (t) => {
      applyTheme(t)
      try {
        localStorage.setItem('opengirder:theme', t)
      } catch {
        /* sem persistência */
      }
      set({ theme: t })
    },

    goStart: () => {
      stopWorker()
      set({ screen: 'start', wizard: null, analysis: IDLE })
    },

    openWizard: (t) => set({ screen: 'wizard', wizard: t }),

    closeWizard: () => set((s) => ({ screen: s.model ? 'workspace' : 'start', wizard: null })),

    loadModel: (m, filePath = null) => freshModel(m, filePath, false),

    loadPreset: (p) => {
      const model = withTemplate(generateModel(p.template), p.template, p.reference)
      freshModel(model, null, false)
    },

    applyWizard: (t) => {
      const model = withTemplate(generateModel(t), t)
      // mantém as referências do modelo anterior quando só os parâmetros mudaram
      const prev = get().model
      if (prev?.meta?.reference?.length && !model.meta?.reference?.length && prev.template?.kind === t.kind) {
        model.meta = { ...model.meta, reference: prev.meta.reference }
      }
      const path = get().filePath
      freshModel(model, path, true)
    },

    renameModel: (name) =>
      set((s) => (s.model ? { model: { ...s.model, name }, dirty: true } : {})),

    setFilePath: (p) => set({ filePath: p }),
    markSaved: () => set({ dirty: false }),

    select: (sel) => set({ selection: sel }),

    setView: (patch) =>
      set((s) => ({
        view: { ...s.view, ...patch },
        overlay: patch.mode && patch.mode !== 'custom' ? null : s.overlay,
      })),

    toggleGroup: (g) =>
      set((s) => {
        const hidden = s.view.hidden.includes(g) ? s.view.hidden.filter((x) => x !== g) : [...s.view.hidden, g]
        return { view: { ...s.view, hidden } }
      }),

    setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),

    setRightTab: (t) => set({ rightTab: t }),

    showMode: (index) => set((s) => ({ view: { ...s.view, mode: 'mode', modeIndex: index } })),

    runAnalysis: () => {
      const { model, options } = get()
      if (!model) return
      const errors = safeValidate(model)
      if (errors.length) {
        set({ modelErrors: errors, analysis: { ...IDLE, error: 'O modelo tem erros de validação — veja a aba Resumo.' }, rightTab: 'summary' })
        return
      }
      stopWorker()
      const w = new Worker(new URL('./workers/analysis.worker.ts', import.meta.url), { type: 'module' })
      worker = w
      set({ analysis: { running: true, stage: 'Preparando', fraction: 0, error: null, elapsed: null } })
      w.onmessage = (e: MessageEvent<AnalysisMessage>) => {
        if (worker !== w) return
        const msg = e.data
        if (msg.type === 'progress') {
          set((s) => ({ analysis: { ...s.analysis, stage: msg.stage, fraction: Math.max(0, Math.min(1, msg.fraction)) } }))
          return
        }
        stopWorker()
        if (msg.type === 'error') {
          set({ analysis: { ...IDLE, error: msg.error } })
          return
        }
        const current = get().model
        if (!current) return
        const results = msg.results
        // guarda no modelo os L0 do form-finding: a próxima análise (e o arquivo salvo) partem deles
        let next = current
        let dirty = get().dirty
        if (results.formFinding && results.cableL0?.length) {
          try {
            next = applyCableL0(current, results.cableL0)
            dirty = true
          } catch {
            next = current
          }
        }
        const nModes = results.modal?.modes.length ?? 0
        set((s) => ({
          model: next,
          results,
          overlay: null,
          dirty,
          analysis: { ...IDLE, elapsed: msg.elapsed },
          view: {
            ...s.view,
            modeIndex: Math.min(s.view.modeIndex, Math.max(0, nModes - 1)),
            mode: s.view.mode === 'custom' || (s.view.mode === 'mode' && nModes === 0) ? 'model' : s.view.mode,
          },
        }))
      }
      w.onerror = (e) => {
        if (worker !== w) return
        stopWorker()
        set({ analysis: { ...IDLE, error: e.message || 'Falha inesperada no motor de cálculo.' } })
      }
      const req: AnalysisRequest = { model, options: toEngineOptions(options) }
      w.postMessage(req)
    },

    cancelAnalysis: () => {
      stopWorker()
      set((s) => ({ analysis: { ...IDLE, elapsed: s.analysis.elapsed } }))
    },

    notify: (text, kind = 'info') => {
      if (toastTimer) clearTimeout(toastTimer)
      const key = ++toastKey
      set({ toast: { text, kind, key } })
      toastTimer = setTimeout(() => {
        if (get().toast?.key === key) set({ toast: null })
      }, kind === 'err' ? 6000 : 2600)
    },
  }
})
