import { useEffect, useMemo, useState } from 'react'
import {
  autoDesignPrestress,
  buildProfile,
  deckPrestressSection,
  refineTendons,
  tendonData,
  type BridgeModel,
  type BridgeResults,
  type Tendon,
  type TendonPoint,
  type TendonStress,
} from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto, fmtInt, numToInput, parseNum } from '../../format'
import { LineChart, type Series } from '../../ui/Chart'
import { lanePaths } from '../data'

/* Aba "Protensão": dados e traçado do cabo resultante, perdas, momentos de protensão e
 * verificação das tensões normais no ato da protensão e em serviço (NBR 6118). */

export function prestressVisible(model: BridgeModel): boolean {
  return model.type === 'girder' || (model.tendons?.length ?? 0) > 0
}

/** campo numérico que só grava ao sair (ou Enter) — o modelo não muda a cada tecla */
function NumField({
  label,
  unit,
  value,
  placeholder,
  scale = 1,
  integer = false,
  min,
  bare = false,
  onCommit,
}: {
  /** sem rótulo (célula de tabela) */
  bare?: boolean
  label: string
  unit?: string
  /** valor no modelo; undefined = padrão */
  value: number | undefined
  placeholder?: string
  /** valor exibido = valor do modelo × scale */
  scale?: number
  integer?: boolean
  min?: number
  onCommit: (v: number | undefined) => void
}) {
  const shown = value === undefined ? '' : numToInput(value * scale)
  const [text, setText] = useState(shown)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(shown)
    setBad(false)
  }, [shown])
  const commit = () => {
    if (text.trim() === '') {
      if (placeholder !== undefined) {
        if (value !== undefined) onCommit(undefined)
        setBad(false)
      } else {
        setText(shown)
      }
      return
    }
    let v = parseNum(text)
    if (!Number.isFinite(v) || (min !== undefined && v < min)) {
      setBad(true)
      return
    }
    if (integer) v = Math.round(v)
    setBad(false)
    if (value === undefined || Math.abs(v / scale - value) > 1e-12 * Math.max(1, Math.abs(value))) onCommit(v / scale)
    else setText(shown)
  }
  return (
    <div className="field">
      {!bare && (
        <div className="label">
          <span>{label}</span>
          {unit && <span className="unit">{unit}</span>}
        </div>
      )}
      <input
        className={`input ${bad ? 'invalid' : ''}`}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </div>
  )
}

const KIND_LABEL: Record<NonNullable<TendonPoint['kind']>, string> = {
  anchor: 'Ancoragem / tangente livre',
  span: 'Ponto baixo (vão)',
  support: 'Ponto alto (apoio)',
}

const STRESS_KEYS: TendonStress['key'][] = ['qp', 'freq', 'rare', 'transfer']

