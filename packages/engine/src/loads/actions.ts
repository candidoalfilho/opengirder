/**
 * Casos de carga das ações do local: temperatura (NBR 6118 11.4.2), vento (NBR 6123) e
 * frenagem/aceleração (NBR 7188 5.2.1) — todos linearizados em torno do estado permanente.
 */

import type { AnalysisContext } from '../analysis/context'
import { resolveSite } from './site'
import { temperatureCases } from './temperature'
import { windCases } from './wind'
import { brakingCase } from './braking'

export function runActions(ctx: AnalysisContext): void {
  const site = resolveSite(ctx.model)
  ctx.progress('Ações: temperatura, vento e frenagem', 0.975)
  if (site.temperature) ctx.cases.push(...temperatureCases(ctx, site.temperature))
  if (site.wind) ctx.cases.push(...windCases(ctx, site.wind))
  if (site.braking && ctx.opts.moving !== false) {
    const fr = brakingCase(ctx)
    if (fr) ctx.cases.push(fr)
  }
  ctx.lap('acoes')
}
