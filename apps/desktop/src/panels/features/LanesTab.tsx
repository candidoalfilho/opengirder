import { useEffect, useState } from 'react'
import type { BridgeModel, BridgeResults, Lane } from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt } from '../../format'
import { applyAutoLanes, laneFromSelection, laneLength, laneSpans, withSpanMeta } from '../../editor/lanes'
import { NumField, selectInView, useEditSelection } from './libFields'

function NameField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className="input ln-name"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = text.trim()
        if (t && t !== value) onCommit(t)
        else setText(value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function LanesTab({ model }: { model: BridgeModel; results: BridgeResults | null }) {
  const updateModel = useStore((s) => s.updateModel)
  const notify = useStore((s) => s.notify)
  const sel = useEditSelection()
  const hasDeck = model.elements.some((e) => e.kind === 'frame' && e.group === 'deck')
  const hasSel = sel.nodes.length + sel.elements.length > 0

  const patch = (id: string, p: Partial<Lane>) =>
    updateModel((m) => ({ ...m, lanes: m.lanes.map((l) => (l.id === id ? { ...l, ...p } : l)) }))

  const auto = () => {
    const r = applyAutoLanes(model)
    if (typeof r === 'string') {
      notify(r, 'err')
      return
    }
    updateModel(() => r.model)
    notify(r.message)
  }

  const fromSelection = () => {
    const lane = laneFromSelection(model, sel)
    if (typeof lane === 'string') {
      notify(lane, 'err')
      return
    }
    updateModel((m) => withSpanMeta({ ...m, lanes: [...m.lanes, lane] }))
    notify(`${lane.name} criada com ${lane.nodes.length} nós`)
  }

  const remove = (id: string) => {
    const used = model.tendons?.some((t) => t.lane === id)
    if (used) {
      notify('Esta pista define o traçado de um cabo de protensão: remova o cabo antes (aba Protensão).', 'err')
      return
    }
    updateModel((m) => ({ ...m, lanes: m.lanes.filter((l) => l.id !== id) }))
  }

  const spans = model.lanes[0] ? laneSpans(model, model.lanes[0]) : []
  const metaSpans = model.meta?.spans ?? []
  const stale = spans.length > 0 && (spans.length !== metaSpans.length || spans.some((s, i) => Math.abs(s - metaSpans[i]) > 1e-3))

  return (
    <div>
      <div className="panel-title">
        Pistas de carga móvel
        <span className="grow" />
        <span className={`chip ${model.lanes.length ? 'ok' : 'warn'}`}>{model.lanes.length} pista(s)</span>
      </div>

      {model.lanes.length === 0 && (
        <div className="msg warn">
          O modelo não tem pista. Sem pista, a carga móvel da NBR 7188, a frenagem e as combinações com tráfego não são calculadas.
        </div>
      )}

      <div className="ln-actions">
        <button className="btn btn-primary" disabled={!hasDeck} onClick={auto} title={hasDeck ? undefined : 'Atribua o grupo Tabuleiro às barras da pista'}>
          {model.lanes.length ? 'Recriar automaticamente' : 'Criar pista automática'}
        </button>
        <button className="btn" disabled={!hasSel} onClick={fromSelection} title={hasSel ? undefined : 'Selecione as barras (ou os nós) do caminho no 3D'}>
          Criar da seleção
        </button>
      </div>
      {!hasDeck && <p className="note">Nenhuma barra é do grupo Tabuleiro. Selecione as barras da pista e atribua o grupo Tabuleiro (menu Operações → Grupo).</p>}

      {model.lanes.map((l) => (
        <div className="ln-card" key={l.id}>
          <div className="ln-head">
            <NameField value={l.name} onCommit={(name) => patch(l.id, { name })} />
            <button className="btn btn-ghost" onClick={() => selectInView(useStore.getState, { nodes: l.nodes, elements: [] })}>
              Ver no 3D
            </button>
            <button className="btn btn-ghost ln-remove" title="Remover a pista" onClick={() => remove(l.id)}>
              Remover
            </button>
          </div>
          <dl className="kv">
            <dt>Nós no caminho</dt>
            <dd>{l.nodes.length}</dd>
            <dt>Comprimento</dt>
            <dd>{fmt(laneLength(model, l), 2)} m</dd>
          </dl>
          <div className="ln-grid">
            <NumField label="Largura carregável" unit="m" value={l.width} min={0.5} max={60} onCommit={(width) => patch(l.id, { width })} />
            <NumField
              label="Excentricidade máx. do veículo"
              unit="m"
              value={l.maxEccentricity}
              min={0}
              max={30}
              onCommit={(maxEccentricity) => patch(l.id, { maxEccentricity })}
            />
          </div>
        </div>
      ))}

      {model.lanes.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">Vãos</div>
          <dl className="kv">
            <dt>Vãos ao longo da 1ª pista</dt>
            <dd>{metaSpans.length ? metaSpans.map((s) => fmt(s, 1)).join(' + ') + ' m' : '—'}</dd>
            <dt>Maior vão (entra no CIV)</dt>
            <dd>{model.meta?.mainSpan ? `${fmt(model.meta.mainSpan, 1)} m` : '—'}</dd>
          </dl>
          {stale && (
            <div className="msg warn ln-stale">
              <span>Os apoios mudaram: os vãos calculados agora são {spans.map((s) => fmt(s, 1)).join(' + ')} m.</span>
              <button className="btn" onClick={() => updateModel((m) => withSpanMeta(m))}>
                Atualizar
              </button>
            </div>
          )}
        </div>
      )}

      <p className="note ln-note">
        A pista é o caminho de nós do tabuleiro por onde passam o veículo-tipo e a carga distribuída. A pista automática segue as barras do
        grupo Tabuleiro; a largura carregável é a largura da seção menos 0,40 m de barreira de cada lado, e a excentricidade máxima é a
        distância que o eixo do veículo (3 m de largura) pode se afastar do eixo da pista. Os vãos vão de apoio a apoio: nós com restrição
        vertical ou ligados a torre ou pilar; estais e pendurais não dividem vãos.
      </p>
    </div>
  )
}
