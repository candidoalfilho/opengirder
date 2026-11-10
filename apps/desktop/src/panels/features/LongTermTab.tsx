import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_LONG_TERM,
  hasConcreteFrames,
  resolveLongTerm,
  type BridgeModel,
  type BridgeResults,
  type FrameForces,
  type LongTermParams,
  type SiteActions,
  type StagesResult,
} from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto, fmtInt, numToInput, parseNum } from '../../format'
import { LineChart, type Series } from '../../ui/Chart'
import { deadAlong, lanePaths } from '../data'
import { NoResults } from '../tabs'

type LongTermInput = Exclude<NonNullable<SiteActions['longTerm']>, false>

export const longTermVisible = (model: BridgeModel): boolean => hasConcreteFrames(model)

/** campo numérico que só grava ao sair do campo ou com Enter (editar descarta os resultados) */
function NumField({
  label, unit, value, min, max, hint, onCommit,
}: {
  label: string
  unit?: string
  value: number
  min: number
  max: number
  hint?: string
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(numToInput(value))
  useEffect(() => setText(numToInput(value)), [value])
  const v = parseNum(text)
  const valid = Number.isFinite(v) && v >= min && v <= max
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
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

const CEMENTS: { v: LongTermParams['cement']; label: string }[] = [
  { v: 'CP I-II', label: 'CP I e CP II — endurecimento normal' },
  { v: 'CP III-IV', label: 'CP III e CP IV — endurecimento lento' },
  { v: 'CP V-ARI', label: 'CP V-ARI — endurecimento rápido' },
]
const SLUMPS: { v: LongTermParams['slump']; label: string }[] = [
  { v: '0-4', label: '0 a 4 cm' },
  { v: '5-9', label: '5 a 9 cm' },
  { v: '10-15', label: '10 a 15 cm' },
]

function age(days: number): string {
  if (days >= 9000) return 't∞'
  if (days >= 365 * 1.5) return `${fmt(days / 365, 0)} anos`
  if (days >= 300) return '1 ano'
  return `${fmtInt(days)} dias`
}

function Params({ model }: { model: BridgeModel }) {
  const updateModel = useStore((s) => s.updateModel)
  const on = model.site?.longTerm !== false && model.site?.longTerm?.enabled !== false
  const p = useMemo<LongTermParams>(() => resolveLongTerm({ ...model, site: { ...model.site, longTerm: { ...(model.site?.longTerm || {}), enabled: true } } }) || DEFAULT_LONG_TERM, [model])
  const patch = (v: Partial<LongTermInput>) =>
    updateModel((m) => {
      const cur = m.site?.longTerm
      return { ...m, site: { ...m.site, longTerm: { ...(cur ? cur : {}), ...v } } }
    })
  return (
    <div className="act-block">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => patch({ enabled: e.target.checked })} />
        Fluência e retração do concreto <span className="dim">NBR 6118, Anexo A</span>
      </label>
      {on && (
        <>
          <div className="act-grid">
            <NumField label="Umidade relativa" unit="%" value={p.humidity} min={40} max={100} onCommit={(v) => patch({ humidity: v })} />
            <NumField label="Idade no carregamento t₀" unit="dias" value={p.t0} min={1} max={3650} onCommit={(v) => patch({ t0: v })} />
            <NumField label="Temperatura média" unit="°C" value={p.temperature} min={0} max={40} onCommit={(v) => patch({ temperature: v })} />
          </div>
          <div className="act-grid lt-grid2">
            <div className="field">
              <label className="label">Cimento</label>
              <select className="select" value={p.cement} onChange={(e) => patch({ cement: e.target.value as LongTermParams['cement'] })}>
                {CEMENTS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Abatimento do concreto</label>
              <select className="select" value={p.slump} onChange={(e) => patch({ slump: e.target.value as LongTermParams['slump'] })}>
                {SLUMPS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="hint lt-hint">
            70 % = ao ar livre em geral; 40 % = ambiente seco; 90 % = muito úmido, logo acima da água. t₀ é a idade do concreto
            quando a carga permanente passa a atuar.
          </div>
        </>
      )}
    </div>
  )
}

/** Mz ao longo da 1ª pista: permanente (+ protensão) em t0 e em t∞ */
function momentSeries(model: BridgeModel, r: BridgeResults): Series[] {
  const cs = r.cases?.find((c) => c.id === r.longTerm?.caseId)
  const path = lanePaths(model)[0]
  if (!cs || !path) return []
  const pt = r.cases?.find((c) => c.kind === 'prestress')
  const add = (a: [number, number, number], b: [number, number, number] | undefined): [number, number, number] =>
    b ? [a[0] + b[0], a[1] + b[1], a[2] + b[2]] : a
  const before: FrameForces[] = r.deadLoad.frames.map((f, i) => ({ ...f, Mz: add(f.Mz, pt?.frames[i]?.Mz) }))
  const after: FrameForces[] = before.map((f, i) => ({ ...f, Mz: add(f.Mz, cs.frames[i]?.Mz) }))
  const d0 = deadAlong(path, before, 'Mz')
  const d1 = deadAlong(path, after, 'Mz')
  if (d0.x.length === 0) return []
  return [
    { label: pt ? 'G + P em t₀' : 'Permanente em t₀', x: d0.x, y: d0.y, color: 'var(--text-dim)', dash: true },
    { label: 'Em t∞ (com fluência e retração)', x: d1.x, y: d1.y, color: 'var(--accent)' },
  ]
}

export function LongTermTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const showOverlay = useStore((s) => s.showOverlay)
  const overlay = useStore((s) => s.overlay)
  const lt = results?.longTerm
  const cs = results?.cases?.find((c) => c.id === lt?.caseId)
  const on = model.site?.longTerm !== false && model.site?.longTerm?.enabled !== false

  const moments = useMemo(() => (results && lt ? safeMoments(model, results) : []), [model, results, lt])

  return (
    <div className="lt-tab">
      <div className="panel-title">Efeitos diferidos</div>
      <Params model={model} />
      {!on ? (
        <div className="note">Fluência e retração desligadas: a análise considera só o estado elástico em t₀.</div>
      ) : !results ? (
        <NoResults what="os efeitos diferidos" />
      ) : !lt || !cs ? (
        <div className="note">Esta análise não calculou efeitos diferidos (o modelo não tem barras de concreto ou as extensões foram puladas).</div>
      ) : (
        <>
          <div className="panel-title">Coeficientes por seção</div>
          <div className="lt-table">
            <table className="table">
              <thead>
                <tr>
                  <th className="left">Seção</th>
                  <th title="fck do concreto">fck (MPa)</th>
                  <th title="Espessura fictícia γ·2Ac/u">h fic (m)</th>
                  <th title="Coeficiente de fluência de t₀ a t∞">φ(t∞, t₀)</th>
                  <th title="Retração de t₀ a t∞">εcs (‰)</th>
                  <th>Barras</th>
                </tr>
              </thead>
              <tbody>
                {lt.sections.map((s) => (
                  <tr key={`${s.sec}|${s.mat}`}>
                    <td className="left">
                      {s.name}
                      {s.approx && <span className="dim" title="Perímetro estimado pela caixa envolvente: a seção não tem geometria detalhada"> *</span>}
                    </td>
                    <td>{fmt(s.fck / 1000, 0)}</td>
                    <td>{fmt(s.hfic, 2)}</td>
                    <td>{fmt(s.phi, 2)}</td>
                    <td>{fmt(s.epsCs * 1000, 3)}</td>
                    <td>{fmtInt(s.nFrames)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lt.sections.some((s) => s.approx) && <div className="hint lt-hint">* espessura fictícia estimada pela largura e altura da seção (sem geometria detalhada).</div>}

          <div className="panel-title">Fluência e retração no tempo</div>
          <LineChart
            series={[{ label: 'φ(t, t₀)', x: lt.curve.t.map((t) => Math.log10(t)), y: lt.curve.phi, color: 'var(--accent)' }]}
            xLabel="idade do concreto — log₁₀(dias)"
            yLabel="φ"
            height={170}
          />
          <LineChart
            series={[{ label: 'εcs(t, t₀)', x: lt.curve.t.map((t) => Math.log10(t)), y: lt.curve.epsCs.map((e) => e * 1000), color: 'var(--info, #4aa3ff)' }]}
            xLabel="idade do concreto — log₁₀(dias)"
            yLabel="εcs (‰)"
            height={150}
          />

          <div className="panel-title">
            Evolução na obra pronta
            <span className="grow" />
            <button
              className={`btn btn-ghost ${overlay?.label.startsWith('Fluência') ? 'active' : ''}`}
              onClick={() =>
                showOverlay(
                  overlay?.label.startsWith('Fluência')
                    ? null
                    : { label: 'Fluência e retração — incremento de t₀ a t∞', u: cs.u, animate: false, note: `φ = ${fmt(lt.instants[lt.instants.length - 1].phi, 2)} · χ = ${fmt(lt.params.chi, 1)}` },
                )
              }
            >
              {overlay?.label.startsWith('Fluência') ? 'Ocultar no 3D' : 'Ver deformada no 3D'}
            </button>
          </div>
          <div className="lt-table">
            <table className="table">
              <thead>
                <tr>
                  <th className="left">Idade</th>
                  <th>φ</th>
                  <th>εcs (‰)</th>
                  <th title="Deslocamento vertical de maior módulo no tabuleiro, incremento em relação a t₀">Tabuleiro (mm)</th>
                  <th title="Deslocamento vertical de maior módulo em torres e pilares">Torre/pilar (mm)</th>
                  {cs.cables.length > 0 && <th title="Variação de tração nos cabos: mínima e máxima">ΔT cabos (kN)</th>}
                </tr>
              </thead>
              <tbody>
                {lt.instants.map((i) => (
                  <tr key={i.t}>
                    <td className="left">{age(i.t)}</td>
                    <td>{fmt(i.phi, 2)}</td>
                    <td>{fmt(i.epsCs * 1000, 3)}</td>
                    <td>{fmt(i.uzDeck * 1000, 1)}</td>
                    <td>{fmt(i.uzTower * 1000, 1)}</td>
                    {cs.cables.length > 0 && (
                      <td>
                        {fmt(i.dT[0], 0)} a {fmt(i.dT[1], 0)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LineChart
            series={[{ label: 'Maior deslocamento vertical do tabuleiro', x: lt.instants.map((i) => Math.log10(i.t)), y: lt.instants.map((i) => i.uzDeck * 1000), color: 'var(--accent)' }]}
            xLabel="idade do concreto — log₁₀(dias)"
            yLabel="uz (mm)"
            height={170}
          />
          {lt.cableChange && (
            <dl className="kv">
              <dt>Variação da tração permanente dos cabos em t∞</dt>
              <dd>
                {fmt(lt.cableChange[0] * 100, 1)} % a {fmt(lt.cableChange[1] * 100, 1)} %
              </dd>
            </dl>
          )}

          {moments.length > 0 && (
            <>
              <div className="panel-title">Momento fletor no tabuleiro: t₀ × t∞</div>
              <LineChart series={moments} xLabel="estaca ao longo do tabuleiro (m)" yLabel="Mz (kN·m)" invertY height={210} />
              <div className="hint lt-hint">Momentos positivos desenhados para baixo. Em estrutura homogênea de concreto a fluência amplia as flechas sem redistribuir momentos; a redistribuição aparece onde o concreto trabalha junto com aço ou cabos.</div>
            </>
          )}

          <div className="note lt-note">
            <b>Método do módulo efetivo ajustado pela idade</b> (χ = {fmt(lt.params.chi, 1)}): de t₀ a cada idade, o concreto recebe a
            deformação livre φ·σ/E + εcs sob os esforços permanentes{results.prestress ? ' e de protensão' : ''}, e a estrutura responde com E/(1 + χ·φ). O estado
            em t∞ é o caso <b>CS</b> das combinações (ação permanente indireta: γ = 1,2 se desfavorável, 0 se favorável).
            <br />
            <b>Não inclui</b> a história da execução (todo o concreto é carregado em t₀ — a evolução durante a obra está na aba Fases),
            a relaxação dos estais nem a realimentação das perdas de protensão.
          </div>
        </>
      )}
    </div>
  )
}

function safeMoments(model: BridgeModel, r: BridgeResults): Series[] {
  try {
    return momentSeries(model, r)
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ bloco p/ a aba Fases */

/** fluência e retração acumuladas fase a fase (usado dentro da aba Fases) */
export function StageCreepBlock({ st }: { st: StagesResult }) {
  const showOverlay = useStore((s) => s.showOverlay)
  if (!st.time) return null
  const stages = st.stages.filter((s) => s.creep)
  const x = stages.map((s) => s.index)
  const tip = stages.map((s) => {
    let v = 0
    for (const t of s.creep!.tips) if (Math.abs(t.uz) > Math.abs(v)) v = t.uz
    return v * 1000
  })
  const uz = stages.map((s) => s.creep!.uzMax * 1000)
  const lo = stages.map((s) => s.creep!.dT[0])
  const hi = stages.map((s) => s.creep!.dT[1])
  const last = stages[stages.length - 1]
  const fin = st.time.final
  return (
    <>
      <div className="panel-title">Fluência e retração durante a obra</div>
      <dl className="kv">
        <dt>Duração de cada fase</dt>
        <dd>{fmt(st.time.daysPerStage, 0)} dias</dd>
        <dt>Idade das aduelas ao serem carregadas</dt>
        <dd>{fmt(st.time.t0, 0)} dias</dd>
        <dt>Da última fase à abertura</dt>
        <dd>{fmt(st.time.tOpen, 0)} dias</dd>
        {last && (
          <>
            <dt>Na abertura (dia {fmtInt(last.creep!.day)}): tabuleiro</dt>
            <dd>{fmt(last.creep!.uzMax * 1000, 0)} mm</dd>
            <dt>Na abertura: variação de tração dos estais</dt>
            <dd>
              {fmt(last.creep!.dT[0], 0)} a {fmt(last.creep!.dT[1], 0)} kN
            </dd>
          </>
        )}
        <dt>Da abertura a t∞: tabuleiro</dt>
        <dd>{fmt(fin.uzMax * 1000, 0)} mm</dd>
        <dt>Da abertura a t∞: variação de tração dos estais</dt>
        <dd>
          {fmt(fin.dT[0], 0)} a {fmt(fin.dT[1], 0)} kN
        </dd>
      </dl>
      <LineChart
        series={[
          { label: 'Tabuleiro montado (maior módulo)', x, y: uz, color: 'var(--accent)' },
          { label: 'Ponta dos balanços', x, y: tip, color: 'var(--text-dim)', dash: true },
        ]}
        xLabel="fase"
        yLabel="uz acumulado de fluência (mm)"
        height={180}
      />
      <LineChart
        series={[
          { label: 'ΔT máxima', x, y: hi, color: 'var(--accent)' },
          { label: 'ΔT mínima', x, y: lo, color: 'var(--info, #4aa3ff)' },
        ]}
        xLabel="fase"
        yLabel="ΔT acumulada nos estais (kN)"
        height={160}
      />
      <div className="lt-actions">
        <button className="btn btn-ghost" onClick={() => showOverlay({ label: 'Fluência e retração — da abertura a t∞', u: fin.u, animate: false })}>
          Ver no 3D o efeito da abertura a t∞
        </button>
      </div>
      <div className="hint lt-hint">
        Incrementos somados fase a fase sobre o estado elástico da análise regressiva (curva de fluência do primeiro carregamento de
        cada aduela; sem retensionamento nem correção de cota). Servem para estimar a contraflecha de fluência.
      </div>
    </>
  )
}
