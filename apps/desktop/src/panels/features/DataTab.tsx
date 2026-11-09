/**
 * Aba "Dados" — editor em tabela do modelo: nós, barras, cabos, seções, materiais e cargas
 * permanentes adicionais. Toda alteração passa por `updateModel` (o store revalida o modelo,
 * descarta os resultados e empilha o estado anterior p/ desfazer).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { BridgeModel, CableElement, ElementGroup, FrameElement, Material } from '@opengirder/engine'
import { useStore } from '../../store'
import { GROUP_LABEL, MATERIAL_KIND_LABEL, numToInput, parseNum } from '../../format'
import {
  type Edit,
  addCable,
  addFrame,
  addLoadCase,
  addMaterial,
  addNodalLoad,
  addNode,
  addSection,
  addUniformLoad,
  patchCable,
  patchFrame,
  patchLoadCase,
  patchMaterial,
  patchNodalLoad,
  patchNode,
  patchSection,
  patchUniformLoad,
  removeElement,
  removeLoadCase,
  removeMaterial,
  removeNodalLoad,
  removeNode,
  removeSection,
  removeUniformLoad,
  setGroupUniformLoad,
  setNodeFix,
} from './dataEdit'

type Sub = 'nodes' | 'frames' | 'cables' | 'sections' | 'materials' | 'loads'

const PAGE = 200
const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz']
const FRAME_GROUPS: ElementGroup[] = ['deck', 'tower', 'pier', 'arch', 'crossbeam', 'rigid']
const CABLE_GROUPS: ElementGroup[] = ['stay', 'main-cable', 'hanger']
const MATERIAL_KINDS: Material['kind'][] = ['concrete', 'steel', 'cable', 'rigid']
const groupLabel = (g: string | undefined): string => GROUP_LABEL[g ?? 'other'] ?? (g === 'arch' ? 'Arco' : (g ?? 'Outros'))

/** aplica uma edição: string = recusa (vira aviso), modelo = commit */
function apply(fn: (m: BridgeModel) => Edit): boolean {
  const st = useStore.getState()
  const cur = st.model
  if (!cur) return false
  let res: Edit
  try {
    res = fn(cur)
  } catch (err) {
    st.notify(err instanceof Error ? err.message : String(err), 'err')
    return false
  }
  if (typeof res === 'string') {
    st.notify(res, 'err')
    return false
  }
  const next = res
  st.updateModel(() => next)
  return true
}

/* ------------------------------------------------------------------ células */

interface CellProps {
  value: number | string | undefined
  /** num/int: número (vazio → null se `optional`); text: texto livre */
  kind?: 'num' | 'int' | 'text'
  optional?: boolean
  left?: boolean
  placeholder?: string
  /** devolve false p/ recusar (a célula volta ao valor anterior) */
  onCommit: (v: number | string | null) => void
}

/** célula editável: clique ou foco (Tab) abre o campo; Enter/Tab confirmam; Esc cancela */
function EditCell({ value, kind = 'num', optional, left, placeholder, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  const shown = typeof value === 'number' ? numToInput(value) : (value ?? '')

  const commit = (text: string) => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (text === shown) return
    if (kind === 'text') {
      onCommit(text)
      return
    }
    if (text.trim() === '') {
      if (optional) onCommit(null)
      else useStore.getState().notify('Este campo não pode ficar vazio.', 'err')
      return
    }
    const v = parseNum(text)
    if (!Number.isFinite(v)) {
      useStore.getState().notify(`"${text}" não é um número válido.`, 'err')
      return
    }
    if (kind === 'int' && !Number.isInteger(v)) {
      useStore.getState().notify('Informe um número inteiro.', 'err')
      return
    }
    onCommit(v)
  }

  if (editing) {
    return (
      <td className={`ed-cell editing ${left ? 'left' : ''}`}>
        <input
          className="ed-input"
          autoFocus
          defaultValue={shown}
          spellCheck={false}
          inputMode={kind === 'text' ? 'text' : 'decimal'}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            }
            e.stopPropagation()
          }}
        />
      </td>
    )
  }
  return (
    <td className={`ed-cell ${left ? 'left' : ''}`} tabIndex={0} onFocus={() => setEditing(true)} onClick={() => setEditing(true)}>
      {shown === '' ? <span className="ed-ph">{placeholder ?? '—'}</span> : shown}
    </td>
  )
}

