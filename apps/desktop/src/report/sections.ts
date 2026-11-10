/**
 * Seções do memorial de cálculo. Cada seção é independente e registrável: para acrescentar
 * uma (verificação de seções, protensão, estabilidade, fases…), inclua um objeto em
 * `REPORT_SECTIONS` na posição desejada. A numeração é automática (só entram as habilitadas).
 *
 * `render` devolve HTML. Use os auxiliares de `./html` (table, kv, ctx.tbl, ctx.fig, ctx.h…) e
 * de `./svg` (lineChartSvg) para manter o padrão visual; o 3º argumento (`ctx`) é opcional.
 */

import type { BridgeModel, BridgeResults, CableCheck, Env3 } from '@opengirder/engine'
import { GROUP_LABEL, MATERIAL_KIND_LABEL, MODE_KIND_LABEL, TYPE_LABEL } from '../format'
import { deadAlong, envelopeAlong, keyFigures, lanePaths, matchReference, type LanePath } from '../panels/data'
import { type Cell, type Col, type ReportContext, badge, eq, esc, kv, n, na, ni, note, p, raw, table, ul } from './html'
import { BLUE, GREY, INK, ORANGE, lineChartSvg, projectionSvg } from './svg'
import { secDiferidos, secEstabilidade, secFases, secProtensao, secSecoes } from './sectionsExtra'

export interface ReportSection {
  key: string
  title: string
  /** anexo: numerado com letras e colocado no fim; só entra se os anexos forem pedidos */
  annex?: boolean
  enabled: (model: BridgeModel, results: BridgeResults) => boolean
  render: (model: BridgeModel, results: BridgeResults, ctx: ReportContext) => string
}

/* ------------------------------------------------------------------ auxiliares */

const typeLabel = (t: string): string => TYPE_LABEL[t] ?? (t === 'arch' ? 'Ponte em arco' : t)
const groupLabel = (g: string | undefined): string => GROUP_LABEL[g ?? 'other'] ?? (g === 'arch' ? 'Arco' : (g ?? 'Outros'))
const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz']
const mpa = (kpa: number | undefined): string => (kpa !== undefined && Number.isFinite(kpa) ? n(kpa / 1000, 0) : '—')

function groupMap(model: BridgeModel): Map<number, string> {
  const m = new Map<number, string>()
  for (const e of model.elements) m.set(e.id, e.group ?? 'other')
  return m
}

function deckNodeSet(model: BridgeModel): Set<number> {
  const s = new Set<number>()
  for (const e of model.elements) {
    if (e.kind === 'frame' && (e.group ?? 'deck') === 'deck') {
      s.add(e.n1)
      s.add(e.n2)
    }
  }
  return s
}

const GROUP_ORDER = ['deck', 'tower', 'arch', 'pier', 'main-cable', 'stay', 'hanger', 'crossbeam', 'rigid', 'other']
const byGroupOrder = (a: string, b: string): number => {
  const ia = GROUP_ORDER.indexOf(a)
  const ib = GROUP_ORDER.indexOf(b)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
}

/** soma ponto a ponto de duas curvas com as mesmas abscissas */
const add = (a: number[], b: number[]): number[] => a.map((v, i) => v + (b[i] ?? NaN))

function extent(values: number[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min: Number.isFinite(min) ? min : NaN, max: Number.isFinite(max) ? max : NaN }
}

const laneTitle = (path: LanePath, count: number): string => (count > 1 ? ` — ${esc(path.lane.name)}` : '')

/**
 * Estacas da faixa onde o tabuleiro tem apoio vertical: o próprio nó restrito em z, ou um nó
 * restrito alcançado por barras que não são do tabuleiro (aparelho de apoio, transversina,
 * pilar, torre).
 */
function supportStations(model: BridgeModel, path: LanePath): number[] {
  const fixedZ = new Set(model.nodes.filter((nd) => nd.fix?.[2]).map((nd) => nd.id))
  if (fixedZ.size === 0) return []
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number): void => {
    const arr = adj.get(a)
    if (arr) arr.push(b)
    else adj.set(a, [b])
  }
  for (const e of model.elements) {
    if (e.kind !== 'frame' || (e.group ?? 'deck') === 'deck') continue
    link(e.n1, e.n2)
    link(e.n2, e.n1)
  }
  const out: number[] = []
  path.lane.nodes
    .filter((id) => model.nodes.some((nd) => nd.id === id))
    .forEach((id, k) => {
      const seen = new Set<number>([id])
      const queue = [id]
      let found = fixedZ.has(id)
      while (!found && queue.length && seen.size < 400) {
        const cur = queue.shift() as number
        for (const nb of adj.get(cur) ?? []) {
          if (seen.has(nb)) continue
          if (fixedZ.has(nb)) {
            found = true
            break
          }
          seen.add(nb)
          queue.push(nb)
        }
      }
      if (found && path.s[k] !== undefined) out.push(path.s[k])
    })
  return out
}

const supportNote = (marks: number[]): string => (marks.length ? ' Triângulos indicam apoios do tabuleiro.' : '')

const tableCompact = (cols: (string | Col)[], rows: Cell[][]): string => table(cols, rows, { compact: true })

/* ------------------------------------------------------------------ 1. dados e hipóteses */

