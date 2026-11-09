import { useMemo } from 'react'
import { useStore } from '../store'
import { fmt, fmtAuto, fmtInt, GROUP_LABEL, MATERIAL_KIND_LABEL, TYPE_LABEL } from '../format'
import { groupColor, PALETTES } from '../viewer/scene'

export function LeftPanel() {
  const model = useStore((s) => s.model)
  const results = useStore((s) => s.results)
  const hidden = useStore((s) => s.view.hidden)
  const toggleGroup = useStore((s) => s.toggleGroup)
  const theme = useStore((s) => s.theme)
  const pal = PALETTES[theme]

  const info = useMemo(() => {
    if (!model) return null
    const matKind = new Map(model.materials.map((m) => [m.id, m.kind]))
    const groups = new Map<string, { count: number; cable: boolean; matKind?: string }>()
    let frames = 0
    let cables = 0
    for (const e of model.elements) {
      const g = e.group ?? 'other'
      const cur = groups.get(g) ?? { count: 0, cable: e.kind === 'cable', matKind: matKind.get(e.mat) }
      cur.count++
      groups.set(g, cur)
      if (e.kind === 'cable') cables++
      else frames++
    }
    const order = ['deck', 'arch', 'tower', 'pier', 'main-cable', 'stay', 'hanger', 'crossbeam', 'rigid', 'other']
    const list = [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    let xmin = Infinity
    let xmax = -Infinity
    for (const n of model.nodes) {
      xmin = Math.min(xmin, n.x)
      xmax = Math.max(xmax, n.x)
    }
    const supports = model.nodes.filter((n) => n.fix?.some(Boolean)).length
    return { frames, cables, groups: list, extent: xmax - xmin, supports }
  }, [model])

  if (!model || !info) return null
  const spans = model.meta?.spans

  return (
    <div className="left-panel">
      <div className="panel-title">Modelo</div>
      <div style={{ marginBottom: 10 }}>
        <span className="chip accent">{TYPE_LABEL[model.type] ?? model.type}</span>
      </div>
      <dl className="kv">
        <dt>Nós</dt>
        <dd>{fmtInt(model.nodes.length)}</dd>
        <dt>Barras</dt>
        <dd>{fmtInt(info.frames)}</dd>
        <dt>Cabos</dt>
        <dd>{fmtInt(info.cables)}</dd>
        <dt>Nós com apoio</dt>
        <dd>{fmtInt(info.supports)}</dd>
        {results && (
          <>
            <dt>Graus de liberdade</dt>
            <dd>{fmtInt(results.nDofs)}</dd>
          </>
        )}
        {model.meta?.mainSpan ? (
          <>
            <dt>Vão principal</dt>
            <dd>{fmtAuto(model.meta.mainSpan)} m</dd>
          </>
        ) : null}
        <dt>Extensão em X</dt>
        <dd>{fmtAuto(info.extent)} m</dd>
      </dl>
      {spans && spans.length > 0 && (
        <div className="note" style={{ marginTop: 8 }}>
          Vãos: <span className="mono">{spans.map((v) => fmtAuto(v)).join(' + ')}</span> m
        </div>
      )}
      {model.meta?.description && (
        <div className="note" style={{ marginTop: 8 }}>
          {model.meta.description}
        </div>
      )}

      <div className="panel-section">
        <div className="panel-title">Grupos</div>
        {info.groups.map(([g, v]) => {
          const off = hidden.includes(g)
          return (
            <div
              key={g}
              className={`group-row ${off ? 'off' : ''}`}
              onClick={() => toggleGroup(g)}
              title={off ? 'Mostrar' : 'Ocultar'}
            >
              <span className="swatch" style={{ background: groupColor(pal, g, v.cable ? 'cable' : v.matKind) }} />
              {GROUP_LABEL[g] ?? g}
              <span className="count">{fmtInt(v.count)}</span>
            </div>
          )
        })}
        <div className="note faint" style={{ marginTop: 6 }}>
          Clique para ocultar ou mostrar no 3D.
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Materiais</div>
        {model.materials.map((m) => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12.5 }}>{m.name}</div>
            <div className="note mono">
              {MATERIAL_KIND_LABEL[m.kind] ?? m.kind} · E = {fmt(m.E / 1e6, 1)} GPa · γ = {fmt(m.gamma, 1)} kN/m³
              {m.fpk ? ` · fpk = ${fmt(m.fpk / 1000, 0)} MPa` : ''}
              {m.fck ? ` · fck = ${fmt(m.fck / 1000, 0)} MPa` : ''}
              {m.fy ? ` · fy = ${fmt(m.fy / 1000, 0)} MPa` : ''}
            </div>
          </div>
        ))}
      </div>

      <div className="panel-section">
        <div className="panel-title">Seções</div>
        {model.sections.map((s) => (
          <div key={s.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12.5 }}>{s.name}</div>
            <div className="note mono">
              A = {fmtAuto(s.A)} m² · Iz = {fmtAuto(s.Iz)} m⁴
              {s.extraDead ? ` · g₂ = ${fmtAuto(s.extraDead)} kN/m` : ''}
            </div>
          </div>
        ))}
      </div>

      {model.lanes.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">Faixas de carga móvel</div>
          {model.lanes.map((l) => (
            <div key={l.id} className="note" style={{ marginBottom: 4 }}>
              {l.name} — <span className="mono">{fmtAuto(l.width)} m</span> carregáveis
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
