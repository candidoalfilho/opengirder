import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultBox,
  generateModel,
  sectionProperties,
  validateGeometry,
  validateModel,
  type BridgeModel,
  type TemplateParams,
} from '@opengirder/engine'
import { useStore, type ViewState } from '../store'
import { fmtInt, numToInput, parseNum } from '../format'
import { IconBack, LogoMark } from '../ui/icons'
import { Viewer } from '../viewer/Viewer'
import { getPath, setPath, WIZARD_FIELDS, WIZARD_TITLE, type Field } from './wizardFields'

const PREVIEW_VIEW: ViewState = {
  mode: 'model',
  diagram: 'Mz',
  cableBy: 'T',
  scaleMul: 1,
  modeIndex: 0,
  showNodes: false,
  hidden: [],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = any

/** mantém os campos opcionais coerentes com as escolhas do formulário */
function normalize(t: TemplateParams): TemplateParams {
  if (t.kind !== 'cable-stayed') return t
  const p = { ...t.params }
  if (p.towerShape === 'X') {
    if (!p.xLegs) p.xLegs = { base: 19, top: 10 }
  } else {
    delete p.xLegs
  }
  return { kind: 'cable-stayed', params: p }
}

function NumberInput({
  value,
  onChange,
  integer,
  onValidity,
}: {
  value: number | undefined
  onChange: (v: number) => void
  integer?: boolean
  onValidity: (ok: boolean) => void
}) {
  const [text, setText] = useState(numToInput(value))
  const [focused, setFocused] = useState(false)
  const [bad, setBad] = useState(false)

  useEffect(() => {
    if (!focused) {
      setText(numToInput(value))
      setBad(false)
    }
  }, [value, focused])

  return (
    <input
      className={`input ${bad ? 'invalid' : ''}`}
      inputMode="decimal"
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const s = e.target.value
        setText(s)
        const v = parseNum(s)
        const ok = Number.isFinite(v) && (!integer || Number.isInteger(v))
        setBad(!ok)
        onValidity(ok)
        if (ok) onChange(v)
      }}
    />
  )
}

function ListInput({
  value,
  onChange,
  onValidity,
  allowEmpty,
}: {
  value: number[] | undefined
  onChange: (v: number[]) => void
  onValidity: (ok: boolean) => void
  allowEmpty?: boolean
}) {
  const toText = (v: number[] | undefined) => (v ?? []).map((x) => numToInput(x)).join('; ')
  const [text, setText] = useState(toText(value))
  const [focused, setFocused] = useState(false)
  const [bad, setBad] = useState(false)

  useEffect(() => {
    if (!focused) {
      setText(toText(value))
      setBad(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused])

  return (
    <input
      className={`input ${bad ? 'invalid' : ''}`}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const s = e.target.value
        setText(s)
        // separador de lista: ";" (ou espaço); vírgula é decimal
        const parts = s
          .split(/[;\s]+/)
          .map((x) => x.trim())
          .filter(Boolean)
        const nums = parts.map(parseNum)
        const ok = (allowEmpty || nums.length > 0) && nums.every((v) => Number.isFinite(v) && v > 0)
        setBad(!ok)
        onValidity(ok)
        if (ok) onChange(nums)
      }}
    />
  )
}

/** com a seção definida por geometria, A, Iz, Iy, J e altura do tabuleiro espelham o que ela dá */
function mirrorGeometry(p: Params): Params {
  const g = p?.deck?.geometry
  if (!g || validateGeometry(g).length > 0) return p
  const q = sectionProperties(g)
  return { ...p, deck: { ...p.deck, A: q.A, Iz: q.Iz, Iy: q.Iy, J: q.J, depth: q.depth } }
}

