import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Inspector } from './Inspector'
import { FEATURE_TABS } from './registry'

const MIN_W = 340
const MAX_W = 900

function initialWidth(): number {
  try {
    const v = Number(localStorage.getItem('opengirder:rightWidth'))
    if (Number.isFinite(v) && v >= MIN_W && v <= MAX_W) return v
  } catch {
    /* sem persistência */
  }
  return 430
}

export function RightPanel() {
  const model = useStore((s) => s.model)
  const results = useStore((s) => s.results)
  const tab = useStore((s) => s.rightTab)
  const setTab = useStore((s) => s.setRightTab)
  const selection = useStore((s) => s.selection)
  const [width, setWidth] = useState(initialWidth)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; w: number } | null>(null)

  const onMove = useCallback((e: PointerEvent) => {
    if (!start.current) return
    const w = Math.max(MIN_W, Math.min(MAX_W, start.current.w + (start.current.x - e.clientX)))
    setWidth(w)
  }, [])

  const onUp = useCallback(() => {
    start.current = null
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!dragging) return
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, onMove, onUp])

  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem('opengirder:rightWidth', String(Math.round(width)))
    } catch {
      /* sem persistência */
    }
  }, [width, dragging])

  if (!model) return null

  const tabs = FEATURE_TABS.filter((t) => !t.visible || t.visible(model, results))
  const current = tabs.find((t) => t.key === tab) ?? tabs[0]

  return (
    <div className="right-panel" style={{ width }}>
      <div
        className={`resize-handle ${dragging ? 'dragging' : ''}`}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, w: width }
          setDragging(true)
          e.preventDefault()
        }}
      />
      {selection && <Inspector selection={selection} />}
      <div className="tabs">
        {tabs.map((t) => {
          const badge = t.badge?.(model, results)
          return (
            <button key={t.key} className={`tab ${current.key === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {badge && <span className={`badge ${badge.err ? 'err' : ''}`}>{badge.text}</span>}
            </button>
          )
        })}
      </div>
      <div className={`tab-body ${current.flush ? 'flush' : ''}`}>{current.render(model, results)}</div>
    </div>
  )
}
