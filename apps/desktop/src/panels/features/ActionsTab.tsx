import { useEffect, useMemo, useState } from 'react'
import {
  resolveSite,
  type BridgeModel,
  type BridgeResults,
  type LoadCaseResult,
  type ResolvedSite,
  type SiteActions,
} from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto, numToInput, parseNum } from '../../format'

/** campo numérico que só grava ao sair do campo ou com Enter (editar descarta os resultados) */
function NumField({
  label,
  unit,
  value,
  min = 0,
  max,
  onCommit,
}: {
  label: string
  unit?: string
  value: number
  min?: number
  max?: number
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(numToInput(value))
  useEffect(() => setText(numToInput(value)), [value])
  const v = parseNum(text)
  const valid = Number.isFinite(v) && v >= min && (max === undefined || v <= max)
  const commit = () => {
    if (!valid) {
      setText(numToInput(value))
      return
    }
    if (Math.abs(v - value) > 1e-12) onCommit(v)
  }
  return (
    <div className="field">
      <label className="label">
        {label}
        {unit && <span className="unit">{unit}</span>}
      </label>
      <input
        className={`input ${valid ? '' : 'invalid'}`}
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </div>
  )
}

const CATEGORIES: { v: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { v: 1, label: 'I — mar, lagos, superfícies lisas' },
  { v: 2, label: 'II — terreno aberto, poucos obstáculos' },
  { v: 3, label: 'III — terreno com obstáculos baixos' },
  { v: 4, label: 'IV — zona urbanizada, industrial' },
  { v: 5, label: 'V — centro de grande cidade' },
]

function maxima(c: LoadCaseResult, nNodes: number) {
  let ux = 0
  let uy = 0
  let uz = 0
  for (let i = 0; i < nNodes; i++) {
    ux = Math.max(ux, Math.abs(c.u[6 * i]))
    uy = Math.max(uy, Math.abs(c.u[6 * i + 1]))
    uz = Math.max(uz, Math.abs(c.u[6 * i + 2]))
  }
  let dT = 0
  for (const k of c.cables) if (Math.abs(k.dT) > Math.abs(dT)) dT = k.dT
  return { ux, uy, uz, dT }
}

export function ActionsTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const updateModel = useStore((s) => s.updateModel)
  const showOverlay = useStore((s) => s.showOverlay)
  const overlay = useStore((s) => s.overlay)
  const site = useMemo<ResolvedSite>(() => resolveSite(model), [model])
  const [open, setOpen] = useState<string | null>(null)
  const hasCables = useMemo(() => model.elements.some((e) => e.kind === 'cable'), [model])
  const hasLanes = model.lanes.length > 0

  const patch = (p: Partial<SiteActions>) => updateModel((m) => ({ ...m, site: { ...m.site, ...p } }))
  // ligar uma ação grava os valores em uso (padrões resolvidos p/ este modelo)
  const defaults = useMemo(() => resolveSite({ ...model, site: undefined }), [model])
  const temp = site.temperature
  const wind = site.wind

  const cases = results?.cases ?? []
  const rows = useMemo(() => cases.map((c) => ({ c, ...maxima(c, model.nodes.length) })), [cases, model.nodes.length])
  const shown = cases.find((c) => c.id === open) ?? null
  const active = overlay ? cases.find((c) => overlay.label.startsWith(`${c.id} — `)) : undefined

  return (
    <div>
      <div className="panel-title">Ações do local</div>

      <div className="act-block">
        <label className="check">
          <input
            type="checkbox"
            checked={!!temp}
            onChange={(e) => patch({ temperature: e.target.checked ? (defaults.temperature || { uniform: 15, gradient: 10, cables: 10 }) : false })}
          />
          Temperatura <span className="dim">NBR 6118, 11.4.2</span>
        </label>
        {temp && (
          <div className="act-grid">
            <NumField label="Uniforme ±" unit="°C" value={temp.uniform} max={60} onCommit={(v) => patch({ temperature: { ...temp, uniform: v } })} />
            <NumField label="Gradiente no tabuleiro" unit="°C" value={temp.gradient} max={40} onCommit={(v) => patch({ temperature: { ...temp, gradient: v } })} />
            {hasCables && (
              <NumField label="Cabos × estrutura ±" unit="°C" value={temp.cables} max={40} onCommit={(v) => patch({ temperature: { ...temp, cables: v } })} />
            )}
          </div>
        )}
      </div>

      <div className="act-block">
        <label className="check">
          <input
            type="checkbox"
            checked={!!wind}
            onChange={(e) => patch({ wind: e.target.checked ? (defaults.wind || { V0: 35, S1: 1, category: 2, S3: 1.1 }) : false })}
          />
          Vento transversal <span className="dim">NBR 6123</span>
        </label>
        {wind && (
          <>
            <div className="act-grid">
              <NumField label="V₀ (isopletas)" unit="m/s" value={wind.V0} min={1} max={80} onCommit={(v) => patch({ wind: { ...wind, V0: v } })} />
              <NumField label="S₁ (topografia)" value={wind.S1} min={0.5} max={1.6} onCommit={(v) => patch({ wind: { ...wind, S1: v } })} />
              <NumField label="S₃ (estatístico)" value={wind.S3} min={0.8} max={1.3} onCommit={(v) => patch({ wind: { ...wind, S3: v } })} />
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label className="label">Categoria de rugosidade (S₂)</label>
              <select
                className="select"
                value={wind.category}
                onChange={(e) => patch({ wind: { ...wind, category: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 } })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div className="act-block">
        <label className="check" title={hasLanes ? undefined : 'O modelo não tem faixas de tráfego'}>
          <input type="checkbox" checked={site.braking && hasLanes} disabled={!hasLanes} onChange={(e) => patch({ braking: e.target.checked })} />
          Frenagem e aceleração <span className="dim">NBR 7188, 5.2.1</span>
        </label>
        {site.braking && hasLanes && <div className="note">Hf = 0,25·B·L·CNF ≥ 135 kN, ao longo de cada pista, nos dois sentidos.</div>}
      </div>
      <div className="note" style={{ marginTop: 8 }}>
        Alterar um parâmetro descarta os resultados: rode a análise de novo. Cada ação é resolvida como incremento linear
        sobre o estado de carga permanente.
      </div>

      <div className="panel-section">
        <div className="panel-title">
          Casos de carga calculados
          <span className="grow" />
          {overlay && (
            <button className="btn btn-ghost" style={{ height: 22, padding: '0 8px', fontSize: 11 }} onClick={() => showOverlay(null)}>
              Voltar ao modelo
            </button>
          )}
        </div>
        {!results ? (
          <div className="note">Rode a análise para calcular os casos de temperatura, vento e frenagem.</div>
        ) : rows.length === 0 ? (
          <div className="note">Nenhum caso adicional nesta análise (ações desligadas ou sem efeito no modelo).</div>
        ) : (
          <>
            <table className="table clickable">
              <thead>
                <tr>
                  <th className="left">Caso</th>
                  <th title="maior deslocamento longitudinal">|ux| mm</th>
                  <th title="maior deslocamento transversal">|uy| mm</th>
                  <th title="maior deslocamento vertical">|uz| mm</th>
                  {hasCables && <th title="maior variação de tração em um cabo">ΔT cabo kN</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, ux, uy, uz, dT }) => (
                  <tr
                    key={c.id}
                    className={active?.id === c.id ? 'selected' : ''}
                    title={`${c.name} — clique para ver a deformada no 3D`}
                    onClick={() => {
                      setOpen(c.id)
                      showOverlay({
                        label: `${c.id} — ${c.name}`,
                        u: c.u,
                        animate: false,
                        note: c.sign === 'both' ? 'Sentido indefinido: entra nas combinações como ±' : undefined,
                      })
                    }}
                  >
                    <td className="left">
                      <b>{c.id}</b>
                      {c.sign === 'both' ? ' ±' : ''}
                    </td>
                    <td>{fmt(ux * 1000, 1)}</td>
                    <td>{fmt(uy * 1000, 1)}</td>
                    <td>{fmt(uz * 1000, 1)}</td>
                    {hasCables && <td>{fmt(dT, 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {shown ? (
              <div className="act-detail">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{shown.name}</div>
                <dl className="kv">
                  {(shown.info ?? []).map((i) => (
                    <FragmentRow key={i.label} label={i.label} value={`${fmtAuto(i.value)}${i.unit ? ` ${i.unit}` : ''}`} />
                  ))}
                </dl>
              </div>
            ) : (
              <div className="note" style={{ marginTop: 8 }}>
                Clique num caso para ver a deformada no 3D e as grandezas da ação.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}
