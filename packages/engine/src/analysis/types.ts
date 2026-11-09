/**
 * Resultados de análise — objetos puros, JSON-serializáveis (vão do Web Worker p/ UI).
 *
 * Indexação: arrays "por nó" seguem a ORDEM de `model.nodes` (índice, não id).
 * Deslocamentos `u` são planos: u[6*i + d], d = ux, uy, uz, rx, ry, rz.
 */

/** Esforços de barra em 3 estações (início, meio, fim). Convenções:
 *  N tração +; Mz > 0 traciona a fibra inferior do tabuleiro (y local p/ cima);
 *  Vy, Vz, T, My conforme diagramas do HyperFrame (ver analysis/frame.ts). */
export interface FrameForces {
  id: number
  L: number
  N: [number, number, number]
  Vy: [number, number, number]
  Vz: [number, number, number]
  T: [number, number, number]
  My: [number, number, number]
  Mz: [number, number, number]
}

export interface CableForces {
  id: number
  /** tração na extremidade n1 / n2 (kN) */
  Ti: number
  Tj: number
  /** componente horizontal (kN) */
  H: number
  /** comprimento indeformado usado (m) */
  L0: number
  /** comprimento da corda deformada (m) */
  chord: number
  /** flecha vertical abaixo da corda, no meio do vão (m) — aproximação parabólica */
  sag: number
  slack: boolean
}

export interface Reaction {
  node: number
  R: [number, number, number, number, number, number]
}

export interface StaticState {
  converged: boolean
  iterations: number
  /** nº de passos de carga (a carga permanente é aplicada de uma vez: sempre 1) */
  loadSteps: number
  /** norma do resíduo final (kN) */
  residual: number
  u: number[]
  frames: FrameForces[]
  cables: CableForces[]
  reactions: Reaction[]
}

export interface FormFindingResult {
  converged: boolean
  iterations: number
  /** maior deslocamento remanescente nos pontos-alvo (m), por iteração */
  history: number[]
  /** deslocamento residual final (m) */
  residual: number
  /** nº de cabos ajustados e de alvos */
  nUnknowns: number
  nTargets: number
}

export type ModeKind = 'vertical' | 'transversal' | 'longitudinal' | 'torcional' | 'misto'

export interface Mode {
  index: number
  period: number
  frequency: number
  /** forma modal normalizada: maior translação = 1 (u plano, 6 por nó) */
  shape: number[]
  /** massa modal efetiva em % da massa total, nas direções X, Y, Z */
  massPct: [number, number, number]
  kind: ModeKind
}

export interface ModalResult {
  modes: Mode[]
  totalMass: number
  iterations: number
  converged: boolean
}

/** envoltória de uma grandeza: [mín, máx] nas 3 estações */
export interface Env3 {
  min: [number, number, number]
  max: [number, number, number]
}

export interface MovingLoadResult {
  vehicle: 'TB-450' | 'TB-240'
  /** coeficientes NBR 7188 aplicados */
  CIV: number
  CNF: number
  CIA: number
  Liv: number
  lanes: string[]
  /** carga por eixo já reduzida da distribuída sob o veículo (kN) e distribuída (kN/m) */
  axleLoad: number
  axleSpacing: number
  nAxles: number
  distributed: number
  /** envoltórias de esforços (só carga móvel, já com coeficientes) */
  frames: { id: number; Mz: Env3; Vy: Env3; N: Env3; T: Env3; My: Env3 }[]
  /** variação de tração nos cabos (kN) */
  cables: { id: number; min: number; max: number }[]
  /** deslocamento vertical por nó (m): mín/máx (índice do nó) */
  uzMin: number[]
  uzMax: number[]
  /** linhas de influência amostradas p/ inspeção: cada uma com estacas e ordenadas */
  influence: { label: string; s: number[]; eta: number[] }[]
}

export interface CableCheck {
  id: number
  group: string
  /** tração permanente (kN) */
  TG: number
  /** máx. variação por carga móvel (kN) */
  dTQ: number
  /** ELS característica: TG + ΔTQ */
  Tels: number
  /** ELU: 1,35·TG + 1,5·ΔTQ */
  Telu: number
  /** resistência à tração do cabo A·fpk (kN) */
  Fu: number
  /** ELS / (0,45·Fu) — limite usual fib Bulletin 30 / PTI DC45.1 */
  ratioEls: number
  /** ELU / (0,65·Fu) — φ = 0,65 (PTI DC45.1) */
  ratioElu: number
  /** faixa de tensão p/ fadiga, ΔσQ (MPa) */
  dSigma: number
  ok: boolean
}

export interface BridgeResults {
  nNodes: number
  nElements: number
  nDofs: number
  formFinding?: FormFindingResult
  deadLoad: StaticState
  modal?: ModalResult
  moving?: MovingLoadResult
  checks: { cables: CableCheck[] }
  /** L0 finais por cabo (aplicar no modelo p/ reaproveitar o form-finding); com `sizeCables`,
   *  traz também a área e o nº de cordoalhas redimensionados */
  cableL0: { id: number; L0: number; A?: number; strands?: number }[]
  warnings: string[]
  timings: Record<string, number>
}

export interface AnalysisOptions {
  /** ajusta L0 de estais/pendurais p/ deslocamento nulo do tabuleiro sob carga permanente */
  formFinding?: boolean
  /** não linearidade geométrica (cabos de catenária + corrotacional) — padrão true */
  nonlinear?: boolean
  /** pré-dimensiona os estais (nº de cordoalhas) p/ ELS 0,45·Fu e ELU 0,65·Fu e reanalisa;
   *  só aumenta. Exige carga móvel. */
  sizeCables?: boolean
  modal?: { modes: number } | false
  moving?: { vehicle: 'TB-450' | 'TB-240'; lanes?: string[] } | false
  /** callback de progresso (só no mesmo thread) */
  onProgress?: (stage: string, fraction: number) => void
}
