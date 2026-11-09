/**
 * Gráficos do memorial em SVG — funções puras (sem React, sem DOM). Pensados p/ papel:
 * fundo branco, traço fino, texto em 8–9 pt.
 */

import type { BridgeModel, BridgeResults } from '@opengirder/engine'
import { esc } from './html'

export const INK = '#1b1a17'
export const ORANGE = '#d9480f'
export const BLUE = '#1c5fb0'
export const GREEN = '#2b8a3e'
export const GREY = '#8a857b'

export interface ChartSeries {
  label: string
  x: number[]
  y: number[]
  color?: string
  dash?: boolean
  /** preenche até o zero */
  fill?: boolean
  width?: number
}

export interface ChartOpts {
  series: ChartSeries[]
  xLabel?: string
  yLabel?: string
  width?: number
  height?: number
  /** eixo y positivo p/ baixo (diagrama de momentos do lado tracionado) */
  invertY?: boolean
  /** linhas verticais de referência (ex.: estacas dos apoios) */
  marks?: number[]
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const r = raw / mag
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

const f1 = (v: number): string => (Math.round(v * 10) / 10).toString()

/** rótulo de eixo com as casas que o passo pede (0; 0,5; 0,25…) */
function tickLabels(ticks: number[]): string[] {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : Math.abs(ticks[0]) || 1
  const digits = Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)))
  return ticks.map((t) => t.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }))
}

