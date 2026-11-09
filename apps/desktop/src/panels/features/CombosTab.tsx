import { useMemo, useState } from 'react'
import type { BridgeModel, BridgeResults, CombinationResult, EnvForces } from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto } from '../../format'
import { LineChart, type Series } from '../../ui/Chart'
import { NoResults } from '../tabs'
import { deadAlong, lanePaths, type LanePath, type Quantity } from '../data'

type LimitKey = 'elu' | 'elsRare' | 'elsFreq' | 'elsQp'
type Triple = [number, number, number]

const LIMITS: { key: LimitKey; label: string; code: string[] }[] = [
  { key: 'elu', label: 'ELU', code: ['ELU', 'ELU-EXC'] },
  { key: 'elsRare', label: 'ELS rara', code: ['ELS-R'] },
  { key: 'elsFreq', label: 'ELS frequente', code: ['ELS-F'] },
  { key: 'elsQp', label: 'ELS quase perm.', code: ['ELS-QP'] },
]

const QUANTS: { key: Quantity; label: string; unit: string }[] = [
  { key: 'Mz', label: 'Momento fletor Mz', unit: 'kN·m' },
  { key: 'Vy', label: 'Cortante Vy', unit: 'kN' },
  { key: 'N', label: 'Normal N', unit: 'kN' },
  { key: 'T', label: 'Torçor T', unit: 'kN·m' },
  { key: 'My', label: 'Momento lateral My', unit: 'kN·m' },
]

/** valores de uma grandeza ao longo da faixa: 3 estações por barra, com quebra onde não há barra */
function alongPath(path: LanePath, get: (id: number) => Triple | undefined): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  path.segs.forEach((seg, k) => {
    const a = path.s[k]
    const b = path.s[k + 1]
    const v = seg ? get(seg.id) : undefined
    if (!seg || !v) {
      x.push(a, b)
      y.push(NaN, NaN)
      return
    }
    const t: Triple = seg.flip ? [v[2], v[1], v[0]] : v
    x.push(a, (a + b) / 2, b)
    y.push(t[0], t[1], t[2])
  })
  return { x, y }
}

function factorText(f: Record<string, number>): string {
  return Object.entries(f)
    .map(([id, v]) => `${fmt(v, v === Math.round(v * 10) / 10 ? (v === Math.round(v) ? 0 : 1) : 2)}·${id}`)
    .join(' + ')
}

