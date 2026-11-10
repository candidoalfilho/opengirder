import { useEffect, useMemo, useState } from 'react'
import type { BridgeModel, BridgeResults, StageResult, StagesResult } from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto, fmtDuration, fmtInt, numToInput, parseNum } from '../../format'
import { LineChart, type Series } from '../../ui/Chart'
import { StageCreepBlock } from './LongTermTab'
import { lanePaths } from '../data'

const KIND_LABEL: Record<StageResult['kind'], string> = {
  base: 'início',
  cantilever: 'balanço',
  closure: 'fechamento',
  finish: 'final',
}

const TOWER_COLORS = ['var(--accent)', 'var(--blue)', 'var(--ok)', 'var(--warn)']

function stageLabel(s: StageResult): string {
  return `Fase ${s.index} — ${s.name}`
}

/** maior deslocamento vertical (em módulo, com sinal) entre as pontas livres da fase */
function tipExtreme(s: StageResult): number | null {
  if (s.tips.length === 0) return null
  let v = s.tips[0].uz
  for (const t of s.tips) if (Math.abs(t.uz) > Math.abs(v)) v = t.uz
  return v
}

function Hypotheses({ st }: { st?: StagesResult }) {
  return (
    <div className="note stg-note">
      <b>Análise regressiva.</b> A ponte pronta é desmontada na ordem inversa da execução e cada estrutura parcial é
      recalculada (não linear) com os comprimentos de fabricação finais dos estais. As trações na fase em que cada estai
      entra são as forças de instalação; o deslocamento da ponta dos balanços é a cota de montagem em relação ao greide.
      <br />
      {st?.time ? (
        <>
          <b>Fluência e retração</b> entram como incrementos somados fase a fase ({fmt(st.time.daysPerStage, 0)} dias por fase),
          sem corrigir o estado elástico das fases seguintes. <b>Não inclui</b> relaxação dos estais nem retensionamentos; o
          fechamento é ideal (pontas corrigidas para a posição de projeto).
        </>
      ) : (
        <>
          <b>Não inclui</b> fluência, retração nem relaxação, nem retensionamentos; o fechamento é ideal (pontas corrigidas
          para a posição de projeto).
        </>
      )}
      {st?.temporaryFixity && ' O aparelho de apoio do tabuleiro na torre fica travado (engaste provisório) até a última fase.'}
      {st && st.equipment > 0 && ` Carga de equipamento de ${fmtAuto(st.equipment)} kN na ponta de cada balanço.`}
    </div>
  )
}

function Launch({ results }: { results: BridgeResults | null }) {
  const options = useStore((s) => s.options)
  const setOptions = useStore((s) => s.setOptions)
  const run = useStore((s) => s.runAnalysis)
  const running = useStore((s) => s.analysis.running)
  const [text, setText] = useState(numToInput(options.stageEquipment))
  const equipment = parseNum(text)
  const valid = text.trim() === '' || (Number.isFinite(equipment) && equipment >= 0)
  const [days, setDays] = useState(numToInput(options.stageDays ?? 7))
  const nDays = parseNum(days)
  const failed = results && options.stages ? results.warnings.filter((w) => /fases construtivas/i.test(w)) : []

  return (
    <div className="stg-launch">
      <div className="panel-title">Fases construtivas</div>
      <p className="stg-lead">
        Acompanha a execução em balanços sucessivos: torre e aduela de disparo, um par de estais por fase, fechamento e
        sobrecarga permanente. Para cada fase saem as trações dos estais, a posição da ponta dos balanços e os esforços na
        torre.
      </p>
      <div className="field">
        <div className="label">
          Equipamento na ponta de cada balanço <span className="unit">kN</span>
        </div>
        <input
          className={`input ${valid ? '' : 'invalid'}`}
          inputMode="decimal"
          value={text}
          placeholder="0"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="hint">Treliça lançadeira, carro de avanço, formas. Deixe 0 para não considerar.</div>
      </div>
      <div className="field">
        <div className="label">
          Duração de cada fase <span className="unit">dias</span>
        </div>
        <input
          className="input"
          inputMode="decimal"
          value={days}
          placeholder="7"
          onChange={(e) => setDays(e.target.value)}
        />
        <div className="hint">Para a fluência e a retração do concreto entre as fases. 0 = não considerar o tempo.</div>
      </div>
      <button
        className="btn btn-primary"
        disabled={running || !valid}
        onClick={() => {
          setOptions({ stages: true, stageEquipment: Number.isFinite(equipment) ? equipment : 0, stageDays: Number.isFinite(nDays) && nDays >= 0 ? nDays : 7 })
          run()
        }}
      >
        Calcular fases construtivas
      </button>
      {failed.map((w, i) => (
        <div key={i} className="msg warn" style={{ marginTop: 10 }}>
          {w}
        </div>
      ))}
      <Hypotheses />
    </div>
  )
}

