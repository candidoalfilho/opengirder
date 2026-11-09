/**
 * Seções do memorial para as verificações além da análise global: protensão, verificação de
 * seções, estabilidade (flambagem, aerodinâmica, passarelas) e fases construtivas.
 */

import type { BridgeModel, BridgeResults, SectionCheck } from '@opengirder/engine'
import { GROUP_LABEL } from '../format'
import type { ReportSection } from './sections'
import { badge, esc, kv, n, ni, note, p, ul } from './html'
import { BLUE, GREEN, GREY, ORANGE, lineChartSvg } from './svg'

const groupLabel = (g: string | undefined): string => GROUP_LABEL[g ?? 'other'] ?? (g ?? 'Outros')
const cm2 = (m2: number | undefined): string => (m2 !== undefined && Number.isFinite(m2) ? n(m2 * 1e4, 1) : '—')
const mpa = (kpa: number): string => n(kpa / 1000, 2)

/* ------------------------------------------------------------------ protensão */

export const secProtensao: ReportSection = {
  key: 'protensao',
  title: 'Protensão do tabuleiro',
  enabled: (_m, r) => !!r.prestress?.tendons?.length,
  render: (_m, r, ctx) => {
    const pt = r.prestress!
    const out: string[] = []
    out.push(
      p(
        'Cabos pós-tracionados aderentes, representados por um cabo resultante por família. A protensão entra como caso de carga ' +
          'próprio (cargas equivalentes do traçado), somado ao estado permanente nas combinações; o momento total sai da análise e o ' +
          'hiperestático é a diferença para o isostático −P·e.',
      ),
    )
    for (const t of pt.tendons ?? []) {
      out.push(ctx.h(`Cabo — ${t.name}`))
      out.push(
        kv([
          ['Cordoalhas', ni(t.nStrands)],
          ['Área de aço de protensão Ap', `${n(t.Ap * 1e4, 1)} cm²`],
          ['Tensão no macaco σpi', `${n(t.sigmaPi / 1000, 0)} MPa`],
          ['Força no macaco Pi', `${ni(t.Pi)} kN`],
          ['Perdas imediatas (atrito, acomodação, encurtamento elástico)', `${n(t.lossImmediatePct, 1)} %`],
          ['Perdas progressivas (fluência, retração, relaxação)', `${n(t.lossProgressivePct, 1)} %`],
          ['Perdas totais', `${n(t.lossTotalPct, 1)} %`],
          ['Desvio angular total do traçado', `${n((t.totalAngle * 180) / Math.PI, 1)}°`],
          ['Alongamento teórico no estiramento', `${n(t.elongation * 1000, 0)} mm`],
        ]),
      )
      out.push(
        ctx.fig(
          lineChartSvg({
            series: [
              { label: 'Face superior', x: t.s, y: t.s.map(() => t.yTop), color: GREY },
              { label: 'Face inferior', x: t.s, y: t.s.map(() => -t.yBot), color: GREY },
              { label: 'Cabo resultante', x: t.s, y: t.e.map((e) => -e), color: ORANGE, width: 1.6 },
            ],
            xLabel: 'estaca (m)', yLabel: 'cota em relação ao centroide (m)', height: 170, marks: t.supports,
          }),
          'Traçado do cabo resultante em relação ao centroide da seção.',
        ),
      )
      out.push(
        ctx.fig(
          lineChartSvg({
            series: [
              { label: 'No estiramento (só atrito)', x: t.s, y: t.Pjack, color: GREY, dash: true },
              { label: 'P0 — após perdas imediatas', x: t.s, y: t.P0, color: BLUE },
              { label: 'P∞ — após todas as perdas', x: t.s, y: t.Pinf, color: ORANGE, width: 1.6 },
            ],
            xLabel: 'estaca (m)', yLabel: 'força de protensão (kN)', height: 190, marks: t.supports,
          }),
          'Força de protensão ao longo do cabo.',
        ),
      )
      out.push(
        ctx.fig(
          lineChartSvg({
            series: [
              { label: 'Isostático −P·e', x: t.s, y: t.Miso, color: BLUE, dash: true },
              { label: 'Hiperestático', x: t.s, y: t.Mhyp, color: GREEN },
              { label: 'Total', x: t.s, y: t.Mtot, color: ORANGE, width: 1.6 },
            ],
            xLabel: 'estaca (m)', yLabel: 'Mz (kN·m)', height: 200, invertY: true, marks: t.supports,
          }),
          'Momentos de protensão em t = ∞ (positivos desenhados para baixo).',
        ),
      )
    }
    const checks = pt.checks ?? []
    if (checks.length) {
      out.push(ctx.h('Verificação das tensões normais no concreto'))
      out.push(
        ctx.tbl(
          'Tensões nas fibras extremas (tração positiva)',
          [
            { label: 'Verificação', left: true }, { label: 'Norma', left: true }, { label: 'Situação', left: true },
            { label: 'Fibra', left: true }, 'Estaca (m)', 'Tensão (MPa)', 'Limite (MPa)', { label: 'Situação', left: true },
          ],
          checks.map((c) => [
            c.name, c.clause, c.combo, c.fibre, n(c.s, 1), mpa(c.value), mpa(c.limit),
            c.informative ? 'referência' : badge(c.ok),
          ]),
        ),
      )
      out.push(note('Seção bruta no estádio I. As linhas marcadas como referência não entram no veredito.'))
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ seções */

function worst(list: SectionCheck[]): SectionCheck | undefined {
  let w: SectionCheck | undefined
  for (const c of list) if (!w || c.ratio > w.ratio) w = c
  return w
}

export const secSecoes: ReportSection = {
  key: 'secoes',
  title: 'Verificação das seções',
  enabled: (_m, r) => !!r.checks.sections?.length,
  render: (_m, r, ctx) => {
    const all = r.checks.sections!
    const out: string[] = []
    out.push(
      p(
        'Esforços de cálculo das envoltórias do ELU (NBR 8681). Concreto pela NBR 6118: flexão composta com diagrama retangular ' +
          '(armadura necessária), cortante pelo modelo I e torção em seção vazada; torres, pilares e arcos à flexo-compressão com ' +
          'armadura distribuída no contorno. Aço pela NBR 8800 em regime elástico, sem verificação de flambagem local ou lateral.',
      ),
    )
    const groups = Array.from(new Set(all.map((c) => c.group)))
    out.push(
      ctx.tbl(
        'Resumo por grupo de barras',
        [{ label: 'Grupo', left: true }, { label: 'Critério', left: true }, 'Barras', 'Não atendem', 'Maior aproveitamento', { label: 'Barra crítica', left: true }],
        groups.map((g) => {
          const list = all.filter((c) => c.group === g)
          const w = worst(list)
          return [
            groupLabel(g), Array.from(new Set(list.map((c) => c.method))).join(', '), ni(list.length),
            ni(list.filter((c) => !c.ok).length), w ? n(w.ratio, 2) : '—', w ? `barra ${w.id}` : '—',
          ]
        }),
      ),
    )
    for (const g of groups) {
      const list = all.filter((c) => c.group === g)
      const beams = list.filter((c) => c.member === 'beam')
      const cols = list.filter((c) => c.member === 'column')
      const steel = list.filter((c) => c.member === 'stress')
      // as barras mais solicitadas de cada grupo (a tabela completa fica na interface e no CSV)
      const top = <T extends SectionCheck>(l: T[]): T[] => [...l].sort((a, b) => b.ratio - a.ratio).slice(0, 12).sort((a, b) => a.s - b.s)
      if (beams.length) {
        out.push(ctx.h(`${groupLabel(g)} — flexão composta, cortante e torção`))
        out.push(
          ctx.tbl(
            `${groupLabel(g)}: as ${Math.min(12, beams.length)} barras mais solicitadas`,
            ['Barra', 'Posição (m)', 'Md+ (kN·m)', 'Md− (kN·m)', 'Nd mín / máx (kN)', 'Vd (kN)', 'As inf. (cm²)', 'As sup. (cm²)', 'Asw/s (cm²/m)', 'Aprov.', { label: '', left: true }],
            top(beams).map((c) => [
              ni(c.id), n(c.s, 1), ni(c.MdPos), ni(c.MdNeg), `${ni(c.Nd[0])} / ${ni(c.Nd[1])}`, ni(c.Vd),
              cm2(c.AsInf), cm2(c.AsSup), cm2(c.AswS), n(c.ratio, 2), badge(c.ok),
            ]),
            { compact: true },
          ),
        )
      }
      if (cols.length) {
        out.push(ctx.h(`${groupLabel(g)} — flexo-compressão`))
        out.push(
          ctx.tbl(
            `${groupLabel(g)}: as ${Math.min(12, cols.length)} barras mais solicitadas`,
            ['Barra', 'Cota (m)', 'Nd mín / máx (kN)', 'Md (kN·m)', 'Myd (kN·m)', 'Vd (kN)', 'As total (cm²)', 'Taxa (%)', 'Aprov.', { label: '', left: true }],
            top(cols).map((c) => [
              ni(c.id), n(c.s, 1), `${ni(c.Nd[0])} / ${ni(c.Nd[1])}`, ni(Math.max(c.MdPos, c.MdNeg)), ni(c.MydAbs), ni(c.Vd),
              cm2(c.AsTotal), c.rho !== undefined ? n(c.rho * 100, 2) : '—', n(c.ratio, 2), badge(c.ok),
            ]),
            { compact: true },
          ),
        )
      }
      if (steel.length) {
        out.push(ctx.h(`${groupLabel(g)} — tensões`))
        out.push(
          ctx.tbl(
            `${groupLabel(g)}: as ${Math.min(12, steel.length)} barras mais solicitadas`,
            ['Barra', 'Posição (m)', 'Nd mín / máx (kN)', 'Md (kN·m)', 'Myd (kN·m)', 'σ máx (MPa)', 'Aprov.', { label: '', left: true }],
            top(steel).map((c) => [
              ni(c.id), n(c.s, 1), `${ni(c.Nd[0])} / ${ni(c.Nd[1])}`, ni(Math.max(c.MdPos, c.MdNeg)), ni(c.MydAbs),
              c.sigma !== undefined ? n(c.sigma / 1000, 0) : '—', n(c.ratio, 2), badge(c.ok),
            ]),
            { compact: true },
          ),
        )
      }
    }
    const notes = Array.from(new Set(all.flatMap((c) => c.notes ?? [])))
    if (all.some((c) => c.approx)) {
      notes.unshift('Seções sem geometria detalhada: mesa e almas deduzidas da área, da largura e da altura — resultado indicativo.')
    }
    if (notes.length) out.push(ul(notes.map((x) => esc(x))))
    return out.join('')
  },
}

/* ------------------------------------------------------------------ estabilidade */

export const secEstabilidade: ReportSection = {
  key: 'estabilidade',
  title: 'Estabilidade',
  enabled: (_m, r) => !!(r.buckling?.modes.length || r.aero || r.pedestrian),
  render: (_m, r, ctx) => {
    const out: string[] = []
    const b = r.buckling
    if (b?.modes.length) {
      out.push(ctx.h('Flambagem global'))
      out.push(
        p(
          'Problema de autovalor (Ke + λ·Kg)·φ = 0 no estado de carga permanente: λ multiplica os esforços normais da carga ' +
            'permanente característica. A rigidez dos cabos é mantida constante, a favor da segurança.',
        ),
      )
      out.push(
        ctx.tbl(
          'Fatores de carga críticos',
          ['Modo', 'λ crítico', { label: 'Barras que flambam', left: true }, 'Parcela (%)', { label: '', left: true }],
          b.modes.map((m) => [ni(m.index), n(m.factor, 2), groupLabel(m.group), n(m.share * 100, 0), m.index === b.modes[0].index ? badge(m.factor >= b.minFactor, `λ ≥ ${n(b.minFactor, 0)}`, `λ < ${n(b.minFactor, 0)}`) : '']),
        ),
      )
      out.push(note(`Maior compressão sob carga permanente: ${ni(b.maxCompression)} kN.`))
    }
    const a = r.aero
    if (a) {
      out.push(ctx.h('Estabilidade aerodinâmica — triagem'))
      out.push(
        kv([
          ['Vento característico na cota do tabuleiro Vk', `${n(a.Vk, 1)} m/s (z = ${n(a.z, 0)} m)`],
          ['Tabuleiro B × D', `${n(a.B, 1)} × ${n(a.D, 2)} m`],
          ['Massa e raio de giração', `${n(a.mass, 1)} t/m · ${n(a.radius, 2)} m`],
          ['1º modo vertical', a.fV > 0 ? `${n(a.fV, 3)} Hz (modo ${a.modeV})` : 'não encontrado'],
          ['1º modo torcional', a.fT > 0 ? `${n(a.fT, 3)} Hz (modo ${a.modeT})` : 'não encontrado entre os modos calculados'],
        ]),
      )
      out.push(
        ctx.tbl(
          'Velocidades críticas',
          [{ label: 'Verificação', left: true }, 'Vcr (m/s)', 'Vk (m/s)', { label: 'Situação', left: true }, { label: 'Observação', left: true }],
          a.checks.map((c) => [c.label, n(c.value, 1), c.limit !== undefined ? n(c.limit, 1) : '—', c.ok === undefined ? 'informativo' : badge(c.ok), c.note]),
        ),
      )
      out.push(note('Triagem simplificada (Selberg com fator de forma, divergência de placa plana, número de Strouhal). Não substitui ensaio em túnel de vento.'))
    }
    const pc = r.pedestrian
    if (pc) {
      out.push(ctx.h('Conforto de pedestres — frequências'))
      out.push(
        kv([
          ['Faixa crítica vertical', `${n(pc.ranges.vertical[0], 1)} a ${n(pc.ranges.vertical[1], 1)} Hz`],
          ['Faixa crítica lateral', `${n(pc.ranges.lateral[0], 1)} a ${n(pc.ranges.lateral[1], 1)} Hz`],
          ['Menor frequência vertical', pc.fVertical > 0 ? `${n(pc.fVertical, 2)} Hz` : '—'],
          ['Menor frequência lateral', pc.fLateral > 0 ? `${n(pc.fLateral, 2)} Hz` : '—'],
          ['Situação', badge(pc.ok, 'fora das faixas críticas', 'há modos nas faixas críticas')],
        ]),
      )
      if (pc.critical.length) {
        out.push(ul(pc.critical.map((c) => `Modo ${c.mode}: ${n(c.frequency, 2)} Hz, ${c.direction} — exige análise dinâmica de acelerações.`)))
      }
    }
    return out.join('')
  },
}

/* ------------------------------------------------------------------ fases construtivas */

export const secFases: ReportSection = {
  key: 'fases',
  title: 'Fases construtivas',
  enabled: (_m, r) => !!r.stages?.stages.length,
  render: (model: BridgeModel, r: BridgeResults, ctx) => {
    const st = r.stages!
    const out: string[] = []
    out.push(
      p(
        'Análise regressiva: a ponte pronta é desmontada na ordem inversa da execução em balanços sucessivos e cada estrutura ' +
          'parcial é recalculada (não linear) com os comprimentos de fabricação finais dos estais. Não inclui fluência, retração, ' +
          'relaxação nem retensionamentos.' +
          (st.equipment > 0 ? ` Equipamento de ${ni(st.equipment)} kN na ponta de cada balanço.` : '') +
          (st.temporaryFixity ? ' Tabuleiro engastado provisoriamente na torre até o fechamento.' : ''),
      ),
    )
    const idx = st.stages.map((s) => s.index)
    out.push(
      ctx.tbl(
        'Resumo por fase',
        ['Fase', { label: 'Descrição', left: true }, 'Estais', 'T máx (kN)', 'Ponta do balanço (mm)', 'Topo da torre (mm)', 'M base da torre (kN·m)', { label: '', left: true }],
        st.stages.map((s) => {
          const tip = s.tips.reduce((a, t) => (Math.abs(t.uz) > Math.abs(a) ? t.uz : a), 0)
          const top = s.towers.reduce((a, t) => (Math.abs(t.ux) > Math.abs(a) ? t.ux : a), 0)
          const mb = s.towers.reduce((a, t) => (Math.abs(t.baseM) > Math.abs(a) ? t.baseM : a), 0)
          return [
            ni(s.index), s.name, ni(s.stays.length), s.stays.length ? ni(s.Tmax) : '—',
            s.tips.length ? n(tip * 1000, 0) : '—', n(top * 1000, 0), ni(mb),
            badge(s.converged && s.nSlack === 0, 'ok', s.converged ? `${s.nSlack} frouxo(s)` : 'não convergiu'),
          ]
        }),
        { compact: true },
      ),
    )
    out.push(
      ctx.fig(
        lineChartSvg({
          series: [
            { label: 'Maior tração nos estais (kN)', x: idx, y: st.stages.map((s) => s.Tmax), color: ORANGE, width: 1.6 },
          ],
          xLabel: 'fase', yLabel: 'T máx (kN)', height: 170,
        }),
        'Maior tração nos estais instalados, fase a fase.',
      ),
    )
    if (st.stays.length) {
      const byId = new Map(model.elements.map((e) => [e.id, e]))
      const rows = [...st.stays].sort((a, b) => a.stage - b.stage || a.id - b.id)
      const MAX = 60
      out.push(
        ctx.tbl(
          `Tração de instalação × tração final dos estais${rows.length > MAX ? ` (primeiros ${MAX} de ${rows.length})` : ''}`,
          ['Estai', 'Fase', 'Cordoalhas', 'T instalação (kN)', 'T final (kN)', 'Instalação / final'],
          rows.slice(0, MAX).map((s) => {
            const el = byId.get(s.id)
            return [ni(s.id), ni(s.stage), el && el.kind === 'cable' && el.strands ? ni(el.strands) : '—', ni(s.Tinstall), ni(s.Tfinal), s.Tfinal > 0 ? n(s.Tinstall / s.Tfinal, 2) : '—']
          }),
          { compact: true },
        ),
      )
    }
    if (st.warnings.length) out.push(ul(st.warnings.map((w) => esc(w))))
    return out.join('')
  },
}
