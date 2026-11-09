import { useEffect, useMemo, useState } from 'react'
import {
  defaultBox,
  designData,
  sectionParts,
  sectionProperties,
  validateGeometry,
  type BridgeModel,
  type BridgeResults,
  type Section,
  type SectionCheck,
  type SectionGeometry,
  type SectionProps,
} from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto, GROUP_LABEL, numToInput, parseNum } from '../../format'
import { NoResults } from '../tabs'

/** nº de barras reprovadas na verificação de seções (badge da aba) */
export function sectionFailures(results: BridgeResults | null): number {
  return results?.checks.sections?.filter((c) => !c.ok).length ?? 0
}

/* ------------------------------------------------------------------ desenho */

interface Shape {
  geometry: SectionGeometry
  props: SectionProps
}

function SectionDrawing({ geometry, props }: Shape) {
  const parts = useMemo(() => sectionParts(geometry), [geometry])
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const p of parts) {
    for (const [x, y] of p.pts) {
      xMin = Math.min(xMin, x)
      xMax = Math.max(xMax, x)
      yMin = Math.min(yMin, y)
      yMax = Math.max(yMax, y)
    }
  }
  const W = 420
  const padX = 34
  const padTop = 26
  const padBot = 12
  const sx = (W - 2 * padX) / Math.max(1e-6, xMax - xMin)
  // seções altas e estreitas (torres) não podem esticar a figura
  const s = Math.min(sx, 190 / Math.max(1e-6, yMax - yMin))
  const H = (yMax - yMin) * s + padTop + padBot
  const x0 = (W - (xMax - xMin) * s) / 2
  const px = (x: number) => x0 + (x - xMin) * s
  const py = (y: number) => padTop + (yMax - y) * s
  const path = (pts: [number, number][]) =>
    pts.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ') + ' Z'
  const yCg = yMax - props.yTop
  const left = px(xMin)
  const right = px(xMax)
  return (
    <svg className="sec-drawing" viewBox={`0 0 ${W} ${H.toFixed(0)}`} role="img" aria-label="Seção transversal">
      {parts.map((p, i) => (
        <path
          key={i}
          d={path(p.pts)}
          className={p.factor < 0 ? 'sec-hole' : p.material === 'steel' ? 'sec-steel' : 'sec-concrete'}
        />
      ))}
      {/* eixo do centroide */}
      <line className="sec-cg" x1={left - 6} x2={right + 6} y1={py(yCg)} y2={py(yCg)} />
      <text className="sec-dim" x={right + 8} y={py(yCg) + 3}>
        CG
      </text>
      {/* cota da largura */}
      <line className="sec-dimline" x1={left} x2={right} y1={12} y2={12} />
      <line className="sec-dimline" x1={left} x2={left} y1={8} y2={16} />
      <line className="sec-dimline" x1={right} x2={right} y1={8} y2={16} />
      <text className="sec-dim" x={(left + right) / 2} y={9} textAnchor="middle">
        {fmt(xMax - xMin, 2)} m
      </text>
      {/* cota da altura */}
      <line className="sec-dimline" x1={left - 14} x2={left - 14} y1={py(yMax)} y2={py(yMin)} />
      <line className="sec-dimline" x1={left - 18} x2={left - 10} y1={py(yMax)} y2={py(yMax)} />
      <line className="sec-dimline" x1={left - 18} x2={left - 10} y1={py(yMin)} y2={py(yMin)} />
      <text
        className="sec-dim"
        x={left - 18}
        y={(py(yMax) + py(yMin)) / 2}
        textAnchor="middle"
        transform={`rotate(-90 ${left - 18} ${(py(yMax) + py(yMin)) / 2})`}
      >
        {fmt(yMax - yMin, 2)} m
      </text>
    </svg>
  )
}

