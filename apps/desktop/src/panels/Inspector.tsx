import { useMemo } from 'react'
import type { BridgeModel, BridgeResults } from '@opengirder/engine'
import { useStore, type Selection } from '../store'
import { fmt, fmtAuto, GROUP_LABEL } from '../format'
import { IconClose } from '../ui/icons'

const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz']

function FrameInfo({ model, results, id }: { model: BridgeModel; results: BridgeResults | null; id: number }) {
  const el = model.elements.find((e) => e.id === id)
  if (!el || el.kind !== 'frame') return null
  const sec = model.sections.find((s) => s.id === el.sec)
  const mat = model.materials.find((m) => m.id === el.mat)
  const f = results?.deadLoad.frames.find((x) => x.id === id)
  const mv = results?.moving?.frames.find((x) => x.id === id)
  const rows: { k: 'N' | 'Vy' | 'Vz' | 'T' | 'My' | 'Mz'; unit: string }[] = [
    { k: 'N', unit: 'kN' },
    { k: 'Vy', unit: 'kN' },
    { k: 'Vz', unit: 'kN' },
    { k: 'T', unit: 'kN·m' },
    { k: 'My', unit: 'kN·m' },
    { k: 'Mz', unit: 'kN·m' },
  ]
  return (
    <>
      <dl className="kv">
        <dt>Grupo</dt>
        <dd>{GROUP_LABEL[el.group ?? 'other'] ?? el.group}</dd>
        <dt>Nós</dt>
        <dd>
          {el.n1} → {el.n2}
        </dd>
        {f && (
          <>
            <dt>Comprimento</dt>
            <dd>{fmt(f.L, 3)} m</dd>
          </>
        )}
        <dt>Material</dt>
        <dd style={{ fontFamily: 'var(--sans)' }}>{mat?.name ?? el.mat}</dd>
        <dt>Seção</dt>
        <dd style={{ fontFamily: 'var(--sans)' }}>{sec?.name ?? el.sec}</dd>
        {sec && (
          <>
            <dt>A</dt>
            <dd>{fmtAuto(sec.A)} m²</dd>
            <dt>Iz / Iy</dt>
            <dd>
              {fmtAuto(sec.Iz)} / {fmtAuto(sec.Iy)} m⁴
            </dd>
            <dt>J</dt>
            <dd>{fmtAuto(sec.J)} m⁴</dd>
          </>
        )}
      </dl>
      {f ? (
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th className="left">Permanente</th>
              <th>Início</th>
              <th>Meio</th>
              <th>Fim</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td className="left">
                  {r.k} <span className="faint">{r.unit}</span>
                </td>
                {f[r.k].map((v, i) => (
                  <td key={i}>{fmtAuto(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="note" style={{ marginTop: 8 }}>
          Rode a análise para ver os esforços.
        </div>
      )}
      {mv && (
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th className="left">Carga móvel</th>
              <th>Início</th>
              <th>Meio</th>
              <th>Fim</th>
            </tr>
          </thead>
          <tbody>
            {(['Mz', 'Vy', 'N'] as const).flatMap((k) => [
              <tr key={`${k}max`}>
                <td className="left">{k} máx</td>
                {mv[k].max.map((v, i) => (
                  <td key={i}>{fmtAuto(v)}</td>
                ))}
              </tr>,
              <tr key={`${k}min`}>
                <td className="left">{k} mín</td>
                {mv[k].min.map((v, i) => (
                  <td key={i}>{fmtAuto(v)}</td>
                ))}
              </tr>,
            ])}
          </tbody>
        </table>
      )}
    </>
  )
}

function CableInfo({ model, results, id }: { model: BridgeModel; results: BridgeResults | null; id: number }) {
  const el = model.elements.find((e) => e.id === id)
  if (!el || el.kind !== 'cable') return null
  const mat = model.materials.find((m) => m.id === el.mat)
  const c = results?.deadLoad.cables.find((x) => x.id === id)
  const chk = results?.checks.cables.find((x) => x.id === id)
  const sigma = c ? Math.max(c.Ti, c.Tj) / el.A / 1000 : NaN
  return (
    <>
      <dl className="kv">
        <dt>Grupo</dt>
        <dd>{GROUP_LABEL[el.group ?? 'other'] ?? el.group}</dd>
        <dt>Nós</dt>
        <dd>
          {el.n1} → {el.n2}
        </dd>
        <dt>Material</dt>
        <dd style={{ fontFamily: 'var(--sans)' }}>{mat?.name ?? el.mat}</dd>
        <dt>Área metálica</dt>
        <dd>{el.A >= 0.01 ? `${fmt(el.A, 4)} m²` : `${fmt(el.A * 1e6, 0)} mm²`}</dd>
        {el.strands ? (
          <>
            <dt>Cordoalhas</dt>
            <dd>{el.strands}</dd>
          </>
        ) : null}
        {el.L0 !== undefined && !c ? (
          <>
            <dt>L0</dt>
            <dd>{fmt(el.L0, 4)} m</dd>
          </>
        ) : null}
      </dl>
      {c ? (
        <>
          <div className="panel-title" style={{ marginTop: 12 }}>
            Carga permanente
            {c.slack && <span className="chip err">frouxo</span>}
          </div>
          <dl className="kv">
            <dt>Tração em n1 / n2</dt>
            <dd>
              {fmtAuto(c.Ti)} / {fmtAuto(c.Tj)} kN
            </dd>
            <dt>Componente horizontal H</dt>
            <dd>{fmtAuto(c.H)} kN</dd>
            <dt>Tensão</dt>
            <dd>{fmt(sigma, 0)} MPa</dd>
            <dt>Comprimento indeformado L0</dt>
            <dd>{fmt(c.L0, 4)} m</dd>
            <dt>Corda</dt>
            <dd>{fmt(c.chord, 4)} m</dd>
            <dt>Flecha no meio</dt>
            <dd>{fmt(c.sag, 3)} m</dd>
          </dl>
        </>
      ) : (
        <div className="note" style={{ marginTop: 8 }}>
          Rode a análise para ver as trações.
        </div>
      )}
      {chk && (
        <>
          <div className="panel-title" style={{ marginTop: 12 }}>
            Verificação
            <span className={`chip ${chk.ok ? 'ok' : 'err'}`}>{chk.ok ? 'atende' : 'não atende'}</span>
          </div>
          <dl className="kv">
            <dt>Permanente TG</dt>
            <dd>{fmtAuto(chk.TG)} kN</dd>
            <dt>Variação por carga móvel ΔTQ</dt>
            <dd>{fmtAuto(chk.dTQ)} kN</dd>
            <dt>Resistência Fu = A·fpk</dt>
            <dd>{fmtAuto(chk.Fu)} kN</dd>
            <dt>ELS: (TG + ΔTQ) / 0,45·Fu</dt>
            <dd style={{ color: chk.ratioEls > 1 ? 'var(--err)' : undefined }}>
              {fmtAuto(chk.Tels)} kN → {fmt(chk.ratioEls, 2)}
            </dd>
            <dt>ELU: (1,35·TG + 1,5·ΔTQ) / 0,65·Fu</dt>
            <dd style={{ color: chk.ratioElu > 1 ? 'var(--err)' : undefined }}>
              {fmtAuto(chk.Telu)} kN → {fmt(chk.ratioElu, 2)}
            </dd>
            <dt>Faixa de tensão ΔσQ</dt>
            <dd>{fmt(chk.dSigma, 1)} MPa</dd>
          </dl>
        </>
      )}
    </>
  )
}

function NodeInfo({ model, results, id }: { model: BridgeModel; results: BridgeResults | null; id: number }) {
  const i = model.nodes.findIndex((n) => n.id === id)
  if (i < 0) return null
  const nd = model.nodes[i]
  const u = results?.deadLoad.u
  const react = results?.deadLoad.reactions.find((r) => r.node === id)
  const fixed = nd.fix ? DOF.filter((_, d) => nd.fix![d]).join(', ') : ''
  return (
    <>
      <dl className="kv">
        <dt>Coordenadas (x; y; z)</dt>
        <dd>
          {fmt(nd.x, 3)}; {fmt(nd.y, 3)}; {fmt(nd.z, 3)} m
        </dd>
        {nd.role && (
          <>
            <dt>Papel</dt>
            <dd>{nd.role}</dd>
          </>
        )}
        <dt>Restrições</dt>
        <dd>{fixed || 'livre'}</dd>
      </dl>
      {u && u.length >= 6 * (i + 1) ? (
        <>
          <div className="panel-title" style={{ marginTop: 12 }}>
            Deslocamentos — permanente
          </div>
          <dl className="kv">
            <dt>ux; uy; uz</dt>
            <dd>
              {fmt(u[6 * i] * 1000, 2)}; {fmt(u[6 * i + 1] * 1000, 2)}; {fmt(u[6 * i + 2] * 1000, 2)} mm
            </dd>
            <dt>rx; ry; rz</dt>
            <dd>
              {fmt(u[6 * i + 3] * 1000, 3)}; {fmt(u[6 * i + 4] * 1000, 3)}; {fmt(u[6 * i + 5] * 1000, 3)} mrad
            </dd>
            {results?.moving && (
              <>
                <dt>uz por carga móvel</dt>
                <dd>
                  {fmt(results.moving.uzMin[i] * 1000, 2)} a {fmt(results.moving.uzMax[i] * 1000, 2)} mm
                </dd>
              </>
            )}
          </dl>
        </>
      ) : null}
      {react && (
        <>
          <div className="panel-title" style={{ marginTop: 12 }}>
            Reação de apoio
          </div>
          <dl className="kv">
            <dt>Fx; Fy; Fz</dt>
            <dd>
              {fmtAuto(react.R[0])}; {fmtAuto(react.R[1])}; {fmtAuto(react.R[2])} kN
            </dd>
            <dt>Mx; My; Mz</dt>
            <dd>
              {fmtAuto(react.R[3])}; {fmtAuto(react.R[4])}; {fmtAuto(react.R[5])} kN·m
            </dd>
          </dl>
        </>
      )}
    </>
  )
}

export function Inspector({ selection }: { selection: Selection }) {
  const model = useStore((s) => s.model)
  const results = useStore((s) => s.results)
  const select = useStore((s) => s.select)

  const title = useMemo(() => {
    if (!model) return ''
    if (selection.kind === 'node') return `Nó ${selection.id}`
    const el = model.elements.find((e) => e.id === selection.id)
    return el ? `${el.kind === 'cable' ? 'Cabo' : 'Barra'} ${el.id}` : `Elemento ${selection.id}`
  }, [model, selection])

  if (!model) return null
  const el = selection.kind === 'element' ? model.elements.find((e) => e.id === selection.id) : null

  return (
    <div style={{ padding: 12, borderBottom: '1px solid var(--border)', maxHeight: '52%', overflow: 'auto', flex: 'none' }}>
      <div className="panel-title">
        {title}
        <span className="grow" />
        <button className="btn-icon" style={{ width: 22, height: 22 }} onClick={() => select(null)} title="Fechar">
          <IconClose size={13} />
        </button>
      </div>
      {selection.kind === 'node' ? (
        <NodeInfo model={model} results={results} id={selection.id} />
      ) : el?.kind === 'cable' ? (
        <CableInfo model={model} results={results} id={selection.id} />
      ) : el ? (
        <FrameInfo model={model} results={results} id={selection.id} />
      ) : (
        <div className="note">Elemento não encontrado no modelo.</div>
      )}
    </div>
  )
}