function SelectCell({ value, options, onCommit }: { value: string; options: { value: string; label: string }[]; onCommit: (v: string) => void }) {
  const known = options.some((o) => o.value === value)
  return (
    <td className="ed-cell left ed-sel">
      <select className="ed-select" value={value} onChange={(e) => onCommit(e.target.value)}>
        {!known && <option value={value}>{value || '—'}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </td>
  )
}

function DelButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button className="ed-del" title={title} aria-label={title} onClick={onClick}>
      ×
    </button>
  )
}

/* ------------------------------------------------------------------ paginação */

interface Paged<R> {
  rows: R[]
  page: number
  pages: number
  total: number
  setPage: (p: number) => void
}

/** pagina a lista e salta p/ a página que contém `focusId` quando ele muda */
function usePaged<R extends { id: number }>(all: R[], focusId: number | null): Paged<R> {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(all.length / PAGE))
  useEffect(() => {
    if (focusId === null) return
    const i = all.findIndex((r) => r.id === focusId)
    if (i >= 0) setPage(Math.floor(i / PAGE))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])
  const p = Math.min(page, pages - 1)
  return { rows: all.slice(p * PAGE, (p + 1) * PAGE), page: p, pages, total: all.length, setPage }
}

function Pager<R>({ p, noun }: { p: Paged<R>; noun: string }) {
  if (p.pages <= 1) {
    return (
      <div className="ed-pager">
        <span>
          {p.total} {noun}
        </span>
      </div>
    )
  }
  return (
    <div className="ed-pager">
      <button className="btn btn-ghost" disabled={p.page === 0} onClick={() => p.setPage(p.page - 1)}>
        ‹ Anterior
      </button>
      <span>
        {p.page * PAGE + 1}–{Math.min((p.page + 1) * PAGE, p.total)} de {p.total} {noun}
      </span>
      <button className="btn btn-ghost" disabled={p.page >= p.pages - 1} onClick={() => p.setPage(p.page + 1)}>
        Próxima ›
      </button>
    </div>
  )
}

/** rola a tabela até a linha selecionada */
function useScrollToRow(ref: RefObject<HTMLDivElement | null>, id: number | null, dep: unknown) {
  useEffect(() => {
    if (id === null || !ref.current) return
    const row = ref.current.querySelector(`tr[data-id="${id}"]`)
    if (row) row.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, dep])
}

function Bar({ children }: { children: ReactNode }) {
  return <div className="ed-bar">{children}</div>
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="input ed-search" value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
}

/** filtro por id: "12" (contém), "10-40" (faixa) */
function matchId(id: number, q: string): boolean {
  const t = q.trim()
  if (!t) return true
  const range = t.match(/^(\d+)\s*[-–:]\s*(\d+)$/)
  if (range) return id >= Number(range[1]) && id <= Number(range[2])
  return String(id).includes(t)
}

/* ------------------------------------------------------------------ nós */

