/**
 * Memorial de cálculo — monta um documento HTML autônomo (CSS embutido, pronto p/ A4).
 * Função pura: não toca em DOM. As seções vêm de `REPORT_SECTIONS` (report/sections.ts).
 */

import type { BridgeModel, BridgeResults } from '@opengirder/engine'
import { TYPE_LABEL } from '../format'
import { ReportContext, esc } from './html'
import { REPORT_SECTIONS, summaryBlock } from './sections'
import { projectionSvg } from './svg'

export interface ReportOptions {
  /** versão do software (ex.: __APP_VERSION__) */
  version: string
  /** data de emissão (padrão: agora) */
  date?: Date
  /** inclui os anexos com as tabelas completas */
  annexes?: boolean
  /** imagem da vista 3D (data URL PNG) */
  image?: string | null
  /** nome do arquivo do modelo, se houver */
  fileName?: string | null
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 18mm 16mm;
  @top-left { content: string(obra); font: 8pt Helvetica, Arial, sans-serif; color: #77726a; }
  @top-right { content: "Memorial de cálculo"; font: 8pt Helvetica, Arial, sans-serif; color: #77726a; }
  @bottom-left { content: string(soft); font: 8pt Helvetica, Arial, sans-serif; color: #77726a; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 8pt Helvetica, Arial, sans-serif; color: #77726a; }
}
@page :first { @top-left { content: none; } @top-right { content: none; } }
* { box-sizing: border-box; }
html { background: #e9e6dd; }
body { margin: 0; font: 9.6pt/1.45 Helvetica, Arial, "Segoe UI", sans-serif; color: #1b1a17; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; align-items: center; padding: 8px 14px; background: #1c1915; color: #f0ece2; font-size: 12px; }
.toolbar b { font-weight: 600; }
.toolbar .grow { flex: 1; }
.toolbar button { font: inherit; height: 28px; padding: 0 14px; border-radius: 100px; border: 1px solid #f4592f; background: #f4592f; color: #240c04; font-weight: 650; cursor: pointer; }
.sheet { width: 210mm; max-width: 100%; margin: 14px auto 40px; background: #fff; padding: 18mm 16mm; box-shadow: 0 2px 18px rgba(40, 30, 10, 0.18); }
.obra { string-set: obra content(text); }
.soft { string-set: soft content(text); }
h1, h2, h3 { font-family: Helvetica, Arial, sans-serif; margin: 0; }
.cover { min-height: 240mm; display: flex; flex-direction: column; break-after: page; page-break-after: always; }
.cover .brand { font-size: 10pt; letter-spacing: 0.4px; color: #77726a; display: flex; align-items: center; gap: 8px; }
.cover .brand b { color: #1b1a17; }
.cover .rule { height: 3px; background: #d9480f; width: 64px; margin: 62mm 0 8mm; }
.cover .kind { font-size: 11pt; letter-spacing: 2.4px; text-transform: uppercase; color: #d9480f; font-weight: 700; }
.cover h1 { font-size: 27pt; line-height: 1.12; margin: 4mm 0 3mm; font-weight: 700; letter-spacing: -0.3px; }
.cover .sub { font-size: 12pt; color: #55514a; }
.cover .draw { margin-top: 14mm; }
.cover .meta { margin-top: auto; font-size: 9pt; color: #55514a; border-top: 1px solid #d8d4c8; padding-top: 4mm; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 10mm; }
.cover .meta b { color: #1b1a17; font-weight: 600; }
.toc { break-after: page; page-break-after: always; }
.toc h2 { border: 0; }
.toc ol { list-style: none; padding: 0; margin: 4mm 0 8mm; }
.toc li { display: flex; gap: 8px; padding: 1.6mm 0; border-bottom: 1px dotted #c9c4b6; font-size: 10pt; }
.toc li .num { width: 9mm; color: #d9480f; font-weight: 700; font-variant-numeric: tabular-nums; }
.toc li.annex .num { color: #55514a; }
.toc a { color: inherit; text-decoration: none; }
section { margin-bottom: 8mm; }
h2 { font-size: 14pt; font-weight: 700; margin: 0 0 4mm; padding-bottom: 1.6mm; border-bottom: 1.2px solid #1b1a17; break-after: avoid; page-break-after: avoid; }
h2 .num { color: #d9480f; margin-right: 6px; }
h3 { font-size: 10.6pt; font-weight: 700; margin: 5.5mm 0 2mm; break-after: avoid; page-break-after: avoid; }
h3 .num { color: #77726a; font-weight: 600; margin-right: 4px; }
p { margin: 0 0 2.4mm; }
ul { margin: 0 0 2.6mm; padding-left: 5mm; }
li { margin-bottom: 1mm; }
.note { font-size: 8.6pt; color: #55514a; margin: 1.6mm 0 2.6mm; }
.eq { font-family: "Times New Roman", Times, serif; font-style: italic; font-size: 11pt; text-align: center; padding: 2.4mm 0; margin: 2mm 0 3mm; background: #f7f5ee; border-left: 2.4px solid #d9480f; }
.eq sub { font-size: 0.72em; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
table.t { width: 100%; font-size: 8.6pt; margin: 0 0 1.5mm; }
table.t.narrow { width: auto; min-width: 45%; }
table.t th { text-align: right; font-weight: 700; font-size: 7.8pt; padding: 1.3mm 1.6mm; border-top: 1px solid #1b1a17; border-bottom: 0.7px solid #1b1a17; vertical-align: bottom; background: #fff; }
table.t td { text-align: right; padding: 1mm 1.6mm; border-bottom: 0.4px solid #dcd8cb; white-space: nowrap; }
table.t th.l, table.t td.l { text-align: left; }
table.t td.l { white-space: normal; }
table.t tbody tr:last-child td { border-bottom: 0.7px solid #1b1a17; }
table.t tfoot td { font-weight: 700; border-bottom: 0.7px solid #1b1a17; }
table.t tr.bad td { background: #fdecea; }
table.t.compact { font-size: 7.4pt; }
table.t.compact th { font-size: 7pt; padding: 0.9mm 1.2mm; }
table.t.compact td { padding: 0.55mm 1.2mm; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.tblock { margin: 3mm 0 4mm; }
.tcap { font-size: 8.6pt; margin-bottom: 1.2mm; break-after: avoid; page-break-after: avoid; }
table.kv { font-size: 9.2pt; margin: 1mm 0 3mm; min-width: 62%; }
table.kv th { text-align: left; font-weight: 400; color: #55514a; padding: 0.8mm 6mm 0.8mm 0; border-bottom: 0.4px solid #e2dece; vertical-align: top; }
table.kv td { text-align: right; padding: 0.8mm 0; border-bottom: 0.4px solid #e2dece; font-weight: 600; }
figure { margin: 3mm 0 4mm; break-inside: avoid; page-break-inside: avoid; }
figure svg { display: block; width: 100%; height: auto; }
figure img.shot { display: block; width: 100%; border: 0.5px solid #cfcabd; }
figcaption { font-size: 8.6pt; color: #33302b; margin-top: 1.4mm; }
.badge { display: inline-block; padding: 0.2mm 2.2mm; border-radius: 3mm; font-size: 8pt; font-weight: 700; }
.badge.ok { background: #e3f4e8; color: #1d6b33; }
.badge.bad { background: #fde3df; color: #b3261e; }
ul.warn li { margin-bottom: 1.6mm; }
.annex-start { break-before: page; page-break-before: always; }
.resp { margin-top: 8mm; padding: 4mm 5mm; border: 0.7px solid #1b1a17; font-size: 8.8pt; break-inside: avoid; page-break-inside: avoid; }
.resp h3 { margin-top: 0; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 14mm; font-size: 8.6pt; color: #55514a; }
.sign div { border-top: 0.6px solid #1b1a17; padding-top: 1.4mm; }
@media print {
  html { background: #fff; }
  .toolbar { display: none; }
  .sheet { width: auto; margin: 0; padding: 0; box-shadow: none; }
  .cover { min-height: 250mm; }
}
`

const typeLabel = (t: string): string => TYPE_LABEL[t] ?? (t === 'arch' ? 'Ponte em arco' : t)

const dateBr = (d: Date): string =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })

const timeBr = (d: Date): string => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function buildReport(model: BridgeModel, results: BridgeResults, opts: ReportOptions): string {
  const date = opts.date ?? new Date()
  const ctx = new ReportContext({
    version: opts.version,
    date,
    annexes: opts.annexes ?? false,
    image: opts.image ?? null,
    fileName: opts.fileName ?? null,
  })
  const active = REPORT_SECTIONS.filter((s) => {
    if (s.annex && !ctx.opts.annexes) return false
    try {
      return s.enabled(model, results)
    } catch {
      return false
    }
  })
  const body = active.filter((s) => !s.annex)
  const annex = active.filter((s) => s.annex)

  const rendered: { key: string; num: string; title: string; html: string; annex: boolean }[] = []
  const renderOne = (s: (typeof active)[number], num: string): void => {
    ctx.begin(num)
    let html: string
    try {
      html = s.render(model, results, ctx)
    } catch (err) {
      html = `<p class="note">Esta seção não pôde ser gerada: ${esc(err instanceof Error ? err.message : String(err))}</p>`
    }
    if (html.trim()) rendered.push({ key: s.key, num, title: s.title, html, annex: !!s.annex })
  }
  body.forEach((s, i) => renderOne(s, String(i + 1)))
  annex.forEach((s, i) => renderOne(s, String.fromCharCode(65 + i)))

  const soft = `OpenGirder v${opts.version}`
  const elev = projectionSvg(model, 'xz', results)
  const spans = model.meta?.spans
  const sub = [typeLabel(model.type), spans?.length ? `vãos de ${spans.map((s) => s.toLocaleString('pt-BR', { maximumFractionDigits: 2 })).join(' + ')} m` : '']
    .filter(Boolean)
    .join(' · ')

  const toc = rendered
    .map(
      (s) =>
        `<li class="${s.annex ? 'annex' : ''}"><span class="num">${s.annex ? `Anexo ${s.num}` : s.num}</span><a href="#sec-${esc(s.key)}">${esc(s.title)}</a></li>`,
    )
    .join('')
    .replace(/<span class="num">Anexo /g, '<span class="num" style="width:18mm">Anexo ')

  const sections = rendered
    .map((s, i) => {
      const firstAnnex = s.annex && !rendered[i - 1]?.annex
      return `<section id="sec-${esc(s.key)}"${firstAnnex ? ' class="annex-start"' : s.annex ? ' class="annex-start"' : ''}><h2><span class="num">${s.annex ? `Anexo ${s.num}` : s.num}</span>${s.annex ? '— ' : ''}${esc(s.title)}</h2>${s.html}</section>`
    })
    .join('')

  const resp = `<div class="resp"><h3>Responsabilidade técnica</h3>
<p>Este memorial foi gerado automaticamente pelo ${esc(soft)}, software livre distribuído sob licença MIT, sem garantia de qualquer natureza. Os resultados dependem dos dados de entrada e das hipóteses de modelagem descritas na seção 1, e <b>devem ser conferidos por engenheiro habilitado</b>, a quem cabe a responsabilidade técnica pelo projeto. O programa é uma ferramenta de cálculo; não substitui o julgamento do projetista nem as verificações exigidas pelas normas aplicáveis.</p>
<div class="sign"><div>Responsável técnico — nome e registro profissional</div><div>Local e data</div></div></div>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Memorial de cálculo — ${esc(model.name)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="toolbar"><b>Memorial de cálculo</b><span>${esc(model.name)}</span><span class="grow"></span><button onclick="window.print()">Imprimir / Salvar em PDF</button></div>
<div class="sheet">
<div class="cover">
  <div class="brand"><b>OpenGirder</b> · análise de pontes</div>
  <div class="rule"></div>
  <div class="kind">Memorial de cálculo</div>
  <h1 class="obra">${esc(model.name)}</h1>
  <div class="sub">${esc(sub)}</div>
  ${elev.svg ? `<div class="draw">${elev.svg}</div>` : ''}
  <div class="meta">
    <div>Emissão: <b>${esc(dateBr(date))}</b>, ${esc(timeBr(date))}</div>
    <div>Programa: <b class="soft">${esc(soft)}</b></div>
    <div>Arquivo: <b>${esc(opts.fileName || 'modelo não salvo')}</b></div>
    <div>Modelo: <b>${results.nNodes.toLocaleString('pt-BR')} nós · ${results.nElements.toLocaleString('pt-BR')} elementos · ${results.nDofs.toLocaleString('pt-BR')} GDL</b></div>
  </div>
</div>
<div class="toc">
  <h2>Sumário</h2>
  <ol>${toc}</ol>
  <h2>Quadro-resumo</h2>
  ${summaryBlock(model, results)}
</div>
${sections}
${resp}
</div>
</body>
</html>`
}
