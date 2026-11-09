/**
 * @opengirder/engine — motor de cálculo de pontes (TypeScript puro, zero dependências).
 *
 * API pública:
 *  - modelo:     tipos em model/types.ts, validação
 *  - templates:  geradores paramétricos (viga contínua, estaiada, pênsil) + PRESETS
 *  - análise:    analyzeBridge() = form-finding → carga permanente não linear →
 *                modal (linearizado no estado deformado) → carga móvel NBR 7188 → verificações
 */

export * from './model/types'
export * from './analysis/types'
export * from './templates/types'

export { validateModel } from './model/validate'
export { generateModel, defaultTemplate, PRESETS } from './templates'
export { analyzeBridge, applyCableL0 } from './analyze'
export { frameAxes, cablePolyline } from './analysis/geometry'
export { LinearSolver, type CaseLoad, type ImposedStrain, type LinearState } from './analysis/linear'
export type { AnalysisContext } from './analysis/context'
export {
  civ,
  cnf,
  ciaFactor,
  VEHICLES,
  type VehicleId,
  type VehicleSpec,
} from './loads/nbr7188'