export function NodesTable({ model }: { model: BridgeModel }) {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const [q, setQ] = useState('')
  const [onlySup, setOnlySup] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selId = selection?.kind === 'node' ? selection.id : null

  const all = useMemo(
    () => model.nodes.filter((n) => matchId(n.id, q) && (!onlySup || n.fix?.some(Boolean))),
    [model.nodes, q, onlySup],
  )
  const p = usePaged(all, selId)
  useScrollToRow(ref, selId, p.page)

  return (
    <>
      <Bar>
        <Search value={q} onChange={setQ} placeholder="Nó (ex.: 12 ou 10-40)" />
        <label className="check">
          <input type="checkbox" checked={onlySup} onChange={(e) => setOnlySup(e.target.checked)} />
          Só apoios
        </label>
        <span className="grow" />
        <button
          className="btn"
          onClick={() => {
            let created = -1
            if (apply((m) => {
              const r = addNode(m)
              created = r.id
              return r.model
            })) {
              setQ('')
              setOnlySup(false)
              select({ kind: 'node', id: created })
            }
          }}
        >
          + Nó
        </button>
      </Bar>
      <div className="ed-scroll" ref={ref}>
        <table className="table ed-table">
          <thead>
            <tr>
              <th className="left">Nó</th>
              <th>x (m)</th>
              <th>y (m)</th>
              <th>z (m)</th>
              {DOF.map((d) => (
                <th key={d} className="ed-dof" title={`Restringe ${d}`}>
                  {d}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {p.rows.map((n) => (
              <tr key={n.id} data-id={n.id} className={selId === n.id ? 'selected' : ''}>
                <td className="left ed-id" onClick={() => select({ kind: 'node', id: n.id })} title="Selecionar no 3D">
                  {n.id}
                </td>
                <EditCell value={n.x} onCommit={(v) => apply((m) => patchNode(m, n.id, { x: v as number }))} />
                <EditCell value={n.y} onCommit={(v) => apply((m) => patchNode(m, n.id, { y: v as number }))} />
                <EditCell value={n.z} onCommit={(v) => apply((m) => patchNode(m, n.id, { z: v as number }))} />
                {DOF.map((d, k) => (
                  <td key={d} className="ed-dof">
                    <input
                      type="checkbox"
                      checked={!!n.fix?.[k]}
                      aria-label={`${d} do nó ${n.id}`}
                      onChange={(e) => apply((m) => setNodeFix(m, n.id, k, e.target.checked))}
                    />
                  </td>
                ))}
                <td className="ed-act">
                  <DelButton
                    title={`Remover o nó ${n.id}`}
                    onClick={() => {
                      if (apply((m) => removeNode(m, n.id)) && selId === n.id) select(null)
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.length === 0 && <div className="empty">Nenhum nó corresponde ao filtro.</div>}
      </div>
      <Pager p={p} noun="nós" />
    </>
  )
}

/* ------------------------------------------------------------------ barras e cabos */

function AddElement({ noun, onAdd }: { noun: string; onAdd: (n1: number, n2: number) => boolean }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const go = () => {
    const n1 = parseNum(a)
    const n2 = parseNum(b)
    if (!Number.isInteger(n1) || !Number.isInteger(n2)) {
      useStore.getState().notify(`Informe os dois nós do novo ${noun}.`, 'err')
      return
    }
    if (onAdd(n1, n2)) {
      setA('')
      setB('')
    }
  }
  return (
    <div className="ed-add">
      <input className="input" value={a} placeholder="nó 1" onChange={(e) => setA(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <input className="input" value={b} placeholder="nó 2" onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <button className="btn" onClick={go}>
        + {noun === 'cabo' ? 'Cabo' : 'Barra'}
      </button>
    </div>
  )
}

function useLengths(model: BridgeModel): (n1: number, n2: number) => number {
  const pos = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes])
  return (n1, n2) => {
    const a = pos.get(n1)
    const b = pos.get(n2)
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : NaN
  }
}

function GroupFilter({ value, onChange, groups, all }: { value: string; onChange: (v: string) => void; groups: string[]; all: string }) {
  return (
    <select className="select compact" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">{all}</option>
      {groups.map((g) => (
        <option key={g} value={g}>
          {groupLabel(g)}
        </option>
      ))}
    </select>
  )
}

export function FramesTable({ model }: { model: BridgeModel }) {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('all')
  const ref = useRef<HTMLDivElement>(null)
  const len = useLengths(model)

  const frames = useMemo(() => model.elements.filter((e): e is FrameElement => e.kind === 'frame'), [model.elements])
  const groups = useMemo(() => [...new Set(frames.map((e) => e.group ?? 'other'))], [frames])
  const selId = selection?.kind === 'element' && frames.some((e) => e.id === selection.id) ? selection.id : null
  const all = useMemo(
    () => frames.filter((e) => matchId(e.id, q) && (group === 'all' || (e.group ?? 'other') === group)),
    [frames, q, group],
  )
  const p = usePaged(all, selId)
  useScrollToRow(ref, selId, p.page)

  const matOpts = model.materials.map((m) => ({ value: m.id, label: m.name }))
  const secOpts = model.sections.map((s) => ({ value: s.id, label: s.name }))
  const grpOpts = FRAME_GROUPS.map((g) => ({ value: g, label: groupLabel(g) }))

  return (
    <>
      <Bar>
        <Search value={q} onChange={setQ} placeholder="Barra (id ou faixa)" />
        <GroupFilter value={group} onChange={setGroup} groups={groups} all={`Todas (${frames.length})`} />
        <span className="grow" />
        <AddElement
          noun="barra"
          onAdd={(n1, n2) => {
            let created = -1
            const ok = apply((m) => {
              const r = addFrame(m, n1, n2)
              if (typeof r === 'string') return r
              created = r.id
              return r.model
            })
            if (ok && created >= 0) {
              setQ('')
              setGroup('all')
              select({ kind: 'element', id: created })
            }
            return ok
          }}
        />
      </Bar>
      <div className="ed-scroll" ref={ref}>
        <table className="table ed-table">
          <thead>
            <tr>
              <th className="left">Barra</th>
              <th>Nó 1</th>
              <th>Nó 2</th>
              <th className="left">Material</th>
              <th className="left">Seção</th>
              <th className="left">Grupo</th>
              <th>L (m)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.rows.map((e) => (
              <tr key={e.id} data-id={e.id} className={selId === e.id ? 'selected' : ''}>
                <td className="left ed-id" onClick={() => select({ kind: 'element', id: e.id })} title="Selecionar no 3D">
                  {e.id}
                </td>
                <EditCell value={e.n1} kind="int" onCommit={(v) => apply((m) => patchFrame(m, e.id, { n1: v as number }))} />
                <EditCell value={e.n2} kind="int" onCommit={(v) => apply((m) => patchFrame(m, e.id, { n2: v as number }))} />
                <SelectCell value={e.mat} options={matOpts} onCommit={(v) => apply((m) => patchFrame(m, e.id, { mat: v }))} />
                <SelectCell value={e.sec} options={secOpts} onCommit={(v) => apply((m) => patchFrame(m, e.id, { sec: v }))} />
                <SelectCell
                  value={e.group ?? ''}
                  options={grpOpts}
                  onCommit={(v) => apply((m) => patchFrame(m, e.id, { group: v as ElementGroup }))}
                />
                <td className="ed-ro">{numToInput(Number(len(e.n1, e.n2).toFixed(3)))}</td>
                <td className="ed-act">
                  <DelButton
                    title={`Remover a barra ${e.id}`}
                    onClick={() => {
                      if (apply((m) => removeElement(m, e.id)) && selId === e.id) select(null)
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.length === 0 && <div className="empty">{frames.length ? 'Nenhuma barra corresponde ao filtro.' : 'Este modelo não tem barras.'}</div>}
      </div>
      <Pager p={p} noun="barras" />
    </>
  )
}

export function CablesTable({ model }: { model: BridgeModel }) {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('all')
  const ref = useRef<HTMLDivElement>(null)
  const len = useLengths(model)

  const cables = useMemo(() => model.elements.filter((e): e is CableElement => e.kind === 'cable'), [model.elements])
  const groups = useMemo(() => [...new Set(cables.map((e) => e.group ?? 'other'))], [cables])
  const selId = selection?.kind === 'element' && cables.some((e) => e.id === selection.id) ? selection.id : null
  const all = useMemo(
    () => cables.filter((e) => matchId(e.id, q) && (group === 'all' || (e.group ?? 'other') === group)),
    [cables, q, group],
  )
  const p = usePaged(all, selId)
  useScrollToRow(ref, selId, p.page)

  const matOpts = model.materials.map((m) => ({ value: m.id, label: m.name }))
  const grpOpts = CABLE_GROUPS.map((g) => ({ value: g, label: groupLabel(g) }))

  return (
    <>
      <Bar>
        <Search value={q} onChange={setQ} placeholder="Cabo (id ou faixa)" />
        <GroupFilter value={group} onChange={setGroup} groups={groups} all={`Todos (${cables.length})`} />
        <span className="grow" />
        <AddElement
          noun="cabo"
          onAdd={(n1, n2) => {
            let created = -1
            const ok = apply((m) => {
              const r = addCable(m, n1, n2)
              if (typeof r === 'string') return r
              created = r.id
              return r.model
            })
            if (ok && created >= 0) {
              setQ('')
              setGroup('all')
              select({ kind: 'element', id: created })
            }
            return ok
          }}
        />
      </Bar>
      <div className="ed-scroll" ref={ref}>
        <table className="table ed-table">
          <thead>
            <tr>
              <th className="left">Cabo</th>
              <th>Nó 1</th>
              <th>Nó 2</th>
              <th className="left">Material</th>
              <th>A (mm²)</th>
              <th title="Número de cordoalhas">Cord.</th>
              <th title="Comprimento indeformado; vazio = definido pelo form-finding ou pela corda">L0 (m)</th>
              <th title="Força-alvo inicial, usada para estimar L0 quando ele está vazio">T inicial (kN)</th>
              <th className="left">Grupo</th>
              <th>Corda (m)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.rows.map((e) => (
              <tr key={e.id} data-id={e.id} className={selId === e.id ? 'selected' : ''}>
                <td className="left ed-id" onClick={() => select({ kind: 'element', id: e.id })} title="Selecionar no 3D">
                  {e.id}
                </td>
                <EditCell value={e.n1} kind="int" onCommit={(v) => apply((m) => patchCable(m, e.id, { n1: v as number }))} />
                <EditCell value={e.n2} kind="int" onCommit={(v) => apply((m) => patchCable(m, e.id, { n2: v as number }))} />
                <SelectCell value={e.mat} options={matOpts} onCommit={(v) => apply((m) => patchCable(m, e.id, { mat: v }))} />
                <EditCell
                  value={Number((e.A * 1e6).toPrecision(9))}
                  onCommit={(v) => apply((m) => patchCable(m, e.id, { A: (v as number) / 1e6 }))}
                />
                <EditCell value={e.strands} kind="int" optional onCommit={(v) => apply((m) => patchCable(m, e.id, { strands: v as number | null }))} />
                <EditCell value={e.L0} optional placeholder="auto" onCommit={(v) => apply((m) => patchCable(m, e.id, { L0: v as number | null }))} />
                <EditCell
                  value={e.pretension}
                  optional
                  placeholder="—"
                  onCommit={(v) => apply((m) => patchCable(m, e.id, { pretension: v as number | null }))}
                />
                <SelectCell
                  value={e.group ?? ''}
                  options={grpOpts}
                  onCommit={(v) => apply((m) => patchCable(m, e.id, { group: v as ElementGroup }))}
                />
                <td className="ed-ro">{numToInput(Number(len(e.n1, e.n2).toFixed(3)))}</td>
                <td className="ed-act">
                  <DelButton
                    title={`Remover o cabo ${e.id}`}
                    onClick={() => {
                      if (apply((m) => removeElement(m, e.id)) && selId === e.id) select(null)
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.length === 0 && <div className="empty">{cables.length ? 'Nenhum cabo corresponde ao filtro.' : 'Este modelo não tem cabos.'}</div>}
      </div>
      <Pager p={p} noun="cabos" />
    </>
  )
}

/* ------------------------------------------------------------------ seções e materiais */

export function SectionsTable({ model }: { model: BridgeModel }) {
  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of model.elements) if (e.kind === 'frame') m.set(e.sec, (m.get(e.sec) ?? 0) + 1)
    return m
  }, [model.elements])
  const num = (id: string, key: 'A' | 'Iy' | 'Iz' | 'J' | 'extraDead' | 'depth' | 'width') => (v: number | string | null) =>
    apply((m) => patchSection(m, id, { [key]: v as number | null }))

  return (
    <>
      <Bar>
        <span className="note">Propriedades em m², m⁴ e kN/m. Iz é a inércia da flexão vertical do tabuleiro.</span>
        <span className="grow" />
        <button className="btn" onClick={() => apply((m) => addSection(m).model)}>
          + Seção
        </button>
      </Bar>
      <div className="ed-scroll">
        <table className="table ed-table">
          <thead>
            <tr>
              <th className="left">Seção</th>
              <th>A (m²)</th>
              <th title="Inércia p/ flexão lateral">Iy (m⁴)</th>
              <th title="Inércia p/ flexão vertical">Iz (m⁴)</th>
              <th>J (m⁴)</th>
              <th title="Carga permanente adicional: pavimento, barreiras, guarda-corpo">g adic. (kN/m)</th>
              <th>Altura (m)</th>
              <th>Largura (m)</th>
              <th>Barras</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.sections.map((s) => (
              <tr key={s.id}>
                <EditCell value={s.name} kind="text" left onCommit={(v) => apply((m) => patchSection(m, s.id, { name: String(v ?? '') }))} />
                <EditCell value={s.A} onCommit={num(s.id, 'A')} />
                <EditCell value={s.Iy} onCommit={num(s.id, 'Iy')} />
                <EditCell value={s.Iz} onCommit={num(s.id, 'Iz')} />
                <EditCell value={s.J} onCommit={num(s.id, 'J')} />
                <EditCell value={s.extraDead} optional placeholder="0" onCommit={num(s.id, 'extraDead')} />
                <EditCell value={s.depth} optional onCommit={num(s.id, 'depth')} />
                <EditCell value={s.width} optional onCommit={num(s.id, 'width')} />
                <td className="ed-ro">{used.get(s.id) ?? 0}</td>
                <td className="ed-act">
                  <button className="ed-del" title="Duplicar seção" aria-label="Duplicar seção" onClick={() => apply((m) => addSection(m, s.id).model)}>
                    ⧉
                  </button>
                  <DelButton title="Remover seção" onClick={() => apply((m) => removeSection(m, s.id))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {model.sections.length === 0 && <div className="empty">Nenhuma seção cadastrada.</div>}
      </div>
    </>
  )
}

export function MaterialsTable({ model }: { model: BridgeModel }) {
  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of model.elements) m.set(e.mat, (m.get(e.mat) ?? 0) + 1)
    return m
  }, [model.elements])
  const kindOpts = MATERIAL_KINDS.map((k) => ({ value: k, label: MATERIAL_KIND_LABEL[k] ?? k }))
  /** tela em MPa; modelo em kPa */
  const mpaCell = (id: string, key: 'E' | 'G' | 'fck' | 'fy' | 'fpk', v: number | undefined, optional: boolean) => (
    <EditCell
      value={v === undefined ? undefined : Number((v / 1000).toPrecision(10))}
      optional={optional}
      onCommit={(x) => apply((m) => patchMaterial(m, id, { [key]: x === null ? null : (x as number) * 1000 }))}
    />
  )

  return (
    <>
      <Bar>
        <span className="note">Módulos e resistências em MPa; γ em kN/m³ (gera peso próprio e massa).</span>
        <span className="grow" />
        <button className="btn" onClick={() => apply((m) => addMaterial(m).model)}>
          + Material
        </button>
      </Bar>
      <div className="ed-scroll">
        <table className="table ed-table">
          <thead>
            <tr>
              <th className="left">Material</th>
              <th className="left">Tipo</th>
              <th>E (MPa)</th>
              <th>G (MPa)</th>
              <th>γ (kN/m³)</th>
              <th>fck (MPa)</th>
              <th>fy (MPa)</th>
              <th>fptk (MPa)</th>
              <th>Elem.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.materials.map((mt) => (
              <tr key={mt.id}>
                <EditCell value={mt.name} kind="text" left onCommit={(v) => apply((m) => patchMaterial(m, mt.id, { name: String(v ?? '') }))} />
                <SelectCell value={mt.kind} options={kindOpts} onCommit={(v) => apply((m) => patchMaterial(m, mt.id, { kind: v as Material['kind'] }))} />
                {mpaCell(mt.id, 'E', mt.E, false)}
                {mpaCell(mt.id, 'G', mt.G, false)}
                <EditCell value={mt.gamma} onCommit={(v) => apply((m) => patchMaterial(m, mt.id, { gamma: v as number }))} />
                {mpaCell(mt.id, 'fck', mt.fck, true)}
                {mpaCell(mt.id, 'fy', mt.fy, true)}
                {mpaCell(mt.id, 'fpk', mt.fpk, true)}
                <td className="ed-ro">{used.get(mt.id) ?? 0}</td>
                <td className="ed-act">
                  <button className="ed-del" title="Duplicar material" aria-label="Duplicar material" onClick={() => apply((m) => addMaterial(m, mt.id).model)}>
                    ⧉
                  </button>
                  <DelButton title="Remover material" onClick={() => apply((m) => removeMaterial(m, mt.id))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {model.materials.length === 0 && <div className="empty">Nenhum material cadastrado.</div>}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ cargas */

function AddRow({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (id: number) => boolean }) {
  const [v, setV] = useState('')
  const go = () => {
    const id = parseNum(v)
    if (!Number.isInteger(id)) {
      useStore.getState().notify(`Informe ${placeholder}.`, 'err')
      return
    }
    if (onAdd(id)) setV('')
  }
  return (
    <div className="ed-add">
      <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <button className="btn" onClick={go}>
        {label}
      </button>
    </div>
  )
}

function GroupLoad({ model, caseId }: { model: BridgeModel; caseId: string }) {
  const groups = useMemo(
    () => [...new Set(model.elements.filter((e) => e.kind === 'frame').map((e) => e.group).filter((g): g is ElementGroup => !!g))],
    [model.elements],
  )
  const [group, setGroup] = useState<string>(groups.includes('deck') ? 'deck' : (groups[0] ?? ''))
  const [wz, setWz] = useState('')
  if (groups.length === 0) return null
  const go = () => {
    const v = parseNum(wz)
    if (!Number.isFinite(v)) {
      useStore.getState().notify('Informe a carga vertical em kN/m (negativa = para baixo).', 'err')
      return
    }
    if (apply((m) => setGroupUniformLoad(m, caseId, group as ElementGroup, [0, 0, v]))) setWz('')
  }
  return (
    <div className="ed-add">
      <select className="select compact" value={group} onChange={(e) => setGroup(e.target.value)}>
        {groups.map((g) => (
          <option key={g} value={g}>
            {groupLabel(g)}
          </option>
        ))}
      </select>
      <input className="input" value={wz} placeholder="wz (kN/m)" onChange={(e) => setWz(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <button className="btn" onClick={go} title="Aplica a carga a todas as barras do grupo (substitui as cargas distribuídas do grupo neste caso)">
        Aplicar ao grupo
      </button>
    </div>
  )
}

export function LoadsPanel({ model }: { model: BridgeModel }) {
  const cases = model.loadCases
  const noSelf = cases.length > 0 && !cases.some((lc) => lc.selfWeight)
  const F = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz']
  const W = ['wx', 'wy', 'wz']

  return (
    <>
      <Bar>
        <span className="note">Todos os casos são somados na carga permanente. Eixos globais; Z para cima (carga para baixo é negativa).</span>
        <span className="grow" />
        <button className="btn" onClick={() => apply((m) => addLoadCase(m).model)}>
          + Caso
        </button>
      </Bar>
      <div className="ed-scroll ed-pad">
        {noSelf && (
          <div className="msg warn">
            Nenhum caso inclui o peso próprio: a análise vai considerar apenas as cargas listadas abaixo. Marque “Peso próprio” em um dos casos
            para incluí-lo.
          </div>
        )}
        {cases.length === 0 && (
          <div className="empty">
            Sem casos cadastrados: a análise usa o peso próprio e a carga adicional das seções. Crie um caso para acrescentar cargas nodais ou
            distribuídas.
          </div>
        )}
        {cases.map((lc) => (
          <div className="ed-case" key={lc.id}>
            <div className="ed-case-head">
              <input
                className="input ed-case-name"
                defaultValue={lc.name}
                key={lc.name}
                spellCheck={false}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim()
                  if (v && v !== lc.name) apply((m) => patchLoadCase(m, lc.id, { name: v }))
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <label className="check" title="Inclui γ·A e a carga adicional das seções">
                <input type="checkbox" checked={!!lc.selfWeight} onChange={(e) => apply((m) => patchLoadCase(m, lc.id, { selfWeight: e.target.checked }))} />
                Peso próprio
              </label>
              <DelButton
                title="Remover caso de carga"
                onClick={() => {
                  const n = (lc.nodal?.length ?? 0) + (lc.uniform?.length ?? 0)
                  if (n > 0 && !confirm(`Remover o caso "${lc.name}" e suas ${n} carga(s)?`)) return
                  apply((m) => removeLoadCase(m, lc.id))
                }}
              />
            </div>

            <div className="ed-case-sub">
              <span>Cargas nodais (kN, kN·m)</span>
              <span className="grow" />
              <AddRow placeholder="nó" label="+ Carga nodal" onAdd={(id) => apply((m) => addNodalLoad(m, lc.id, id))} />
            </div>
            {(lc.nodal?.length ?? 0) > 0 && (
              <table className="table ed-table">
                <thead>
                  <tr>
                    <th className="left">Nó</th>
                    {F.map((f) => (
                      <th key={f}>{f}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(lc.nodal ?? []).map((nl, i) => (
                    <tr key={i}>
                      <EditCell value={nl.node} kind="int" left onCommit={(v) => apply((m) => patchNodalLoad(m, lc.id, i, { node: v as number }))} />
                      {F.map((f, d) => (
                        <EditCell key={f} value={nl.F[d]} onCommit={(v) => apply((m) => patchNodalLoad(m, lc.id, i, { dof: d, value: v as number }))} />
                      ))}
                      <td className="ed-act">
                        <DelButton title="Remover carga" onClick={() => apply((m) => removeNodalLoad(m, lc.id, i))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="ed-case-sub">
              <span>Cargas distribuídas em barras (kN/m)</span>
              <span className="grow" />
              <AddRow placeholder="barra" label="+ Carga distribuída" onAdd={(id) => apply((m) => addUniformLoad(m, lc.id, id))} />
            </div>
            <GroupLoad model={model} caseId={lc.id} />
            {(lc.uniform?.length ?? 0) > 0 && <UniformRows model={model} caseId={lc.id} W={W} />}
          </div>
        ))}
      </div>
    </>
  )
}

function UniformRows({ model, caseId, W }: { model: BridgeModel; caseId: string; W: string[] }) {
  const lc = model.loadCases.find((c) => c.id === caseId)
  const rows = lc?.uniform ?? []
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? rows : rows.slice(0, 40)
  return (
    <>
      <table className="table ed-table">
        <thead>
          <tr>
            <th className="left">Barra</th>
            {W.map((w) => (
              <th key={w}>{w}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((ul, i) => (
            <tr key={i}>
              <EditCell value={ul.element} kind="int" left onCommit={(v) => apply((m) => patchUniformLoad(m, caseId, i, { element: v as number }))} />
              {W.map((w, a) => (
                <EditCell key={w} value={ul.w[a]} onCommit={(v) => apply((m) => patchUniformLoad(m, caseId, i, { axis: a, value: v as number }))} />
              ))}
              <td className="ed-act">
                <DelButton title="Remover carga" onClick={() => apply((m) => removeUniformLoad(m, caseId, i))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <button className="btn btn-ghost" style={{ margin: '6px 0' }} onClick={() => setShowAll(true)}>
          Mostrar as {rows.length} cargas
        </button>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ aba */

const SUBS: { key: Sub; label: string }[] = [
  { key: 'nodes', label: 'Nós' },
  { key: 'frames', label: 'Barras' },
  { key: 'cables', label: 'Cabos' },
  { key: 'sections', label: 'Seções' },
  { key: 'materials', label: 'Materiais' },
  { key: 'loads', label: 'Cargas' },
]

export function DataTab({ model }: { model: BridgeModel }) {
  const selection = useStore((s) => s.selection)
  const errors = useStore((s) => s.modelErrors)
  const [sub, setSub] = useState<Sub>('nodes')

  // a seleção no 3D leva à tabela correspondente (só entre nós/barras/cabos)
  useEffect(() => {
    if (!selection) return
    setSub((cur) => {
      if (cur !== 'nodes' && cur !== 'frames' && cur !== 'cables') return cur
      if (selection.kind === 'node') return 'nodes'
      const el = model.elements.find((e) => e.id === selection.id)
      return el ? (el.kind === 'cable' ? 'cables' : 'frames') : cur
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  const count: Record<Sub, number> = {
    nodes: model.nodes.length,
    frames: model.elements.reduce((a, e) => a + (e.kind === 'frame' ? 1 : 0), 0),
    cables: model.elements.reduce((a, e) => a + (e.kind === 'cable' ? 1 : 0), 0),
    sections: model.sections.length,
    materials: model.materials.length,
    loads: model.loadCases.length,
  }

  return (
    <div className="ed-wrap">
      <div className="ed-subs">
        {SUBS.map((s) => (
          <button key={s.key} className={`ed-sub ${sub === s.key ? 'active' : ''}`} onClick={() => setSub(s.key)}>
            {s.label}
            <span className="count">{count[s.key]}</span>
          </button>
        ))}
      </div>
      {errors.length > 0 && (
        <div className="ed-errors" title={errors.join('\n')}>
          {errors.length === 1 ? errors[0] : `${errors.length} erros de validação — o primeiro: ${errors[0]}`}
        </div>
      )}
      {sub === 'nodes' && <NodesTable model={model} />}
      {sub === 'frames' && <FramesTable model={model} />}
      {sub === 'cables' && <CablesTable model={model} />}
      {sub === 'sections' && <SectionsTable model={model} />}
      {sub === 'materials' && <MaterialsTable model={model} />}
      {sub === 'loads' && <LoadsPanel model={model} />}
    </div>
  )
}
