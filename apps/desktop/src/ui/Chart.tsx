import { useMemo, useRef, useState } from 'react'
import { fmt, fmtAuto } from '../format'

export interface Series {
  label: string
  color: string
  x: number[]
  y: number[]
  dash?: boolean
  /** preenche a área até a série indicada (índice) */
  fillTo?: number
}

interface Props {
  series: Series[]
  xLabel?: string
  yLabel?: string
  /** eixo y invertido (positivo p/ baixo) — convenção de momento fletor */
  invertY?: boolean
  height?: number
  /** linhas verticais de referência (ex.: apoios, torres) */
  marks?: number[]
}

interface Ticks {
  values: number[]
  /** casas decimais adequadas ao passo */
  digits: number
}

function niceTicks(lo: number, hi: number, count: number): Ticks {
  if (!(hi > lo)) return { values: [lo], digits: 2 }
  const raw = (hi - lo) / count
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  const digits = Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9)))
  return { values: out, digits }
}

const W = 520
const PAD = { l: 58, r: 12, t: 10, b: 30 }

export function LineChart({ series, xLabel, yLabel, invertY = false, height = 220, marks }: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const dom = useMemo(() => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const s of series) {
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i]
        const y = s.y[i]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    }
    if (!Number.isFinite(x0)) return null
    y0 = Math.min(y0, 0)
    y1 = Math.max(y1, 0)
    if (y1 - y0 < 1e-12) y1 = y0 + 1
    const pad = (y1 - y0) * 0.06
    if (x1 - x0 < 1e-12) x1 = x0 + 1
    return { x0, x1, y0: y0 - pad, y1: y1 + pad }
  }, [series])

  if (!dom) return <div className="note">Sem dados para o gráfico.</div>

  const H = height
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const sx = (x: number) => PAD.l + ((x - dom.x0) / (dom.x1 - dom.x0)) * iw
  const sy = (y: number) => {
    const t = (y - dom.y0) / (dom.y1 - dom.y0)
    return PAD.t + (invertY ? t : 1 - t) * ih
  }
  const path = (s: Series) => {
    let d = ''
    let pen = false
    for (let i = 0; i < s.x.length; i++) {
      if (!Number.isFinite(s.y[i])) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${sx(s.x[i]).toFixed(1)} ${sy(s.y[i]).toFixed(1)}`
      pen = true
    }
    return d
  }
  const area = (a: Series, b: Series) => {
    const pts: string[] = []
    for (let i = 0; i < a.x.length; i++) {
      if (Number.isFinite(a.y[i])) pts.push(`${sx(a.x[i]).toFixed(1)} ${sy(a.y[i]).toFixed(1)}`)
    }
    for (let i = b.x.length - 1; i >= 0; i--) {
      if (Number.isFinite(b.y[i])) pts.push(`${sx(b.x[i]).toFixed(1)} ${sy(b.y[i]).toFixed(1)}`)
    }
    return pts.length > 2 ? `M${pts.join('L')}Z` : ''
  }

  const xt = niceTicks(dom.x0, dom.x1, 6)
  const yt = niceTicks(dom.y0, dom.y1, 5)

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = ref.current
    if (!svg) return
    const r = svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const x = dom.x0 + ((px - PAD.l) / iw) * (dom.x1 - dom.x0)
    setHover(x < dom.x0 || x > dom.x1 ? null : x)
  }

  const nearest = (s: Series, x: number): number => {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < s.x.length; i++) {
      const d = Math.abs(s.x[i] - x)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  const hoverRows =
    hover === null
      ? null
      : series.map((s) => {
          const i = nearest(s, hover)
          return { s, x: s.x[i], y: s.y[i] }
        })

  return (
    <div>
      <svg
        ref={ref}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
      >
        {yt.values.map((v) => (
          <g key={`y${v}`}>
            <line className={v === 0 ? 'zero' : 'grid'} x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end">
              {fmt(v, yt.digits)}
            </text>
          </g>
        ))}
        {xt.values.map((v) => (
          <g key={`x${v}`}>
            <line className="grid" x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} strokeDasharray="2 4" />
            <text x={sx(v)} y={H - PAD.b + 13} textAnchor="middle">
              {fmt(v, xt.digits)}
            </text>
          </g>
        ))}
        {marks?.map((m, i) =>
          m >= dom.x0 && m <= dom.x1 ? (
            <line key={`m${i}`} className="axis" x1={sx(m)} x2={sx(m)} y1={PAD.t} y2={H - PAD.b} />
          ) : null,
        )}
        <line className="axis" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} />
        {series.map((s, i) =>
          s.fillTo !== undefined && series[s.fillTo] ? (
            <path key={`a${i}`} d={area(s, series[s.fillTo])} fill={s.color} opacity={0.12} />
          ) : null,
        )}
        {series.map((s, i) => (
          <path
            key={`s${i}`}
            d={path(s)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.6}
            strokeDasharray={s.dash ? '5 4' : undefined}
            strokeLinejoin="round"
          />
        ))}
        {hoverRows && hover !== null && (
          <g>
            <line className="zero" x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={H - PAD.b} />
            {hoverRows.map((r, i) =>
              Number.isFinite(r.y) ? <circle key={i} cx={sx(r.x)} cy={sy(r.y)} r={3} fill={r.s.color} /> : null,
            )}
          </g>
        )}
        {xLabel && (
          <text x={PAD.l + iw / 2} y={H - 3} textAnchor="middle">
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text transform={`translate(11 ${PAD.t + ih / 2}) rotate(-90)`} textAnchor="middle">
            {yLabel}
          </text>
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s, i) => (
          <span key={i}>
            <i style={{ borderTopColor: s.color, borderTopStyle: s.dash ? 'dashed' : 'solid' }} />
            {s.label}
            {hoverRows && Number.isFinite(hoverRows[i].y) ? (
              <b className="mono" style={{ color: 'var(--text)' }}>
                {fmtAuto(hoverRows[i].y)}
              </b>
            ) : null}
          </span>
        ))}
        {hoverRows && hover !== null ? <span className="mono faint">x = {fmtAuto(hover)}</span> : null}
      </div>
    </div>
  )
}
