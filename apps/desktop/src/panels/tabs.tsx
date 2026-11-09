import { useMemo, useState } from 'react'
import { VEHICLES, type BridgeModel, type BridgeResults } from '@opengirder/engine'
import { useStore } from '../store'
import { fmt, fmtAuto, fmtDuration, fmtInt, GROUP_LABEL, MODE_KIND_LABEL } from '../format'
import { LineChart, type Series } from '../ui/Chart'
import { IconChart } from '../ui/icons'
import { deadAlong, envelopeAlong, keyFigures, lanePaths, matchReference, type Quantity } from './data'

export function NoResults({ what }: { what: string }) {
  const run = useStore((s) => s.runAnalysis)
  const running = useStore((s) => s.analysis.running)
  return (
    <div className="empty">
      <IconChart size={30} />
      <div>
        {what}
        <br />
        Rode a análise para calcular.
      </div>
      <button className="btn btn-primary" disabled={running} onClick={run}>
        Analisar
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ resumo */

const TIMING_LABEL: Record<string, string> = {
  montagem: 'Montagem',
  formFinding: 'Form-finding',
  cargaPermanente: 'Carga permanente',
  deadLoad: 'Carga permanente',
  modal: 'Análise modal',
  cargaMovel: 'Carga móvel',
  dimensionamento: 'Dimensionamento dos estais',
  moving: 'Carga móvel',
  verificacoes: 'Verificações',
  checks: 'Verificações',
  total: 'Total',
}

export function SummaryTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const errors = useStore((s) => s.modelErrors)
  const analysis = useStore((s) => s.analysis)
  const refs = model.meta?.reference ?? []
  const figures = useMemo(() => (results ? keyFigures(model, results) : []), [model, results])

  return (
    <div>
      {errors.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="panel-title">Erros do modelo</div>
          {errors.map((e, i) => (
            <div className="msg err" key={i}>
              {e}
            </div>
          ))}
        </div>
      )}
      {analysis.error && <div className="msg err">{analysis.error}</div>}

      {!results ? (
        <NoResults what="Ainda não há resultados para este modelo." />
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="k">Nós</div>
              <div className="v">{fmtInt(results.nNodes)}</div>
            </div>
            <div className="stat">
              <div className="k">Elementos</div>
              <div className="v">{fmtInt(results.nElements)}</div>
            </div>
            <div className="stat">
              <div className="k">GDL</div>
              <div className="v">{fmtInt(results.nDofs)}</div>
            </div>
            <div className="stat">
              <div className="k">Tempo</div>
              <div className="v">
                {analysis.elapsed !== null
                  ? fmtDuration(analysis.elapsed)
                  : fmtDuration(Object.values(results.timings).reduce((a, b) => a + b, 0))}
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-title">
              Carga permanente
              <span className={`chip ${results.deadLoad.converged ? 'ok' : 'err'}`}>
                {results.deadLoad.converged ? 'convergiu' : 'não convergiu'}
              </span>
            </div>
            <dl className="kv">
              <dt>Iterações (Newton-Raphson)</dt>
              <dd>{fmtInt(results.deadLoad.iterations)}</dd>
              <dt>Passos de carga</dt>
              <dd>{fmtInt(results.deadLoad.loadSteps)}</dd>
              <dt>Resíduo final</dt>
              <dd>{fmtAuto(results.deadLoad.residual)} kN</dd>
            </dl>
          </div>

          {results.formFinding && (
            <div className="panel-section">
              <div className="panel-title">
                Form-finding
                <span className={`chip ${results.formFinding.converged ? 'ok' : 'warn'}`}>
                  {results.formFinding.converged ? 'convergiu' : 'não convergiu'}
                </span>
              </div>
              <dl className="kv">
                <dt>Cabos ajustados / alvos</dt>
                <dd>
                  {fmtInt(results.formFinding.nUnknowns)} / {fmtInt(results.formFinding.nTargets)}
                </dd>
                <dt>Iterações</dt>
                <dd>{fmtInt(results.formFinding.iterations)}</dd>
                <dt>Deslocamento residual</dt>
                <dd>{fmtAuto(results.formFinding.residual * 1000)} mm</dd>
              </dl>
              {results.formFinding.history.length > 1 && (
                <div style={{ marginTop: 8 }}>
                  <LineChart
                    height={150}
                    xLabel="iteração"
                    yLabel="log₁₀ desloc. (m)"
                    series={[
                      {
                        label: 'Maior deslocamento nos alvos (log₁₀ m)',
                        color: 'var(--accent)',
                        x: results.formFinding.history.map((_, i) => i + 1),
                        y: results.formFinding.history.map((v) => Math.log10(Math.max(v, 1e-12))),
                      },
                    ]}
                  />
                </div>
              )}
              <div className="note" style={{ marginTop: 6 }}>
                Os comprimentos indeformados (L0) encontrados foram gravados no modelo.
              </div>
            </div>
          )}

          {figures.length > 0 && (
            <div className="panel-section">
              <div className="panel-title">Grandezas calculadas</div>
              <dl className="kv">
                {figures.map((f) => (
                  <div key={f.label} style={{ display: 'contents' }}>
                    <dt>{f.label}</dt>
                    <dd>
                      {fmt(f.value, f.digits ?? 2)} {f.unit}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {results.warnings.length > 0 && (
            <div className="panel-section">
              <div className="panel-title">Avisos</div>
              {results.warnings.map((w, i) => (
                <div className="msg warn" key={i}>
                  {w}
                </div>
              ))}
            </div>
          )}

          <div className="panel-section">
            <div className="panel-title">Tempos</div>
            <dl className="kv">
              {Object.entries(results.timings).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{TIMING_LABEL[k] ?? k}</dt>
                  <dd>{fmtDuration(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      {refs.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">Referências publicadas</div>
          <table className="table">
            <thead>
              <tr>
                <th className="left">Grandeza</th>
                <th>Referência</th>
                <th>Calculado</th>
                <th>Dif.</th>
              </tr>
            </thead>
            <tbody>
              {refs.map((r, i) => {
                const m = matchReference(r, results)
                const diff = m && r.value !== 0 ? ((m.value - r.value) / r.value) * 100 : null
                return (
                  <tr key={i} title={r.source}>
                    <td className="left" style={{ whiteSpace: 'normal', fontFamily: 'var(--sans)' }}>
                      {r.label}
                      <div className="faint" style={{ fontSize: 10.5 }}>
                        {r.source}
                      </div>
                    </td>
                    <td>
                      {fmtAuto(r.value)} {r.unit}
                    </td>
                    <td>
                      {m ? (
                        <>
                          {fmtAuto(m.value)} {r.unit}
                          <div className="faint" style={{ fontSize: 10.5 }}>
                            {m.note}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={diff === null ? '' : Math.abs(diff) <= 10 ? 'good' : Math.abs(diff) <= 25 ? 'mid' : 'bad'}>
                      {diff === null ? '—' : `${diff > 0 ? '+' : ''}${fmt(diff, 1)}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="note" style={{ marginTop: 6 }}>
            Só períodos e frequências são pareados automaticamente (pelo tipo do modo). As demais referências ficam
            listadas para comparação manual com as grandezas calculadas acima.
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- cabos */

type CableKey = 'id' | 'group' | 'strands' | 'L0' | 'TG' | 'dTQ' | 'ratioEls' | 'ratioElu' | 'dSigma'

interface CableRow {
  id: number
  group: string
  strands: number
  L0: number
  TG: number
  dTQ: number
  ratioEls: number
  ratioElu: number
  dSigma: number
  ok: boolean | null
  slack: boolean
}

const ratioClass = (v: number) => (!Number.isFinite(v) ? '' : v > 1 ? 'bad' : v > 0.9 ? 'mid' : 'good')

export function CablesTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const [sort, setSort] = useState<{ key: CableKey; dir: 1 | -1 }>({ key: 'ratioEls', dir: -1 })
  const [group, setGroup] = useState('all')

  const rows = useMemo<CableRow[]>(() => {
    if (!results) return []
    const dead = new Map(results.deadLoad.cables.map((c) => [c.id, c]))
    const chk = new Map(results.checks.cables.map((c) => [c.id, c]))
    const out: CableRow[] = []
    for (const e of model.elements) {
      if (e.kind !== 'cable') continue
      const d = dead.get(e.id)
      const c = chk.get(e.id)
      out.push({
        id: e.id,
        group: e.group ?? 'other',
        strands: e.strands ?? NaN,
        L0: d?.L0 ?? e.L0 ?? NaN,
        TG: c?.TG ?? (d ? Math.max(d.Ti, d.Tj) : NaN),
        dTQ: c?.dTQ ?? NaN,
        ratioEls: c?.ratioEls ?? NaN,
        ratioElu: c?.ratioElu ?? NaN,
        dSigma: c?.dSigma ?? NaN,
        ok: c ? c.ok : null,
        slack: d?.slack ?? false,
      })
    }
    return out
  }, [model, results])

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group))], [rows])

  const shown = useMemo(() => {
    const list = group === 'all' ? rows : rows.filter((r) => r.group === group)
    const k = sort.key
    return [...list].sort((a, b) => {
      const va = a[k]
      const vb = b[k]
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * sort.dir
      const na = Number.isFinite(va) ? (va as number) : -Infinity
      const nb = Number.isFinite(vb) ? (vb as number) : -Infinity
      return (na - nb) * sort.dir
    })
  }, [rows, group, sort])

  if (!results) return <NoResults what="As trações e verificações dos cabos aparecem aqui." />
  if (rows.length === 0) return <div className="empty">Este modelo não tem cabos.</div>

  const fails = rows.filter((r) => r.ok === false).length
  const slack = rows.filter((r) => r.slack).length
  const hasStrands = rows.some((r) => Number.isFinite(r.strands))

  const th = (key: CableKey, label: string, left = false) => (
    <th
      className={`sortable ${left ? 'left' : ''}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'id' || key === 'group' ? 1 : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', flex: 'none', flexWrap: 'wrap' }}>
        <select className="select compact" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="all">Todos os cabos ({rows.length})</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL[g] ?? g}
            </option>
          ))}
        </select>
        <span className={`chip ${fails ? 'err' : 'ok'}`}>{fails ? `${fails} não atendem` : 'todos atendem'}</span>
        {slack > 0 && <span className="chip warn">{slack} frouxos</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table className="table clickable">
          <thead>
            <tr>
              {th('id', 'ID', true)}
              {th('group', 'Grupo', true)}
              {hasStrands && th('strands', 'Cord.')}
              {th('L0', 'L0 (m)')}
              {th('TG', 'T perm. (kN)')}
              {th('dTQ', 'ΔT móvel (kN)')}
              {th('ratioEls', 'ELS')}
              {th('ratioElu', 'ELU')}
              {th('dSigma', 'Δσ (MPa)')}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                className={selection?.kind === 'element' && selection.id === r.id ? 'selected' : ''}
                onClick={() => select({ kind: 'element', id: r.id })}
              >
                <td className="left">{r.id}</td>
                <td className="left" style={{ fontFamily: 'var(--sans)' }}>
                  {GROUP_LABEL[r.group] ?? r.group}
                </td>
                {hasStrands && <td>{Number.isFinite(r.strands) ? r.strands : '—'}</td>}
                <td>{fmt(r.L0, 3)}</td>
                <td>{fmt(r.TG, 0)}</td>
                <td>{fmt(r.dTQ, 0)}</td>
                <td className={ratioClass(r.ratioEls)}>{fmt(r.ratioEls, 2)}</td>
                <td className={ratioClass(r.ratioElu)}>{fmt(r.ratioElu, 2)}</td>
                <td>{fmt(r.dSigma, 1)}</td>
                <td className={r.slack ? 'bad' : r.ok === null ? '' : r.ok ? 'good' : 'bad'}>
                  {r.slack ? 'frouxo' : r.ok === null ? '—' : r.ok ? 'ok' : 'falha'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ padding: '8px 12px', flex: 'none', borderTop: '1px solid var(--border)' }}>
        ELS = (TG + ΔTQ) / (0,45·Fu) · ELU = (1,35·TG + 1,5·ΔTQ) / (0,65·Fu), com Fu = A·fpk.
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- modos */

export function ModesTab({ results }: { results: BridgeResults | null }) {
  const view = useStore((s) => s.view)
  const showMode = useStore((s) => s.showMode)
  if (!results) return <NoResults what="Períodos e formas modais aparecem aqui." />
  const modal = results.modal
  if (!modal || modal.modes.length === 0) {
    return <div className="empty">A análise modal está desligada nas opções de análise.</div>
  }
  const sum = modal.modes.reduce(
    (a, m) => [a[0] + m.massPct[0], a[1] + m.massPct[1], a[2] + m.massPct[2]],
    [0, 0, 0],
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: '10px 12px', flex: 'none', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`chip ${modal.converged ? 'ok' : 'warn'}`}>
          {modal.converged ? 'convergiu' : 'não convergiu'} · {fmtInt(modal.iterations)} iterações
        </span>
        <span className="chip">massa total {fmtAuto(modal.totalMass)} t</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table className="table clickable">
          <thead>
            <tr>
              <th className="left">Modo</th>
              <th>T (s)</th>
              <th>f (Hz)</th>
              <th className="left">Tipo</th>
              <th>Mx %</th>
              <th>My %</th>
              <th>Mz %</th>
            </tr>
          </thead>
          <tbody>
            {modal.modes.map((m, i) => (
              <tr
                key={m.index}
                className={view.mode === 'mode' && view.modeIndex === i ? 'selected' : ''}
                onClick={() => showMode(i)}
              >
                <td className="left">{m.index}</td>
                <td>{fmt(m.period, 3)}</td>
                <td>{fmt(m.frequency, 4)}</td>
                <td className="left" style={{ fontFamily: 'var(--sans)' }}>
                  {MODE_KIND_LABEL[m.kind] ?? m.kind}
                </td>
                <td>{fmt(m.massPct[0], 1)}</td>
                <td>{fmt(m.massPct[1], 1)}</td>
                <td>{fmt(m.massPct[2], 1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="left" colSpan={4}>
                Massa efetiva acumulada
              </td>
              <td>{fmt(sum[0], 1)}</td>
              <td>{fmt(sum[1], 1)}</td>
              <td>{fmt(sum[2], 1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="note" style={{ padding: '8px 12px', flex: 'none', borderTop: '1px solid var(--border)' }}>
        Clique em um modo para animá-lo no 3D. Modos calculados sobre a rigidez tangente do estado de carga permanente.
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- carga móvel */

const QUANTITIES: { key: Quantity | 'uz'; label: string; unit: string }[] = [
  { key: 'Mz', label: 'Momento fletor Mz', unit: 'kN·m' },
  { key: 'Vy', label: 'Força cortante Vy', unit: 'kN' },
  { key: 'N', label: 'Força normal N', unit: 'kN' },
  { key: 'T', label: 'Momento torçor T', unit: 'kN·m' },
  { key: 'uz', label: 'Deslocamento vertical', unit: 'mm' },
]

export function MovingTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const paths = useMemo(() => lanePaths(model), [model])
  const [laneI, setLaneI] = useState(0)
  const [q, setQ] = useState<Quantity | 'uz'>('Mz')
  const [withDead, setWithDead] = useState(false)
  const [infI, setInfI] = useState(0)

  const mv = results?.moving
  const path = paths[Math.min(laneI, paths.length - 1)]

  const series = useMemo<Series[]>(() => {
    if (!mv || !results || !path) return []
    if (q === 'uz') {
      return [
        { label: 'Móvel máx. (para cima)', color: 'var(--blue)', x: path.s, y: path.nodeIdx.map((i) => mv.uzMax[i] * 1000) },
        { label: 'Móvel mín. (flecha)', color: 'var(--accent)', x: path.s, y: path.nodeIdx.map((i) => mv.uzMin[i] * 1000), fillTo: 0 },
      ]
    }
    const env = envelopeAlong(path, mv.frames, q)
    const dead = deadAlong(path, results.deadLoad.frames, q)
    const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i])
    const out: Series[] = [
      {
        label: withDead ? 'Permanente + móvel máx.' : 'Móvel máx.',
        color: 'var(--accent)',
        x: env.max.x,
        y: withDead ? add(env.max.y, dead.y) : env.max.y,
      },
      {
        label: withDead ? 'Permanente + móvel mín.' : 'Móvel mín.',
        color: 'var(--blue)',
        x: env.min.x,
        y: withDead ? add(env.min.y, dead.y) : env.min.y,
        fillTo: 0,
      },
    ]
    if (withDead) out.push({ label: 'Permanente', color: 'var(--text-dim)', x: dead.x, y: dead.y, dash: true })
    return out
  }, [mv, results, path, q, withDead])

  if (!results) return <NoResults what="Envoltórias da carga móvel NBR 7188 aparecem aqui." />
  if (!mv) return <div className="empty">A carga móvel está desligada nas opções de análise.</div>

  const spec = VEHICLES[mv.vehicle]
  const qInfo = QUANTITIES.find((x) => x.key === q)!
  const inf = mv.influence[Math.min(infI, mv.influence.length - 1)]

  return (
    <div>
      <div className="panel-title">Trem-tipo NBR 7188 — {mv.vehicle}</div>
      <div className="stat-grid">
        <div className="stat">
          <div className="k">CIV</div>
          <div className="v">{fmt(mv.CIV, 3)}</div>
        </div>
        <div className="stat">
          <div className="k">CNF</div>
          <div className="v">{fmt(mv.CNF, 3)}</div>
        </div>
        <div className="stat">
          <div className="k">CIA</div>
          <div className="v">{fmt(mv.CIA, 2)}</div>
        </div>
        <div className="stat">
          <div className="k">Liv</div>
          <div className="v">
            {fmtAuto(mv.Liv)}
            <small>m</small>
          </div>
        </div>
      </div>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>Eixos do veículo</dt>
        <dd>
          {mv.nAxles} × {fmtAuto(mv.axleLoad)} kN a cada {fmtAuto(mv.axleSpacing)} m
        </dd>
        <dt>Carga distribuída</dt>
        <dd>{fmtAuto(mv.distributed)} kN/m</dd>
        <dt>Faixas consideradas</dt>
        <dd style={{ fontFamily: 'var(--sans)' }}>{mv.lanes.join(', ') || '—'}</dd>
      </dl>
      {spec && (
        <div className="note" style={{ marginTop: 6 }}>
          Valores já com os coeficientes de impacto. Carga por eixo descontada da distribuída sob o veículo.
        </div>
      )}

      <div className="panel-section">
        <div className="panel-title">Envoltória ao longo do tabuleiro</div>
        {paths.length === 0 ? (
          <div className="note">O modelo não tem faixas de tráfego definidas.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              {paths.length > 1 && (
                <select className="select compact" value={laneI} onChange={(e) => setLaneI(Number(e.target.value))}>
                  {paths.map((p, i) => (
                    <option key={p.lane.id} value={i}>
                      {p.lane.name}
                    </option>
                  ))}
                </select>
              )}
              <select className="select compact" value={q} onChange={(e) => setQ(e.target.value as Quantity | 'uz')}>
                {QUANTITIES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
              {q !== 'uz' && (
                <label className="check">
                  <input type="checkbox" checked={withDead} onChange={(e) => setWithDead(e.target.checked)} />
                  Somar permanente
                </label>
              )}
            </div>
            <LineChart
              series={series}
              xLabel="estaca ao longo da faixa (m)"
              yLabel={`${q === 'uz' ? 'uz' : q} (${qInfo.unit})`}
              invertY={q === 'Mz'}
              marks={path?.supports}
              height={240}
            />
            {q === 'Mz' && <div className="note">Momentos positivos desenhados para baixo (fibra inferior tracionada).</div>}
          </>
        )}
      </div>

      {mv.influence.length > 0 && inf && (
        <div className="panel-section">
          <div className="panel-title">Linhas de influência</div>
          <select
            className="select"
            style={{ marginBottom: 8 }}
            value={Math.min(infI, mv.influence.length - 1)}
            onChange={(e) => setInfI(Number(e.target.value))}
          >
            {mv.influence.map((l, i) => (
              <option key={i} value={i}>
                {l.label}
              </option>
            ))}
          </select>
          <LineChart
            series={[{ label: inf.label, color: 'var(--accent)', x: inf.s, y: inf.eta }]}
            xLabel="posição da carga unitária (m)"
            yLabel="ordenada η"
            height={200}
          />
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- reações */

export function ReactionsTab({ results }: { results: BridgeResults | null }) {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  if (!results) return <NoResults what="As reações de apoio aparecem aqui." />
  const rs = results.deadLoad.reactions
  if (rs.length === 0) return <div className="empty">Nenhuma reação calculada.</div>
  const sum = [0, 0, 0, 0, 0, 0]
  for (const r of rs) for (let d = 0; d < 6; d++) sum[d] += r.R[d]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table className="table clickable">
          <thead>
            <tr>
              <th className="left">Nó</th>
              <th>Fx (kN)</th>
              <th>Fy (kN)</th>
              <th>Fz (kN)</th>
              <th>Mx (kN·m)</th>
              <th>My (kN·m)</th>
              <th>Mz (kN·m)</th>
            </tr>
          </thead>
          <tbody>
            {rs.map((r) => (
              <tr
                key={r.node}
                className={selection?.kind === 'node' && selection.id === r.node ? 'selected' : ''}
                onClick={() => select({ kind: 'node', id: r.node })}
              >
                <td className="left">{r.node}</td>
                {r.R.map((v, d) => (
                  <td key={d}>{fmt(v, d < 3 ? 1 : 1)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="left">Σ</td>
              {sum.slice(0, 3).map((v, d) => (
                <td key={d}>{fmt(v, 1)}</td>
              ))}
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="note" style={{ padding: '8px 12px', flex: 'none', borderTop: '1px solid var(--border)' }}>
        Reações sob carga permanente, em eixos globais (X ao longo da ponte, Z para cima).
      </div>
    </div>
  )
}