function FieldView({
  field,
  params,
  set,
  onValidity,
}: {
  field: Field
  params: Params
  set: (key: string, value: unknown) => void
  onValidity: (key: string, ok: boolean) => void
}) {
  const kind = field.kind ?? 'number'
  const raw =
    field.key === '__twin'
      ? !!params.twin
      : field.key === '__boxGeometry'
        ? !!getPath(params, 'deck.geometry')
        : getPath(params, field.key)
  const cls = `field ${field.wide ? 'wide' : ''}`

  if (kind === 'bool') {
    return (
      <div className={cls}>
        <label className="check">
          <input type="checkbox" checked={!!raw} onChange={(e) => set(field.key, e.target.checked)} />
          {field.label}
        </label>
        {field.hint && <div className="hint">{field.hint}</div>}
      </div>
    )
  }

  let control
  if (kind === 'text') {
    control = <input className="input" style={{ fontFamily: 'var(--sans)' }} value={String(raw ?? '')} onChange={(e) => set(field.key, e.target.value)} />
  } else if (kind === 'select') {
    const opts = field.options ?? []
    const current = raw === undefined ? opts[0]?.value : raw
    control = (
      <select
        className="select"
        value={String(current)}
        onChange={(e) => {
          const o = opts.find((x) => String(x.value) === e.target.value)
          if (o) set(field.key, o.value)
        }}
      >
        {opts.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    )
  } else if (kind === 'list') {
    control = (
      <ListInput
        value={raw as number[] | undefined}
        onChange={(v) => set(field.key, v)}
        onValidity={(ok) => onValidity(field.key, ok)}
        allowEmpty={field.allowEmpty}
      />
    )
  } else {
    const scale = field.scale ?? 1
    const shown = typeof raw === 'number' ? Number((raw * scale).toPrecision(10)) : undefined
    control = (
      <NumberInput
        value={shown}
        integer={kind === 'int'}
        onChange={(v) => set(field.key, v / scale)}
        onValidity={(ok) => onValidity(field.key, ok)}
      />
    )
  }

  return (
    <div className={cls}>
      <label className="label">
        <span>{field.label}</span>
        {field.unit && <span className="unit">{field.unit}</span>}
      </label>
      {control}
      {field.hint && <div className="hint">{field.hint}</div>}
    </div>
  )
}

interface Preview {
  model: BridgeModel | null
  errors: string[]
  fitKey: string
}

export function Wizard() {
  const initial = useStore((s) => s.wizard)
  const closeWizard = useStore((s) => s.closeWizard)
  const applyWizard = useStore((s) => s.applyWizard)
  const notify = useStore((s) => s.notify)
  const theme = useStore((s) => s.theme)
  const editing = useStore((s) => !!s.model)

  const [t, setT] = useState<TemplateParams | null>(initial ? normalize(initial) : null)
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<Preview>({ model: null, errors: [], fitKey: '0' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!t) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try {
        const model = generateModel(t)
        let errors: string[] = []
        try {
          errors = validateModel(model)
        } catch (err) {
          errors = [err instanceof Error ? err.message : String(err)]
        }
        let min = [Infinity, Infinity, Infinity]
        let max = [-Infinity, -Infinity, -Infinity]
        for (const n of model.nodes) {
          min = [Math.min(min[0], n.x), Math.min(min[1], n.y), Math.min(min[2], n.z)]
          max = [Math.max(max[0], n.x), Math.max(max[1], n.y), Math.max(max[2], n.z)]
        }
        const fitKey = `${t.kind}:${[0, 1, 2].map((i) => Math.round((max[i] - min[i]) / 5)).join('x')}`
        setPreview({ model, errors, fitKey })
      } catch (err) {
        setPreview((p) => ({ ...p, model: null, errors: [err instanceof Error ? err.message : String(err)] }))
      }
    }, 220)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [t])

  const stats = useMemo(() => {
    const m = preview.model
    if (!m) return null
    let frames = 0
    let cables = 0
    for (const e of m.elements) e.kind === 'cable' ? cables++ : frames++
    return { nodes: m.nodes.length, frames, cables }
  }, [preview.model])

  if (!t) return null
  const groups = WIZARD_FIELDS[t.kind]
  const params = t.params as Params

  const set = (key: string, value: unknown) => {
    setT((prev) => {
      if (!prev) return prev
      if (key === '__twin') {
        const p = { ...(prev.params as Params) }
        if (value) p.twin = { level2: (Number(p.deckLevel) || 12) + 12 }
        else delete p.twin
        return normalize({ kind: prev.kind, params: p } as TemplateParams)
      }
      if (key === '__boxGeometry') {
        // liga/desliga a seção por geometria; ligada, A/I/J/altura passam a espelhar o caixão
        const p = prev.params as Params
        const geometry = value ? defaultBox(Number(p.deckWidth) || 12, Number(getPath(p, 'deck.depth')) || 2) : undefined
        return normalize({ kind: prev.kind, params: mirrorGeometry(setPath(p, 'deck.geometry', geometry)) } as TemplateParams)
      }
      const next = setPath(prev.params, key, value)
      return normalize({
        kind: prev.kind,
        params: key.startsWith('deck.geometry.') ? mirrorGeometry(next as Params) : next,
      } as TemplateParams)
    })
  }

  const onValidity = (key: string, ok: boolean) =>
    setInvalid((prev) => (!!prev[key] === !ok ? prev : { ...prev, [key]: !ok }))

  const hasInvalid = Object.values(invalid).some(Boolean)
  const canGenerate = !hasInvalid && !!preview.model

  const onGenerate = () => {
    try {
      applyWizard(t)
    } catch (err) {
      notify(`Não foi possível gerar o modelo: ${err instanceof Error ? err.message : String(err)}`, 'err')
    }
  }

  return (
    <div className="wizard">
      <div className="topbar">
        <button className="btn btn-ghost" onClick={closeWizard}>
          <IconBack size={14} />
          Voltar
        </button>
        <div className="sep" />
        <div className="logo">
          <LogoMark size={18} />
          <span>
            Open<b>Girder</b>
          </span>
        </div>
        <span className="dim">Assistente — {WIZARD_TITLE[t.kind]}</span>
        <div className="spacer" />
        <button className="btn" onClick={closeWizard}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={!canGenerate} onClick={onGenerate}>
          {editing ? 'Regenerar modelo' : 'Gerar modelo'}
        </button>
      </div>
      <div className="wizard-main">
        <div className="wizard-form">
          <h2>{WIZARD_TITLE[t.kind]}</h2>
          <div className="note">
            Preencha os parâmetros; a prévia ao lado é atualizada a cada mudança. Unidades: m, kN, MPa.
            {editing ? ' Regenerar substitui o modelo aberto e descarta os resultados.' : ''}
          </div>
          {groups.map((g) => {
            const fields = g.fields.filter((f) => !f.show || f.show(params))
            if (fields.length === 0) return null
            return (
              <div className="wizard-group" key={g.title}>
                <div className="panel-title">{g.title}</div>
                <div className="field-grid">
                  {fields.map((f) => (
                    <FieldView key={f.key} field={f} params={params} set={set} onValidity={onValidity} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="wizard-preview">
          {preview.model && (
            <Viewer
              model={preview.model}
              results={null}
              view={PREVIEW_VIEW}
              selection={null}
              fitKey={preview.fitKey}
              theme={theme}
              showLegend={false}
            />
          )}
          <div className="badge-row">
            <span className="chip accent">Prévia</span>
            {stats && (
              <>
                <span className="chip">{fmtInt(stats.nodes)} nós</span>
                <span className="chip">{fmtInt(stats.frames)} barras</span>
                {stats.cables > 0 && <span className="chip">{fmtInt(stats.cables)} cabos</span>}
              </>
            )}
          </div>
          {(preview.errors.length > 0 || hasInvalid) && (
            <div className="errors">
              {hasInvalid && <div className="msg warn">Há campos com valor inválido (em vermelho).</div>}
              {preview.errors.slice(0, 6).map((e, i) => (
                <div className="msg err" key={i}>
                  {e}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