const secDados: ReportSection = {
  key: 'dados',
  title: 'Dados da obra e hipóteses de cálculo',
  enabled: () => true,
  render: (model, r, ctx) => {
    const meta = model.meta ?? {}
    const xs = model.nodes.map((nd) => nd.x)
    const total = xs.length ? Math.max(...xs) - Math.min(...xs) : NaN
    const lanes = model.lanes ?? []
    const deckMat = meta.deckMaterial === 'steel' ? 'Aço' : meta.deckMaterial === 'composite' ? 'Misto aço–concreto' : meta.deckMaterial === 'concrete' ? 'Concreto' : undefined
    const out: string[] = []
    out.push(ctx.h('Identificação'))
    out.push(
      kv([
        ['Obra', model.name],
        ['Sistema estrutural', typeLabel(model.type)],
        ['Vãos', meta.spans?.length ? `${meta.spans.map((s) => n(s, 2)).join(' + ')} m` : undefined],
        ['Maior vão', meta.mainSpan ? `${n(meta.mainSpan, 2)} m` : undefined],
        ['Extensão do modelo (eixo X)', Number.isFinite(total) ? `${n(total, 2)} m` : undefined],
        ['Material do tabuleiro', deckMat],
        ['Faixas de carga móvel', lanes.length ? lanes.map((l) => `${l.name} (${n(l.width, 2)} m)`).join('; ') : 'nenhuma'],
        ['Descrição', meta.description],
      ]),
    )
    out.push(ctx.h('Normas e referências'))
    const normas = [
      '<b>ABNT NBR 7188:2013</b> — Carga móvel rodoviária e de pedestres em pontes, viadutos, passarelas e outras estruturas (trem-tipo, CIV, CNF e CIA).',
      '<b>ABNT NBR 6118:2023</b> — Projeto de estruturas de concreto (módulo de elasticidade secante do concreto, item 8.2.8).',
      '<b>ABNT NBR 8800:2008</b> — propriedades do aço estrutural (E = 200 GPa, G = 77 GPa).',
    ]
    if (r.combos) normas.push('<b>ABNT NBR 8681:2003</b> — Ações e segurança nas estruturas (combinações de ações).')
    if (r.checks.cables.length) {
      normas.push(
        '<b>fib Bulletin 30</b> e <b>PTI DC45.1</b> — limites de tração em estais e cabos (0,45·F<sub>u</sub> em serviço; φ = 0,65 no estado-limite último). A ABNT não possui norma específica para estais.',
      )
    }
    out.push(ul(normas))
    out.push(ctx.h('Unidades e convenções de sinais'))
    out.push(
      ul([
        'Unidades: comprimento em m; força em kN; momento em kN·m; tensão em MPa; massa em t; deslocamentos apresentados em mm.',
        'Eixos globais: X ao longo da obra, Y transversal, Z vertical para cima (gravidade em −Z).',
        'Barras: força normal N positiva na tração. M<sub>z</sub> é o momento fletor no plano vertical; M<sub>z</sub> &gt; 0 traciona a fibra inferior. V<sub>y</sub> é o cortante associado. Os diagramas de momento são desenhados do lado tracionado.',
        'Esforços informados em três estações de cada barra: início, meio e fim.',
        'Reações: forças e momentos que o apoio aplica na estrutura, nos eixos globais.',
      ]),
    )
    out.push(ctx.h('O que a análise considera'))
    const cons: string[] = []
    cons.push(
      r.formFinding
        ? 'Form-finding: os comprimentos indeformados de estais e pendurais são ajustados para que o tabuleiro fique no greide de projeto sob carga permanente.'
        : 'Carga permanente aplicada sobre a geometria e os comprimentos de cabo informados (sem form-finding nesta análise).',
    )
    cons.push(
      'Carga permanente (peso próprio + sobrecarga permanente das seções) por análise estática não linear geométrica: cabos como catenária elástica exata e barras em formulação corrotacional (grandes deslocamentos, efeito P-Δ).',
    )
    if (r.modal) cons.push('Análise modal sobre a rigidez tangente do estado de carga permanente (inclui a rigidez geométrica dos cabos), com massas concentradas.')
    if (r.moving) cons.push('Carga móvel por linhas de influência, linearizada em torno do estado de carga permanente, com envoltórias de esforços, trações e flechas.')
    if (r.cases?.length) cons.push(`Casos de carga adicionais linearizados em torno do estado permanente: ${r.cases.map((c) => esc(c.name)).join('; ')}.`)
    if (r.combos) cons.push('Combinações de ações da NBR 8681 com envoltórias por estado-limite.')
    if (r.prestress) cons.push('Protensão do tabuleiro: perdas imediatas e progressivas, cargas equivalentes do traçado e verificação das tensões normais.')
    if (r.checks.sections?.length) cons.push('Verificação das seções de concreto (NBR 6118) e de aço (NBR 8800) com os esforços das envoltórias.')
    if (r.buckling) cons.push('Flambagem global linearizada no estado de carga permanente.')
    if (r.stages) cons.push('Fases construtivas por análise regressiva (desmontagem), sem efeitos reológicos.')
    out.push(ul(cons))
    out.push(ctx.h('Limitações desta análise'))
    const lim: string[] = [
      'Carga móvel, análise modal e demais ações variáveis são <b>linearizadas</b> em torno do estado de carga permanente. Em pontes pênseis muito carregadas isso tende a superestimar flechas (a rigidez cresce com a carga).',
      'Modelo de barras (espinha): efeitos locais em lajes, transversinas, ancoragens e regiões de introdução de carga não são representados, nem a distorção de seções abertas ou treliçadas na torção.',
      r.prestress
        ? r.longTerm
          ? 'Fluência e retração: perdas de protensão e efeitos na estrutura pelo módulo efetivo ajustado pela idade (um passo de t0 a t∞); a relaxação dos estais não é considerada.'
          : 'Fluência, retração e relaxação entram apenas nas perdas de protensão; a redistribuição de esforços ao longo do tempo não é calculada.'
        : r.longTerm
          ? 'Fluência e retração do concreto pelo módulo efetivo ajustado pela idade (um passo de t0 a t∞); sem história de carregamento nem relaxação dos estais.'
          : 'Fluência, retração e relaxação ao longo do tempo não são consideradas neste memorial.',
      'Apoios rígidos ou com as molas informadas no modelo; não há interação solo–estrutura.',
    ]
    if (!r.cases?.length) lim.push('Temperatura, vento, frenagem e sismo não foram incluídos nesta análise.')
    if (!r.moving) lim.push('A carga móvel não foi calculada nesta análise.')
    if (r.moving && r.moving.Liv > 200) lim.push('Vão acima de 200 m: a NBR 7188 exige estudo específico de amplificação dinâmica; foi adotado o CIV correspondente a 200 m.')
    out.push(ul(lim))
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 2. materiais e seções */

const secMateriais: ReportSection = {
  key: 'materiais',
  title: 'Materiais e seções',
  enabled: (m) => m.materials.length > 0,
  render: (model, _r, ctx) => {
    const usedMat = new Map<string, number>()
    const usedSec = new Map<string, number>()
    for (const e of model.elements) {
      usedMat.set(e.mat, (usedMat.get(e.mat) ?? 0) + 1)
      if (e.kind === 'frame') usedSec.set(e.sec, (usedSec.get(e.sec) ?? 0) + 1)
    }
    const out: string[] = []
    out.push(
      ctx.tbl(
        'Materiais',
        [{ label: 'Material', left: true }, { label: 'Tipo', left: true }, 'E (MPa)', 'G (MPa)', 'γ (kN/m³)', 'Resistência característica (MPa)', 'Elementos'],
        model.materials.map((m) => [
          m.name,
          MATERIAL_KIND_LABEL[m.kind] ?? m.kind,
          mpa(m.E),
          mpa(m.G),
          n(m.gamma, 1),
          m.fck !== undefined ? `fck = ${mpa(m.fck)}` : m.fy !== undefined ? `fy = ${mpa(m.fy)}` : m.fpk !== undefined ? `fptk = ${mpa(m.fpk)}` : '—',
          ni(usedMat.get(m.id) ?? 0),
        ]),
      ),
    )
    if (model.sections.length) {
      out.push(
        ctx.tbl(
          'Seções das barras',
          [{ label: 'Seção', left: true }, 'A (m²)', 'Iy lateral (m⁴)', 'Iz vertical (m⁴)', 'J (m⁴)', 'Carga adicional (kN/m)', 'Altura (m)', 'Largura (m)', 'Barras'],
          model.sections.map((s) => [
            s.name,
            na(s.A),
            na(s.Iy),
            na(s.Iz),
            na(s.J),
            s.extraDead ? n(s.extraDead, 1) : '—',
            s.depth !== undefined ? n(s.depth, 2) : '—',
            s.width !== undefined ? n(s.width, 2) : '—',
            ni(usedSec.get(s.id) ?? 0),
          ]),
        ),
      )
    }
    // cabos por grupo
    const mats = new Map(model.materials.map((m) => [m.id, m]))
    const cg = new Map<string, { count: number; aMin: number; aMax: number; sMin: number; sMax: number; mat: string }>()
    for (const e of model.elements) {
      if (e.kind !== 'cable') continue
      const g = e.group ?? 'other'
      const cur = cg.get(g) ?? { count: 0, aMin: Infinity, aMax: -Infinity, sMin: Infinity, sMax: -Infinity, mat: mats.get(e.mat)?.name ?? e.mat }
      cur.count++
      cur.aMin = Math.min(cur.aMin, e.A)
      cur.aMax = Math.max(cur.aMax, e.A)
      if (e.strands) {
        cur.sMin = Math.min(cur.sMin, e.strands)
        cur.sMax = Math.max(cur.sMax, e.strands)
      }
      cg.set(g, cur)
    }
    if (cg.size) {
      const range = (a: number, b: number, f: (v: number) => string): string => (!Number.isFinite(a) ? '—' : Math.abs(a - b) < 1e-12 ? f(a) : `${f(a)} a ${f(b)}`)
      out.push(
        ctx.tbl(
          'Cabos',
          [{ label: 'Grupo', left: true }, { label: 'Material', left: true }, 'Quantidade', 'Área metálica (mm²)', 'Cordoalhas'],
          [...cg.entries()]
            .sort((a, b) => byGroupOrder(a[0], b[0]))
            .map(([g, c]) => [groupLabel(g), c.mat, ni(c.count), range(c.aMin * 1e6, c.aMax * 1e6, (v) => n(v, 0)), range(c.sMin, c.sMax, (v) => ni(v))]),
        ),
      )
    }
    out.push(note('A carga adicional da seção reúne pavimento, barreiras, guarda-corpos e demais cargas permanentes não estruturais, e entra também na massa.'))
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 3. modelo */

const secModelo: ReportSection = {
  key: 'modelo',
  title: 'Modelo estrutural',
  enabled: () => true,
  render: (model, r, ctx) => {
    const nFrames = model.elements.filter((e) => e.kind === 'frame').length
    const nCables = model.elements.length - nFrames
    const out: string[] = []
    out.push(
      kv([
        ['Nós', ni(model.nodes.length)],
        ['Barras de pórtico espacial', ni(nFrames)],
        ['Elementos de cabo', ni(nCables)],
        ['Graus de liberdade livres', ni(r.nDofs)],
      ]),
    )
    const el = projectionSvg(model, 'xz', r)
    if (el.svg) {
      out.push(
        ctx.fig(el.svg, `Elevação do modelo (plano X–Z)${el.exaggeration > 1 ? `, com escala vertical ampliada ${ni(el.exaggeration)}×` : ''}. Apoios em azul.`),
      )
    }
    const ys = model.nodes.map((nd) => nd.y)
    const xs = model.nodes.map((nd) => nd.x)
    const wy = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
    const wx = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
    if (wy > 0.02 * wx && wy > 1) {
      const pl = projectionSvg(model, 'xy', r)
      if (pl.svg) out.push(ctx.fig(pl.svg, `Planta do modelo (plano X–Y)${pl.exaggeration > 1 ? `, com escala transversal ampliada ${ni(pl.exaggeration)}×` : ''}.`))
    }
    if (ctx.opts.image) {
      out.push(ctx.fig(`<img class="shot" src="${ctx.opts.image}" alt="Vista 3D do modelo"/>`, 'Vista tridimensional do modelo no momento da emissão do memorial.'))
    }
    // contagem por grupo
    const cnt = new Map<string, number>()
    for (const e of model.elements) cnt.set(e.group ?? 'other', (cnt.get(e.group ?? 'other') ?? 0) + 1)
    out.push(
      ctx.tbl(
        'Elementos por grupo',
        [{ label: 'Grupo', left: true }, 'Elementos'],
        [...cnt.entries()].sort((a, b) => byGroupOrder(a[0], b[0])).map(([g, c]) => [groupLabel(g), ni(c)]),
        { narrow: true },
      ),
    )
    const sup = model.nodes.filter((nd) => nd.fix?.some(Boolean) || nd.springs?.some((k) => k > 0))
    if (sup.length) {
      const MAX = 60
      out.push(
        ctx.tbl(
          `Apoios${sup.length > MAX ? ` (primeiros ${MAX} de ${sup.length})` : ''}`,
          [{ label: 'Nó' }, 'x (m)', 'y (m)', 'z (m)', { label: 'Graus de liberdade restritos', left: true }, { label: 'Molas', left: true }],
          sup.slice(0, MAX).map((nd) => [
            ni(nd.id),
            n(nd.x, 2),
            n(nd.y, 2),
            n(nd.z, 2),
            nd.fix?.every(Boolean) ? 'engaste (todos)' : DOF.filter((_, d) => nd.fix?.[d]).join(', ') || '—',
            nd.springs?.some((k) => k > 0) ? DOF.filter((_, d) => (nd.springs?.[d] ?? 0) > 0).join(', ') : '—',
          ]),
        ),
      )
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 4. carga permanente */

const secPermanente: ReportSection = {
  key: 'permanente',
  title: 'Form-finding e carga permanente',
  enabled: () => true,
  render: (model, r, ctx) => {
    const out: string[] = []
    const dl = r.deadLoad
    const ff = r.formFinding
    out.push(ctx.h('Convergência'))
    const conv: [string, Cell][] = []
    if (ff) {
      conv.push(['Form-finding', badge(ff.converged, 'convergiu', 'não estabilizou')])
      conv.push(['Cabos ajustados / condições impostas', `${ni(ff.nUnknowns)} / ${ni(ff.nTargets)}`])
      conv.push(['Iterações do form-finding', ni(ff.iterations)])
      conv.push(['Deslocamento residual nas ancoragens do tabuleiro', `${n(ff.residual * 1000, 1)} mm`])
    }
    conv.push(['Análise estática não linear', badge(dl.converged, 'convergiu', 'não convergiu')])
    conv.push(['Iterações de Newton–Raphson', ni(dl.iterations)])
    conv.push(['Resíduo final de forças', `${na(dl.residual)} kN`])
    out.push(kv(conv))
    if (ff) {
      out.push(
        note(
          'O form-finding ajusta o comprimento indeformado de cada estai e pendural por mínimos quadrados sobre três famílias de condições: força nos cabos próxima da reação do tabuleiro sobre apoios rígidos nas ancoragens, tabuleiro no greide e torres no prumo. O deslocamento residual corresponde, em essência, ao encurtamento elástico de torres e pilares.',
        ),
      )
    }

    // deslocamentos
    out.push(ctx.h('Deslocamentos'))
    const u = dl.u
    const deck = deckNodeSet(model)
    let dMin = { v: 0, id: -1 }
    let dMax = { v: 0, id: -1 }
    let tMax = { v: 0, id: -1 }
    const towerNodes = new Set<number>()
    for (const e of model.elements) {
      if (e.kind === 'frame' && e.group === 'tower') {
        towerNodes.add(e.n1)
        towerNodes.add(e.n2)
      }
    }
    let hTower = { v: 0, id: -1 }
    model.nodes.forEach((nd, i) => {
      const ux = u[6 * i] ?? 0
      const uy = u[6 * i + 1] ?? 0
      const uz = u[6 * i + 2] ?? 0
      const t = Math.hypot(ux, uy, uz)
      if (Number.isFinite(t) && t > tMax.v) tMax = { v: t, id: nd.id }
      if (deck.has(nd.id) && Number.isFinite(uz)) {
        if (uz < dMin.v) dMin = { v: uz, id: nd.id }
        if (uz > dMax.v) dMax = { v: uz, id: nd.id }
      }
      if (towerNodes.has(nd.id)) {
        const h = Math.hypot(ux, uy)
        if (Number.isFinite(h) && h > hTower.v) hTower = { v: h, id: nd.id }
      }
    })
    const at = (x: { v: number; id: number }): string => `${n(x.v * 1000, 1)} mm${x.id >= 0 ? ` (nó ${x.id})` : ''}`
    const disp: [string, Cell][] = [['Maior deslocamento total', at(tMax)]]
    if (deck.size) {
      disp.push(['Tabuleiro — maior deslocamento para baixo', at(dMin)])
      disp.push(['Tabuleiro — maior deslocamento para cima', at(dMax)])
    }
    if (towerNodes.size) disp.push(['Torres — maior deslocamento horizontal', at(hTower)])
    out.push(kv(disp))

    // diagramas ao longo do tabuleiro
    const paths = lanePaths(model).filter((pth) => pth.s.length > 1)
    if (paths.length) {
      out.push(ctx.h('Esforços no tabuleiro'))
      for (const path of paths.slice(0, 3)) {
        const marks = supportStations(model, path)
        const mz = deadAlong(path, dl.frames, 'Mz')
        const nn = deadAlong(path, dl.frames, 'N')
        const vy = deadAlong(path, dl.frames, 'Vy')
        out.push(
          ctx.fig(
            lineChartSvg({
              series: [{ label: 'Mz — carga permanente', x: mz.x, y: mz.y, color: INK, fill: true }],
              xLabel: 'Estaca ao longo do tabuleiro (m)',
              yLabel: 'Mz (kN·m)',
              invertY: true,
              marks,
            }),
            `Momento fletor M<sub>z</sub> de carga permanente${laneTitle(path, paths.length)}.${supportNote(marks)}`,
          ),
        )
        const eN = extent(nn.y)
        const eV0 = extent(vy.y)
        // só desenha N quando ele é relevante frente ao cortante (estaiadas, pênseis, arcos, pórticos)
        if (Math.max(Math.abs(eN.min), Math.abs(eN.max)) > 0.05 * Math.max(Math.abs(eV0.min), Math.abs(eV0.max), 1)) {
          out.push(
            ctx.fig(
              lineChartSvg({
                series: [{ label: 'N — carga permanente', x: nn.x, y: nn.y, color: BLUE, fill: true }],
                xLabel: 'Estaca ao longo do tabuleiro (m)',
                yLabel: 'N (kN)',
                marks,
                height: 190,
              }),
              `Força normal de carga permanente no tabuleiro${laneTitle(path, paths.length)} (tração positiva).`,
            ),
          )
        }
        const eM = extent(mz.y)
        const eV = extent(vy.y)
        out.push(
          kv([
            [`Mz máximo / mínimo${paths.length > 1 ? ` (${path.lane.name})` : ''}`, `${n(eM.max, 0)} / ${n(eM.min, 0)} kN·m`],
            ['Vy máximo / mínimo', `${n(eV.max, 0)} / ${n(eV.min, 0)} kN`],
            ['N máximo / mínimo', `${n(eN.max, 0)} / ${n(eN.min, 0)} kN`],
          ]),
        )
      }
    }

    // extremos por grupo de barras
    const gm = groupMap(model)
    const fg = new Map<string, { count: number; N: [number, number]; Mz: [number, number]; Vy: number; My: number; T: number }>()
    for (const f of dl.frames) {
      const g = gm.get(f.id) ?? 'other'
      if (g === 'rigid') continue
      const cur = fg.get(g) ?? { count: 0, N: [Infinity, -Infinity], Mz: [Infinity, -Infinity], Vy: 0, My: 0, T: 0 }
      cur.count++
      for (let s = 0; s < 3; s++) {
        cur.N[0] = Math.min(cur.N[0], f.N[s])
        cur.N[1] = Math.max(cur.N[1], f.N[s])
        cur.Mz[0] = Math.min(cur.Mz[0], f.Mz[s])
        cur.Mz[1] = Math.max(cur.Mz[1], f.Mz[s])
        cur.Vy = Math.max(cur.Vy, Math.abs(f.Vy[s]))
        cur.My = Math.max(cur.My, Math.abs(f.My[s]))
        cur.T = Math.max(cur.T, Math.abs(f.T[s]))
      }
      fg.set(g, cur)
    }
    if (fg.size) {
      out.push(ctx.h('Esforços extremos por grupo de barras'))
      out.push(
        ctx.tbl(
          'Esforços de carga permanente — valores extremos por grupo',
          [{ label: 'Grupo', left: true }, 'Barras', 'N mín (kN)', 'N máx (kN)', 'Mz mín (kN·m)', 'Mz máx (kN·m)', '|Vy| máx (kN)', '|My| máx (kN·m)', '|T| máx (kN·m)'],
          [...fg.entries()]
            .sort((a, b) => byGroupOrder(a[0], b[0]))
            .map(([g, c]) => [groupLabel(g), ni(c.count), n(c.N[0], 0), n(c.N[1], 0), n(c.Mz[0], 0), n(c.Mz[1], 0), n(c.Vy, 0), n(c.My, 0), n(c.T, 0)]),
        ),
      )
    }

    // cabos por grupo
    if (dl.cables.length) {
      out.push(ctx.h('Trações nos cabos'))
      const cg = new Map<string, { count: number; min: number; max: number; sum: number; slack: number; sag: number }>()
      for (const c of dl.cables) {
        const g = gm.get(c.id) ?? 'other'
        const T = Math.max(c.Ti, c.Tj)
        const cur = cg.get(g) ?? { count: 0, min: Infinity, max: -Infinity, sum: 0, slack: 0, sag: 0 }
        cur.count++
        cur.min = Math.min(cur.min, T)
        cur.max = Math.max(cur.max, T)
        cur.sum += T
        if (c.slack) cur.slack++
        if (Number.isFinite(c.sag)) cur.sag = Math.max(cur.sag, c.sag)
        cg.set(g, cur)
      }
      out.push(
        ctx.tbl(
          'Tração de carga permanente nos cabos, por grupo (maior valor entre as duas extremidades)',
          [{ label: 'Grupo', left: true }, 'Cabos', 'T mín (kN)', 'T média (kN)', 'T máx (kN)', 'Maior flecha (m)', 'Frouxos'],
          [...cg.entries()]
            .sort((a, b) => byGroupOrder(a[0], b[0]))
            .map(([g, c]) => [groupLabel(g), ni(c.count), n(c.min, 0), n(c.sum / c.count, 0), n(c.max, 0), n(c.sag, 2), ni(c.slack)]),
        ),
      )
      out.push(note(ctx.opts.annexes ? 'A tabela completa, cabo a cabo, está no anexo.' : 'A tabela completa, cabo a cabo, pode ser incluída como anexo ou exportada em CSV.'))
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 5. modal */

const secModal: ReportSection = {
  key: 'modal',
  title: 'Análise modal',
  enabled: (_m, r) => !!r.modal && r.modal.modes.length > 0,
  render: (model, r, ctx) => {
    const md = r.modal!
    const out: string[] = []
    out.push(
      p(
        'Modos de vibração calculados por iteração em subespaço sobre a rigidez tangente do estado de carga permanente, com matriz de massa concentrada (inclui a sobrecarga permanente). A massa efetiva é dada em porcentagem da massa total em cada direção global.',
      ),
    )
    out.push(kv([['Massa total do modelo', `${n(md.totalMass, 0)} t`], ['Modos calculados', ni(md.modes.length)], ['Convergência', badge(md.converged, 'convergiu', 'incompleta')]]))
    const sum: [number, number, number] = [0, 0, 0]
    for (const m of md.modes) for (let d = 0; d < 3; d++) sum[d] += m.massPct[d]
    out.push(
      ctx.tbl(
        'Modos de vibração',
        ['Modo', 'Período (s)', 'Frequência (Hz)', { label: 'Tipo', left: true }, 'Massa X (%)', 'Massa Y (%)', 'Massa Z (%)'],
        md.modes.map((m) => [ni(m.index), n(m.period, 3), n(m.frequency, 4), MODE_KIND_LABEL[m.kind] ?? m.kind, n(m.massPct[0], 1), n(m.massPct[1], 1), n(m.massPct[2], 1)]),
        { foot: [['Σ', '', '', 'massa efetiva acumulada', n(sum[0], 1), n(sum[1], 1), n(sum[2], 1)]] },
      ),
    )
    const refs = model.meta?.reference ?? []
    if (refs.length) {
      const rows: Cell[][] = refs.map((ref) => {
        const m = matchReference(ref, r)
        const diff = m && ref.value !== 0 ? ((m.value - ref.value) / ref.value) * 100 : NaN
        return [
          ref.label,
          `${na(ref.value)} ${ref.unit}`,
          m ? `${na(m.value)} ${ref.unit}` : '—',
          m ? m.note : 'sem grandeza correspondente',
          Number.isFinite(diff) ? `${diff >= 0 ? '+' : ''}${n(diff, 1)}%` : '—',
          ref.source,
        ]
      })
      out.push(
        ctx.tbl(
          'Comparação com valores de referência',
          [{ label: 'Grandeza', left: true }, 'Referência', 'Calculado', { label: 'Correspondência', left: true }, 'Diferença', { label: 'Fonte', left: true }],
          rows,
        ),
      )
      out.push(note('A comparação só é feita para períodos e frequências, pelo tipo de modo citado na referência.'))
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 6. carga móvel */

const secMovel: ReportSection = {
  key: 'movel',
  title: 'Carga móvel — NBR 7188',
  enabled: (_m, r) => !!r.moving,
  render: (model, r, ctx) => {
    const mv = r.moving!
    const out: string[] = []
    out.push(ctx.h('Trem-tipo e coeficientes de ponderação'))
    out.push(
      p(
        `Trem-tipo <b>${esc(mv.vehicle)}</b>: veículo de ${ni(mv.nAxles)} eixos espaçados de ${n(mv.axleSpacing, 2)} m e carga uniformemente distribuída na pista. A carga distribuída é mantida sob o veículo e a parcela que ela já aplica na área de 3 × 6 m é descontada dos eixos (homogeneização).`,
      ),
    )
    out.push(eq('Q = P · CIV · CNF · CIA &nbsp;&nbsp;&nbsp; q = p · CIV · CNF · CIA'))
    out.push(
      ctx.tbl(
        'Coeficientes da NBR 7188',
        [{ label: 'Coeficiente', left: true }, { label: 'Expressão', left: true }, 'Valor'],
        [
          ['CIV — impacto vertical (5.1.2.1)', mv.Liv < 10 ? 'CIV = 1,35 (vão menor que 10 m)' : `CIV = 1 + 1,06 · 20 / (Liv + 50), com Liv = ${n(Math.min(mv.Liv, 200), 1)} m${mv.Liv > 200 ? ' (limitado a 200 m)' : ''}`, n(mv.CIV, 3)],
          ['CNF — número de faixas (5.1.2.2)', 'CNF = 1 − 0,05 · (n − 2) ≥ 0,9', n(mv.CNF, 3)],
          ['CIA — impacto adicional (5.1.2.3)', 'aplicado às seções a menos de 5 m de juntas e extremidades', n(mv.CIA, 2)],
        ],
      ),
    )
    out.push(
      kv([
        ['Vão de referência do CIV (Liv)', `${n(mv.Liv, 1)} m`],
        ['Carga por eixo, já descontada a distribuída', `${n(mv.axleLoad, 1)} kN`],
        ['Carga distribuída na pista mais larga', `${n(mv.distributed, 1)} kN/m`],
        ['Faixas carregadas', mv.lanes.map((id) => model.lanes.find((l) => l.id === id)?.name ?? id).join(', ') || '—'],
      ]),
    )
    out.push(
      note(
        'Envoltórias obtidas das linhas de influência de cada resposta: carga distribuída nos trechos desfavoráveis (pista inteira ou meia pista, com a torção correspondente) e um único veículo na posição e na excentricidade mais desfavoráveis.',
      ),
    )

    const paths = lanePaths(model).filter((pth) => pth.s.length > 1 && mv.lanes.includes(pth.lane.id.split('#')[0]))
    if (paths.length) {
      out.push(ctx.h('Envoltórias no tabuleiro'))
      for (const path of paths.slice(0, 3)) {
        const marks = supportStations(model, path)
        const dM = deadAlong(path, r.deadLoad.frames, 'Mz')
        const eM = envelopeAlong(path, mv.frames, 'Mz')
        const dV = deadAlong(path, r.deadLoad.frames, 'Vy')
        const eV = envelopeAlong(path, mv.frames, 'Vy')
        const mMax = add(dM.y, eM.max.y)
        const mMin = add(dM.y, eM.min.y)
        out.push(
          ctx.fig(
            lineChartSvg({
              series: [
                { label: 'Permanente', x: dM.x, y: dM.y, color: INK },
                { label: 'Permanente + móvel (máx.)', x: dM.x, y: mMax, color: ORANGE },
                { label: 'Permanente + móvel (mín.)', x: dM.x, y: mMin, color: BLUE },
              ],
              xLabel: 'Estaca ao longo do tabuleiro (m)',
              yLabel: 'Mz (kN·m)',
              invertY: true,
              marks,
            }),
            `Envoltória de M<sub>z</sub> característico (permanente + carga móvel com CIV, CNF e CIA)${laneTitle(path, paths.length)}.`,
          ),
        )
        out.push(
          ctx.fig(
            lineChartSvg({
              series: [
                { label: 'Permanente', x: dV.x, y: dV.y, color: INK },
                { label: 'Permanente + móvel (máx.)', x: dV.x, y: add(dV.y, eV.max.y), color: ORANGE },
                { label: 'Permanente + móvel (mín.)', x: dV.x, y: add(dV.y, eV.min.y), color: BLUE },
              ],
              xLabel: 'Estaca ao longo do tabuleiro (m)',
              yLabel: 'Vy (kN)',
              marks,
              height: 200,
            }),
            `Envoltória de V<sub>y</sub> característico${laneTitle(path, paths.length)}.`,
          ),
        )
        const xm = extent(eM.max.y)
        const nm = extent(eM.min.y)
        const tM = extent(mMax)
        const tm = extent(mMin)
        out.push(
          kv([
            [`Só carga móvel — Mz máximo / mínimo${paths.length > 1 ? ` (${path.lane.name})` : ''}`, `${n(xm.max, 0)} / ${n(nm.min, 0)} kN·m`],
            ['Permanente + móvel — Mz máximo / mínimo', `${n(tM.max, 0)} / ${n(tm.min, 0)} kN·m`],
          ]),
        )
      }
    }
    // flecha
    const deck = deckNodeSet(model)
    let q = { v: 0, id: -1 }
    model.nodes.forEach((nd, i) => {
      if (!deck.has(nd.id)) return
      const v = mv.uzMin[i]
      if (Number.isFinite(v) && v < q.v) q = { v, id: nd.id }
    })
    if (q.id >= 0) {
      out.push(ctx.h('Flecha por carga móvel'))
      const L = model.meta?.mainSpan
      out.push(
        kv([
          ['Maior flecha do tabuleiro (carga móvel com impacto)', `${n(Math.abs(q.v) * 1000, 1)} mm (nó ${q.id})`],
          ['Relação vão / flecha', L && q.v !== 0 ? `L / ${ni(L / Math.abs(q.v))} (L = ${n(L, 1)} m)` : undefined],
        ]),
      )
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 7. cabos */

const worst = (c: CableCheck): number => Math.max(c.ratioEls, c.ratioElu)

const secCabos: ReportSection = {
  key: 'cabos',
  title: 'Verificação dos cabos',
  enabled: (_m, r) => r.checks.cables.length > 0,
  render: (_model, r, ctx) => {
    const checks = r.checks.cables
    const out: string[] = []
    out.push(ctx.h('Critérios'))
    out.push(eq('ELS: &nbsp; T<sub>G</sub> + ΔT<sub>Q</sub> ≤ 0,45 · F<sub>u</sub> &nbsp;&nbsp;&nbsp;&nbsp; ELU: &nbsp; 1,35 · T<sub>G</sub> + 1,5 · ΔT<sub>Q</sub> ≤ 0,65 · F<sub>u</sub> &nbsp;&nbsp;&nbsp;&nbsp; F<sub>u</sub> = A · f<sub>ptk</sub>'))
    out.push(
      note(
        'T<sub>G</sub>: tração de carga permanente (maior extremidade); ΔT<sub>Q</sub>: maior acréscimo por carga móvel com impacto. Δσ é a faixa de tensão por carga móvel, para a avaliação de fadiga. Cabo frouxo sob carga permanente é reprovado.' +
          (r.moving ? '' : ' <b>A carga móvel não foi calculada nesta análise: ΔT<sub>Q</sub> = 0.</b>'),
      ),
    )
    const fails = checks.filter((c) => !c.ok).length
    out.push(ctx.h('Resultado'))
    out.push(
      kv([
        ['Cabos verificados', ni(checks.length)],
        ['Situação', badge(fails === 0, 'todos atendem', `${fails} não atende${fails === 1 ? '' : 'm'}`)],
        ['Maior aproveitamento em serviço (ELS)', n(Math.max(...checks.map((c) => c.ratioEls)), 2)],
        ['Maior aproveitamento último (ELU)', n(Math.max(...checks.map((c) => c.ratioElu)), 2)],
      ]),
    )
    const cg = new Map<string, { count: number; els: number; elu: number; ds: number; fail: number }>()
    for (const c of checks) {
      const cur = cg.get(c.group) ?? { count: 0, els: 0, elu: 0, ds: 0, fail: 0 }
      cur.count++
      cur.els = Math.max(cur.els, c.ratioEls)
      cur.elu = Math.max(cur.elu, c.ratioElu)
      cur.ds = Math.max(cur.ds, c.dSigma)
      if (!c.ok) cur.fail++
      cg.set(c.group, cur)
    }
    out.push(
      ctx.tbl(
        'Verificação dos cabos — resumo por grupo',
        [{ label: 'Grupo', left: true }, 'Cabos', 'ELS máx.', 'ELU máx.', 'Δσ máx. (MPa)', 'Reprovados', { label: 'Situação', left: true }],
        [...cg.entries()]
          .sort((a, b) => byGroupOrder(a[0], b[0]))
          .map(([g, c]) => [groupLabel(g), ni(c.count), n(c.els, 2), n(c.elu, 2), n(c.ds, 1), ni(c.fail), badge(c.fail === 0)]),
      ),
    )
    const top = [...checks].sort((a, b) => worst(b) - worst(a)).slice(0, 12)
    out.push(
      ctx.tbl(
        `Cabos mais solicitados${checks.length > top.length ? ` (${top.length} de ${checks.length})` : ''}`,
        ['Cabo', { label: 'Grupo', left: true }, 'TG (kN)', 'ΔTQ (kN)', 'T ELS (kN)', 'T ELU (kN)', 'Fu (kN)', 'ELS', 'ELU', 'Δσ (MPa)', { label: 'Situação', left: true }],
        top.map((c) => [ni(c.id), groupLabel(c.group), n(c.TG, 0), n(c.dTQ, 0), n(c.Tels, 0), n(c.Telu, 0), n(c.Fu, 0), n(c.ratioEls, 2), n(c.ratioElu, 2), n(c.dSigma, 1), badge(c.ok)]),
        { rowClass: (k) => (top[k].ok ? undefined : 'bad') },
      ),
    )
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 8. reações */

const secReacoes: ReportSection = {
  key: 'reacoes',
  title: 'Reações de apoio',
  enabled: (_m, r) => r.deadLoad.reactions.length > 0,
  render: (model, r, ctx) => {
    const rs = r.deadLoad.reactions
    const MAX = 80
    const sum = [0, 0, 0]
    for (const x of rs) for (let d = 0; d < 3; d++) sum[d] += x.R[d]
    const pos = new Map(model.nodes.map((nd) => [nd.id, nd]))
    const out: string[] = []
    out.push(
      ctx.tbl(
        `Reações de carga permanente${rs.length > MAX ? ` (primeiros ${MAX} de ${rs.length} apoios)` : ''}`,
        ['Nó', 'x (m)', 'Fx (kN)', 'Fy (kN)', 'Fz (kN)', 'Mx (kN·m)', 'My (kN·m)', 'Mz (kN·m)'],
        rs.slice(0, MAX).map((x) => [ni(x.node), n(pos.get(x.node)?.x, 2), n(x.R[0], 1), n(x.R[1], 1), n(x.R[2], 1), n(x.R[3], 1), n(x.R[4], 1), n(x.R[5], 1)]),
        { foot: [['Σ', '', n(sum[0], 1), n(sum[1], 1), n(sum[2], 1), '', '', '']] },
      ),
    )
    out.push(note('A soma das reações verticais equilibra o peso total do modelo (peso próprio, sobrecarga permanente e cabos).'))
    const cb = r.combos
    if (cb?.reactions.length) {
      out.push(
        ctx.tbl(
          'Reação vertical F<sub>z</sub> nas combinações',
          ['Nó', 'ELU mín (kN)', 'ELU máx (kN)', 'ELS rara mín (kN)', 'ELS rara máx (kN)'],
          cb.reactions.slice(0, MAX).map((x) => [ni(x.node), n(x.elu.min[2], 0), n(x.elu.max[2], 0), n(x.elsRare.min[2], 0), n(x.elsRare.max[2], 0)]),
        ),
      )
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ 9. casos e combinações */

const KIND_LABEL: Record<string, string> = {
  temperature: 'Temperatura',
  wind: 'Vento',
  braking: 'Frenagem / aceleração',
  seismic: 'Sismo',
  prestress: 'Protensão',
  creep: 'Fluência e retração',
  settlement: 'Recalque',
  other: 'Outro',
}
const LIMIT_LABEL: Record<string, string> = {
  ELU: 'ELU normal',
  'ELU-EXC': 'ELU excepcional',
  'ELS-R': 'ELS rara',
  'ELS-F': 'ELS frequente',
  'ELS-QP': 'ELS quase permanente',
}

const secCombos: ReportSection = {
  key: 'combos',
  title: 'Ações adicionais e combinações',
  enabled: (_m, r) => !!(r.cases?.length || r.combos),
  render: (model, r, ctx) => {
    const out: string[] = []
    const cases = r.cases ?? []
    const gm = groupMap(model)
    const deck = deckNodeSet(model)
    if (cases.length) {
      out.push(ctx.h('Casos de carga adicionais'))
      out.push(p('Cada caso é resolvido sobre a rigidez tangente do estado de carga permanente; os valores são incrementos em relação a esse estado.'))
      out.push(
        ctx.tbl(
          'Casos de carga adicionais — respostas extremas',
          [{ label: 'Caso', left: true }, { label: 'Ação', left: true }, { label: 'Sentido', left: true }, 'uz tabuleiro (mm)', 'Mz tabuleiro mín / máx (kN·m)', 'ΔT cabos mín / máx (kN)'],
          cases.map((c) => {
            let uz = 0
            model.nodes.forEach((nd, i) => {
              if (!deck.has(nd.id)) return
              const v = c.u[6 * i + 2]
              if (Number.isFinite(v) && Math.abs(v) > Math.abs(uz)) uz = v
            })
            const mz: number[] = []
            for (const f of c.frames) if ((gm.get(f.id) ?? '') === 'deck') mz.push(...f.Mz)
            const eM = extent(mz)
            const eT = extent(c.cables.map((x) => x.dT))
            return [
              `${c.id} — ${c.name}`,
              KIND_LABEL[c.kind] ?? c.kind,
              c.sign === 'both' ? '±' : 'fixo',
              n(uz * 1000, 1),
              mz.length ? `${n(eM.min, 0)} / ${n(eM.max, 0)}` : '—',
              c.cables.length ? `${n(eT.min, 0)} / ${n(eT.max, 0)}` : '—',
            ]
          }),
        ),
      )
      const info = cases.filter((c) => c.info?.length)
      if (info.length) {
        out.push(
          ctx.tbl(
            'Grandezas que caracterizam cada ação',
            [{ label: 'Caso', left: true }, { label: 'Grandeza', left: true }, 'Valor', { label: 'Unidade', left: true }],
            info.flatMap((c) => (c.info ?? []).map((i, k) => [k === 0 ? `${c.id} — ${c.name}` : '', i.label, na(i.value), i.unit])),
          ),
        )
      }
    }
    const cb = r.combos
    if (cb) {
      out.push(ctx.h('Combinações de ações'))
      const actions = Array.from(new Set(cb.list.flatMap((c) => Object.keys(c.factors))))
      const MAXC = 60
      if (cb.list.length && actions.length <= 14) {
        out.push(
          ctx.tbl(
            `Combinações geradas e fatores por ação${cb.list.length > MAXC ? ` (primeiras ${MAXC} de ${cb.list.length})` : ''}`,
            [{ label: 'Combinação', left: true }, { label: 'Estado-limite', left: true }, ...actions],
            cb.list.slice(0, MAXC).map((c) => [c.name || c.id, LIMIT_LABEL[c.limit] ?? c.limit, ...actions.map((a) => (c.factors[a] ? n(c.factors[a], 2) : '—'))]),
            { compact: true },
          ),
        )
        out.push(note('G: ações permanentes; Q: carga móvel; demais colunas: casos de carga adicionais pelo identificador.'))
      } else if (cb.list.length) {
        out.push(
          ctx.tbl(
            'Combinações geradas',
            [{ label: 'Combinação', left: true }, { label: 'Estado-limite', left: true }, { label: 'Fatores', left: true }],
            cb.list.slice(0, MAXC).map((c) => [
              c.name || c.id,
              LIMIT_LABEL[c.limit] ?? c.limit,
              Object.entries(c.factors)
                .filter(([, v]) => v)
                .map(([k, v]) => `${n(v, 2)}·${k}`)
                .join(' + '),
            ]),
            { compact: true },
          ),
        )
      }
      const paths = lanePaths(model).filter((pth) => pth.s.length > 1)
      const cbFrames = cb.frames
      const asEnv = (pick: (f: (typeof cbFrames)[number]) => { N: Env3; Vy: Env3; T: Env3; My: Env3; Mz: Env3 }) =>
        cbFrames.map((f) => ({ id: f.id, ...pick(f) }))
      for (const path of paths.slice(0, 3)) {
        const elu = envelopeAlong(path, asEnv((f) => f.elu), 'Mz')
        const qp = envelopeAlong(path, asEnv((f) => f.elsQp), 'Mz')
        const dM = deadAlong(path, r.deadLoad.frames, 'Mz')
        out.push(
          ctx.fig(
            lineChartSvg({
              series: [
                { label: 'ELU — máximo', x: elu.max.x, y: elu.max.y, color: ORANGE },
                { label: 'ELU — mínimo', x: elu.min.x, y: elu.min.y, color: BLUE },
                { label: 'Permanente (característico)', x: dM.x, y: dM.y, color: GREY, dash: true },
              ],
              xLabel: 'Estaca ao longo do tabuleiro (m)',
              yLabel: 'Mz (kN·m)',
              invertY: true,
              marks: supportStations(model, path),
            }),
            `Envoltória de M<sub>z</sub> no estado-limite último${laneTitle(path, paths.length)}.`,
          ),
        )
        const eu = extent(elu.max.y)
        const el = extent(elu.min.y)
        const q1 = extent(qp.max.y)
        const q0 = extent(qp.min.y)
        out.push(
          kv([
            [`ELU — Mz máximo / mínimo${paths.length > 1 ? ` (${path.lane.name})` : ''}`, `${n(eu.max, 0)} / ${n(el.min, 0)} kN·m`],
            ['ELS quase permanente — Mz máximo / mínimo', `${n(q1.max, 0)} / ${n(q0.min, 0)} kN·m`],
          ]),
        )
      }
      // extremos ELU por grupo
      const fg = new Map<string, { N: [number, number]; Mz: [number, number]; Vy: number }>()
      for (const f of cb.frames) {
        const g = gm.get(f.id) ?? 'other'
        if (g === 'rigid') continue
        const cur = fg.get(g) ?? { N: [Infinity, -Infinity], Mz: [Infinity, -Infinity], Vy: 0 }
        for (let s = 0; s < 3; s++) {
          cur.N[0] = Math.min(cur.N[0], f.elu.N.min[s])
          cur.N[1] = Math.max(cur.N[1], f.elu.N.max[s])
          cur.Mz[0] = Math.min(cur.Mz[0], f.elu.Mz.min[s])
          cur.Mz[1] = Math.max(cur.Mz[1], f.elu.Mz.max[s])
          cur.Vy = Math.max(cur.Vy, Math.abs(f.elu.Vy.min[s]), Math.abs(f.elu.Vy.max[s]))
        }
        fg.set(g, cur)
      }
      if (fg.size) {
        out.push(
          ctx.tbl(
            'Esforços de cálculo no ELU — valores extremos por grupo',
            [{ label: 'Grupo', left: true }, 'Nd mín (kN)', 'Nd máx (kN)', 'Mz,d mín (kN·m)', 'Mz,d máx (kN·m)', '|Vy,d| máx (kN)'],
            [...fg.entries()].sort((a, b) => byGroupOrder(a[0], b[0])).map(([g, c]) => [groupLabel(g), n(c.N[0], 0), n(c.N[1], 0), n(c.Mz[0], 0), n(c.Mz[1], 0), n(c.Vy, 0)]),
          ),
        )
      }
      out.push(note('As envoltórias são por esforço: os valores extremos de esforços diferentes não são necessariamente concomitantes.'))
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ avisos */

const secAvisos: ReportSection = {
  key: 'avisos',
  title: 'Avisos da análise',
  enabled: (_m, r) => r.warnings.length > 0,
  render: (_m, r) => `<ul class="warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`,
}

/* ------------------------------------------------------------------ anexos */

const anexoCabos: ReportSection = {
  key: 'anexo-cabos',
  title: 'Trações e verificações de todos os cabos',
  annex: true,
  enabled: (_m, r) => r.deadLoad.cables.length > 0,
  render: (model, r) => {
    const chk = new Map(r.checks.cables.map((c) => [c.id, c]))
    const el = new Map(model.elements.map((e) => [e.id, e]))
    const rows: Cell[][] = r.deadLoad.cables.map((c) => {
      const e = el.get(c.id)
      const k = chk.get(c.id)
      const cab = e && e.kind === 'cable' ? e : null
      return [
        ni(c.id), groupLabel(e?.group), e ? `${e.n1}–${e.n2}` : '—', cab ? n(cab.A * 1e6, 0) : '—', cab?.strands ? ni(cab.strands) : '—',
        n(c.L0, 3), n(Math.max(c.Ti, c.Tj), 0), k ? n(k.dTQ, 0) : '—', k ? n(k.ratioEls, 2) : '—', k ? n(k.ratioElu, 2) : '—',
        k ? n(k.dSigma, 1) : '—', c.slack ? raw('<span class="badge bad">frouxo</span>') : k ? badge(k.ok, 'ok', 'falha') : '—',
      ]
    })
    return tableCompact(
      ['Cabo', { label: 'Grupo', left: true }, { label: 'Nós', left: true }, 'A (mm²)', 'Cord.', 'L0 (m)', 'TG (kN)', 'ΔTQ (kN)', 'ELS', 'ELU', 'Δσ (MPa)', { label: 'Situação', left: true }],
      rows,
    )
  },
}

const anexoTabuleiro: ReportSection = {
  key: 'anexo-tabuleiro',
  title: 'Esforços ao longo do tabuleiro',
  annex: true,
  enabled: (m) => lanePaths(m).some((pth) => pth.s.length > 1),
  render: (model, r) => {
    const out: string[] = []
    const paths = lanePaths(model).filter((pth) => pth.s.length > 1)
    const mv = r.moving
    for (const path of paths.slice(0, 3)) {
      const N = deadAlong(path, r.deadLoad.frames, 'N')
      const V = deadAlong(path, r.deadLoad.frames, 'Vy')
      const M = deadAlong(path, r.deadLoad.frames, 'Mz')
      const eM = mv ? envelopeAlong(path, mv.frames, 'Mz') : null
      const eV = mv ? envelopeAlong(path, mv.frames, 'Vy') : null
      const rows: Cell[][] = M.x.map((x, i) => [
        n(x, 2), n(N.y[i], 0), n(V.y[i], 0), n(M.y[i], 0),
        ...(eM && eV ? [n(eM.min.y[i], 0), n(eM.max.y[i], 0), n(eV.min.y[i], 0), n(eV.max.y[i], 0)] : []),
      ])
      if (paths.length > 1) out.push(`<h3>${esc(path.lane.name)}</h3>`)
      out.push(
        tableCompact(
          ['Estaca (m)', 'N perm. (kN)', 'Vy perm. (kN)', 'Mz perm. (kN·m)', ...(eM ? ['Mz móvel mín', 'Mz móvel máx', 'Vy móvel mín', 'Vy móvel máx'] : [])],
          rows,
        ),
      )
    }
    out.push(note('Três estações por barra (início, meio e fim); nas emendas entre barras a estaca aparece duas vezes. Envoltórias de carga móvel já com CIV, CNF e CIA.'))
    return out.join('')
  },
}

/* ------------------------------------------------------------------ registro */

/**
 * Ordem do memorial. Seções novas: inserir aqui (antes de `secAvisos` para o corpo;
 * com `annex: true` para anexos).
 */
export const REPORT_SECTIONS: ReportSection[] = [
  secDados,
  secMateriais,
  secModelo,
  secPermanente,
  secModal,
  secMovel,
  secCabos,
  secReacoes,
  secCombos,
  secProtensao,
  secSecoes,
  secEstabilidade,
  secFases,
  secDiferidos,
  // [memorial:novas] — seções das demais frentes entram acima deste marcador
  secAvisos,
  anexoCabos,
  anexoTabuleiro,
]

/** quadro-resumo da 1ª página (grandezas principais + situação das verificações) */
export function summaryBlock(model: BridgeModel, r: BridgeResults): string {
  const figs = keyFigures(model, r)
  const fails = r.checks.cables.filter((c) => !c.ok).length
  const rows: [string, Cell][] = figs.map((f) => [f.label, `${n(f.value, f.digits ?? 2)} ${f.unit}`])
  if (r.checks.cables.length) rows.push(['Verificação dos cabos', badge(fails === 0, 'todos atendem', `${fails} não atende${fails === 1 ? '' : 'm'}`)])
  rows.push(['Carga permanente', badge(r.deadLoad.converged, 'convergiu', 'não convergiu')])
  if (r.warnings.length) rows.push(['Avisos da análise', `${r.warnings.length} (ver seção própria)`])
  return kv(rows)
}
