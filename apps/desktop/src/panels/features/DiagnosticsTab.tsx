import { useMemo } from 'react'
import type { BridgeModel, BridgeResults } from '@opengirder/engine'
import { useStore } from '../../store'
import { diagnose, type Diagnostic } from '../../editor/diagnostics'
import { defaultValues, editAction } from '../../editor/actions'
import { editSelectionOf, selectInView } from './libFields'

const LABEL: Record<Diagnostic['severity'], string> = { erro: 'erro', aviso: 'aviso', dica: 'dica' }
const CHIP: Record<Diagnostic['severity'], string> = { erro: 'err', aviso: 'warn', dica: '' }

/** nº de erros e avisos p/ o selo da aba */
export function diagnosticsBadge(model: BridgeModel): { text: string; err?: boolean } | undefined {
  const d = diagnose(model)
  const errors = d.filter((x) => x.severity === 'erro').length
  if (errors) return { text: String(errors), err: true }
  const warns = d.filter((x) => x.severity === 'aviso').length
  return warns ? { text: String(warns) } : undefined
}

export function DiagnosticsTab({ model }: { model: BridgeModel; results: BridgeResults | null }) {
  const updateModel = useStore((s) => s.updateModel)
  const notify = useStore((s) => s.notify)
  const items = useMemo(() => diagnose(model), [model])
  const count = (s: Diagnostic['severity']): number => items.filter((d) => d.severity === s).length

  const fix = (d: Diagnostic) => {
    const action = d.fix ? editAction(d.fix) : undefined
    if (!action) return
    const sel = d.select ?? editSelectionOf(useStore.getState())
    const can = action.enabled(model, sel)
    if (can !== true) {
      notify(can, 'err')
      return
    }
    const r = action.run(model, sel, { ...defaultValues(action, model, sel), ...d.fixValues })
    if (typeof r === 'string') {
      notify(r, 'err')
      return
    }
    updateModel(() => r.model)
    notify(r.message ?? 'Corrigido')
  }

  return (
    <div>
      <div className="panel-title">
        Diagnóstico do modelo
        <span className="grow" />
        {count('erro') > 0 && <span className="chip err">{count('erro')} erro(s)</span>}
        {count('aviso') > 0 && <span className="chip warn">{count('aviso')} aviso(s)</span>}
        {count('dica') > 0 && <span className="chip">{count('dica')} dica(s)</span>}
        {items.length === 0 && <span className="chip ok">sem pendências</span>}
      </div>

      {items.length === 0 ? (
        <p className="note">Nenhum problema encontrado: o modelo tem apoios, as partes estão ligadas e há pista para a carga móvel.</p>
      ) : (
        <div className="dg-list">
          {items.map((d, i) => {
            const action = d.fix ? editAction(d.fix) : undefined
            return (
              <div className={`dg-item ${d.severity}`} key={i}>
                <span className={`chip ${CHIP[d.severity]}`}>{LABEL[d.severity]}</span>
                <div className="dg-body">
                  <div className="dg-text">{d.text}</div>
                  {(d.select || action) && (
                    <div className="dg-actions">
                      {d.select && (
                        <button className="btn btn-ghost" onClick={() => selectInView(useStore.getState, d.select!)}>
                          Selecionar no 3D
                        </button>
                      )}
                      {action && (
                        <button className="btn" onClick={() => fix(d)}>
                          {d.fixLabel ?? action.label}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="note dg-note">
        Erros impedem a análise ou tornam a estrutura um mecanismo. Avisos não impedem, mas costumam ser engano de modelagem. Dicas melhoram a
        qualidade dos resultados. A conferência é geométrica: estabilidade e esforços só saem da análise.
      </p>
    </div>
  )
}