export function lineChartSvg(o: ChartOpts): string {
  const W = o.width ?? 680
  const H = o.height ?? 230
  const pad = { l: 62, r: 14, t: 24, b: 34 }
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = 0
  let y1 = 0
  for (const s of o.series) {
    for (let i = 0; i < s.x.length; i++) {
      const xv = s.x[i]
      const yv = s.y[i]
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue
      if (xv < x0) x0 = xv
      if (xv > x1) x1 = xv
      if (yv < y0) y0 = yv
      if (yv > y1) y1 = yv
    }
  }
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return `<svg class="chart" viewBox="0 0 ${W} 40" width="100%"><text x="8" y="24" font-size="10" fill="${GREY}">Sem dados p/ o gráfico.</text></svg>`
  if (x1 - x0 < 1e-12) x1 = x0 + 1
  if (y1 - y0 < 1e-12) {
    y1 += 1
    y0 -= 1
  }
  const m = 0.06 * (y1 - y0)
  if (y0 < 0) y0 -= m
  if (y1 > 0) y1 += m
  const pw = W - pad.l - pad.r
  const ph = H - pad.t - pad.b
  const X = (v: number): number => pad.l + ((v - x0) / (x1 - x0)) * pw
  const Y = (v: number): number => {
    const t = (v - y0) / (y1 - y0)
    return o.invertY ? pad.t + t * ph : pad.t + (1 - t) * ph
  }
  const parts: string[] = []
  parts.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">`)
  parts.push(`<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="#fff" stroke="#cfcabd" stroke-width="0.6"/>`)
  // grade e eixos
  const yt = niceTicks(y0, y1, 5)
  const yl = tickLabels(yt)
  yt.forEach((t, i) => {
    const y = Y(t)
    parts.push(`<line x1="${pad.l}" x2="${pad.l + pw}" y1="${f1(y)}" y2="${f1(y)}" stroke="${t === 0 ? '#6f6a5e' : '#e6e2d6'}" stroke-width="${t === 0 ? 0.8 : 0.5}"/>`)
    parts.push(`<text x="${pad.l - 5}" y="${f1(y + 3)}" font-size="8.5" text-anchor="end" fill="${INK}">${esc(yl[i])}</text>`)
  })
  const xt = niceTicks(x0, x1, 8)
  const xl = tickLabels(xt)
  xt.forEach((t, i) => {
    const x = X(t)
    parts.push(`<line x1="${f1(x)}" x2="${f1(x)}" y1="${pad.t + ph}" y2="${pad.t + ph + 3}" stroke="#6f6a5e" stroke-width="0.6"/>`)
    parts.push(`<text x="${f1(x)}" y="${pad.t + ph + 13}" font-size="8.5" text-anchor="middle" fill="${INK}">${esc(xl[i])}</text>`)
  })
  for (const mk of o.marks ?? []) {
    if (mk < x0 - 1e-9 || mk > x1 + 1e-9) continue
    const x = X(mk)
    parts.push(`<line x1="${f1(x)}" x2="${f1(x)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#b9b3a3" stroke-width="0.6" stroke-dasharray="2 3"/>`)
    parts.push(`<path d="M${f1(x)} ${pad.t + ph} l-3.5 6 h7 z" fill="#8a857b"/>`)
  }
  // séries
  for (const s of o.series) {
    const color = s.color ?? INK
    let d = ''
    let pen = false
    let seg: [number, number][] = []
    const flush = (): void => {
      if (s.fill && seg.length > 1) {
        const yz = Y(0)
        const body = seg.map(([px, py]) => `L${f1(px)} ${f1(py)}`).join(' ')
        parts.push(`<path d="M${f1(seg[0][0])} ${f1(yz)} ${body} L${f1(seg[seg.length - 1][0])} ${f1(yz)} Z" fill="${color}" fill-opacity="0.10"/>`)
      }
      seg = []
    }
    for (let i = 0; i < s.x.length; i++) {
      const xv = s.x[i]
      const yv = s.y[i]
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
        pen = false
        flush()
        continue
      }
      const px = X(xv)
      const py = Y(yv)
      d += `${pen ? 'L' : 'M'}${f1(px)} ${f1(py)} `
      pen = true
      seg.push([px, py])
    }
    flush()
    if (d) {
      parts.push(
        `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="${s.width ?? 1.3}" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="5 3"' : ''}/>`,
      )
    }
  }
  // legenda
  let lx = pad.l
  for (const s of o.series) {
    const color = s.color ?? INK
    parts.push(`<line x1="${lx}" x2="${lx + 16}" y1="11" y2="11" stroke="${color}" stroke-width="1.6"${s.dash ? ' stroke-dasharray="5 3"' : ''}/>`)
    parts.push(`<text x="${lx + 20}" y="14" font-size="8.5" fill="${INK}">${esc(s.label)}</text>`)
    lx += 30 + s.label.length * 4.7
  }
  if (o.xLabel) parts.push(`<text x="${pad.l + pw / 2}" y="${H - 5}" font-size="8.5" text-anchor="middle" fill="${INK}">${esc(o.xLabel)}</text>`)
  if (o.yLabel) {
    parts.push(
      `<text transform="translate(11 ${pad.t + ph / 2}) rotate(-90)" font-size="8.5" text-anchor="middle" fill="${INK}">${esc(o.yLabel)}${o.invertY ? ' (positivo p/ baixo)' : ''}</text>`,
    )
  }
  parts.push('</svg>')
  return parts.join('')
}

/* ------------------------------------------------------------------ desenho do modelo */

const GROUP_STYLE: Record<string, { color: string; width: number }> = {
  deck: { color: INK, width: 2.2 },
  tower: { color: '#5c574c', width: 2.2 },
  pier: { color: '#5c574c', width: 1.8 },
  arch: { color: '#5c574c', width: 2.2 },
  'main-cable': { color: ORANGE, width: 1.5 },
  stay: { color: ORANGE, width: 0.7 },
  hanger: { color: ORANGE, width: 0.5 },
  crossbeam: { color: GREY, width: 0.8 },
  rigid: { color: '#b9b3a3', width: 0.5 },
  other: { color: GREY, width: 0.8 },
}
const DRAW_ORDER = ['rigid', 'crossbeam', 'other', 'hanger', 'stay', 'main-cable', 'pier', 'arch', 'tower', 'deck']

export interface ProjectionInfo {
  svg: string
  /** exagero aplicado ao eixo vertical do desenho (1 = em escala) */
  exaggeration: number
}

/**
 * Projeção do modelo: 'xz' = elevação (X × Z), 'xy' = planta (X × Y).
 * Cabos com flecha são desenhados com a parábola do estado permanente, se houver resultados.
 */
