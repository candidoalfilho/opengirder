import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SITE,
  SEISMIC_ZONES,
  designSpectrum,
  resolveSite,
  soilFactors,
  type BridgeModel,
  type BridgeResults,
  type SeismicParams,
} from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto, fmtInt, GROUP_LABEL, numToInput, parseNum } from '../../format'
import { LineChart, type Series } from '../../ui/Chart'

/** campo numérico que só grava ao sair do campo ou com Enter (editar descarta os resultados) */
function NumField({
  label,
  unit,
  value,
  min,
  max,
  onCommit,
}: {
  label: string
  unit?: string
  value: number
  min: number
  max: number
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
    </div>
  )
}

const SOILS: { v: SeismicParams['soil']; label: string }[] = [
  { v: 'A', label: 'A — rocha sã' },
  { v: 'B', label: 'B — rocha' },
  { v: 'C', label: 'C — rocha alterada ou solo muito rígido' },
  { v: 'D', label: 'D — solo rígido' },
  { v: 'E', label: 'E — solo mole' },
]

const IMPORTANCE: { v: number; label: string }[] = [
  { v: 1, label: 'I = 1,0 — categoria de utilização I' },
  { v: 1.25, label: 'I = 1,25 — categoria II' },
  { v: 1.5, label: 'I = 1,5 — categoria III (essencial)' },
]

function zoneOf(ag: number): number {
  if (ag <= 0.025 + 1e-9) return 0
  if (ag <= 0.05 + 1e-9) return 1
  if (ag <= 0.1 + 1e-9) return 2
  if (ag < 0.15 - 1e-9) return 3
  return 4
}

const BUCKLING_LABEL = 'Flambagem — modo '

/* ---------------------------------------------------------------- flambagem */

