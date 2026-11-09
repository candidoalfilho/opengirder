import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, type RightTab } from '../store'
import { Inspector } from './Inspector'
import { CablesTab, ModesTab, MovingTab, ReactionsTab, SummaryTab } from './tabs'

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

  const fails = results?.checks.cables.filter((c) => !c.ok).length ?? 0
  const nCables = model.elements.reduce((a, e) => a + (e.kind === 'cable' ? 1 : 0), 0)
  const tabs: { key: RightTab; label: string; badge?: string; err?: boolean }[] = [
    { key: 'summary', label: 'Resumo' },
    { key: 'cables', label: 'Cabos', badge: fails ? String(fails) : nCables ? String(nCables) : undefined, err: fails > 0 },
    { key: 'modes', label: 'Modos', badge: results?.modal ? String(results.modal.modes.length) : undefined },
    { key: 'moving', label: 'Carga móvel' },
    { key: 'reactions', label: 'Reações' },
  ]
  const flush = tab === 'cables' || tab === 'modes' || tab === 'reactions'

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
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.badge && <span className={`badge ${t.err ? 'err' : ''}`}>{t.badge}</span>}
          </button>
        ))}
      </div>
      <div className={`tab-body ${flush ? 'flush' : ''}`}>
        {tab === 'summary' && <SummaryTab model={model} results={results} />}
        {tab === 'cables' && <CablesTab model={model} results={results} />}
        {tab === 'modes' && <ModesTab results={results} />}
        {tab === 'moving' && <MovingTab model={model} results={results} />}
        {tab === 'reactions' && <ReactionsTab results={results} />}
      </div>
    </div>
  )
}
