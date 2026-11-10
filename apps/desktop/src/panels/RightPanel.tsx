import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Inspector } from './Inspector'
import { FEATURE_TABS } from './registry'

/** grupos do painel direito (1ª linha) e a que grupo pertence cada aba do registro */
const GROUPS: { key: string; label: string }[] = [
  { key: 'analysis', label: 'Análise' },
  { key: 'actions', label: 'Ações' },
  { key: 'checks', label: 'Verificações' },
  { key: 'construction', label: 'Construção' },
  { key: 'data', label: 'Dados' },
]
const TAB_GROUP: Record<string, string> = {
  summary: 'analysis', cables: 'analysis', modes: 'analysis', moving: 'analysis', reactions: 'analysis',
  actions: 'actions', combos: 'actions',
  sections: 'checks', prestress: 'checks', stability: 'checks',
  stages: 'construction',
  data: 'data', lanes: 'data', library: 'data', diagnostics: 'data',
}

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
  const lastInGroup = useRef<Record<string, string>>({})

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
  const groupOf = (key: string): string => TAB_GROUP[key] ?? 'analysis'
  const curGroup = groupOf(current.key)
  const groups = GROUPS.filter((g) => tabs.some((t) => groupOf(t.key) === g.key))
  const inGroup = tabs.filter((t) => groupOf(t.key) === curGroup)
  const openGroup = (g: string) => {
    const remembered = tabs.find((t) => t.key === lastInGroup.current[g])
    const first = remembered ?? tabs.find((t) => groupOf(t.key) === g)
    if (first) setTab(first.key)
  }
  lastInGroup.current[curGroup] = current.key

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
      <div className="tab-groups">
        {groups.map((g) => {
          const err = tabs.some((t) => groupOf(t.key) === g.key && t.badge?.(model, results)?.err)
          return (
            <button key={g.key} className={curGroup === g.key ? 'active' : ''} onClick={() => openGroup(g.key)}>
              {g.label}
              {err && <span className="dot-err" />}
            </button>
          )
        })}
      </div>
      {inGroup.length > 1 && (
        <div className="tabs">
          {inGroup.map((t) => {
            const badge = t.badge?.(model, results)
            return (
              <button key={t.key} className={`tab ${current.key === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
                {badge && <span className={`badge ${badge.err ? 'err' : ''}`}>{badge.text}</span>}
              </button>
            )
          })}
        </div>
      )}
      <div className={`tab-body ${current.flush ? 'flush' : ''}`}>{current.render(model, results)}</div>
    </div>
  )
}