function BucklingSection({ results }: { results: BridgeResults | null }) {
  const showOverlay = useStore((s) => s.showOverlay)
  const overlay = useStore((s) => s.overlay)
  const b = results?.buckling
  return (
    <>
      <div className="panel-title">Flambagem global</div>
      {!results && <div className="note">Rode a análise para calcular os fatores críticos de flambagem.</div>}
      {results && !b && (
        <div className="note">
          Sem resultado: o modelo não tem barras comprimidas sob carga permanente, ou a verificação está desligada.
        </div>
      )}
      {b && (
        <>
          <div className="stb-chips">
            <span className={`chip ${b.modes[0].factor >= b.minFactor ? 'ok' : 'err'}`}>
              λ mín = {fmt(b.modes[0].factor, 2)} {b.modes[0].factor >= b.minFactor ? '≥' : '<'} {fmt(b.minFactor, 0)}
            </span>
            <span className={`chip ${b.converged ? '' : 'warn'}`}>
              {b.converged ? 'convergiu' : 'não convergiu'} · {fmtInt(b.iterations)} iterações
            </span>
            <span className="chip">compressão máx. {fmtAuto(b.maxCompression)} kN</span>
          </div>
          <table className="table clickable stb-table">
            <thead>
              <tr>
                <th className="left">Modo</th>
                <th>λ crítico</th>
                <th className="left">Barras que flambam</th>
                <th>Parcela</th>
              </tr>
            </thead>
            <tbody>
              {b.modes.map((m) => {
                const label = `${BUCKLING_LABEL}${m.index}`
                const active = overlay?.label === label
                return (
                  <tr
                    key={m.index}
                    className={active ? 'selected' : ''}
                    onClick={() =>
                      showOverlay(
                        active
                          ? null
                          : { label, u: m.shape, animate: true, note: `λ = ${fmt(m.factor, 2)} × carga permanente` },
                      )
                    }
                  >
                    <td className="left">{m.index}</td>
                    <td className={m.factor < b.minFactor ? 'bad' : ''}>{fmt(m.factor, 2)}</td>
                    <td className="left" style={{ fontFamily: 'var(--sans)' }}>
                      {GROUP_LABEL[m.group] ?? m.group}
                    </td>
                    <td>{fmt(100 * m.share, 0)} %</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="note">
            Clique em um modo para animá-lo no 3D. λ multiplica os esforços normais da carga permanente característica
            (sem carga móvel nem coeficientes de ponderação); a rigidez dos cabos é mantida constante, a favor da
            segurança. Referência usual de estabilidade elástica global: λ ≥ {fmt(b.minFactor, 0)}.
          </div>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------- aerodinâmica */

function AeroSection({ results }: { results: BridgeResults | null }) {
  const a = results?.aero
  return (
    <>
      <div className="panel-title">Estabilidade aerodinâmica</div>
      {!results && <div className="note">Rode a análise (com a análise modal ligada) para verificar flutter, divergência e vórtices.</div>}
      {results && !a && (
        <div className="note">
          Sem resultado: é preciso a análise modal e um tabuleiro com largura definida; os modos calculados também
          precisam incluir um modo vertical ou torcional.
        </div>
      )}
      {a && (
        <>
          <dl className="kv stb-kv">
              <dt>Vento de projeto Vk (cota {fmt(a.z, 0)} m)</dt>
              <dd>{a.Vk > 0 ? `${fmt(a.Vk, 1)} m/s` : 'vento desligado'}</dd>
              <dt>Tabuleiro B × D</dt>
              <dd>
                {fmt(a.B, 1)} × {fmt(a.D, 2)} m
              </dd>
              <dt>Massa · raio de giração</dt>
              <dd>
                {fmt(a.mass, 1)} t/m · {fmt(a.radius, 2)} m
              </dd>
              <dt>1º modo vertical</dt>
              <dd>{a.modeV ? `${fmt(a.fV, 3)} Hz (modo ${a.modeV})` : 'não encontrado'}</dd>
              <dt>1º modo torcional</dt>
              <dd>{a.modeT ? `${fmt(a.fT, 3)} Hz (modo ${a.modeT})` : 'não encontrado'}</dd>
          </dl>
          <table className="table stb-table">
            <thead>
              <tr>
                <th className="left">Verificação</th>
                <th>Vcr (m/s)</th>
                <th>Vk (m/s)</th>
                <th className="left">Situação</th>
              </tr>
            </thead>
            <tbody>
              {a.checks.map((c) => (
                <tr key={c.key} title={c.note}>
                  <td className="left" style={{ fontFamily: 'var(--sans)' }}>
                    {c.label}
                    <div className="stb-sub">{c.note}</div>
                  </td>
                  <td className={c.ok === false ? 'bad' : c.ok ? 'good' : ''}>{c.value > 0 ? fmt(c.value, 1) : '—'}</td>
                  <td>{c.limit !== undefined ? fmt(c.limit, 1) : '—'}</td>
                  <td className="left">
                    {c.ok === undefined ? (
                      <span className="chip">informativo</span>
                    ) : c.ok ? (
                      <span className="chip ok">atende</span>
                    ) : (
                      <span className="chip err">não atende</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">
            Triagem simplificada: flutter pela fórmula de Selberg (placa plana × fator de forma {fmt(a.shapeFactor, 2)}),
            divergência com dCm/dα = π/2 e vórtices com St = 0,12. Não substitui ensaio em túnel de vento nem a análise
            com as derivadas de flutter da seção.
            {!a.modeT && ' Aumente o número de modos para incluir um modo torcional e habilitar o flutter.'}
          </div>
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------- sismo */

function SeismicSection({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const updateModel = useStore((s) => s.updateModel)
  const showOverlay = useStore((s) => s.showOverlay)
  const overlay = useStore((s) => s.overlay)
  const p = useMemo(() => resolveSite(model).seismic, [model])
  const set = (s: SeismicParams | false) => updateModel((m) => ({ ...m, site: { ...m.site, seismic: s } }))
  const E = results?.cases?.find((c) => c.kind === 'seismic')
  const modes = results?.modal?.modes

  const chart = useMemo(() => {
    if (!p) return null
    const tMax = Math.min(8, Math.max(3, 1.15 * (modes?.[0]?.period ?? 0)))
    const x: number[] = []
    const elastic: number[] = []
    const design: number[] = []
    const n = 240
    for (let i = 0; i <= n; i++) {
      // malha mais fina nos períodos curtos
      const t = tMax * (i / n) ** 1.6
      const sa = designSpectrum(p, t)
      x.push(t)
      elastic.push(sa)
      design.push((sa * p.I) / p.R)
    }
    const series: Series[] = [
      { label: 'Sa elástico (g)', color: 'var(--text-dim)', x, y: elastic, dash: true },
      { label: 'Sa·I/R de projeto (g)', color: 'var(--accent)', x, y: design },
    ]
    const marks = (modes ?? []).map((m) => m.period).filter((t) => t <= tMax)
    return { series, marks }
  }, [p, modes])

  const f = p ? soilFactors(p.soil, p.ag) : null
  const label = 'E — sismo (envoltória espectral)'
  const active = overlay?.label === label

  return (
    <>
      <div className="panel-title">Sismo — NBR 15421</div>
      <div className="stb-block">
        <label className="check">
          <input type="checkbox" checked={!!p} onChange={(e) => set(e.target.checked ? { ...DEFAULT_SITE.seismic } : false)} />
          Considerar ação sísmica (análise espectral)
        </label>
        {p && (
          <div className="stb-grid">
            <div className="field wide">
              <label className="label">Zona sísmica</label>
              <select
                className="select"
                value={zoneOf(p.ag)}
                onChange={(e) => {
                  const z = SEISMIC_ZONES[Number(e.target.value)]
                  if (z) set({ ...p, ag: z.agMax })
                }}
              >
                {SEISMIC_ZONES.map((z) => (
                  <option key={z.zone} value={z.zone}>
                    {z.label.replace(/\./g, ',')}
                  </option>
                ))}
              </select>
            </div>
            <NumField label="ag (rocha)" unit="g" value={p.ag} min={0.005} max={0.6} onCommit={(v) => set({ ...p, ag: v })} />
            <NumField label="Coef. de modificação R" value={p.R} min={1} max={8} onCommit={(v) => set({ ...p, R: v })} />
            <div className="field wide">
              <label className="label">Classe do terreno</label>
              <select className="select" value={p.soil} onChange={(e) => set({ ...p, soil: e.target.value as SeismicParams['soil'] })}>
                {SOILS.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field wide">
              <label className="label">Fator de importância</label>
              <select
                className="select"
                value={IMPORTANCE.find((i) => Math.abs(i.v - p.I) < 1e-9) ? p.I : 'x'}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) set({ ...p, I: v })
                }}
              >
                {IMPORTANCE.map((i) => (
                  <option key={i.v} value={i.v}>
                    {i.label}
                  </option>
                ))}
                {!IMPORTANCE.find((i) => Math.abs(i.v - p.I) < 1e-9) && <option value="x">I = {fmt(p.I, 2)}</option>}
              </select>
            </div>
          </div>
        )}
      </div>

      {p && f && chart && (
        <>
          <div className="stb-chips">
            <span className="chip">
              Ca = {fmt(f.Ca, 2)} · Cv = {fmt(f.Cv, 2)}
            </span>
            <span className="chip">ags0 = {fmt(f.Ca * p.ag, 3)} g</span>
            <span className="chip">ags1 = {fmt(f.Cv * p.ag, 3)} g</span>
            <span className="chip accent">patamar {fmt(2.5 * f.Ca * p.ag, 3)} g</span>
          </div>
          <LineChart series={chart.series} xLabel="Período T (s)" yLabel="Sa (g)" height={190} marks={chart.marks} />
          <div className="note">
            Espectro de resposta de projeto (5 % de amortecimento). As linhas verticais marcam os períodos dos modos
            calculados. A NBR 15421 não traz coeficientes R para pontes: R e I são dados do projetista.
          </div>
        </>
      )}

      {p && !E && (
        <div className="note">
          {results
            ? 'O caso sísmico não foi calculado nesta análise — ligue a análise modal e rode de novo.'
            : 'Rode a análise para obter os esforços sísmicos (caso E, combinação excepcional).'}
        </div>
      )}
      {E && (
        <>
          <dl className="kv stb-kv">
            {(E.info ?? []).map((i) => (
              <Fragment key={i.label}>
                <dt>{i.label}</dt>
                <dd>
                  {i.unit === 'g' ? fmt(i.value, 3) : i.unit === '%' ? fmt(i.value, 1) : i.unit === 's' ? fmt(i.value, 3) : fmtAuto(i.value)}
                  {i.unit ? ` ${i.unit}` : ''}
                </dd>
              </Fragment>
            ))}
          </dl>
          <button
            className="btn"
            onClick={() =>
              showOverlay(active ? null : { label, u: E.u, animate: false, note: 'deslocamentos máximos (CQC, sem sinal)' })
            }
          >
            {active ? 'Voltar ao modelo' : 'Ver deslocamentos sísmicos no 3D'}
          </button>
          <div className="note">
            Modos combinados pela CQC, direções por 100 % + 30 % + 30 % (vertical com 50 % do espectro); a massa que os
            modos não mobilizam entra como resposta estática. Esforços com I/R, deslocamentos com I. O caso entra nas
            combinações excepcionais como ±E.
          </div>
        </>
      )}
    </>
  )
}

export function StabilityTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  return (
    <div className="stb-tab">
      <BucklingSection results={results} />
      <AeroSection results={results} />
      <SeismicSection model={model} results={results} />
    </div>
  )
}

/** nº de verificações reprovadas (flambagem abaixo do mínimo + aerodinâmicas) — p/ o selo da aba */
export function stabilityFailures(results: BridgeResults | null): number {
  if (!results) return 0
  const b = results.buckling
  return (b && b.modes[0].factor < b.minFactor ? 1 : 0) + (results.aero?.checks.filter((c) => c.ok === false).length ?? 0)
}
