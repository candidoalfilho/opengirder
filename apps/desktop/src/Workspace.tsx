import { useEffect, useRef, useState } from 'react'
import type { TemplateParams } from '@opengirder/engine'
import { useStore, type DiagramKind, type ViewMode } from './store'
import { openModel, saveModel, saveModelAs } from './io/fileio'
import { fmt, fmtDuration, fmtInt, MODE_KIND_LABEL } from './format'
import { IconDots, IconFit, IconGear, IconMoon, IconOpen, IconPlay, IconSave, IconSliders, IconStop, IconSun, LogoMark } from './ui/icons'
import { Viewer, type CameraPreset } from './viewer/Viewer'
import { LeftPanel } from './panels/LeftPanel'
import { RightPanel } from './panels/RightPanel'

const TEMPLATE_KINDS = ['girder', 'cable-stayed', 'suspension']

const MODES: { key: ViewMode; label: string; needsResults: boolean }[] = [
  { key: 'model', label: 'Modelo', needsResults: false },
  { key: 'deformed', label: 'Deformada', needsResults: true },
  { key: 'cables', label: 'Trações', needsResults: true },
  { key: 'diagram', label: 'Diagramas', needsResults: true },
  { key: 'mode', label: 'Modos', needsResults: true },
]

const DIAGRAMS: { key: DiagramKind; label: string }[] = [
  { key: 'Mz', label: 'Mz' },
  { key: 'Vy', label: 'Vy' },
  { key: 'N', label: 'N' },
]

const CAMERAS: { key: CameraPreset; label: string }[] = [
  { key: 'iso', label: '3D' },
  { key: 'elev', label: 'Elevação' },
  { key: 'plan', label: 'Planta' },
  { key: 'front', label: 'Frontal' },
]

function OptionsPopover({ onClose }: { onClose: () => void }) {
  const o = useStore((s) => s.options)
  const set = useStore((s) => s.setOptions)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="popover" ref={ref}>
      <div className="panel-title">Opções de análise</div>
      <label className="check">
        <input type="checkbox" checked={o.formFinding} onChange={(e) => set({ formFinding: e.target.checked })} />
        Form-finding dos cabos
      </label>
      <div className="note" style={{ margin: '0 0 6px 22px' }}>
        Ajusta o comprimento indeformado de estais e pendurais para o tabuleiro ficar na posição de projeto sob carga
        permanente.
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={o.sizeCables && o.formFinding && o.moving}
          disabled={!o.formFinding || !o.moving}
          onChange={(e) => set({ sizeCables: e.target.checked })}
        />
        Dimensionar os estais
      </label>
      <div className="note" style={{ margin: '0 0 6px 22px' }}>
        Aumenta o número de cordoalhas de cada estai até atender 0,45·Fu em serviço e 0,65·Fu no ELU, e reanalisa.
        Exige form-finding e carga móvel.
      </div>
      <label className="check">
        <input type="checkbox" checked={o.nonlinear} onChange={(e) => set({ nonlinear: e.target.checked })} />
        Não linearidade geométrica
      </label>
      <div className="note" style={{ margin: '0 0 6px 22px' }}>
        Cabos de catenária e grandes deslocamentos. Desligado: análise linear.
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={o.modal} onChange={(e) => set({ modal: e.target.checked })} />
          Análise modal
        </label>
        <input
          className="input"
          type="number"
          min={1}
          max={60}
          disabled={!o.modal}
          value={o.modes}
          title="Número de modos"
          onChange={(e) => {
            const v = Math.round(Number(e.target.value))
            if (Number.isFinite(v) && v >= 1 && v <= 60) set({ modes: v })
          }}
        />
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={o.moving} onChange={(e) => set({ moving: e.target.checked })} />
          Carga móvel
        </label>
        <select
          className="select"
          disabled={!o.moving}
          value={o.vehicle}
          onChange={(e) => set({ vehicle: e.target.value as 'TB-450' | 'TB-240' })}
        >
          <option value="TB-450">TB-450</option>
          <option value="TB-240">TB-240</option>
        </select>
      </div>
      <div className="note" style={{ marginTop: 10 }}>
        Trem-tipo da NBR 7188 com CIV, CNF e CIA.
      </div>
    </div>
  )
}

