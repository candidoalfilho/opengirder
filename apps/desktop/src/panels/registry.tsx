import type { ReactNode } from 'react'
import type { BridgeModel, BridgeResults } from '@opengirder/engine'
import { CablesTab, ModesTab, MovingTab, ReactionsTab, SummaryTab } from './tabs'
import { DataTab } from './features/DataTab'
import { SectionsTab, sectionFailures } from './features/SectionsTab'
import { StabilityTab, stabilityFailures } from './features/StabilityTab'
import { PrestressTab, prestressVisible } from './features/PrestressTab'
import { StagesTab } from './features/StagesTab'
import { ActionsTab } from './features/ActionsTab'
import { CombosTab } from './features/CombosTab'
import { LanesTab } from './features/LanesTab'
import { LibraryTab } from './features/LibraryTab'
import { DiagnosticsTab, diagnosticsBadge } from './features/DiagnosticsTab'

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
  {
    key: 'actions',
    label: 'Ações',
    badge: (_m, r) => (r?.cases?.length ? { text: String(r.cases.length) } : undefined),
    render: (m, r) => <ActionsTab model={m} results={r} />,
  },
  {
    key: 'combos',
    label: 'Combinações',
    badge: (_m, r) => (r?.combos ? { text: String(r.combos.list.length) } : undefined),
    render: (m, r) => <CombosTab model={m} results={r} />,
  },
  {
    key: 'stages',
    label: 'Fases',
    visible: (m) => m.type === 'cable-stayed',
    badge: (_m, r) => (r?.stages ? { text: String(r.stages.stages.length), err: r.stages.stages.some((s) => !s.converged) } : undefined),
    render: (m, r) => <StagesTab model={m} results={r} />,
  },
  {
    key: 'prestress',
    label: 'Protensão',
    visible: (m) => prestressVisible(m),
    badge: (_m, r) => (r?.prestress?.ok === false ? { text: '!', err: true } : undefined),
    render: (m, r) => <PrestressTab model={m} results={r} />,
  },
  {
    key: 'stability',
    label: 'Estabilidade',
    badge: (_m, r) => {
      const n = stabilityFailures(r)
      return n ? { text: String(n), err: true } : undefined
    },
    render: (m, r) => <StabilityTab model={m} results={r} />,
  },
  {
    key: 'sections',
    label: 'Seções',
    badge: (_m, r) => {
      const f = sectionFailures(r)
      return f ? { text: String(f), err: true } : undefined
    },
    render: (m, r) => <SectionsTab model={m} results={r} />,
  },
  { key: 'data', label: 'Dados', flush: true, render: (m) => <DataTab model={m} /> },
  {
    key: 'lanes',
    label: 'Pistas',
    badge: (m) => (m.lanes.length ? { text: String(m.lanes.length) } : m.elements.length ? { text: '0', err: true } : undefined),
    render: (m, r) => <LanesTab model={m} results={r} />,
  },
  { key: 'library', label: 'Biblioteca', render: (m, r) => <LibraryTab model={m} results={r} /> },
  {
    key: 'diagnostics',
    label: 'Diagnóstico',
    badge: (m) => diagnosticsBadge(m),
    render: (m, r) => <DiagnosticsTab model={m} results={r} />,
  },
  // [abas:novas] — uma linha por aba nova, acima deste marcador
]
