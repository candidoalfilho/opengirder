/**
 * Barra de ferramentas do editor gráfico (sobre a área 3D): ferramentas, plano de trabalho,
 * malha de captura, padrões dos elementos novos, entrada de coordenadas e o menu de
 * operações, desenhado a partir do registro `EDIT_ACTIONS`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementGroup } from '@opengirder/engine'
import { useStore } from '../store'
import { GROUP_LABEL, numToInput, parseNum } from '../format'
import type { EditAction, EditParam, EditTool, EditValues, WorkPlane } from './types'
import { EDIT_ACTIONS } from './actions'
import { parseCoords } from './draw'
import { cancelCommand, commitPoint, planeOffsetFor, toolHint, useEditSession } from './session'
import { PLANE_LABEL } from './snap'
import { useEditKeys } from './useEditKeys'

const TOOLS: { key: EditTool; label: string; hot: string }[] = [
  { key: 'select', label: 'Selecionar', hot: 'S' },
  { key: 'node', label: 'Nó', hot: 'N' },
  { key: 'frame', label: 'Barra', hot: 'B' },
  { key: 'cable', label: 'Cabo', hot: 'C' },
  { key: 'move', label: 'Mover', hot: 'M' },
]

const FRAME_GROUPS: ElementGroup[] = ['deck', 'tower', 'pier', 'arch', 'crossbeam', 'rigid']
const CABLE_GROUPS: ElementGroup[] = ['stay', 'hanger', 'main-cable']
const groupLabel = (g: string): string => GROUP_LABEL[g] ?? g

/** campo numérico compacto: confirma no Enter ou ao sair; aceita vírgula */
function Num({
  value, onCommit, width = 54, title, min,
}: {
  value: number
  onCommit: (v: number) => void
  width?: number
  title?: string
  min?: number
}) {
  const [text, setText] = useState(numToInput(value))
  useEffect(() => setText(numToInput(value)), [value])
  const commit = () => {
    const v = parseNum(text)
    if (Number.isFinite(v) && (min === undefined || v >= min)) onCommit(v)
    else setText(numToInput(value))
  }
  return (
    <input
      className="edt-num"
      style={{ width }}
      value={text}
      title={title}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(numToInput(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/* ------------------------------------------------------------------ menu de operações */

const GROUP_ORDER: EditAction['group'][] = ['Gerar', 'Transformar', 'Atribuir', 'Limpar']

function initialValues(params: EditParam[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const p of params) out[p.key] = typeof p.default === 'boolean' ? p.default : typeof p.default === 'number' ? numToInput(p.default) : p.default
  return out
}

function OperationsMenu({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model)
  const sel = useStore((s) => s.edit.sel)
  const ref = useRef<HTMLDivElement>(null)
  const [action, setAction] = useState<EditAction | null>(null)
  const [vals, setVals] = useState<Record<string, string | boolean>>({})

  // ouvintes registrados uma vez só: a tecla Esc é tratada na fase de captura e não segue
  // adiante, senão o atalho do editor (que troca de ferramenta) re-renderiza a barra no meio
  // do evento e este menu nunca chega a ouvi-la
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  // `enabled` também atualiza opções e padrões que dependem do modelo
  const states = useMemo(() => {
    if (!model) return []
    return EDIT_ACTIONS.map((a) => {
      let ok: true | string
      try {
        ok = a.enabled(model, sel)
      } catch (err) {
        ok = err instanceof Error ? err.message : String(err)
      }
      return { a, ok }
    })
  }, [model, sel])

  if (!model) return null

  const run = (a: EditAction, raw: Record<string, string | boolean>) => {
    const values: EditValues = {}
    for (const p of a.params) {
      const v = raw[p.key]
      if (p.kind === 'number' || p.kind === 'int') {
        const x = parseNum(String(v))
        if (!Number.isFinite(x)) {
          useStore.getState().notify(`"${p.label}": valor inválido.`, 'err')
          return
        }
        values[p.key] = p.kind === 'int' ? Math.round(x) : x
      } else values[p.key] = v
    }
    const st = useStore.getState()
    const cur = st.model
    if (!cur) return
    let res: ReturnType<EditAction['run']>
    try {
      res = a.run(cur, st.edit.sel, values)
    } catch (err) {
      res = err instanceof Error ? err.message : String(err)
    }
    if (typeof res === 'string') {
      st.notify(res, 'err')
      return
    }
    const out = res
    cancelCommand()
    if (out.model !== cur) st.updateModel(() => out.model)
    // geradores e cópias mudam o tamanho do modelo: reenquadra a câmera
    if (out.model.nodes.length !== cur.nodes.length && (a.group === 'Gerar' || a.group === 'Transformar')) {
      useStore.setState((s) => ({ fitKey: s.fitKey + 1 }))
    }
    if (out.select) useStore.getState().setEditSel(out.select)
    if (out.message) useStore.getState().notify(out.message)
    onClose()
  }

  const open = (a: EditAction) => {
    if (a.params.length === 0) {
      run(a, {})
      return
    }
    setVals(initialValues(a.params))
    setAction(a)
  }

  if (action) {
    return (
      <div className="popover edt-ops" ref={ref}>
        <div className="panel-title">{action.label}</div>
        <div className="note" style={{ marginBottom: 10 }}>{action.description}</div>
        <div className="edt-form">
          {action.params.map((p) => (
            <div className={`field ${p.kind === 'bool' ? 'wide' : ''}`} key={p.key}>
              {p.kind === 'bool' ? (
                <label className="check">
                  <input type="checkbox" checked={!!vals[p.key]} onChange={(e) => setVals((v) => ({ ...v, [p.key]: e.target.checked }))} />
                  {p.label}
                </label>
              ) : (
                <>
                  <label className="label">
                    {p.label}
                    {p.unit && <span className="unit">{p.unit}</span>}
                  </label>
                  {p.kind === 'select' ? (
                    <select className="select" value={String(vals[p.key] ?? '')} onChange={(e) => setVals((v) => ({ ...v, [p.key]: e.target.value }))}>
                      {(p.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      value={String(vals[p.key] ?? '')}
                      inputMode={p.kind === 'text' ? 'text' : 'decimal'}
                      onChange={(e) => setVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && run(action, vals)}
                    />
                  )}
                </>
              )}
              {p.hint && <div className="hint">{p.hint}</div>}
            </div>
          ))}
        </div>
        <div className="edt-ops-actions">
          <button className="btn btn-ghost" onClick={() => setAction(null)}>
            Voltar
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={() => run(action, vals)}>
            Aplicar
          </button>
        </div>
      </div>
    )
  }

  const nSel = sel.nodes.length + sel.elements.length
  return (
    <div className="popover edt-ops" ref={ref}>
      <div className="panel-title">Operações</div>
      <div className="note" style={{ marginBottom: 6 }}>
        {nSel ? `Seleção: ${sel.nodes.length} nó(s), ${sel.elements.length} elemento(s).` : 'Nada selecionado — algumas operações pedem uma seleção.'}
      </div>
      {states.length === 0 && <div className="note">Nenhuma operação disponível.</div>}
      {GROUP_ORDER.map((g) => {
        const list = states.filter((x) => x.a.group === g)
        if (list.length === 0) return null
        return (
          <div key={g}>
            <div className="edt-ops-group">{g}</div>
            {list.map(({ a, ok }) => (
              <button key={a.key} className="edt-op" disabled={ok !== true} onClick={() => open(a)} title={a.description}>
                <span>{a.label}</span>
                {ok !== true && <small>{ok}</small>}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ liga/desliga */

/** botão da barra de vista que liga e desliga o modo de edição */
export function EditToggle() {
  const active = useStore((s) => s.edit.active)
  const toggle = useStore((s) => s.toggleEdit)
  return (
    <div className="seg edt-toggle">
      <button className={active ? 'active' : ''} onClick={toggle} title="Desenhar e alterar o modelo direto no 3D">
        {active ? 'Concluir edição' : 'Editar modelo'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ barra */

export function EditToolbar() {
  const edit = useStore((s) => s.edit)
  const setEdit = useStore((s) => s.setEdit)
  const model = useStore((s) => s.model)
  const fitKey = useStore((s) => s.fitKey)
  const viewMode = useStore((s) => s.view.mode)
  const pending = useEditSession((s) => s.pending)
  const [ops, setOps] = useState(false)
  const [coord, setCoord] = useState('')
  useEditKeys()

  // sair do modo de edição ou trocar de modelo encerra o comando em curso
  useEffect(() => {
    if (!edit.active) cancelCommand()
  }, [edit.active])
  useEffect(() => {
    cancelCommand()
    useEditSession.getState().set({ last: null })
  }, [fitKey])

  if (!edit.active || !model) return null
  if (viewMode !== 'model') {
    return (
      <div className="edt-bar">
        <div className="edt-hint">Edição em pausa: volte à vista "Modelo" para desenhar.</div>
      </div>
    )
  }

  const d = edit.defaults
  const setDefaults = (patch: Partial<typeof d>) => setEdit({ defaults: { ...d, ...patch } })
  const setTool = (tool: EditTool) => {
    cancelCommand()
    setEdit({ tool })
  }
  const setPlane = (patch: Partial<WorkPlane>) => setEdit({ plane: { ...edit.plane, ...patch } })
  const drawing = edit.tool === 'node' || edit.tool === 'frame' || edit.tool === 'cable'
  const frameMats = model.materials.filter((m) => m.kind !== 'cable')
  const cableMats = model.materials.filter((m) => m.kind === 'cable')

  const submitCoord = () => {
    const last = useEditSession.getState().last
    const p = parseCoords(coord, edit.plane, last)
    if (!p) {
      useStore.getState().notify(
        coord.trim().startsWith('@') && !last
          ? 'Coordenada relativa (@) precisa de um ponto anterior.'
          : 'Coordenada inválida. Use "x; y; z" (ou dois valores no plano de trabalho); @ = relativa ao último ponto.',
        'err',
      )
      return
    }
    commitPoint({ p })
    setCoord('')
  }

  return (
    <div className="edt-bar">
      <div className="seg">
        {TOOLS.map((t) => (
          <button key={t.key} className={edit.tool === t.key ? 'active' : ''} onClick={() => setTool(t.key)} title={`${t.label} (${t.hot})`}>
            {t.label}
            <kbd>{t.hot}</kbd>
          </button>
        ))}
      </div>

      <div className="seg">
        <span className="seg-label">Plano</span>
        <select
          className="select"
          value={edit.plane.kind}
          onChange={(e) => {
            const kind = e.target.value as WorkPlane['kind']
            const axis = kind === 'elevation' ? 1 : kind === 'plan' ? 2 : 0
            setEdit({ plane: { kind, offset: planeOffsetFor(model, axis, edit.sel.nodes, useEditSession.getState().last) } })
          }}
          title="Plano onde os cliques criam pontos"
        >
          {(Object.keys(PLANE_LABEL) as WorkPlane['kind'][]).map((k) => (
            <option key={k} value={k}>
              {PLANE_LABEL[k].name}
            </option>
          ))}
        </select>
        <span className="edt-eq">{PLANE_LABEL[edit.plane.kind].fixed} =</span>
        <Num value={edit.plane.offset} onCommit={(v) => setPlane({ offset: v })} title="Posição do plano de trabalho (m)" />
        <span className="seg-label">Malha</span>
        <Num value={edit.snap} min={0} onCommit={(v) => setEdit({ snap: v })} width={44} title="Passo da malha de captura (m); 0 = só nós existentes" />
        <span className="edt-unit">m</span>
      </div>

      <div className="popover-wrap">
        <div className="seg">
          <button className={ops ? 'active' : ''} onClick={() => setOps((o) => !o)}>
            Operações ▾
          </button>
        </div>
        {ops && <OperationsMenu onClose={() => setOps(false)} />}
      </div>

      {edit.tool === 'frame' && (
        <div className="seg">
          <span className="seg-label">Barra</span>
          <select className="select" value={d.frameSec} onChange={(e) => setDefaults({ frameSec: e.target.value })} title="Seção das barras novas">
            {model.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="select" value={d.frameMat} onChange={(e) => setDefaults({ frameMat: e.target.value })} title="Material das barras novas">
            {frameMats.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select className="select" value={d.frameGroup} onChange={(e) => setDefaults({ frameGroup: e.target.value as ElementGroup })} title="Grupo (papel estrutural) das barras novas">
            {FRAME_GROUPS.map((g) => (
              <option key={g} value={g}>
                {groupLabel(g)}
              </option>
            ))}
          </select>
        </div>
      )}

      {edit.tool === 'cable' && (
        <div className="seg">
          <span className="seg-label">Cabo</span>
          <select className="select" value={d.cableMat} onChange={(e) => setDefaults({ cableMat: e.target.value })} title="Material dos cabos novos">
            {cableMats.length === 0 && <option value="">(sem material de cabo)</option>}
            {cableMats.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select className="select" value={d.cableGroup} onChange={(e) => setDefaults({ cableGroup: e.target.value as ElementGroup })} title="Grupo dos cabos novos">
            {CABLE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {groupLabel(g)}
              </option>
            ))}
          </select>
          <Num
            value={d.cableStrands}
            min={0}
            width={40}
            title="Nº de cordoalhas de 150 mm² (preenche a área); 0 = informar só a área"
            onCommit={(v) => {
              const n = Math.round(v)
              setDefaults(n > 0 ? { cableStrands: n, cableA: n * 150e-6 } : { cableStrands: 0 })
            }}
          />
          <span className="edt-unit">cord.</span>
          <Num
            value={Math.round(d.cableA * 1e6 * 100) / 100}
            min={0.01}
            width={58}
            title="Área de aço do cabo (mm²)"
            onCommit={(v) => setDefaults({ cableA: v * 1e-6, cableStrands: 0 })}
          />
          <span className="edt-unit">mm²</span>
        </div>
      )}

      {drawing && (
        <div className="seg">
          <span className="seg-label">Ponto</span>
          <input
            className="edt-num edt-coord"
            placeholder="x; y; z  ou  @dx; dy; dz"
            value={coord}
            title="Enter cria o ponto. Dois valores = coordenadas no plano de trabalho. @ = relativo ao último ponto."
            onChange={(e) => setCoord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCoord()
              if (e.key === 'Escape') {
                setCoord('')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
        </div>
      )}

      <div className="edt-hint">{toolHint(edit.tool, pending)}</div>
    </div>
  )
}