function TopBar() {
  const model = useStore((s) => s.model)
  const filePath = useStore((s) => s.filePath)
  const dirty = useStore((s) => s.dirty)
  const analysis = useStore((s) => s.analysis)
  const theme = useStore((s) => s.theme)
  const { goStart, renameModel, openWizard, loadModel, setFilePath, markSaved, runAnalysis, cancelAnalysis, notify, setTheme } =
    useStore.getState()
  const [optionsOpen, setOptionsOpen] = useState(false)

  const canEditParams = !!model?.template && TEMPLATE_KINDS.includes(model.template.kind)

  const onOpen = async () => {
    try {
      if (dirty && !confirm('Há alterações não salvas no modelo atual. Abrir outro arquivo mesmo assim?')) return
      const r = await openModel()
      if (r) loadModel(r.model, r.path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  const onSave = async (as: boolean) => {
    const m = useStore.getState().model
    if (!m) return
    try {
      const path = as ? await saveModelAs(m, filePath) : await saveModel(m, filePath)
      if (path) {
        setFilePath(path)
        markSaved()
        notify('Modelo salvo')
      }
    } catch (err) {
      notify(`Não foi possível salvar: ${err instanceof Error ? err.message : String(err)}`, 'err')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void onSave(e.shiftKey)
      } else if (k === 'o') {
        e.preventDefault()
        void onOpen()
      } else if (k === 'enter') {
        e.preventDefault()
        if (!useStore.getState().analysis.running) runAnalysis()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, dirty])

  if (!model) return null

  return (
    <div className="topbar">
      <button className="logo logo-btn tip-down-right" data-tip="Tela inicial" onClick={goStart}>
        <LogoMark size={18} />
        <span>
          Open<b>Girder</b>
        </span>
      </button>
      <div className="sep" />
      <input
        className="name-input"
        value={model.name}
        spellCheck={false}
        onChange={(e) => renameModel(e.target.value)}
        aria-label="Nome do modelo"
      />
      {canEditParams && (
        <button
          className="btn btn-ghost"
          onClick={() => openWizard(model.template as unknown as TemplateParams)}
        >
          <IconSliders size={14} />
          Editar parâmetros
        </button>
      )}
      <button className="btn btn-ghost tip-down" data-tip="Abrir (⌘O)" onClick={onOpen}>
        <IconOpen size={14} />
        Abrir
      </button>
      <button className="btn btn-ghost tip-down" data-tip="Salvar (⌘S) · Salvar como (⇧⌘S)" onClick={() => onSave(false)}>
        <IconSave size={14} />
        Salvar
      </button>
      <div className="spacer" />
      <button
        className="btn-icon tip-down-left"
        data-tip={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
      <div className="popover-wrap">
        <button
          className={`btn-icon ${optionsOpen ? 'active' : ''}`}
          title="Opções de análise"
          onClick={() => setOptionsOpen((v) => !v)}
        >
          <IconGear />
        </button>
        {optionsOpen && <OptionsPopover onClose={() => setOptionsOpen(false)} />}
      </div>
      {analysis.running ? (
        <button className="btn btn-primary btn-run" onClick={cancelAnalysis}>
          <i className="bar" style={{ width: `${Math.round(analysis.fraction * 100)}%` }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconStop size={12} />
            Cancelar
          </span>
        </button>
      ) : (
        <button className="btn btn-primary btn-run tip-down-left" data-tip="Analisar (⌘↵)" onClick={runAnalysis}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconPlay size={12} />
            Analisar
          </span>
        </button>
      )}
    </div>
  )
}

function ViewToolbar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const results = useStore((s) => s.results)
  const modes = results?.modal?.modes ?? []
  const scalable = view.mode === 'deformed' || view.mode === 'diagram' || view.mode === 'mode' || view.mode === 'custom'

  return (
    <div className="view-toolbar">
      <div className="seg">
        {MODES.map((m) => {
          const disabled = m.needsResults && (!results || (m.key === 'mode' && modes.length === 0))
          return (
            <button
              key={m.key}
              className={view.mode === m.key ? 'active' : ''}
              disabled={disabled}
              title={disabled ? 'Rode a análise para habilitar' : undefined}
              onClick={() => setView({ mode: m.key, scaleMul: 1 })}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {view.mode === 'diagram' && (
        <div className="seg">
          {DIAGRAMS.map((d) => (
            <button key={d.key} className={view.diagram === d.key ? 'active' : ''} onClick={() => setView({ diagram: d.key })}>
              {d.label}
            </button>
          ))}
        </div>
      )}

      {view.mode === 'cables' && (
        <div className="seg">
          <button className={view.cableBy === 'T' ? 'active' : ''} onClick={() => setView({ cableBy: 'T' })}>
            Tração (kN)
          </button>
          <button className={view.cableBy === 'els' ? 'active' : ''} onClick={() => setView({ cableBy: 'els' })}>
            Aproveitamento ELS
          </button>
        </div>
      )}

      {view.mode === 'mode' && modes.length > 0 && (
        <div className="seg">
          <select
            className="select"
            value={Math.min(view.modeIndex, modes.length - 1)}
            onChange={(e) => setView({ modeIndex: Number(e.target.value) })}
          >
            {modes.map((m, i) => (
              <option key={m.index} value={i}>
                Modo {m.index} — T = {fmt(m.period, 3)} s — {MODE_KIND_LABEL[m.kind] ?? m.kind}
              </option>
            ))}
          </select>
        </div>
      )}

      {scalable && (
        <div className="seg">
          <span className="seg-label">Escala</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={view.scaleMul}
            onChange={(e) => setView({ scaleMul: Number(e.target.value) })}
          />
        </div>
      )}

    </div>
  )
}

function CameraBar({ onCamera }: { onCamera: (p: CameraPreset) => void }) {
  const showNodes = useStore((s) => s.view.showNodes)
  const setView = useStore((s) => s.setView)
  return (
    <div className="view-corner">
      <div className="seg">
        {CAMERAS.map((c) => (
          <button key={c.key} onClick={() => onCamera(c.key)}>
            {c.key === 'iso' ? <IconFit size={13} /> : null}
            {c.label}
          </button>
        ))}
      </div>
      <div className="seg">
        <button
          className={showNodes ? 'active' : ''}
          title="Mostrar nós (clicáveis)"
          onClick={() => setView({ showNodes: !showNodes })}
        >
          <IconDots size={14} />
          Nós
        </button>
      </div>
    </div>
  )
}

function StatusBar() {
  const model = useStore((s) => s.model)
  const results = useStore((s) => s.results)
  const filePath = useStore((s) => s.filePath)
  const dirty = useStore((s) => s.dirty)
  const analysis = useStore((s) => s.analysis)
  const errors = useStore((s) => s.modelErrors)
  if (!model) return null
  const file = filePath ? filePath.split(/[\\/]/).pop() : 'não salvo'
  let status: string
  if (analysis.running) status = `${analysis.stage || 'Analisando'} — ${Math.round(analysis.fraction * 100)}%`
  else if (analysis.error) status = 'Falha na análise'
  else if (results)
    status = `Analisado${analysis.elapsed !== null ? ` em ${fmtDuration(analysis.elapsed)}` : ''} · ${
      results.deadLoad.converged ? 'convergiu' : 'NÃO convergiu'
    }`
  else status = 'Sem análise'
  return (
    <div className="statusbar">
      <span>
        {file}
        {dirty ? ' •' : ''}
      </span>
      <span>{fmtInt(model.nodes.length)} nós</span>
      <span>{fmtInt(model.elements.length)} elementos</span>
      {errors.length > 0 && <span style={{ color: 'var(--err)' }}>{errors.length} erro(s) no modelo</span>}
      <span style={{ color: analysis.error ? 'var(--err)' : results ? 'var(--ok)' : undefined }}>{status}</span>
      <span className="spacer" />
      <span className="faint">arrastar: orbitar · botão direito: mover · rolagem: zoom · clique: inspecionar</span>
      <span>m · kN · kN·m</span>
      <span>OpenGirder v{__APP_VERSION__}</span>
    </div>
  )
}

export function Workspace() {
  const model = useStore((s) => s.model)
  const results = useStore((s) => s.results)
  const view = useStore((s) => s.view)
  const overlay = useStore((s) => s.overlay)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const fitKey = useStore((s) => s.fitKey)
  const theme = useStore((s) => s.theme)
  const analysis = useStore((s) => s.analysis)
  const cancelAnalysis = useStore((s) => s.cancelAnalysis)
  const [cam, setCam] = useState<{ preset: CameraPreset; n: number }>({ preset: 'iso', n: 0 })

  if (!model) return null

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-main">
        <LeftPanel />
        <div className="view-area">
          <Viewer
            model={model}
            results={results}
            view={view}
            selection={selection}
            onSelect={select}
            fitKey={fitKey}
            theme={theme}
            cameraCmd={cam}
            overlay={overlay}
          />
          <ViewToolbar />
          <CameraBar onCamera={(preset) => setCam((c) => ({ preset, n: c.n + 1 }))} />
          {analysis.running && (
            <div className="view-overlay">
              <div className="progress-card">
                <h4>Analisando…</h4>
                <div className="dim">{analysis.stage || 'Preparando'}</div>
                <div className="progress-track">
                  <i style={{ width: `${Math.round(analysis.fraction * 100)}%` }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="mono dim">{Math.round(analysis.fraction * 100)}%</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn" onClick={cancelAnalysis}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <RightPanel />
      </div>
      <StatusBar />
    </div>
  )
}