function PropsTable({ p, sec }: { p: { A: number; Iz: number; Iy: number; J: number; yTop: number; yBot: number }; sec?: SectionProps }) {
  return (
    <dl className="kv sec-props">
      <dt>Área A</dt>
      <dd>{fmtAuto(p.A)} m²</dd>
      <dt>Inércia vertical Iz</dt>
      <dd>{fmtAuto(p.Iz)} m⁴</dd>
      <dt>Inércia lateral Iy</dt>
      <dd>{fmtAuto(p.Iy)} m⁴</dd>
      <dt>Torção J</dt>
      <dd>{fmtAuto(p.J)} m⁴</dd>
      <dt>Centroide — topo / fundo</dt>
      <dd>
        {fmt(p.yTop, 3)} / {fmt(p.yBot, 3)} m
      </dd>
      <dt>Módulos W sup. / inf.</dt>
      <dd>
        {fmtAuto(p.Iz / p.yTop)} / {fmtAuto(p.Iz / p.yBot)} m³
      </dd>
      {sec && (
        <>
          <dt>Perímetro exposto</dt>
          <dd>{fmt(sec.perimeter, 2)} m</dd>
        </>
      )}
      {sec?.steelArea !== undefined && sec.concreteArea !== undefined && (
        <>
          <dt>Aço / concreto (áreas reais)</dt>
          <dd>
            {fmtAuto(sec.steelArea)} / {fmtAuto(sec.concreteArea)} m²
          </dd>
        </>
      )}
    </dl>
  )
}

/* ------------------------------------------------------------------ editor */

type Kind = SectionGeometry['kind']

const DECK_KINDS: { kind: Kind; label: string }[] = [
  { kind: 'box', label: 'Caixão de concreto' },
  { kind: 't-girders', label: 'Longarinas + laje (concreto)' },
  { kind: 'slab', label: 'Laje maciça' },
  { kind: 'steel-i-composite', label: 'Mista: vigas I de aço + laje' },
  { kind: 'steel-box', label: 'Mista: caixão de aço + laje' },
]

interface FieldDef {
  key: string
  label: string
  unit?: string
  integer?: boolean
  min?: number
}

