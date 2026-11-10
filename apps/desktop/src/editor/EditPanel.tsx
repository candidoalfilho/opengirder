/**
 * Propriedades da seleção do editor (no lugar do Inspector enquanto o modo de edição está
 * ligado): coordenadas, apoios e molas dos nós; seção, material e grupo das barras; material,
 * área, cordoalhas, pré-tração e L0 dos cabos. Tudo em lote quando há vários itens.
 */

import { useEffect, useState } from 'react'
import type { BridgeModel, BridgeNode, CableElement, ElementGroup, FrameElement, Vec3 } from '@opengirder/engine'
import { useStore } from '../store'
import { fmt, GROUP_LABEL, numToInput, parseNum } from '../format'
import { IconClose } from '../ui/icons'
import { patchCable, patchFrame, patchNode } from '../panels/features/dataEdit'
import { selectionNodes, setNodesFix, translateNodes } from './draw'
import { deleteSelected } from './session'

const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz']
const FRAME_GROUPS: ElementGroup[] = ['deck', 'tower', 'pier', 'arch', 'crossbeam', 'rigid']
const CABLE_GROUPS: ElementGroup[] = ['stay', 'hanger', 'main-cable']
const groupLabel = (g: string): string => GROUP_LABEL[g] ?? g

const SUPPORT_PRESETS: { label: string; fix: boolean[]; tip: string }[] = [
  { label: 'Livre', fix: [false, false, false, false, false, false], tip: 'Sem restrição' },
  { label: 'Apoio fixo', fix: [true, true, true, false, false, false], tip: 'ux, uy e uz impedidos' },
  { label: 'Móvel em X', fix: [false, true, true, false, false, false], tip: 'uy e uz impedidos; livre ao longo da ponte' },
  { label: 'Engaste', fix: [true, true, true, true, true, true], tip: 'Os 6 graus de liberdade impedidos' },
]

/** aplica uma edição que pode falhar (string = motivo) */
function apply(fn: (m: BridgeModel) => BridgeModel | string): void {
  const st = useStore.getState()
  const cur = st.model
  if (!cur) return
  const r = fn(cur)
  if (typeof r === 'string') {
    st.notify(r, 'err')
    return
  }
  if (r === cur) return
  const keep = st.edit.sel
  st.updateModel(() => r)
  useStore.getState().setEdit({ sel: keep })
}

/** valor comum a todos os itens, ou undefined se diferem */
function common<T, V>(items: T[], get: (t: T) => V): V | undefined {
  if (items.length === 0) return undefined
  const v = get(items[0])
  return items.every((x) => get(x) === v) ? v : undefined
}

