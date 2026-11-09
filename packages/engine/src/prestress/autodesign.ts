/**
 * Pré-dimensionamento VERIFICADO da protensão: parte do balanceamento de cargas
 * (`designTendon`) e repete análise → ajuste (`refineTendons`) até as tensões em serviço e no
 * ato da protensão serem atendidas, ou até o limite de iterações.
 *
 * Fica fora de prestress/index.ts porque depende de analyze.ts (que importa aquele módulo).
 */

import type { BridgeModel } from '../model/types'
import type { AnalysisOptions } from '../analysis/types'
import { analyzeBridge } from '../analyze'
import { type TendonDesignOptions, designTendon, refineTendons } from './design'

export interface AutoDesignResult {
  model: BridgeModel
  /** todas as verificações normativas de tensões atendidas */
  ok: boolean
  /** nº de análises feitas */
  iterations: number
}

export function autoDesignPrestress(
  model: BridgeModel,
  opts: TendonDesignOptions & { maxIterations?: number; keep?: boolean; analysis?: AnalysisOptions } = {},
): AutoDesignResult | null {
  let current = model
  if (!opts.keep || !model.tendons?.length) {
    const t = designTendon(model, opts)
    if (!t) return null
    current = { ...model, tendons: [t] }
  }
  const max = Math.max(1, opts.maxIterations ?? 8)
  let ok = false
  let iterations = 0
  for (; iterations < max; ) {
    const res = analyzeBridge(current, { ...opts.analysis, modal: false, sizeCables: false, onProgress: undefined })
    iterations++
    ok = res.prestress?.ok === true
    if (ok) break
    const next = refineTendons(current, res)
    if (!next) break
    current = next
  }
  return { model: current, ok, iterations }
}
