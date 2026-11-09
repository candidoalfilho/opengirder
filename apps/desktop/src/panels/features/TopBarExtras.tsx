/**
 * Itens da barra superior: desfazer/refazer, exportação (DXF, CSV, JSON, PNG) e memorial de
 * cálculo (pré-visualização em tela cheia, impressão/PDF e download do .html).
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useStore } from '../../store'
import { isTauri } from '../../platform'
import { buildDxf, csvTables, csvText, fileBase, resultsJson } from '../../io/export'
import { KIND_CSV, KIND_DXF, KIND_HTML, KIND_JSON, saveDataUrl, saveManyText, saveText } from '../../io/download'
import { buildReport } from '../../report/build'
import { captureView } from '../../viewer/capture'
import { parseNum } from '../../format'

const IconUndo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
)
const IconRedo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </svg>
)
const IconExport = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
)
const IconDoc = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </svg>
)

function useDismiss(ref: RefObject<HTMLDivElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [ref, open, onClose])
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/* ------------------------------------------------------------------ exportar */

function ExportPopover({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model)
  const results = useStore((s) => s.results)
  const notify = useStore((s) => s.notify)
  const [deformed, setDeformed] = useState(false)
  const [scale, setScale] = useState('100')
  const [nodes, setNodes] = useState(false)
  const tables = useMemo(() => (model ? csvTables(model, results) : []), [model, results])
  const [tableKey, setTableKey] = useState('')
  if (!model) return null
  const base = fileBase(model)
  const current = tables.find((t) => t.key === tableKey) ?? tables[0]

  const run = async (what: string, fn: () => Promise<string | number | null>) => {
    try {
      const r = await fn()
      if (r !== null) {
        notify(`${what} exportado`)
        onClose()
      }
    } catch (err) {
      notify(`Não foi possível exportar: ${errText(err)}`, 'err')
    }
  }

  const dxf = () =>
    run('DXF', () => {
      const s = parseNum(scale)
      const text = buildDxf(model, results, { deformed: deformed && !!results, scale: Number.isFinite(s) && s > 0 ? s : 1, nodes })
      return saveText(`${base}.dxf`, text, KIND_DXF)
    })

  const png = () =>
    run('Imagem', async () => {
      const url = captureView()
      if (!url) throw new Error('a vista 3D não está disponível.')
      return saveDataUrl(`${base}_vista.png`, url)
    })

  const json = () =>
    run('JSON', async () => {
      if (!results) return null
      return saveText(`${base}_resultados.json`, resultsJson(model, results, __APP_VERSION__), KIND_JSON)
    })

  const csvOne = () =>
    run('CSV', async () => {
      if (!current) return null
      return saveText(`${base}_${current.file}`, csvText(current), KIND_CSV)
    })

  const csvAll = () =>
    run(`${tables.length} tabelas`, () =>
      saveManyText(
        tables.map((t) => ({ name: `${base}_${t.file}`, text: csvText(t) })),
        KIND_CSV,
      ),
    )

  return (
    <div className="popover rep-pop">
      <div className="panel-title">Exportar</div>

      <div className="rep-group">Desenho</div>
      <label className="check">
        <input type="checkbox" checked={deformed && !!results} disabled={!results} onChange={(e) => setDeformed(e.target.checked)} />
        Incluir a deformada de carga permanente
      </label>
      {deformed && !!results && (
        <div className="row" style={{ margin: '0 0 4px 22px' }}>
          <span className="note">Escala dos deslocamentos ×</span>
          <input className="input" value={scale} onChange={(e) => setScale(e.target.value)} />
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={nodes} onChange={(e) => setNodes(e.target.checked)} />
        Incluir os nós como pontos
      </label>
      <div className="rep-actions">
        <button className="btn" onClick={dxf}>
          DXF (3D, uma layer por grupo)
        </button>
        <button className="btn" onClick={png}>
          PNG da vista 3D
        </button>
      </div>

      <div className="rep-group">Tabelas (CSV para Excel)</div>
      <select className="select" style={{ width: '100%' }} value={current?.key ?? ''} onChange={(e) => setTableKey(e.target.value)}>
        {tables.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label} ({t.rows.length})
          </option>
        ))}
      </select>
      <div className="rep-actions">
        <button className="btn" disabled={!current} onClick={csvOne}>
          Exportar tabela
        </button>
        <button className="btn" disabled={tables.length === 0} onClick={csvAll}>
          Todas ({tables.length})
        </button>
      </div>
      {!results && <div className="note">Rode a análise para exportar esforços, trações, modos e envoltórias.</div>}

      <div className="rep-group">Resultados completos</div>
      <div className="rep-actions">
        <button className="btn" disabled={!results} onClick={json}>
          JSON dos resultados
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ memorial */

interface Preview {
  /** documento completo (com a barra de impressão própria) — p/ baixar e abrir em nova aba */
  full: string
  name: string
}

function ReportPopover({ onClose, onPreview }: { onClose: () => void; onPreview: (p: Preview) => void }) {
  const notify = useStore((s) => s.notify)
  const [annexes, setAnnexes] = useState(false)
  const [image, setImage] = useState(true)

  const go = () => {
    const { model, results, filePath } = useStore.getState()
    if (!model || !results) return
    try {
      const shot = image ? captureView() : null
      const fileName = filePath ? filePath.split(/[\\/]/).pop() : null
      const full = buildReport(model, results, { version: __APP_VERSION__, annexes, image: shot, fileName })
      onPreview({ full, name: `${fileBase(model)}_memorial.html` })
      onClose()
    } catch (err) {
      notify(`Não foi possível gerar o memorial: ${errText(err)}`, 'err')
    }
  }

  return (
    <div className="popover rep-pop">
      <div className="panel-title">Memorial de cálculo</div>
      <label className="check">
        <input type="checkbox" checked={annexes} onChange={(e) => setAnnexes(e.target.checked)} />
        Incluir anexos com as tabelas completas
      </label>
      <div className="note" style={{ margin: '0 0 6px 22px' }}>
        Todos os cabos e os esforços ao longo do tabuleiro, estação a estação.
      </div>
      <label className="check">
        <input type="checkbox" checked={image} onChange={(e) => setImage(e.target.checked)} />
        Incluir imagem da vista 3D atual
      </label>
      <div className="rep-actions">
        <button className="btn btn-primary" onClick={go}>
          Gerar memorial
        </button>
      </div>
      <div className="note">Abre uma pré-visualização; de lá, imprima ou salve em PDF (A4).</div>
    </div>
  )
}

function ReportModal({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  const notify = useStore((s) => s.notify)
  const frame = useRef<HTMLIFrameElement>(null)
  // na pré-visualização a barra do próprio documento é redundante
  const doc = useMemo(() => preview.full.replace('<div class="toolbar">', '<div class="toolbar" style="display:none">'), [preview.full])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const print = () => {
    try {
      const w = frame.current?.contentWindow
      if (!w) throw new Error('pré-visualização indisponível.')
      w.focus()
      w.print()
    } catch (err) {
      notify(`Não foi possível imprimir: ${errText(err)}. Baixe o .html e imprima pelo navegador.`, 'err')
    }
  }

  const download = async () => {
    try {
      if (await saveText(preview.name, preview.full, KIND_HTML)) notify('Memorial salvo')
    } catch (err) {
      notify(`Não foi possível salvar: ${errText(err)}`, 'err')
    }
  }

  const newTab = () => {
    const url = URL.createObjectURL(new Blob([preview.full], { type: 'text/html;charset=utf-8' }))
    const w = window.open(url, '_blank')
    if (!w) notify('O navegador bloqueou a nova aba. Use "Baixar .html".', 'err')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  return (
    <div className="rep-modal" role="dialog" aria-label="Memorial de cálculo">
      <div className="rep-modal-bar">
        <b>Memorial de cálculo</b>
        <span className="grow" />
        <button className="btn btn-primary" onClick={print}>
          Imprimir / Salvar em PDF
        </button>
        <button className="btn" onClick={download}>
          Baixar .html
        </button>
        {!isTauri() && (
          <button className="btn" onClick={newTab}>
            Abrir em nova aba
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
      <iframe ref={frame} className="rep-frame" title="Memorial de cálculo" srcDoc={doc} />
    </div>
  )
}

/* ------------------------------------------------------------------ barra */

export function TopBarExtras() {
  const hasModel = useStore((s) => !!s.model)
  const hasResults = useStore((s) => !!s.results)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const [open, setOpen] = useState<'export' | 'report' | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  useDismiss(wrap, open !== null, () => setOpen(null))

  // Ctrl/Cmd+Z desfaz, Ctrl/Cmd+Shift+Z (ou Ctrl+Y) refaz — fora de campos de texto
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) useStore.getState().redo()
        else useStore.getState().undo()
      } else if (k === 'y') {
        e.preventDefault()
        useStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!hasModel) return null

  return (
    <>
      <button className="btn-icon tip-down" data-tip="Desfazer (⌘Z)" disabled={!canUndo} onClick={() => useStore.getState().undo()} aria-label="Desfazer">
        <IconUndo />
      </button>
      <button className="btn-icon tip-down" data-tip="Refazer (⇧⌘Z)" disabled={!canRedo} onClick={() => useStore.getState().redo()} aria-label="Refazer">
        <IconRedo />
      </button>
      <div className="rep-wraps" ref={wrap}>
        <div className="popover-wrap">
          <button className={`btn btn-ghost ${open === 'export' ? 'active' : ''}`} onClick={() => setOpen(open === 'export' ? null : 'export')}>
            <IconExport />
            Exportar
          </button>
          {open === 'export' && <ExportPopover onClose={() => setOpen(null)} />}
        </div>
        <div className="popover-wrap">
          <button
            className={`btn btn-ghost ${open === 'report' ? 'active' : ''}`}
            disabled={!hasResults}
            title={hasResults ? undefined : 'Rode a análise para gerar o memorial'}
            onClick={() => setOpen(open === 'report' ? null : 'report')}
          >
            <IconDoc />
            Memorial
          </button>
          {open === 'report' && hasResults && <ReportPopover onClose={() => setOpen(null)} onPreview={setPreview} />}
        </div>
      </div>
      {preview && <ReportModal preview={preview} onClose={() => setPreview(null)} />}
    </>
  )
}