export function projectionSvg(
  model: BridgeModel,
  plane: 'xz' | 'xy',
  results?: BridgeResults | null,
  width = 680,
): ProjectionInfo {
  const a = 0
  const b = plane === 'xz' ? 2 : 1
  const pt = (n: { x: number; y: number; z: number }): [number, number] => {
    const v = [n.x, n.y, n.z]
    return [v[a], v[b]]
  }
  const byId = new Map(model.nodes.map((nd) => [nd.id, nd]))
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const nd of model.nodes) {
    const [x, y] = pt(nd)
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (!Number.isFinite(x0)) return { svg: '', exaggeration: 1 }
  const dx = Math.max(x1 - x0, 1e-6)
  const dy = Math.max(y1 - y0, 1e-6)
  const pad = 14
  const pw = width - 2 * pad
  const sx = pw / dx
  // altura em escala; se o desenho ficar baixo demais, exagera o eixo vertical
  const minH = plane === 'xz' ? 70 : 40
  const maxH = 330
  let sy = sx
  let exaggeration = 1
  if (dy * sy < minH) {
    exaggeration = Math.min(8, minH / (dy * sy))
    exaggeration = exaggeration < 1.5 ? 1 : Math.round(exaggeration)
    sy = sx * exaggeration
  }
  let k = 1
  if (dy * sy > maxH) k = maxH / (dy * sy)
  const ph = dy * sy * k
  const H = ph + 2 * pad + 8
  const off = (pw - dx * sx * k) / 2
  const X = (v: number): number => pad + off + (v - x0) * sx * k
  const Y = (v: number): number => pad + ph - (v - y0) * sy * k
  const sag = new Map<number, number>()
  if (plane === 'xz') results?.deadLoad.cables.forEach((c) => sag.set(c.id, Number.isFinite(c.sag) ? c.sag : 0))

  const paths = new Map<string, string[]>()
  for (const el of model.elements) {
    const n1 = byId.get(el.n1)
    const n2 = byId.get(el.n2)
    if (!n1 || !n2) continue
    const g = el.group && GROUP_STYLE[el.group] ? el.group : 'other'
    const [ax, ay] = pt(n1)
    const [bx, by] = pt(n2)
    let d = `M${f1(X(ax))} ${f1(Y(ay))}`
    const s = el.kind === 'cable' ? (sag.get(el.id) ?? 0) : 0
    if (s > 1e-3) {
      for (let i = 1; i <= 10; i++) {
        const t = i / 10
        d += `L${f1(X(ax + (bx - ax) * t))} ${f1(Y(ay + (by - ay) * t - 4 * s * t * (1 - t)))}`
      }
    } else {
      d += `L${f1(X(bx))} ${f1(Y(by))}`
    }
    const arr = paths.get(g)
    if (arr) arr.push(d)
    else paths.set(g, [d])
  }
  const parts: string[] = []
  parts.push(`<svg class="draw" viewBox="0 0 ${width} ${f1(H)}" width="100%" xmlns="http://www.w3.org/2000/svg">`)
  for (const g of DRAW_ORDER) {
    const arr = paths.get(g)
    if (!arr) continue
    const st = GROUP_STYLE[g]
    parts.push(`<path d="${arr.join('')}" fill="none" stroke="${st.color}" stroke-width="${st.width}" stroke-linecap="round"/>`)
  }
  // apoios
  for (const nd of model.nodes) {
    if (!nd.fix || !(nd.fix[0] || nd.fix[1] || nd.fix[2])) continue
    const [x, y] = pt(nd)
    const px = X(x)
    const py = Y(y)
    if (plane === 'xz') parts.push(`<path d="M${f1(px)} ${f1(py)} l-4 7 h8 z" fill="${BLUE}"/>`)
    else parts.push(`<rect x="${f1(px - 2.5)}" y="${f1(py - 2.5)}" width="5" height="5" fill="${BLUE}"/>`)
  }
  parts.push('</svg>')
  return { svg: parts.join(''), exaggeration }
}