export function CombosTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const select = useStore((s) => s.select)
  const paths = useMemo(() => lanePaths(model), [model])
  const [laneI, setLaneI] = useState(0)
  const [limit, setLimit] = useState<LimitKey>('elu')
  const [q, setQ] = useState<Quantity>('Mz')

  const cb: CombinationResult | undefined = results?.combos
  const path = paths[Math.min(laneI, paths.length - 1)]
  const byId = useMemo(() => new Map((cb?.frames ?? []).map((f) => [f.id, f])), [cb])

  const series = useMemo<Series[]>(() => {
    if (!cb || !results || !path) return []
    const env = (id: number): EnvForces | undefined => byId.get(id)?.[limit]
    const mx = alongPath(path, (id) => env(id)?.[q].max)
    const mn = alongPath(path, (id) => env(id)?.[q].min)
    const dead = deadAlong(path, results.deadLoad.frames, q)
    return [
      { label: 'Máximo', color: 'var(--accent)', x: mx.x, y: mx.y },
      { label: 'Mínimo', color: 'var(--blue)', x: mn.x, y: mn.y, fillTo: 0 },
      { label: 'Permanente', color: 'var(--text-dim)', x: dead.x, y: dead.y, dash: true },
    ]
  }, [cb, results, path, byId, limit, q])

  /** extremos da grandeza escolhida: no tabuleiro (faixa) e em toda a estrutura */
  const extremes = useMemo(() => {
    if (!cb) return null
    const deckIds = new Set<number>()
    for (const p of paths) for (const s of p.segs) if (s) deckIds.add(s.id)
    const scan = (only: Set<number> | null) => {
      let max = -Infinity
      let min = Infinity
      let idMax = -1
      let idMin = -1
      for (const f of cb.frames) {
        if (only && !only.has(f.id)) continue
        const e = f[limit][q]
        for (let s = 0; s < 3; s++) {
          if (e.max[s] > max) {
            max = e.max[s]
            idMax = f.id
          }
          if (e.min[s] < min) {
            min = e.min[s]
            idMin = f.id
          }
        }
      }
      return idMax < 0 ? null : { max, min, idMax, idMin }
    }
    return { deck: deckIds.size ? scan(deckIds) : null, all: scan(null) }
  }, [cb, paths, limit, q])

  const cableStats = useMemo(() => {
    if (!cb || cb.cables.length === 0) return null
    let hi = cb.cables[0]
    let lo = cb.cables[0]
    for (const c of cb.cables) {
      if (c[limit][1] > hi[limit][1]) hi = c
      if (c[limit][0] < lo[limit][0]) lo = c
    }
    return { hi, lo }
  }, [cb, limit])

  const reactions = useMemo(() => {
    if (!cb) return []
    return cb.reactions.filter((r) => Math.abs(r.elu.max[2]) + Math.abs(r.elu.min[2]) > 1e-6)
  }, [cb])

  if (!results) return <NoResults what="As combinações NBR 8681 e as envoltórias de esforços aparecem aqui." />
  if (!cb) return <div className="empty">As combinações não foram calculadas nesta análise.</div>

  const lim = LIMITS.find((l) => l.key === limit)!
  const qi = QUANTS.find((x) => x.key === q)!
  const list = cb.list.filter((c) => lim.code.includes(c.limit))
  const stat = (label: string, v: number, id: number) => (
    <div className="stat" style={{ cursor: 'pointer' }} title="Selecionar a barra no 3D" onClick={() => select({ kind: 'element', id })}>
      <div className="k">{label}</div>
      <div className="v">
        {fmtAuto(v)}
        <small>{qi.unit}</small>
      </div>
      <div className="cmb-where">barra {id}</div>
    </div>
  )

  return (
    <div>
      <div className="panel-title">Combinações NBR 8681</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <div className="seg cmb-seg">
          {LIMITS.map((l) => (
            <button key={l.key} className={limit === l.key ? 'active' : ''} onClick={() => setLimit(l.key)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <select className="select compact" value={q} onChange={(e) => setQ(e.target.value as Quantity)}>
          {QUANTS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        {paths.length > 1 && (
          <select className="select compact" value={laneI} onChange={(e) => setLaneI(Number(e.target.value))}>
            {paths.map((p, i) => (
              <option key={p.lane.id} value={i}>
                {p.lane.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {path ? (
        <>
          <LineChart
            series={series}
            xLabel="estaca ao longo do tabuleiro (m)"
            yLabel={`${q} (${qi.unit})`}
            invertY={q === 'Mz'}
            marks={path.supports}
            height={240}
          />
          {q === 'Mz' && <div className="note">Momentos positivos desenhados para baixo (fibra inferior tracionada).</div>}
        </>
      ) : (
        <div className="note">O modelo não tem faixas de tráfego: sem eixo de tabuleiro para desenhar a envoltória.</div>
      )}

      {extremes && (extremes.deck || extremes.all) && (
        <div className="panel-section">
          <div className="panel-title">
            Extremos — {lim.label}, {q}
          </div>
          <div className="stat-grid">
            {extremes.deck && stat('Tabuleiro, máx.', extremes.deck.max, extremes.deck.idMax)}
            {extremes.deck && stat('Tabuleiro, mín.', extremes.deck.min, extremes.deck.idMin)}
            {extremes.all && stat('Estrutura, máx.', extremes.all.max, extremes.all.idMax)}
            {extremes.all && stat('Estrutura, mín.', extremes.all.min, extremes.all.idMin)}
          </div>
          {cableStats && (
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Maior tração em cabo</dt>
              <dd>
                {fmtAuto(cableStats.hi[limit][1])} kN <span className="dim">cabo {cableStats.hi.id}</span>
              </dd>
              <dt>Menor tração em cabo</dt>
              <dd className={cableStats.lo[limit][0] <= 0 ? 'cmb-bad' : ''}>
                {fmtAuto(cableStats.lo[limit][0])} kN <span className="dim">cabo {cableStats.lo.id}</span>
              </dd>
            </dl>
          )}
          {cableStats && cableStats.lo[limit][0] <= 0 && (
            <div className="msg warn" style={{ marginTop: 8 }}>
              Há cabo que pode afrouxar nesta combinação (tração mínima ≤ 0).
            </div>
          )}
        </div>
      )}

      {reactions.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">Reações verticais de apoio</div>
          <table className="table clickable">
            <thead>
              <tr>
                <th className="left">Nó</th>
                <th>ELU mín (kN)</th>
                <th>ELU máx (kN)</th>
                <th>Rara mín (kN)</th>
                <th>Rara máx (kN)</th>
              </tr>
            </thead>
            <tbody>
              {reactions.map((r) => (
                <tr key={r.node} onClick={() => select({ kind: 'node', id: r.node })}>
                  <td className="left">{r.node}</td>
                  <td className={r.elu.min[2] < 0 ? 'bad' : ''} title={r.elu.min[2] < 0 ? 'Levantamento do apoio' : undefined}>
                    {fmt(r.elu.min[2], 0)}
                  </td>
                  <td>{fmt(r.elu.max[2], 0)}</td>
                  <td>{fmt(r.elsRare.min[2], 0)}</td>
                  <td>{fmt(r.elsRare.max[2], 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-section">
        <div className="panel-title">
          Combinações geradas — {lim.label}
          <span className="grow" />
          <span className="chip">{cb.list.length} no total</span>
        </div>
        {list.length === 0 ? (
          <div className="note">Sem ações variáveis: só as ações permanentes.</div>
        ) : (
          list.map((c) => (
            <div key={c.id} className="cmb-item">
              <div className="cmb-head">
                <b>{c.id}</b> {c.name.replace(/^[^—]*— /, '')}
              </div>
              <div className="cmb-factors">{factorText(c.factors)}</div>
            </div>
          ))
        )}
        <div className="note" style={{ marginTop: 8 }}>
          G = permanente (no ELU, 1,0 onde é favorável); Q = carga móvel NBR 7188, com a frenagem FR. Cada ação variável só
          entra onde é desfavorável; pares como TU+/TU− são alternativas (entra no máximo um); W é o vento com a ponte
          descarregada e nunca soma com Q; ações ± entram com o pior sinal. As envoltórias são por esforço — máximos de
          esforços diferentes não são concomitantes.
        </div>
      </div>
    </div>
  )
}
