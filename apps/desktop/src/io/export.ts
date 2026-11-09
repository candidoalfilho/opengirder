/**
 * Exportação — funções PURAS (sem DOM, sem React): DXF, CSV e JSON a partir do modelo e
 * dos resultados. Quem grava o arquivo é `io/download.ts`.
 *
 *  - DXF: ASCII R12 (AC1009), entidades LINE em 3D, uma layer por grupo de elementos.
 *  - CSV: separador `;`, vírgula decimal e BOM UTF-8 (abre direto no Excel em pt-BR).
 */

import { cablePolyline, type BridgeModel, type BridgeResults, type Env3 } from '@opengirder/engine'

type Vec3 = [number, number, number]

/* ------------------------------------------------------------------ DXF */

export interface DxfOptions {
  /** desenha a deformada de carga permanente (posição + escala·u) em layers "<grupo>_DEF" */
  deformed?: boolean
  /** multiplicador dos deslocamentos da deformada */
  scale?: number
  /** inclui os nós como POINT na layer NOS */
  nodes?: boolean
}

/** grupo → [nome da layer, cor ACI] */
const DXF_LAYERS: Record<string, [string, number]> = {
  deck: ['TABULEIRO', 4],
  tower: ['TORRE', 2],
  pier: ['PILARES', 5],
  'main-cable': ['CABO_PRINCIPAL', 30],
  stay: ['ESTAIS', 1],
  hanger: ['PENDURAIS', 3],
  crossbeam: ['TRANSVERSINAS', 6],
  rigid: ['LIGACOES_RIGIDAS', 8],
  arch: ['ARCO', 40],
  other: ['OUTROS', 7],
}

function layerOf(group: string | undefined): [string, number] {
  const g = group ?? 'other'
  const known = DXF_LAYERS[g]
  if (known) return known
  // grupo desconhecido: nome ASCII seguro
  const name = g.toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'OUTROS'
  return [name, 7]
}

const dxfNum = (v: number): string => (Number.isFinite(v) ? Number(v.toFixed(6)).toString() : '0')

export function buildDxf(model: BridgeModel, results: BridgeResults | null, opts: DxfOptions = {}): string {
  const index = new Map(model.nodes.map((n, i) => [n.id, i]))
  const u = opts.deformed && results ? results.deadLoad.u : null
  const scale = opts.scale ?? 1
  const base = (i: number): Vec3 => {
    const n = model.nodes[i]
    return [n.x, n.y, n.z]
  }
  const moved = (i: number): Vec3 => {
    const p = base(i)
    if (!u) return p
    return [p[0] + scale * (u[6 * i] ?? 0), p[1] + scale * (u[6 * i + 1] ?? 0), p[2] + scale * (u[6 * i + 2] ?? 0)]
  }
  const sag = new Map<number, number>()
  results?.deadLoad.cables.forEach((c) => sag.set(c.id, Number.isFinite(c.sag) ? c.sag : 0))

  const layers = new Map<string, number>()
  const ent: string[] = []
  const line = (layer: string, a: Vec3, b: Vec3): void => {
    ent.push(
      '0', 'LINE', '8', layer,
      '10', dxfNum(a[0]), '20', dxfNum(a[1]), '30', dxfNum(a[2]),
      '11', dxfNum(b[0]), '21', dxfNum(b[1]), '31', dxfNum(b[2]),
    )
  }
  const draw = (pos: (i: number) => Vec3, suffix: string, withSag: boolean): void => {
    for (const el of model.elements) {
      const i1 = index.get(el.n1)
      const i2 = index.get(el.n2)
      if (i1 === undefined || i2 === undefined) continue
      const [name, color] = layerOf(el.group)
      const layer = name + suffix
      if (!layers.has(layer)) layers.set(layer, suffix ? 9 : color)
      const a = pos(i1)
      const b = pos(i2)
      const s = el.kind === 'cable' && withSag ? (sag.get(el.id) ?? 0) : 0
      if (s > 1e-4) {
        const pts = cablePolyline(a, b, s, 12)
        for (let k = 1; k < pts.length; k++) line(layer, pts[k - 1], pts[k])
      } else {
        line(layer, a, b)
      }
    }
  }
  draw(base, '', !u)
  if (u) draw(moved, '_DEF', true)

  if (opts.nodes) {
    layers.set('NOS', 7)
    model.nodes.forEach((_, i) => {
      const p = base(i)
      ent.push('0', 'POINT', '8', 'NOS', '10', dxfNum(p[0]), '20', dxfNum(p[1]), '30', dxfNum(p[2]))
    })
  }
  // apoios: POINT na layer APOIOS
  const sup = model.nodes.map((n, i) => (n.fix?.slice(0, 3).some(Boolean) ? i : -1)).filter((i) => i >= 0)
  if (sup.length) {
    layers.set('APOIOS', 3)
    for (const i of sup) {
      const p = base(i)
      ent.push('0', 'POINT', '8', 'APOIOS', '10', dxfNum(p[0]), '20', dxfNum(p[1]), '30', dxfNum(p[2]))
    }
  }

  const out: string[] = []
  out.push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC')
  out.push('0', 'SECTION', '2', 'TABLES')
  out.push('0', 'TABLE', '2', 'LTYPE', '70', '1')
  out.push('0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0')
  out.push('0', 'ENDTAB')
  out.push('0', 'TABLE', '2', 'LAYER', '70', String(layers.size))
  for (const [name, color] of layers) out.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS')
  out.push('0', 'ENDTAB', '0', 'ENDSEC')
  out.push('0', 'SECTION', '2', 'ENTITIES', ...ent, '0', 'ENDSEC', '0', 'EOF')
  return out.join('\r\n') + '\r\n'
}

