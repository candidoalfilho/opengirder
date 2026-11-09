import type { ReactNode } from 'react'
import type { BridgeModel, BridgeResults } from '@opengirder/engine'
import { CablesTab, ModesTab, MovingTab, ReactionsTab, SummaryTab } from './tabs'

/**
 * Abas do painel direito. Para acrescentar uma aba: criar o componente em
 * `panels/features/<Nome>Tab.tsx` e incluir UMA entrada aqui (import + objeto).
 */
export interface FeatureTab {
  key: string
  label: string
  /** aba só aparece quando devolve true (padrão: sempre) */
  visible?: (model: BridgeModel, results: BridgeResults | null) => boolean
  badge?: (model: BridgeModel, results: BridgeResults | null) => { text: string; err?: boolean } | undefined
  /** true = conteúdo sem margem interna (tabelas que ocupam a aba inteira) */
  flush?: boolean
  render: (model: BridgeModel, results: BridgeResults | null) => ReactNode
}

const nCables = (m: BridgeModel): number => m.elements.reduce((a, e) => a + (e.kind === 'cable' ? 1 : 0), 0)

export const FEATURE_TABS: FeatureTab[] = [
  { key: 'summary', label: 'Resumo', render: (m, r) => <SummaryTab model={m} results={r} /> },
  {
    key: 'cables',
    label: 'Cabos',
    flush: true,
    visible: (m) => nCables(m) > 0,
    badge: (m, r) => {
      const fails = r?.checks.cables.filter((c) => !c.ok).length ?? 0
      if (fails) return { text: String(fails), err: true }
      const n = nCables(m)
      return n ? { text: String(n) } : undefined
    },
    render: (m, r) => <CablesTab model={m} results={r} />,
  },
  {
    key: 'modes',
    label: 'Modos',
    flush: true,
    badge: (_m, r) => (r?.modal ? { text: String(r.modal.modes.length) } : undefined),
    render: (_m, r) => <ModesTab results={r} />,
  },
  { key: 'moving', label: 'Carga móvel', render: (m, r) => <MovingTab model={m} results={r} /> },
  { key: 'reactions', label: 'Reações', flush: true, render: (_m, r) => <ReactionsTab results={r} /> },
  // [abas:novas] — uma linha por aba nova, acima deste marcador
]