export function StagesTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const overlay = useStore((s) => s.overlay)
  const showOverlay = useStore((s) => s.showOverlay)
  const setOptions = useStore((s) => s.setOptions)
  const st = results?.stages
  const [sel, setSel] = useState<number | null>(null)
  const [showStays, setShowStays] = useState(false)

  // a seleção só vale enquanto o 3D estiver mostrando a fase
  useEffect(() => {
    if (!overlay) setSel(null)
  }, [overlay])

  const paths = useMemo(() => lanePaths(model), [model])

  const charts = useMemo(() => {
    if (!st) return null
    const x = st.stages.map((s) => s.index)
    const building = st.stages.filter((s) => s.tips.length > 0)
    const tipUp: Series = {
      label: 'Ponta mais alta', color: 'var(--blue)',
      x: building.map((s) => s.index), y: building.map((s) => 1000 * Math.max(...s.tips.map((t) => t.uz))),
    }
    const tipDown: Series = {
      label: 'Ponta mais baixa', color: 'var(--accent)',
      x: building.map((s) => s.index), y: building.map((s) => 1000 * Math.min(...s.tips.map((t) => t.uz))),
    }
    const tmax: Series = { label: 'Maior tração nos estais', color: 'var(--accent)', x, y: st.stages.map((s) => s.Tmax) }
    const nTowers = Math.max(0, ...st.stages.map((s) => s.towers.length))
    const towerM: Series[] = []
    const towerU: Series[] = []
    for (let t = 0; t < nTowers; t++) {
      const name = nTowers > 1 ? `Torre ${t + 1}` : 'Torre'
      const color = TOWER_COLORS[t % TOWER_COLORS.length]
      towerM.push({ label: name, color, x, y: st.stages.map((s) => (s.towers[t]?.baseM ?? 0) / 1000) })
      towerU.push({ label: name, color, x, y: st.stages.map((s) => 1000 * (s.towers[t]?.ux ?? 0)) })
    }
    // cota de montagem ao longo de cada pista
    const uzAt = new Map(st.erection.map((e) => [e.node, e.uz]))
    const erection: Series[] = paths.map((p, i) => ({
      label: paths.length > 1 ? p.lane.name : 'Cota de montagem',
      color: TOWER_COLORS[i % TOWER_COLORS.length],
      x: p.s,
      y: p.nodeIdx.map((k) => 1000 * (uzAt.get(model.nodes[k].id) ?? 0)),
    }))
    return { tipUp, tipDown, tmax, towerM, towerU, erection, hasTips: building.length > 0 }
  }, [st, paths, model])

  if (!st) return <Launch results={results} />

  const pick = (s: StageResult) => {
    setSel(s.index)
    const tip = tipExtreme(s)
    const parts = [`${fmtInt(s.stays.length)} estais`, `T máx. ${fmtAuto(s.Tmax)} kN`]
    if (tip !== null) parts.push(`ponta ${fmt(tip * 1000, 0)} mm`)
    if (!s.converged) parts.push('NÃO CONVERGIU')
    showOverlay({ label: stageLabel(s), u: s.u, animate: false, hideElements: s.hidden, note: parts.join(' · ') })
  }
  const cur = sel !== null ? st.stages[sel] : null
  const last = st.stages.length - 1
  const nBad = st.stages.filter((s) => !s.converged).length
  const nSlack = st.stages.filter((s) => s.nSlack > 0).length
  const idx = sel ?? last

  return (
    <div className="stg-tab">
      <div className="stg-head">
        <span className="chip accent">{fmtInt(st.stages.length)} fases</span>
        <span className={`chip ${nBad ? 'err' : 'ok'}`}>{nBad ? `${nBad} sem convergência` : 'todas convergiram'}</span>
        {nSlack > 0 && <span className="chip warn">estais frouxos em {nSlack}</span>}
        <span className="chip">{fmtDuration(st.elapsed)}</span>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-ghost"
          title="Volta à tela de configuração (a próxima análise não calcula as fases)"
          onClick={() => {
            setOptions({ stages: false })
            showOverlay(null)
          }}
        >
          Desligar
        </button>
      </div>

      {st.warnings.map((w, i) => (
        <div key={i} className="msg warn">
          {w}
        </div>
      ))}

      <div className="stg-player">
        <button className="btn" disabled={idx <= 0} onClick={() => pick(st.stages[idx - 1])}>
          ‹
        </button>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={idx}
          onChange={(e) => pick(st.stages[Number(e.target.value)])}
        />
        <button className="btn" disabled={idx >= last} onClick={() => pick(st.stages[idx + 1])}>
          ›
        </button>
      </div>
      <div className="stg-current">
        {cur ? (
          <>
            <b>{stageLabel(cur)}</b>
            <span className="dim">{cur.note}</span>
          </>
        ) : (
          <span className="dim">Arraste o controle ou clique numa fase para ver a estrutura parcial deformada no 3D.</span>
        )}
      </div>

      <div className="stg-table">
        <table className="table clickable">
          <thead>
            <tr>
              <th className="left">Fase</th>
              <th className="left">Etapa</th>
              <th title="Estais instalados">Estais</th>
              <th title="Maior tração entre os estais instalados">T máx. (kN)</th>
              <th title="Deslocamento vertical da ponta livre de maior módulo; + = acima do greide">Ponta (mm)</th>
              <th title="Deslocamento longitudinal do topo da torre, maior módulo">Torre (mm)</th>
              <th title="Maior compressão no tabuleiro">N tab. (kN)</th>
            </tr>
          </thead>
          <tbody>
            {st.stages.map((s) => {
              const tip = tipExtreme(s)
              let tw = 0
              for (const t of s.towers) if (Math.abs(t.ux) > Math.abs(tw)) tw = t.ux
              return (
                <tr key={s.index} className={sel === s.index ? 'selected' : ''} onClick={() => pick(s)}>
                  <td className="left">{s.index}</td>
                  <td className="left" style={{ fontFamily: 'var(--sans)' }} title={s.error ?? s.note}>
                    {s.name}
                    {!s.converged && <span className="chip err stg-flag">não convergiu</span>}
                    {s.nSlack > 0 && <span className="chip warn stg-flag">{s.nSlack} frouxo(s)</span>}
                  </td>
                  <td>{fmtInt(s.stays.length)}</td>
                  <td>{s.stays.length ? fmtAuto(s.Tmax) : '—'}</td>
                  <td>{tip === null ? '—' : fmt(tip * 1000, 0)}</td>
                  <td>{s.towers.length ? fmt(tw * 1000, 0) : '—'}</td>
                  <td>{fmtAuto(s.deckNmin)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {cur && (
        <dl className="kv stg-detail">
          <dt>Etapa</dt>
          <dd>{KIND_LABEL[cur.kind]}</dd>
          <dt>Elementos montados na fase</dt>
          <dd>{fmtInt(cur.added.length)}</dd>
          <dt>Iterações de Newton</dt>
          <dd>{fmtInt(cur.iterations)}</dd>
          <dt>Maior deslocamento vertical do tabuleiro</dt>
          <dd>{fmt(cur.uzMax * 1000, 1)} mm</dd>
          {cur.tips.map((t) => (
            <FragmentRow key={t.node} k={`Ponta do balanço — nó ${t.node}`} v={`${fmt(t.uz * 1000, 1)} mm`} />
          ))}
          {cur.towers.map((t, i) => (
            <FragmentRow
              key={t.topNode}
              k={`Torre${cur.towers.length > 1 ? ` ${i + 1}` : ''}: topo / momento na base`}
              v={`${fmt(t.ux * 1000, 1)} mm / ${fmtAuto(t.baseM)} kN·m`}
            />
          ))}
        </dl>
      )}

      {charts && (
        <>
          {charts.hasTips && (
            <>
              <div className="panel-title">Ponta dos balanços por fase</div>
              <LineChart series={[charts.tipUp, charts.tipDown]} xLabel="fase" yLabel="uz (mm)" height={190} />
            </>
          )}
          {charts.erection.length > 0 && (
            <>
              <div className="panel-title">Cota de montagem ao longo do tabuleiro</div>
              <LineChart series={charts.erection} xLabel="estaca ao longo da pista (m)" yLabel="uz na montagem (mm)" height={190} />
              <div className="note">
                Posição de cada aduela, em relação ao greide final, na fase em que é montada. Com o sinal trocado é a
                contraflecha de execução.
              </div>
            </>
          )}
          <div className="panel-title">Maior tração nos estais por fase</div>
          <LineChart series={[charts.tmax]} xLabel="fase" yLabel="T (kN)" height={170} />
          {charts.towerM.length > 0 && (
            <>
              <div className="panel-title">Momento longitudinal na base da torre</div>
              <LineChart series={charts.towerM} xLabel="fase" yLabel="M (MN·m)" height={170} />
              <div className="panel-title">Deslocamento longitudinal do topo da torre</div>
              <LineChart series={charts.towerU} xLabel="fase" yLabel="ux (mm)" height={170} />
            </>
          )}
        </>
      )}

      <StageCreepBlock st={st} />

      <div className="panel-title">
        Tração de instalação dos estais
        <span className="grow" />
        <button className="btn btn-ghost" onClick={() => setShowStays((v) => !v)}>
          {showStays ? 'Ocultar' : `Mostrar ${fmtInt(st.stays.length)}`}
        </button>
      </div>
      {showStays && (
        <div className="stg-table">
          <table className="table">
            <thead>
              <tr>
                <th className="left">Estai</th>
                <th>Fase</th>
                <th title="Tração na fase em que o estai é instalado">T instalação (kN)</th>
                <th title="Tração no estado final de projeto">T final (kN)</th>
                <th>Instal./final</th>
              </tr>
            </thead>
            <tbody>
              {st.stays.map((s) => (
                <tr key={s.id}>
                  <td className="left">{s.id}</td>
                  <td>{s.stage}</td>
                  <td>{fmtAuto(s.Tinstall)}</td>
                  <td>{fmtAuto(s.Tfinal)}</td>
                  <td>{s.Tfinal > 0 ? fmt(s.Tinstall / s.Tfinal, 2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Hypotheses st={st} />
    </div>
  )
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  )
}
