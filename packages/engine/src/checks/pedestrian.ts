/**
 * Conforto de pedestres em passarelas — triagem por frequência.
 *
 * A caminhada excita a estrutura a ~2 Hz na vertical (1,6–2,4 Hz) e à metade disso na
 * lateral (0,8–1,2 Hz, o fenômeno de sincronização lateral). Um modo dentro dessas faixas
 * pode entrar em ressonância com o passo: é o critério de triagem usual (fib Bulletin 32,
 * Sétra 2006, BS 5400-2). A NBR 6118 (23.3, Tabela 23.1) pede, p/ passarelas, frequência
 * própria afastada da faixa crítica de 1,6 a 4,5 Hz (f > 1,2·f_crit).
 *
 * Isto NÃO é a verificação de acelerações: um modo dentro da faixa pede análise dinâmica
 * com o carregamento de pedestres (ou amortecedores de massa sintonizada).
 */

import type { ModalResult, PedestrianComfort } from '../analysis/types'
import type { AnalysisContext } from '../analysis/context'

export const PEDESTRIAN_RANGES: PedestrianComfort['ranges'] = { vertical: [1.6, 2.4], lateral: [0.8, 1.2] }

export function pedestrianComfort(modal: ModalResult): PedestrianComfort {
  const { vertical, lateral } = PEDESTRIAN_RANGES
  const critical: PedestrianComfort['critical'] = []
  let fVertical = 0
  let fLateral = 0
  for (const m of modal.modes) {
    // direção em que o modo responde ao passo: tipo do modo; nos mistos, a massa efetiva
    const isV = m.kind === 'vertical' || m.kind === 'torcional' || (m.kind === 'misto' && m.massPct[2] >= m.massPct[1])
    const isL = m.kind === 'transversal' || (m.kind === 'misto' && m.massPct[1] > m.massPct[2])
    const f = m.frequency
    if (isV && (fVertical === 0 || f < fVertical)) fVertical = f
    if (isL && (fLateral === 0 || f < fLateral)) fLateral = f
    if (isV && f >= vertical[0] && f <= vertical[1]) critical.push({ mode: m.index, frequency: f, kind: m.kind, direction: 'vertical' })
    else if (isL && f >= lateral[0] && f <= lateral[1]) critical.push({ mode: m.index, frequency: f, kind: m.kind, direction: 'lateral' })
  }
  return { ranges: PEDESTRIAN_RANGES, critical, fVertical, fLateral, ok: critical.length === 0 }
}

/** extensão de `analyzeBridge`: só quando a carga móvel é a de pedestres */
export function runPedestrian(ctx: AnalysisContext): void {
  const { res } = ctx
  if (res.moving?.vehicle !== 'Pedestres' || !res.modal) return
  res.pedestrian = pedestrianComfort(res.modal)
  if (!res.pedestrian.ok) {
    ctx.warnings.push(
      `${res.pedestrian.critical.length} modo(s) de vibração na faixa crítica do passo de pedestres ` +
        '(vertical 1,6–2,4 Hz; lateral 0,8–1,2 Hz): verificar acelerações por análise dinâmica.',
    )
  }
}
