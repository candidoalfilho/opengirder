/**
 * Contexto de uma análise — o que os módulos de extensão (ações, combinações, verificações,
 * estabilidade, fases…) recebem de `analyzeBridge` depois que o estado permanente, a análise
 * modal e a carga móvel já foram resolvidos.
 */

import type { BridgeModel } from '../model/types'
import type { AnalysisOptions, BridgeResults, LoadCaseResult } from './types'
import type { BridgeSystem } from './system'
import type { StaticSolution } from './static'
import type { LinearSolver } from './linear'

export interface AnalysisContext {
  model: BridgeModel
  opts: AnalysisOptions
  /** sistema montado, com os elementos no estado de carga permanente */
  sys: BridgeSystem
  /** solução de carga permanente; `sol.K` é a rigidez tangente FATORADA desse estado */
  sol: StaticSolution
  nonlinear: boolean
  /** casos lineares sobre a tangente do estado permanente */
  lin: LinearSolver
  /** resultados parciais: deadLoad, modal, moving e checks.cables já preenchidos */
  res: BridgeResults
  /** casos de carga adicionais — os módulos de ações acrescentam aqui (vira `res.cases`) */
  cases: LoadCaseResult[]
  warnings: string[]
  progress: (stage: string, fraction: number) => void
  /** registra em `res.timings[name]` o tempo desde a última chamada */
  lap: (name: string) => void
}