export function PrestressTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const updateModel = useStore((s) => s.updateModel)
  const notify = useStore((s) => s.notify)
  const tendons = model.tendons ?? []
  const [ti, setTi] = useState(0)
  const [sit, setSit] = useState<TendonStress['key']>('qp')
  const [showPoints, setShowPoints] = useState(false)
  const idx = Math.min(ti, Math.max(0, tendons.length - 1))
  const tendon: Tendon | undefined = tendons[idx]

  const deck = useMemo(() => deckPrestressSection(model, tendon?.lane), [model, tendon?.lane])
  const path = useMemo(() => {
    const paths = lanePaths(model)
    return paths.find((p) => p.lane.id === tendon?.lane) ?? paths[0]
  }, [model, tendon?.lane])

  const profile = useMemo(() => {
    if (!tendon) return null
    try {
      return buildProfile(tendon.profile, tendon.inflection)
    } catch {
      return null
    }
  }, [tendon])

  const patch = (p: Partial<Tendon>) =>
    updateModel((m) => ({
      ...m,
      tendons: (m.tendons ?? []).map((t, i) => {
        if (i !== idx) return t
        const out = { ...t, ...p } as Tendon
        // undefined = volta ao padrão: remove a chave p/ não sujar o arquivo
        const bag = out as unknown as Record<string, unknown>
        for (const k of Object.keys(p)) if (bag[k] === undefined) delete bag[k]
        return out
      }),
    }))

  const design = () => {
    // balanceamento de cargas + ajuste pelas tensões (roda a análise do modelo algumas vezes)
    let auto: ReturnType<typeof autoDesignPrestress> = null
    try {
      auto = autoDesignPrestress({ ...model, tendons: undefined }, { level: tendon?.level, strandArea: tendon?.strandArea, fptk: tendon?.fptk })
    } catch (err) {
      notify(err instanceof Error ? err.message.split('\n')[0] : String(err), 'err')
      return
    }
    const t = auto?.model.tendons?.[0]
    if (!auto || !t) {
      notify('Não foi possível pré-dimensionar: o modelo precisa de uma faixa sobre o tabuleiro.', 'err')
      return
    }
    updateModel((m) => {
      const cur = m.tendons ?? []
      if (cur.length === 0) return { ...m, tendons: [t] }
      // mantém os parâmetros de atrito/perdas já editados; troca traçado e nº de cordoalhas
      return { ...m, tendons: cur.map((c, i) => (i === idx ? { ...c, nStrands: t.nStrands, profile: t.profile, lane: t.lane } : c)) }
    })
    notify(
      auto.ok
        ? `Protensão pré-dimensionada: ${t.nStrands} cordoalhas, tensões em serviço atendidas. Rode a análise para ver os resultados.`
        : `Protensão pré-dimensionada com ${t.nStrands} cordoalhas, mas ainda há verificações não atendidas — rode a análise e ajuste o traçado.`,
      auto.ok ? 'info' : 'err',
    )
  }

  const refine = () => {
    if (!results) return
    const next = refineTendons(model, results)
    if (!next) {
      notify('Nada a ajustar: as verificações de tração já são atendidas.')
      return
    }
    updateModel(() => next)
    notify(`Cabo ajustado (${next.tendons!.map((t) => t.nStrands).join(' + ')} cordoalhas). Rode a análise de novo.`)
  }

  if (!tendon) {
    const concrete = model.meta?.deckMaterial ? model.meta.deckMaterial === 'concrete' : true
    return (
      <div>
        <div className="panel-title">Protensão do tabuleiro</div>
        <div className="note">
          Este modelo não tem cabos de protensão. O pré-dimensionamento cria um cabo resultante pós-tracionado ao longo
          da faixa, com traçado parabólico (embaixo nos vãos, em cima sobre os apoios) e força para balancear a carga
          permanente.
        </div>
        {!concrete && <div className="msg warn" style={{ marginTop: 10 }}>O tabuleiro deste modelo não é de concreto.</div>}
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!deck} onClick={design}>
          Pré-dimensionar protensão
        </button>
      </div>
    )
  }

  const td = tendonData(tendon)
  const tr = results?.prestress?.tendons?.find((t) => t.id === tendon.id)
  const checks = results?.prestress?.checks?.filter((c) => c.tendon === tendon.id) ?? []
  const fails = checks.filter((c) => !c.ok && !c.informative)
  const supports = tr?.supports ?? path?.supports

  // ---- traçado (cota em relação ao centroide: para cima +)
  const profSeries: Series[] = []
  if (profile && deck) {
    const s0 = profile.s0
    const s1 = profile.s1
    const xs = Array.from({ length: 161 }, (_, i) => s0 + ((s1 - s0) * i) / 160)
    const ends = [Math.min(s0, 0), Math.max(s1, path?.length ?? s1)]
    profSeries.push(
      { label: 'Face superior', color: 'var(--text-dim)', x: ends, y: [deck.sec.yTop, deck.sec.yTop] },
      { label: 'Face inferior', color: 'var(--text-dim)', x: ends, y: [-deck.sec.yBot, -deck.sec.yBot], fillTo: 0 },
      { label: 'Centroide', color: 'var(--text-dim)', x: ends, y: [0, 0], dash: true },
      { label: 'Cabo resultante', color: 'var(--accent)', x: xs, y: xs.map((s) => -profile.e(s)) },
    )
  }

  const stress = tr?.stress?.find((q) => q.key === sit)
  const limitLines = (): Series[] => {
    if (!tr || !stress) return []
    const x = [tr.s[0], tr.s[tr.s.length - 1]]
    const tens = checks.find((c) =>
      sit === 'transfer' ? c.key === 'transfer-t' : (c.key === 'els-d' || c.key === 'els-f') && c.combo === stress.label,
    )
    const comp = checks.find((c) => (sit === 'transfer' ? c.key === 'transfer-c' : sit === 'rare' && c.key === 'service-c'))
    const out: Series[] = []
    if (tens) out.push({ label: 'Limite de tração', color: 'var(--err)', x, y: [tens.limit / 1000, tens.limit / 1000], dash: true })
    if (comp) out.push({ label: 'Limite de compressão', color: 'var(--warn)', x, y: [comp.limit / 1000, comp.limit / 1000], dash: true })
    return out
  }

  const setPoint = (i: number, p: Partial<TendonPoint>) =>
    patch({ profile: tendon.profile.map((q, k) => (k === i ? { ...q, ...p } : q)) })

  return (
    <div>
      <div className="panel-title">
        Protensão do tabuleiro
        <span className="grow" />
        {results?.prestress?.ok !== undefined && (
          <span className={`chip ${results.prestress.ok ? 'ok' : 'err'}`}>{results.prestress.ok ? 'tensões OK' : `${fails.length} não atende`}</span>
        )}
      </div>
      {tendons.length > 1 && (
        <select className="select" style={{ marginBottom: 8 }} value={idx} onChange={(e) => setTi(Number(e.target.value))}>
          {tendons.map((t, i) => (
            <option key={t.id} value={i}>
              {t.name ?? `Cabo ${t.id}`}
            </option>
          ))}
        </select>
      )}

      <div className="stat-grid">
        <div className="stat">
          <div className="k">Cordoalhas</div>
          <div className="v">{fmtInt(tendon.nStrands)}</div>
        </div>
        <div className="stat">
          <div className="k">Pi (macaco)</div>
          <div className="v">
            {fmtAuto(td.Pi)}
            <small>kN</small>
          </div>
        </div>
        <div className="stat">
          <div className="k">P∞ médio</div>
          <div className="v">
            {tr ? fmtAuto(td.Pi * (1 - tr.lossTotalPct / 100)) : '—'}
            <small>kN</small>
          </div>
        </div>
        <div className="stat">
          <div className="k">Perda total</div>
          <div className="v">
            {tr ? fmt(tr.lossTotalPct, 1) : '—'}
            <small>%</small>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Cabo resultante</div>
        <div className="field-grid">
          <NumField label="Nº de cordoalhas" value={tendon.nStrands} integer min={1} onCommit={(v) => v !== undefined && patch({ nStrands: v })} />
          <NumField label="Área da cordoalha" unit="mm²" value={tendon.strandArea} scale={1e6} min={1} onCommit={(v) => v !== undefined && patch({ strandArea: v })} />
          <NumField label="fptk" unit="MPa" value={tendon.fptk} scale={1e-3} min={1} onCommit={(v) => v !== undefined && patch({ fptk: v })} />
          <NumField
            label="σpi no macaco"
            unit="MPa"
            value={tendon.sigmaPi}
            scale={1e-3}
            min={1}
            placeholder={`${fmt(tendonData({ ...tendon, sigmaPi: undefined }).sigmaPi / 1000, 0)} (limite da norma)`}
            onCommit={(v) => patch({ sigmaPi: v })}
          />
          <NumField label="Atrito μ" value={tendon.mu} min={0} placeholder="0,2" onCommit={(v) => patch({ mu: v })} />
          <NumField label="Perda parasita k" unit="1/m" value={tendon.k} min={0} placeholder={`${numToInput(0.01 * td.mu)} (0,01·μ)`} onCommit={(v) => patch({ k: v })} />
          <NumField label="Acomodação da ancoragem" unit="mm" value={tendon.slip} scale={1000} min={0} placeholder="6" onCommit={(v) => patch({ slip: v })} />
          <NumField label="Nº de cabos (bainhas)" value={tendon.nCables} integer min={1} placeholder={String(td.nCables)} onCommit={(v) => patch({ nCables: v })} />
          <div className="field">
            <div className="label">
              <span>Protensão por</span>
            </div>
            <select className="select" value={tendon.jacking ?? 'both'} onChange={(e) => patch({ jacking: e.target.value as Tendon['jacking'] })}>
              <option value="both">Duas extremidades</option>
              <option value="start">Só o início</option>
              <option value="end">Só o fim</option>
            </select>
          </div>
          <div className="field">
            <div className="label">
              <span>Nível de protensão</span>
            </div>
            <select className="select" value={tendon.level ?? 'limitada'} onChange={(e) => patch({ level: e.target.value as Tendon['level'] })}>
              <option value="limitada">Limitada (nível 2)</option>
              <option value="completa">Completa (nível 3)</option>
            </select>
          </div>
          <NumField label="Fluência φ(∞, t0)" value={tendon.phi} min={0} placeholder="2,5" onCommit={(v) => patch({ phi: v })} />
          <NumField
            label="Retração εcs(∞, t0)"
            unit="‰"
            value={tendon.epsCs === undefined ? undefined : Math.abs(tendon.epsCs)}
            scale={1000}
            min={0}
            placeholder="0,25"
            onCommit={(v) => patch({ epsCs: v === undefined ? undefined : -v })}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="btn" onClick={design} title="Traçado automático e nº de cordoalhas: balanceia a carga permanente e ajusta pelas tensões em serviço">
            Pré-dimensionar
          </button>
          <button
            className="btn"
            onClick={refine}
            disabled={!results?.prestress?.checks}
            title={results?.prestress?.checks ? 'Um passo de ajuste: mais cordoalhas ou traçado menos excêntrico, conforme a verificação que falha' : 'Rode a análise para habilitar'}
          >
            Ajustar pelo ELS
          </button>
          <button className="btn btn-ghost" onClick={() => updateModel((m) => ({ ...m, tendons: (m.tendons ?? []).filter((_, i) => i !== idx) }))}>
            Remover
          </button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">
          Traçado
          <span className="grow" />
          <label className="check" style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} />
            Editar pontos
          </label>
        </div>
        {profile && deck ? (
          <LineChart series={profSeries} xLabel="estaca ao longo do tabuleiro (m)" yLabel="cota em relação ao centroide (m)" marks={supports} height={190} />
        ) : (
          <div className="msg err">O traçado precisa de pelo menos 2 pontos com estacas diferentes.</div>
        )}
        <div className="note">
          Parábolas entre os pontos de controle; inflexão a {fmt(100 * (tendon.inflection ?? 0.2), 0)}% do trecho a partir do ponto alto.
          {tr && (
            <>
              {' '}
              Desvio angular total {fmt((tr.totalAngle * 180) / Math.PI, 1)}° · alongamento teórico {fmt(tr.elongation * 1000, 0)} mm.
            </>
          )}
        </div>
        {showPoints && (
          <div className="pt-points">
            <table className="table">
              <thead>
                <tr>
                  <th className="left">Estaca (m)</th>
                  <th className="left">Excentricidade (m, + p/ baixo)</th>
                  <th className="left">Tipo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tendon.profile.map((p, i) => {
                  const kind = p.kind ?? (i === 0 || i === tendon.profile.length - 1 ? 'anchor' : 'span')
                  return (
                    <tr key={i}>
                      <td className="left">
                        <NumField bare label="" value={p.s} min={0} onCommit={(v) => v !== undefined && setPoint(i, { s: v })} />
                      </td>
                      <td className="left">
                        <NumField bare label="" value={p.e} onCommit={(v) => v !== undefined && setPoint(i, { e: v })} />
                      </td>
                      <td className="left">
                        <select className="select compact" value={kind} onChange={(e) => setPoint(i, { kind: e.target.value as TendonPoint['kind'] })}>
                          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          disabled={tendon.profile.length <= 2}
                          title="Remover ponto"
                          onClick={() => patch({ profile: tendon.profile.filter((_, k) => k !== i) })}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 6 }}
              onClick={() => {
                const pts = tendon.profile
                const a = pts[pts.length - 2]
                const b = pts[pts.length - 1]
                const mid: TendonPoint = { s: 0.5 * (a.s + b.s), e: 0.5 * (a.e + b.e), kind: 'span' }
                patch({ profile: [...pts.slice(0, -1), mid, b] })
              }}
            >
              + ponto
            </button>
            {deck && (
              <div className="note">
                Seção: centroide a {fmt(deck.sec.yTop, 3)} m da face superior e {fmt(deck.sec.yBot, 3)} m da inferior.
              </div>
            )}
          </div>
        )}
      </div>

      {!results && <div className="note" style={{ marginTop: 14 }}>Rode a análise para ver perdas, momentos de protensão e tensões.</div>}
      {results && !tr && (
        <div className="msg warn" style={{ marginTop: 14 }}>
          A protensão não foi calculada nesta análise — veja os avisos na aba Resumo.
        </div>
      )}

      {tr && (
        <>
          <div className="panel-section">
            <div className="panel-title">Força de protensão e perdas</div>
            <LineChart
              series={[
                { label: 'No estiramento (só atrito)', color: 'var(--text-dim)', x: tr.s, y: tr.Pjack, dash: true },
                { label: 'Após a cravação', color: 'var(--blue)', x: tr.s, y: tr.Panc },
                { label: 'P0 (após perdas imediatas)', color: 'var(--ok)', x: tr.s, y: tr.P0 },
                { label: 'P∞ (após todas as perdas)', color: 'var(--accent)', x: tr.s, y: tr.Pinf },
              ]}
              xLabel="estaca (m)"
              yLabel="P (kN)"
              marks={tr.supports}
              height={210}
            />
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Tensão no macaco σpi</dt>
              <dd>
                {fmt(tr.sigmaPi / 1000, 0)} MPa ({fmt(tr.sigmaPi / td.fptk, 2)}·fptk)
              </dd>
              <dt>Perdas imediatas (atrito, acomodação, encurtamento)</dt>
              <dd>{fmt(tr.lossImmediatePct, 1)} %</dd>
              <dt>Perdas progressivas (fluência, retração, relaxação)</dt>
              <dd>{fmt(tr.lossProgressivePct, 1)} %</dd>
              <dt>Comprimento afetado pela acomodação</dt>
              <dd>
                {tr.slipLength
                  .filter((v) => v > 0)
                  .map((v) => `${fmt(v, 1)} m`)
                  .join(' · ') || '—'}
              </dd>
              {deck && (
                <>
                  <dt>Compressão média P∞/A</dt>
                  <dd>{fmt((td.Pi * (1 - tr.lossTotalPct / 100)) / deck.sec.A / 1000, 2)} MPa</dd>
                </>
              )}
            </dl>
          </div>

          <div className="panel-section">
            <div className="panel-title">Momentos de protensão (t = ∞)</div>
            <LineChart
              series={[
                { label: 'Isostático −P·e', color: 'var(--blue)', x: tr.s, y: tr.Miso, dash: true },
                { label: 'Hiperestático', color: 'var(--ok)', x: tr.s, y: tr.Mhyp },
                { label: 'Total', color: 'var(--accent)', x: tr.s, y: tr.Mtot },
              ]}
              xLabel="estaca (m)"
              yLabel="Mz (kN·m)"
              invertY
              marks={tr.supports}
              height={210}
            />
            <div className="note">
              O total sai da análise com as cargas equivalentes do cabo; o hiperestático é a diferença para −P·e e vem das
              reações de apoio. Momentos positivos desenhados para baixo.
            </div>
          </div>

          {tr.stress && stress && (
            <div className="panel-section">
              <div className="panel-title">Tensões normais no concreto</div>
              <select className="select" style={{ marginBottom: 8 }} value={sit} onChange={(e) => setSit(e.target.value as TendonStress['key'])}>
                {STRESS_KEYS.map((k) => {
                  const q = tr.stress!.find((x) => x.key === k)
                  return q ? (
                    <option key={k} value={k}>
                      {q.label}
                    </option>
                  ) : null
                })}
              </select>
              <LineChart
                series={[
                  { label: 'Fibra superior — máx.', color: 'var(--blue)', x: tr.s, y: stress.topMax.map((v) => v / 1000) },
                  { label: 'Fibra superior — mín.', color: 'var(--blue)', x: tr.s, y: stress.topMin.map((v) => v / 1000), dash: true },
                  { label: 'Fibra inferior — máx.', color: 'var(--accent)', x: tr.s, y: stress.botMax.map((v) => v / 1000) },
                  { label: 'Fibra inferior — mín.', color: 'var(--accent)', x: tr.s, y: stress.botMin.map((v) => v / 1000), dash: true },
                  ...limitLines(),
                ]}
                xLabel="estaca (m)"
                yLabel="σ (MPa, tração +)"
                marks={tr.supports}
                height={230}
              />
              <div className="note">Seção bruta no estádio I. Envoltórias de N e Mz combinadas a favor da segurança.</div>
            </div>
          )}

          {checks.length > 0 && (
            <div className="panel-section">
              <div className="panel-title">Verificações</div>
              <table className="table pt-checks">
                <thead>
                  <tr>
                    <th className="left">Verificação</th>
                    <th>σ (MPa)</th>
                    <th>Limite</th>
                    <th>Estaca</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.key} title={`${c.clause} · ${c.combo} · fibra ${c.fibre}`}>
                      <td className="left pt-name">
                        {c.name}
                        <span>
                          {c.clause} · {c.combo.split(' (')[0]} · fibra {c.fibre}
                        </span>
                      </td>
                      <td className={c.ok ? '' : c.informative ? 'mid' : 'bad'}>{fmt(c.value / 1000, 2)}</td>
                      <td>{fmt(c.limit / 1000, 2)}</td>
                      <td>{fmt(c.s, 1)} m</td>
                      <td className={c.ok ? 'good' : c.informative ? 'mid' : 'bad'}>{c.ok ? '✓' : c.informative ? '!' : '✗'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fails.length > 0 && (
                <div className="msg warn" style={{ marginTop: 8 }}>
                  Trações acima do limite se resolvem com mais cordoalhas ou mudando o traçado — o botão “Ajustar pelo ELS”
                  dá um passo nessa direção a cada análise.
                </div>
              )}
              <div className="note" style={{ marginTop: 6 }}>
                Tração positiva. A protensão entra como um caso separado: o estado permanente não a inclui e as combinações a
                somam. Aqui só se verificam tensões normais em serviço e no ato da protensão.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
