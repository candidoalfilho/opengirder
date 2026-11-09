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
export { pedestrianComfort, PEDESTRIAN_RANGES } from './checks/pedestrian'
export { analyzeBridge, applyCableL0 } from './analyze'
export { frameAxes, cablePolyline } from './analysis/geometry'
export {
  sectionParts,
  validateGeometry,
  defaultBox,
  type SectionGeometry,
  type SectionPart,
  type BoxGeometry,
  type TGirdersGeometry,
  type SlabGeometry,
  type SteelIGeometry,
  type SteelBoxGeometry,
  type HollowRectGeometry,
  type SolidRectGeometry,
  type CircleGeometry,
} from './sections/geometry'
export { sectionProperties, type SectionProps, type DesignSection, type TorsionSection } from './sections/properties'
export {
  flexureELU,
  columnELU,
  shearELU,
  torsionELU,
  fiberStresses,
  stressELS,
  concreteParams,
  rhoMin,
} from './checks/nbr6118'
export { steelStressCheck } from './checks/nbr8800'
export { designData } from './checks/sections'
export { LinearSolver, type CaseLoad, type ImposedStrain, type LinearState } from './analysis/linear'
export type { AnalysisContext } from './analysis/context'
export { BUCKLING_MIN_FACTOR } from './analysis/buckling'
export { designSpectrum, soilFactors, SEISMIC_ZONES, type SeismicParams } from './loads/seismic'
export { selbergFlutter, torsionalDivergence, vortexSpeed, flutterShapeFactor } from './checks/aero'
export {
  type Tendon,
  type TendonPoint,
  type TendonResult,
  type TendonStress,
  type PrestressCheck,
  type TendonDesignOptions,
  TENDON_DEFAULTS,
  defaultSigmaPi,
  tendonData,
  buildProfile,
  autoProfile,
  designTendon,
  refineTendons,
  deckPrestressSection,
} from './prestress'
export { autoDesignPrestress, type AutoDesignResult } from './prestress/autodesign'
export { DEFAULT_SITE, resolveSite, defaultGradient, type ResolvedSite } from './loads/site'
export { s2Factor, windClass, dynamicPressure, deckDrag } from './loads/wind'
export { brakingForce } from './loads/braking'
export { GAMMA, PSI } from './combos/nbr8681'
export { stagePlan, elementStages, type StageDef, type StagePlan, type StageKind } from './stages/plan'
export { runStages, type StageOptions } from './stages/backward'
export {
  civ,
  cnf,
  ciaFactor,
  VEHICLES,
  type VehicleId,
  type VehicleSpec,
} from './loads/nbr7188'