const FIELDS: Partial<Record<Kind, FieldDef[]>> = {
  box: [
    { key: 'topWidth', label: 'Largura da laje superior', unit: 'm' },
    { key: 'bottomWidth', label: 'Largura do fundo', unit: 'm' },
    { key: 'depth', label: 'Altura total', unit: 'm' },
    { key: 'cantilever', label: 'Balanço de cada lado', unit: 'm', min: 0 },
    { key: 'topSlab', label: 'Laje superior', unit: 'm' },
    { key: 'bottomSlab', label: 'Laje inferior', unit: 'm' },
    { key: 'web', label: 'Espessura das almas', unit: 'm' },
    { key: 'cells', label: 'Nº de células', integer: true, min: 1 },
  ],
  't-girders': [
    { key: 'width', label: 'Largura da laje', unit: 'm' },
    { key: 'slab', label: 'Espessura da laje', unit: 'm' },
    { key: 'n', label: 'Nº de longarinas', integer: true, min: 1 },
    { key: 'spacing', label: 'Espaçamento entre eixos', unit: 'm' },
    { key: 'bw', label: 'Largura da alma', unit: 'm' },
    { key: 'depth', label: 'Altura total (com a laje)', unit: 'm' },
  ],
  slab: [
    { key: 'width', label: 'Largura', unit: 'm' },
    { key: 'depth', label: 'Espessura', unit: 'm' },
  ],
  'steel-i-composite': [
    { key: 'width', label: 'Largura da laje', unit: 'm' },
    { key: 'slab', label: 'Espessura da laje', unit: 'm' },
    { key: 'n', label: 'Nº de vigas', integer: true, min: 1 },
    { key: 'spacing', label: 'Espaçamento entre eixos', unit: 'm' },
    { key: 'topFlangeWidth', label: 'Mesa superior — largura', unit: 'm' },
    { key: 'topFlangeThickness', label: 'Mesa superior — espessura', unit: 'm' },
    { key: 'bottomFlangeWidth', label: 'Mesa inferior — largura', unit: 'm' },
    { key: 'bottomFlangeThickness', label: 'Mesa inferior — espessura', unit: 'm' },
    { key: 'webHeight', label: 'Alma — altura', unit: 'm' },
    { key: 'webThickness', label: 'Alma — espessura', unit: 'm' },
    { key: 'modularRatio', label: 'Razão modular n = Es/Ec' },
  ],
  'steel-box': [
    { key: 'width', label: 'Largura da laje', unit: 'm' },
    { key: 'slab', label: 'Espessura da laje', unit: 'm' },
    { key: 'topWidth', label: 'Distância entre almas no topo', unit: 'm' },
    { key: 'bottomWidth', label: 'Largura do fundo', unit: 'm' },
    { key: 'steelDepth', label: 'Altura do caixão de aço', unit: 'm' },
    { key: 'webThickness', label: 'Almas — espessura', unit: 'm' },
    { key: 'bottomPlate', label: 'Chapa de fundo — espessura', unit: 'm' },
    { key: 'topFlangeWidth', label: 'Mesas superiores — largura', unit: 'm' },
    { key: 'topFlangeThickness', label: 'Mesas superiores — espessura', unit: 'm' },
    { key: 'modularRatio', label: 'Razão modular n = Es/Ec' },
  ],
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** geometria inicial de cada tipo p/ a largura e a altura atuais do tabuleiro */
function defaultGeometry(kind: Kind, width: number, depth: number): SectionGeometry {
  const slab = Math.min(0.22, 0.4 * depth)
  switch (kind) {
    case 't-girders': {
      const n = Math.max(2, Math.round(width / 2.8))
      return { kind, width, slab, n, bw: 0.4, depth, spacing: r2(width / n) }
    }
    case 'slab':
      return { kind, width, depth }
    case 'steel-i-composite': {
      const n = Math.max(2, Math.round(width / 3.2))
      return {
        kind, width, slab, n, spacing: r2(width / n),
        topFlangeWidth: 0.4, topFlangeThickness: 0.025, bottomFlangeWidth: 0.6, bottomFlangeThickness: 0.04,
        webHeight: r2(Math.max(0.3, depth - slab - 0.065)), webThickness: 0.016, modularRatio: 7,
      }
    }
    case 'steel-box':
      return {
        kind, width, slab, topWidth: r2(0.5 * width), bottomWidth: r2(0.4 * width),
        steelDepth: r2(Math.max(0.4, depth - slab)), webThickness: 0.02, bottomPlate: 0.03,
        topFlangeWidth: 0.5, topFlangeThickness: 0.03, modularRatio: 7,
      }
    default:
      return defaultBox(width, depth)
  }
}

/** peso real − γ_aço·A_hom de uma seção mista (kN/m); 0 nas demais */
function weightCorrection(p: SectionProps | null): number {
  if (!p || p.steelArea === undefined || p.concreteArea === undefined) return 0
  return 25 * p.concreteArea + 77 * p.steelArea - 77 * p.A
}

/** grava a geometria na seção (e no gabarito do assistente, p/ reabrir coerente) */
function applyGeometry(model: BridgeModel, secId: string, geometry: SectionGeometry): BridgeModel {
  const p = sectionProperties(geometry)
  const sections = model.sections.map((s) => {
    if (s.id !== secId) return s
    const prev = s.geometry ? sectionProperties(s.geometry) : null
    const extraDead = (s.extraDead ?? 0) - weightCorrection(prev) + weightCorrection(p)
    const next: Section = {
      ...s, A: p.A, Iy: p.Iy, Iz: p.Iz, J: p.J, depth: p.depth, width: p.width, yTop: p.yTop, yBot: p.yBot, geometry,
    }
    if (s.extraDead !== undefined || extraDead !== 0) next.extraDead = extraDead
    return next
  })
  let template = model.template
  const params = template?.params as { deck?: Record<string, unknown> } | undefined
  if (template && secId === 'deck' && params?.deck) {
    template = {
      ...template,
      params: { ...params, deck: { ...params.deck, A: p.A, Iz: p.Iz, Iy: p.Iy, J: p.J, depth: p.depth, geometry } },
    }
  }
  return { ...model, sections, template }
}

function GeoField({ def, value, onCommit }: { def: FieldDef; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(numToInput(value))
  useEffect(() => setText(numToInput(value)), [value])
  const v = parseNum(text)
  const valid = Number.isFinite(v) && v >= (def.min ?? 1e-9) && (!def.integer || Number.isInteger(v))
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
        {def.label}
        {def.unit && <span className="unit">{def.unit}</span>}
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

function DeckEditor({ model, sec }: { model: BridgeModel; sec: Section }) {
  const updateModel = useStore((s) => s.updateModel)
  const hasResults = useStore((s) => s.results !== null)
  // rascunho: só vai p/ o modelo quando é uma geometria válida
  const [draft, setDraft] = useState<SectionGeometry | null>(sec.geometry ?? null)
  useEffect(() => setDraft(sec.geometry ?? null), [sec.geometry])

  const width = sec.width ?? 10
  const depth = sec.depth ?? 2
  const errors = draft ? validateGeometry(draft) : []
  const props = useMemo(() => (draft && errors.length === 0 ? sectionProperties(draft) : null), [draft, errors.length])

  const commit = (g: SectionGeometry) => {
    setDraft(g)
    if (validateGeometry(g).length === 0) updateModel((m) => applyGeometry(m, sec.id, g))
  }

  if (!draft) {
    return (
      <div className="sec-block">
        <PropsTable p={{ A: sec.A, Iz: sec.Iz, Iy: sec.Iy, J: sec.J, yTop: sec.yTop ?? depth / 2, yBot: sec.yBot ?? depth / 2 }} />
        <p className="note">
          Esta seção está definida só pelas propriedades (A, I, J) — largura {fmt(width, 2)} m, altura {fmt(depth, 2)} m. A
          verificação usa um caixão equivalente de mesma área. Defina a geometria para desenhar a seção e dimensionar com as
          espessuras reais.
        </p>
        <button className="btn" onClick={() => commit(defaultBox(width, depth))}>
          Definir por geometria
        </button>
        {hasResults && <p className="note sec-warn">Alterar a seção descarta os resultados da análise.</p>}
      </div>
    )
  }

  const fields = FIELDS[draft.kind] ?? []
  const values = draft as unknown as Record<string, number>
  const steelDeck = model.materials.find((m) => m.id === 'deck')?.kind === 'steel'
  const mixed = draft.kind === 'steel-i-composite' || draft.kind === 'steel-box'
  return (
    <div className="sec-block">
      {props ? <SectionDrawing geometry={draft} props={props} /> : <div className="sec-drawing sec-invalid">Geometria inválida</div>}
      <div className="field sec-kind">
        <label className="label">Tipo de seção</label>
        <select
          className="select"
          value={draft.kind}
          onChange={(e) => commit(defaultGeometry(e.target.value as Kind, props?.width ?? width, props?.depth ?? depth))}
        >
          {DECK_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-grid">
        {fields.map((f) => (
          <GeoField
            key={`${draft.kind}-${f.key}`}
            def={f}
            value={values[f.key]}
            onCommit={(v) => commit({ ...draft, [f.key]: v } as SectionGeometry)}
          />
        ))}
      </div>
      {errors.map((e) => (
        <div key={e} className="msg err">
          {e}
        </div>
      ))}
      {mixed !== steelDeck && (
        <div className="msg warn">
          {mixed
            ? 'Seção mista homogeneizada em aço, mas o material do tabuleiro é concreto: troque o material no assistente.'
            : 'Seção de concreto, mas o material do tabuleiro é aço: troque o material no assistente.'}
        </div>
      )}
      {props && <PropsTable p={props} sec={props} />}
      <p className="note">
        Propriedades calculadas da geometria (polígonos; torção por Bredt nas células fechadas). Cada alteração é gravada
        no modelo{hasResults ? ' e descarta os resultados da análise' : ''}.
      </p>
    </div>
  )
}

function TowerBlock({ sec, label }: { sec: Section; label: string }) {
  const dd = useMemo(() => designData(sec, true), [sec])
  const geometry: SectionGeometry =
    sec.geometry ??
    (dd.tw && dd.tf
      ? { kind: 'hollow-rect', width: dd.b, depth: dd.h, wall: dd.tw, wallDepth: dd.tf }
      : { kind: 'solid-rect', width: dd.b, depth: dd.h })
  const props = useMemo(() => sectionProperties(geometry), [geometry])
  return (
    <div className="sec-block">
      <div className="panel-title">{label}</div>
      <SectionDrawing geometry={geometry} props={props} />
      <PropsTable p={{ A: sec.A, Iz: sec.Iz, Iy: sec.Iy, J: sec.J, yTop: dd.yTop, yBot: dd.yBot }} />
      {dd.approx && dd.tw && (
        <p className="note">
          Seção equivalente p/ o dimensionamento: tubo retangular {fmt(dd.b, 2)} × {fmt(dd.h, 2)} m com parede de{' '}
          {fmt(dd.tw, 2)} m, de mesma área que a seção do modelo.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ verificação */

const cm2 = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : fmt(v * 1e4, v * 1e4 >= 100 ? 0 : 1))
const ratioClass = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v) ? '' : v > 1 ? 'bad' : v > 0.9 ? 'mid' : 'good'
const METHOD_NOTE: Record<SectionCheck['member'], string> = {
  beam:
    'NBR 6118: flexão composta reta de seção T/caixão no ELU (armadura inferior p/ o momento positivo, superior p/ o negativo, ' +
    'cada uma com a normal concomitante), cortante pelo modelo I e torção de seção vazada. Aproveitamento = maior entre ' +
    'a taxa de armadura sobre 4 % e a compressão das bielas (Vsd/VRd2 + Tsd/TRd2).',
  column:
    'NBR 6118: flexo-compressão oblíqua (torres, pilares e arcos) com armadura distribuída no contorno e momento mínimo de 1ª ordem. ' +
    'Os efeitos locais de 2ª ordem (15.8) não estão somados. Aproveitamento = taxa de armadura sobre 4 % ou bielas de cortante.',
  stress:
    'Tensões elásticas no ELU contra fy/1,10 (NBR 8800). Flambagem local, lateral e global não são verificadas; ' +
    'em seções equivalentes estimadas o resultado é indicativo.',
}

function ChecksTable({ checks }: { checks: SectionCheck[] }) {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const groups = useMemo(() => [...new Set(checks.map((c) => c.group))], [checks])
  const [group, setGroup] = useState(groups[0] ?? 'deck')
  const [byRatio, setByRatio] = useState(false)
  const active = groups.includes(group) ? group : groups[0]
  const rows = useMemo(() => {
    const list = checks.filter((c) => c.group === active)
    return [...list].sort((a, b) => (byRatio ? b.ratio - a.ratio : a.s - b.s || a.id - b.id))
  }, [checks, active, byRatio])
  if (rows.length === 0) return null
  const member = rows[0].member
  const crit = rows.reduce((a, b) => (b.ratio > a.ratio ? b : a), rows[0])
  const fails = rows.filter((c) => !c.ok).length
  const approx = rows.some((c) => c.approx)
  const posLabel = active === 'deck' || active === 'arch' ? 'x (m)' : 'z (m)'

  return (
    <div className="sec-checks">
      <div className="sec-bar">
        <div className="seg">
          {groups.map((g) => {
            const nf = checks.filter((c) => c.group === g && !c.ok).length
            return (
              <button key={g} className={g === active ? 'active' : ''} onClick={() => setGroup(g)}>
                {GROUP_LABEL[g] ?? g}
                {nf > 0 ? ` (${nf})` : ''}
              </button>
            )
          })}
        </div>
        <label className="check">
          <input type="checkbox" checked={byRatio} onChange={(e) => setByRatio(e.target.checked)} />
          Piores primeiro
        </label>
      </div>
      <div className="sec-chips">
        <span className={`chip ${fails ? 'err' : 'ok'}`}>{fails ? `${fails} acima do limite` : `${rows.length} barras OK`}</span>
        <span className="chip">
          crítica: barra {crit.id} · {fmt(crit.ratio, 2)}
        </span>
        <span className="chip">{rows[0].method}</span>
        {approx && <span className="chip warn">seção equivalente</span>}
      </div>
      <div className="sec-scroll">
        <table className="table clickable">
          <thead>
            {member === 'beam' && (
              <tr>
                <th className="left">Barra</th>
                <th>{posLabel}</th>
                <th>Md⁺</th>
                <th>Md⁻</th>
                <th>Nd</th>
                <th>As inf.</th>
                <th>As sup.</th>
                <th>Vd</th>
                <th>Asw/s</th>
                <th>Aprov.</th>
                <th />
              </tr>
            )}
            {member === 'column' && (
              <tr>
                <th className="left">Barra</th>
                <th>{posLabel}</th>
                <th>Nd mín</th>
                <th>Nd máx</th>
                <th>Mzd</th>
                <th>Myd</th>
                <th>As total</th>
                <th>ρ</th>
                <th>Asw/s</th>
                <th>Aprov.</th>
                <th />
              </tr>
            )}
            {member === 'stress' && (
              <tr>
                <th className="left">Barra</th>
                <th>{posLabel}</th>
                <th>Nd mín</th>
                <th>Nd máx</th>
                <th>Md⁺</th>
                <th>Md⁻</th>
                <th>Myd</th>
                <th>σ (MPa)</th>
                <th>Aprov.</th>
                <th />
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((c) => {
              const sel = selection?.kind === 'element' && selection.id === c.id
              const cls = `${sel ? 'selected' : ''} ${c.id === crit.id ? 'sec-crit' : ''}`
              const tail = (
                <>
                  <td className={ratioClass(c.ratio)}>{fmt(c.ratio, 2)}</td>
                  <td className={c.ok ? 'good' : 'bad'} title={c.notes?.join(' ')}>
                    {c.ok ? '✓' : '✗'}
                  </td>
                </>
              )
              const click = () => select({ kind: 'element', id: c.id })
              if (member === 'beam') {
                const nd = Math.abs(c.Nd[0]) > Math.abs(c.Nd[1]) ? c.Nd[0] : c.Nd[1]
                return (
                  <tr key={c.id} className={cls} onClick={click}>
                    <td className="left">{c.id}</td>
                    <td>{fmt(c.s, 1)}</td>
                    <td>{fmtAuto(c.MdPos)}</td>
                    <td>{fmtAuto(c.MdNeg)}</td>
                    <td>{fmtAuto(nd)}</td>
                    <td>{cm2(c.AsInf)}</td>
                    <td>{cm2(c.AsSup)}</td>
                    <td>{fmtAuto(c.Vd)}</td>
                    <td>{cm2(c.AswS)}</td>
                    {tail}
                  </tr>
                )
              }
              if (member === 'column') {
                return (
                  <tr key={c.id} className={cls} onClick={click}>
                    <td className="left">{c.id}</td>
                    <td>{fmt(c.s, 1)}</td>
                    <td>{fmtAuto(c.Nd[0])}</td>
                    <td>{fmtAuto(c.Nd[1])}</td>
                    <td>{fmtAuto(Math.max(c.MdPos, c.MdNeg))}</td>
                    <td>{fmtAuto(c.MydAbs)}</td>
                    <td>{cm2(c.AsTotal)}</td>
                    <td>{c.rho !== undefined ? `${fmt(c.rho * 100, 2)} %` : '—'}</td>
                    <td>{cm2(c.AswS)}</td>
                    {tail}
                  </tr>
                )
              }
              return (
                <tr key={c.id} className={cls} onClick={click}>
                  <td className="left">{c.id}</td>
                  <td>{fmt(c.s, 1)}</td>
                  <td>{fmtAuto(c.Nd[0])}</td>
                  <td>{fmtAuto(c.Nd[1])}</td>
                  <td>{fmtAuto(c.MdPos)}</td>
                  <td>{fmtAuto(c.MdNeg)}</td>
                  <td>{fmtAuto(c.MydAbs)}</td>
                  <td>{c.sigma !== undefined ? fmt(c.sigma / 1000, 0) : '—'}</td>
                  {tail}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Esforços de cálculo em kN e kN·m (envoltória ELU); armaduras em cm² e estribos em cm²/m (soma das almas).{' '}
        {METHOD_NOTE[member]}
        {approx &&
          ' A seção deste grupo não tem geometria detalhada: mesa e almas foram deduzidas da área, largura e altura — resultado indicativo.'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ aba */

export function SectionsTab({ model, results }: { model: BridgeModel; results: BridgeResults | null }) {
  const [view, setView] = useState<'section' | 'checks'>('section')
  const used = useMemo(() => {
    const ids = new Map<string, string>()
    for (const e of model.elements) {
      if (e.kind !== 'frame' || !e.group) continue
      if (e.group === 'deck' || e.group === 'tower' || e.group === 'pier' || e.group === 'arch') {
        if (!ids.has(e.sec)) ids.set(e.sec, e.group)
      }
    }
    return ids
  }, [model.elements])
  const deck = model.sections.find((s) => used.get(s.id) === 'deck')
  const others = model.sections.filter((s) => {
    const g = used.get(s.id)
    if (!g || g === 'deck' || s.shape === 'rigid') return false
    return g === 'arch' || s.shape !== 'generic'
  })
  const checks = results?.checks.sections ?? []

  return (
    <div className="sec-tab">
      <div className="seg sec-switch">
        <button className={view === 'section' ? 'active' : ''} onClick={() => setView('section')}>
          Geometria
        </button>
        <button className={view === 'checks' ? 'active' : ''} onClick={() => setView('checks')}>
          Verificação{checks.length ? ` (${checks.length})` : ''}
        </button>
      </div>

      {view === 'section' && (
        <>
          {deck ? (
            <>
              <div className="panel-title">Tabuleiro — {deck.name}</div>
              <DeckEditor model={model} sec={deck} />
            </>
          ) : (
            <div className="empty">Este modelo não tem barras de tabuleiro.</div>
          )}
          {others.map((s) => (
            <TowerBlock key={s.id} sec={s} label={`${GROUP_LABEL[used.get(s.id) ?? ''] ?? 'Seção'} — ${s.name}`} />
          ))}
        </>
      )}

      {view === 'checks' &&
        (!results ? (
          <NoResults what="O dimensionamento das seções do tabuleiro, das torres e dos pilares aparece aqui." />
        ) : checks.length === 0 ? (
          <div className="empty">Nenhuma barra de tabuleiro, torre ou pilar para verificar nesta análise.</div>
        ) : (
          <ChecksTable checks={checks} />
        ))}
    </div>
  )
}