function NumInput({
  label, unit, value, onCommit, allowEmpty, hint,
}: {
  label: string
  unit?: string
  /** undefined = valores diferentes (ou vazio) */
  value: number | undefined
  onCommit: (v: number | null) => void
  allowEmpty?: boolean
  hint?: string
}) {
  const shown = value === undefined ? '' : numToInput(value)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const commit = () => {
    if (text.trim() === shown.trim()) return
    if (text.trim() === '') {
      if (allowEmpty) onCommit(null)
      else setText(shown)
      return
    }
    const v = parseNum(text)
    if (Number.isFinite(v)) onCommit(v)
    else setText(shown)
  }
  return (
    <div className="field">
      <label className="label">
        {label}
        {unit && <span className="unit">{unit}</span>}
      </label>
      <input
        className="input"
        value={text}
        placeholder={value === undefined ? (allowEmpty ? 'automático' : 'vários') : undefined}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(shown)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function Pick({
  label, value, options, onChange,
}: {
  label: string
  value: string | undefined
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      <select className="select" value={value ?? ''} onChange={(e) => e.target.value !== '' && onChange(e.target.value)}>
        {value === undefined && <option value="">— vários —</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ------------------------------------------------------------------ nós */

function NodesEditor({ model, nodes }: { model: BridgeModel; nodes: BridgeNode[] }) {
  const ids = nodes.map((n) => n.id)
  const single = nodes.length === 1 ? nodes[0] : null
  const [delta, setDelta] = useState<[string, string, string]>(['0', '0', '0'])
  const fixAll = DOF.map((_, d) => nodes.every((n) => !!n.fix?.[d]))
  const fixSome = DOF.map((_, d) => nodes.some((n) => !!n.fix?.[d]))
  const setFix = (d: number, on: boolean) => {
    const next = [...fixAll]
    next[d] = on
    apply((m) => setNodesFix(m, ids, next))
  }
  const springs = single?.springs ?? [0, 0, 0, 0, 0, 0]
  const setSpring = (d: number, k: number) =>
    apply((m) => ({
      ...m,
      nodes: m.nodes.map((n) => {
        if (n.id !== single!.id) return n
        const s = [...(n.springs ?? [0, 0, 0, 0, 0, 0])] as NonNullable<BridgeNode['springs']>
        s[d] = Math.max(0, k)
        const { springs: _s, ...rest } = n
        return s.some((x) => x > 0) ? { ...rest, springs: s } : rest
      }),
    }))
  const move = () => {
    const d = delta.map((t) => parseNum(t)) as Vec3
    if (!d.every(Number.isFinite)) {
      useStore.getState().notify('Deslocamento inválido.', 'err')
      return
    }
    apply((m) => translateNodes(m, ids, d))
    setDelta(['0', '0', '0'])
  }
  void model

  return (
    <>
      {single && (
        <div className="edt-grid3">
          {(['x', 'y', 'z'] as const).map((k) => (
            <NumInput key={k} label={k} unit="m" value={single[k]} onCommit={(v) => v !== null && apply((m) => patchNode(m, single.id, { [k]: v }))} />
          ))}
        </div>
      )}

      <div className="edt-sub">Apoio</div>
      <div className="edt-presets">
        {SUPPORT_PRESETS.map((p) => {
          const on = p.fix.every((f, d) => f === fixAll[d]) && p.fix.every((f, d) => f === fixSome[d])
          return (
            <button key={p.label} className={`btn ${on ? 'edt-on' : ''}`} title={p.tip} onClick={() => apply((m) => setNodesFix(m, ids, p.fix))}>
              {p.label}
            </button>
          )
        })}
      </div>
      <div className="edt-dofs">
        {DOF.map((name, d) => (
          <label key={name} className="check" title={fixSome[d] && !fixAll[d] ? 'Só parte dos nós selecionados' : undefined}>
            <input
              type="checkbox"
              checked={fixAll[d]}
              ref={(el) => {
                if (el) el.indeterminate = fixSome[d] && !fixAll[d]
              }}
              onChange={(e) => setFix(d, e.target.checked)}
            />
            {name}
          </label>
        ))}
      </div>

      {single && (
        <details className="edt-details">
          <summary>Molas de apoio</summary>
          <div className="edt-grid3">
            {DOF.map((name, d) => (
              <NumInput key={name} label={`k ${name}`} unit={d < 3 ? 'kN/m' : 'kN·m/rad'} value={springs[d]} onCommit={(v) => setSpring(d, v ?? 0)} />
            ))}
          </div>
        </details>
      )}

      <div className="edt-sub">Deslocar {nodes.length > 1 ? `${nodes.length} nós` : 'o nó'}</div>
      <div className="edt-move">
        {(['Δx', 'Δy', 'Δz'] as const).map((k, i) => (
          <div className="field" key={k}>
            <label className="label">
              {k}
              <span className="unit">m</span>
            </label>
            <input
              className="input"
              value={delta[i]}
              inputMode="decimal"
              onChange={(e) => setDelta((cur) => cur.map((x, j) => (j === i ? e.target.value : x)) as [string, string, string])}
              onKeyDown={(e) => e.key === 'Enter' && move()}
            />
          </div>
        ))}
        <button className="btn" onClick={move}>
          Deslocar
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ barras */

function FramesEditor({ model, frames }: { model: BridgeModel; frames: FrameElement[] }) {
  const ids = frames.map((f) => f.id)
  const batch = (patch: Partial<Pick<FrameElement, 'mat' | 'sec' | 'group'>>) =>
    apply((m) => {
      let cur: BridgeModel = m
      for (const id of ids) {
        const r = patchFrame(cur, id, patch)
        if (typeof r === 'string') return r
        cur = r
      }
      return cur
    })
  let L = 0
  const pos = new Map(model.nodes.map((n) => [n.id, n]))
  for (const f of frames) {
    const a = pos.get(f.n1)
    const b = pos.get(f.n2)
    if (a && b) L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  }
  return (
    <>
      <div className="field-grid">
        <Pick label="Seção" value={common(frames, (f) => f.sec)} options={model.sections.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => batch({ sec: v })} />
        <Pick
          label="Material"
          value={common(frames, (f) => f.mat)}
          options={model.materials.filter((m) => m.kind !== 'cable').map((m) => ({ value: m.id, label: m.name }))}
          onChange={(v) => batch({ mat: v })}
        />
        <Pick
          label="Grupo"
          value={common(frames, (f) => f.group ?? 'deck')}
          options={FRAME_GROUPS.map((g) => ({ value: g, label: groupLabel(g) }))}
          onChange={(v) => batch({ group: v as ElementGroup })}
        />
        <div className="field">
          <label className="label">{frames.length > 1 ? 'Comprimento total' : 'Comprimento'}</label>
          <div className="edt-ro">{fmt(L, 3)} m</div>
        </div>
      </div>
      {frames.length === 1 && (
        <div className="note" style={{ marginTop: 6 }}>
          Nós {frames[0].n1} → {frames[0].n2}
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ cabos */

function CablesEditor({ model, cables }: { model: BridgeModel; cables: CableElement[] }) {
  const ids = cables.map((c) => c.id)
  type Patch = Parameters<typeof patchCable>[2]
  const batch = (patch: Patch) =>
    apply((m) => {
      let cur: BridgeModel = m
      for (const id of ids) {
        const r = patchCable(cur, id, patch)
        if (typeof r === 'string') return r
        cur = r
      }
      return cur
    })
  const A = common(cables, (c) => c.A)
  const hasL0 = cables.some((c) => c.L0 !== undefined)
  return (
    <>
      <div className="field-grid">
        <Pick
          label="Material"
          value={common(cables, (c) => c.mat)}
          options={model.materials.filter((m) => m.kind === 'cable').map((m) => ({ value: m.id, label: m.name }))}
          onChange={(v) => batch({ mat: v })}
        />
        <Pick
          label="Grupo"
          value={common(cables, (c) => c.group ?? 'stay')}
          options={CABLE_GROUPS.map((g) => ({ value: g, label: groupLabel(g) }))}
          onChange={(v) => batch({ group: v as ElementGroup })}
        />
        <NumInput
          label="Cordoalhas"
          value={common(cables, (c) => c.strands)}
          allowEmpty
          hint="× 150 mm² preenche a área"
          onCommit={(v) => batch(v === null ? { strands: null } : { strands: Math.round(v), A: Math.round(v) * 150e-6 })}
        />
        <NumInput label="Área de aço" unit="mm²" value={A === undefined ? undefined : Math.round(A * 1e8) / 100} onCommit={(v) => v !== null && batch({ A: v * 1e-6 })} />
        <NumInput
          label="Pré-tração inicial"
          unit="kN"
          value={common(cables, (c) => c.pretension)}
          allowEmpty
          hint="Ponto de partida do form-finding"
          onCommit={(v) => batch({ pretension: v })}
        />
        <NumInput
          label="L0 indeformado"
          unit="m"
          value={common(cables, (c) => c.L0)}
          allowEmpty
          hint="Vazio: o form-finding calcula"
          onCommit={(v) => batch({ L0: v })}
        />
      </div>
      {hasL0 && (
        <button className="btn" style={{ marginTop: 8 }} onClick={() => batch({ L0: null })}>
          Limpar L0 (recalcular no form-finding)
        </button>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ painel */

export function EditPanel() {
  const model = useStore((s) => s.model)
  const sel = useStore((s) => s.edit.sel)
  const setEditSel = useStore((s) => s.setEditSel)
  if (!model) return null
  const nodeSet = new Set(sel.nodes)
  const elSet = new Set(sel.elements)
  const nodes = model.nodes.filter((n) => nodeSet.has(n.id))
  const frames = model.elements.filter((e): e is FrameElement => e.kind === 'frame' && elSet.has(e.id))
  const cables = model.elements.filter((e): e is CableElement => e.kind === 'cable' && elSet.has(e.id))
  if (nodes.length + frames.length + cables.length === 0) return null

  const parts: string[] = []
  if (nodes.length) parts.push(nodes.length === 1 ? `Nó ${nodes[0].id}` : `${nodes.length} nós`)
  if (frames.length) parts.push(frames.length === 1 ? `Barra ${frames[0].id}` : `${frames.length} barras`)
  if (cables.length) parts.push(cables.length === 1 ? `Cabo ${cables[0].id}` : `${cables.length} cabos`)

  return (
    <div className="edt-panel">
      <div className="panel-title">
        {parts.join(' · ')}
        <span className="grow" />
        <button className="btn-icon" style={{ width: 22, height: 22 }} onClick={() => setEditSel({ nodes: [], elements: [] })} title="Limpar a seleção (Esc)">
          <IconClose size={13} />
        </button>
      </div>
      {nodes.length > 0 && <NodesEditor model={model} nodes={nodes} />}
      {frames.length > 0 && (
        <>
          {nodes.length > 0 && <div className="edt-sub">{frames.length === 1 ? 'Barra' : 'Barras'}</div>}
          <FramesEditor model={model} frames={frames} />
        </>
      )}
      {cables.length > 0 && (
        <>
          {nodes.length + frames.length > 0 && <div className="edt-sub">{cables.length === 1 ? 'Cabo' : 'Cabos'}</div>}
          <CablesEditor model={model} cables={cables} />
        </>
      )}
      <div className="edt-panel-foot">
        <span className="note">{selectionNodes(model, sel).length} nó(s) envolvidos</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={deleteSelected} title="Delete">
          Apagar seleção
        </button>
      </div>
    </div>
  )
}