/* ------------------------------------------------------------------ CSV */

export interface CsvTable {
  /** chave estável (usada no menu e no nome do arquivo) */
  key: string
  /** rótulo no menu */
  label: string
  /** nome do arquivo, sem o prefixo do modelo */
  file: string
  header: string[]
  rows: (string | number | boolean | null | undefined)[][]
}

/** número → texto com vírgula decimal (até 8 algarismos significativos); vazio se não finito */
export function csvNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ''
  if (v === 0) return '0'
  const s = Number(v.toPrecision(8)).toString()
  if (s.includes('e')) {
    // notação científica: Excel pt-BR aceita "1,5E-7"
    return s.replace('.', ',').toUpperCase()
  }
  return s.replace('.', ',')
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return csvNum(v)
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function csvText(t: Pick<CsvTable, 'header' | 'rows'>): string {
  const lines = [t.header.map(csvCell).join(';')]
  for (const r of t.rows) lines.push(r.map(csvCell).join(';'))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

const STATIONS = ['início', 'meio', 'fim'] as const
const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const

const GROUP_PT: Record<string, string> = {
  deck: 'tabuleiro',
  tower: 'torre',
  stay: 'estai',
  'main-cable': 'cabo principal',
  hanger: 'pendural',
  pier: 'pilar',
  rigid: 'ligação rígida',
  crossbeam: 'transversina',
  arch: 'arco',
  other: 'outro',
}
const groupPt = (g: string | undefined): string => GROUP_PT[g ?? 'other'] ?? g ?? 'outro'

/** todas as tabelas disponíveis p/ o modelo e os resultados atuais (só as que têm linhas) */
export function csvTables(model: BridgeModel, results: BridgeResults | null): CsvTable[] {
  const out: CsvTable[] = []
  const groupOf = new Map<number, string | undefined>()
  for (const e of model.elements) groupOf.set(e.id, e.group)
  const u = results?.deadLoad.u

  // ---- nós (e deslocamentos de carga permanente)
  out.push({
    key: 'nodes',
    label: u ? 'Nós e deslocamentos' : 'Nós',
    file: 'nos.csv',
    header: [
      'nó', 'x (m)', 'y (m)', 'z (m)', 'restrições',
      ...(u ? ['ux (mm)', 'uy (mm)', 'uz (mm)', 'rx (mrad)', 'ry (mrad)', 'rz (mrad)'] : []),
    ],
    rows: model.nodes.map((n, i) => [
      n.id, n.x, n.y, n.z,
      DOF.filter((_, d) => n.fix?.[d]).join(' '),
      ...(u ? [0, 1, 2, 3, 4, 5].map((d) => (u[6 * i + d] ?? NaN) * 1000) : []),
    ]),
  })

  // ---- elementos
  out.push({
    key: 'elements',
    label: 'Barras e cabos (dados)',
    file: 'elementos.csv',
    header: ['id', 'tipo', 'grupo', 'nó 1', 'nó 2', 'material', 'seção', 'A cabo (m²)', 'cordoalhas', 'L0 (m)'],
    rows: model.elements.map((e) =>
      e.kind === 'frame'
        ? [e.id, 'barra', groupPt(e.group), e.n1, e.n2, e.mat, e.sec, '', '', '']
        : [e.id, 'cabo', groupPt(e.group), e.n1, e.n2, e.mat, '', e.A, e.strands ?? '', e.L0 ?? ''],
    ),
  })

  if (!results) return out

  // ---- esforços nas barras, carga permanente
  if (results.deadLoad.frames.length) {
    const rows: CsvTable['rows'] = []
    for (const f of results.deadLoad.frames) {
      for (let s = 0; s < 3; s++) {
        rows.push([f.id, groupPt(groupOf.get(f.id)), STATIONS[s], (f.L * s) / 2, f.N[s], f.Vy[s], f.Vz[s], f.T[s], f.My[s], f.Mz[s]])
      }
    }
    out.push({
      key: 'frames',
      label: 'Esforços nas barras (permanente)',
      file: 'esforcos_barras.csv',
      header: ['barra', 'grupo', 'estação', 'x local (m)', 'N (kN)', 'Vy (kN)', 'Vz (kN)', 'T (kN·m)', 'My (kN·m)', 'Mz (kN·m)'],
      rows,
    })
  }

  // ---- cabos
  if (results.deadLoad.cables.length) {
    const chk = new Map(results.checks.cables.map((c) => [c.id, c]))
    const el = new Map(model.elements.map((e) => [e.id, e]))
    out.push({
      key: 'cables',
      label: 'Cabos: trações e verificações',
      file: 'cabos.csv',
      header: [
        'cabo', 'grupo', 'nó 1', 'nó 2', 'A (mm²)', 'cordoalhas', 'L0 (m)', 'corda (m)', 'flecha (m)',
        'Ti (kN)', 'Tj (kN)', 'H (kN)', 'frouxo',
        'TG (kN)', 'ΔTQ (kN)', 'T ELS (kN)', 'T ELU (kN)', 'Fu (kN)', 'ELS / 0,45·Fu', 'ELU / 0,65·Fu', 'Δσ (MPa)', 'atende',
      ],
      rows: results.deadLoad.cables.map((c) => {
        const e = el.get(c.id)
        const k = chk.get(c.id)
        const cab = e && e.kind === 'cable' ? e : null
        return [
          c.id, groupPt(groupOf.get(c.id)), e?.n1 ?? '', e?.n2 ?? '', cab ? cab.A * 1e6 : '', cab?.strands ?? '',
          c.L0, c.chord, c.sag, c.Ti, c.Tj, c.H, c.slack,
          k?.TG, k?.dTQ, k?.Tels, k?.Telu, k?.Fu, k?.ratioEls, k?.ratioElu, k?.dSigma, k ? k.ok : '',
        ]
      }),
    })
  }

  // ---- reações
  if (results.deadLoad.reactions.length) {
    out.push({
      key: 'reactions',
      label: 'Reações de apoio (permanente)',
      file: 'reacoes.csv',
      header: ['nó', 'Fx (kN)', 'Fy (kN)', 'Fz (kN)', 'Mx (kN·m)', 'My (kN·m)', 'Mz (kN·m)'],
      rows: results.deadLoad.reactions.map((r) => [r.node, ...r.R]),
    })
  }

  // ---- modos
  if (results.modal?.modes.length) {
    out.push({
      key: 'modes',
      label: 'Modos de vibração',
      file: 'modos.csv',
      header: ['modo', 'período (s)', 'frequência (Hz)', 'tipo', 'massa efetiva X (%)', 'massa efetiva Y (%)', 'massa efetiva Z (%)'],
      rows: results.modal.modes.map((m) => [m.index, m.period, m.frequency, m.kind, m.massPct[0], m.massPct[1], m.massPct[2]]),
    })
  }

  // ---- carga móvel
  const mv = results.moving
  if (mv) {
    const rows: CsvTable['rows'] = []
    const env = (e: Env3, s: number): [number, number] => [e.min[s], e.max[s]]
    for (const f of mv.frames) {
      for (let s = 0; s < 3; s++) {
        rows.push([
          f.id, groupPt(groupOf.get(f.id)), STATIONS[s],
          ...env(f.Mz, s), ...env(f.Vy, s), ...env(f.N, s), ...env(f.T, s), ...env(f.My, s),
        ])
      }
    }
    out.push({
      key: 'moving',
      label: 'Carga móvel: envoltórias nas barras',
      file: 'carga_movel_barras.csv',
      header: [
        'barra', 'grupo', 'estação',
        'Mz mín (kN·m)', 'Mz máx (kN·m)', 'Vy mín (kN)', 'Vy máx (kN)', 'N mín (kN)', 'N máx (kN)',
        'T mín (kN·m)', 'T máx (kN·m)', 'My mín (kN·m)', 'My máx (kN·m)',
      ],
      rows,
    })
    if (mv.cables.length) {
      out.push({
        key: 'movingCables',
        label: 'Carga móvel: variação de tração nos cabos',
        file: 'carga_movel_cabos.csv',
        header: ['cabo', 'grupo', 'ΔT mín (kN)', 'ΔT máx (kN)'],
        rows: mv.cables.map((c) => [c.id, groupPt(groupOf.get(c.id)), c.min, c.max]),
      })
    }
    out.push({
      key: 'movingUz',
      label: 'Carga móvel: flechas nos nós',
      file: 'carga_movel_flechas.csv',
      header: ['nó', 'x (m)', 'uz mín (mm)', 'uz máx (mm)'],
      rows: model.nodes.map((n, i) => [n.id, n.x, (mv.uzMin[i] ?? NaN) * 1000, (mv.uzMax[i] ?? NaN) * 1000]),
    })
  }

  // ---- casos adicionais
  const cases = results.cases
  if (cases?.length) {
    const rows: CsvTable['rows'] = []
    for (const c of cases) {
      for (const f of c.frames) {
        for (let s = 0; s < 3; s++) {
          rows.push([c.id, c.name, f.id, groupPt(groupOf.get(f.id)), STATIONS[s], f.N[s], f.Vy[s], f.Vz[s], f.T[s], f.My[s], f.Mz[s]])
        }
      }
    }
    if (rows.length) {
      out.push({
        key: 'cases',
        label: 'Casos adicionais: esforços nas barras',
        file: 'casos_barras.csv',
        header: ['caso', 'nome', 'barra', 'grupo', 'estação', 'N (kN)', 'Vy (kN)', 'Vz (kN)', 'T (kN·m)', 'My (kN·m)', 'Mz (kN·m)'],
        rows,
      })
    }
  }

  // ---- combinações
  const cb = results.combos
  if (cb) {
    const actions = Array.from(new Set(cb.list.flatMap((c) => Object.keys(c.factors))))
    if (cb.list.length) {
      out.push({
        key: 'combos',
        label: 'Combinações: fatores',
        file: 'combinacoes.csv',
        header: ['id', 'nome', 'estado-limite', ...actions],
        rows: cb.list.map((c) => [c.id, c.name, c.limit, ...actions.map((a) => c.factors[a] ?? '')]),
      })
    }
    if (cb.frames.length) {
      const rows: CsvTable['rows'] = []
      for (const f of cb.frames) {
        for (let s = 0; s < 3; s++) {
          rows.push([
            f.id, groupPt(groupOf.get(f.id)), STATIONS[s],
            f.elu.Mz.min[s], f.elu.Mz.max[s], f.elu.Vy.min[s], f.elu.Vy.max[s], f.elu.N.min[s], f.elu.N.max[s],
            f.elu.T.min[s], f.elu.T.max[s],
            f.NatMz?.min[s], f.NatMz?.max[s],
            f.elsRare.Mz.min[s], f.elsRare.Mz.max[s], f.elsFreq.Mz.min[s], f.elsFreq.Mz.max[s], f.elsQp.Mz.min[s], f.elsQp.Mz.max[s],
            f.elsRare.N.min[s], f.elsRare.N.max[s],
          ])
        }
      }
      out.push({
        key: 'comboFrames',
        label: 'Combinações: envoltórias nas barras',
        file: 'combinacoes_barras.csv',
        header: [
          'barra', 'grupo', 'estação',
          'ELU Mz mín (kN·m)', 'ELU Mz máx (kN·m)', 'ELU Vy mín (kN)', 'ELU Vy máx (kN)', 'ELU N mín (kN)', 'ELU N máx (kN)',
          'ELU T mín (kN·m)', 'ELU T máx (kN·m)',
          'ELU N conc. c/ Mz mín (kN)', 'ELU N conc. c/ Mz máx (kN)',
          'ELS rara Mz mín (kN·m)', 'ELS rara Mz máx (kN·m)', 'ELS freq. Mz mín (kN·m)', 'ELS freq. Mz máx (kN·m)',
          'ELS q.p. Mz mín (kN·m)', 'ELS q.p. Mz máx (kN·m)',
          'ELS rara N mín (kN)', 'ELS rara N máx (kN)',
        ],
        rows,
      })
    }
    if (cb.cables.length) {
      out.push({
        key: 'comboCables',
        label: 'Combinações: tração nos cabos',
        file: 'combinacoes_cabos.csv',
        header: [
          'cabo', 'grupo', 'ELU mín (kN)', 'ELU máx (kN)', 'ELS rara mín (kN)', 'ELS rara máx (kN)',
          'ELS freq. mín (kN)', 'ELS freq. máx (kN)', 'ELS q.p. mín (kN)', 'ELS q.p. máx (kN)',
        ],
        rows: cb.cables.map((c) => [c.id, groupPt(groupOf.get(c.id)), ...c.elu, ...c.elsRare, ...c.elsFreq, ...c.elsQp]),
      })
    }
  }

  return out.filter((t) => t.rows.length > 0)
}

/* ------------------------------------------------------------------ JSON */

export function resultsJson(model: BridgeModel, results: BridgeResults, version: string): string {
  return JSON.stringify(
    { schema: 'opengirder-results/1', software: `OpenGirder ${version}`, model: model.name, exportedAt: new Date().toISOString(), results },
    null,
    1,
  )
}

/** nome-base de arquivo seguro a partir do nome do modelo */
export function fileBase(model: BridgeModel): string {
  return model.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().replace(/\s+/g, '_') || 'ponte'
}
