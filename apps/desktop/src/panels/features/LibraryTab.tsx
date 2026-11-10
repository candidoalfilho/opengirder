import { useMemo, useState } from 'react'
import type { BridgeModel, BridgeResults, Section } from '@opengirder/engine'
import { useStore } from '../../store'
import { fmt, fmtAuto } from '../../format'
import {
  LIBRARY_MATERIALS,
  LIBRARY_SECTIONS,
  addLibraryMaterial,
  addLibrarySection,
  addSectionToModel,
  hollowRectSection,
  sectionFromGeometry,
  tubeSection,
  type LibraryMaterial,
  type LibrarySection,
} from '../../editor/library'
import { NumField } from './libFields'

type Sub = 'materials' | 'sections' | 'calc'
type CalcKind = 'hollow' | 'solid' | 'tube' | 'circle'

function groups<T extends { group: string }>(items: T[]): [string, T[]][] {
  const out = new Map<string, T[]>()
  for (const it of items) out.set(it.group, [...(out.get(it.group) ?? []), it])
  return [...out.entries()]
}

function Calculator({ model }: { model: BridgeModel }) {
  const updateModel = useStore((s) => s.updateModel)
  const notify = useStore((s) => s.notify)
  const [kind, setKind] = useState<CalcKind>('hollow')
  const [b, setB] = useState(4)
  const [h, setH] = useState(6)
  const [t, setT] = useState(0.5)
  const [d, setD] = useState(1.2)
  const [tw, setTw] = useState(0.025)

  const sec = useMemo<Section | string>(() => {
    try {
      if (kind === 'hollow') {
        if (!(2 * t < Math.min(b, h))) return 'A parede precisa ser menor que metade do menor lado.'
        return hollowRectSection(b, h, t, 'vazada')
      }
      if (kind === 'solid') return sectionFromGeometry('retangular', `Retangular maciça ${fmt(b, 2)} × ${fmt(h, 2)} m`, { kind: 'solid-rect', width: b, depth: h })
      if (kind === 'tube') {
        if (!(2 * tw < d)) return 'A parede precisa ser menor que o raio.'
        return tubeSection(d, tw, 'tubo')
      }
      return tubeSection(d, 0, 'circular')
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, [kind, b, h, t, d, tw])

  const add = () => {
    if (typeof sec === 'string') return
    const r = addSectionToModel(model, sec)
    if (!r.added) {
      notify('O modelo já tem uma seção com essas propriedades.')
      return
    }
    updateModel(() => r.model)
    notify(`Seção "${sec.name}" adicionada`)
  }

  const rect = kind === 'hollow' || kind === 'solid'
  return (
    <div>
      <div className="field">
        <label className="label">Forma</label>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as CalcKind)}>
          <option value="hollow">Retângulo vazado (torre, pilar, caixão de aço)</option>
          <option value="solid">Retângulo maciço</option>
          <option value="tube">Tubo circular</option>
          <option value="circle">Círculo maciço</option>
        </select>
      </div>
      <div className="lib-grid">
        {rect ? (
          <>
            <NumField label="Largura b (transversal)" unit="m" value={b} min={0.05} max={60} live onCommit={setB} />
            <NumField label="Altura h (plano de flexão)" unit="m" value={h} min={0.05} max={60} live onCommit={setH} />
            {kind === 'hollow' && <NumField label="Parede t" unit="m" value={t} min={0.005} max={10} live onCommit={setT} />}
          </>
        ) : (
          <>
            <NumField label="Diâmetro externo" unit="m" value={d} min={0.05} max={30} live onCommit={setD} />
            {kind === 'tube' && <NumField label="Parede" unit="m" value={tw} min={0.003} max={10} live onCommit={setTw} />}
          </>
        )}
      </div>
      {typeof sec === 'string' ? (
        <div className="msg warn">{sec}</div>
      ) : (
        <dl className="kv lib-props">
          <dt>Área A</dt>
          <dd>{fmtAuto(sec.A)} m²</dd>
          <dt>Inércia Iz (flexão no plano da altura h)</dt>
          <dd>{fmtAuto(sec.Iz)} m⁴</dd>
          <dt>Inércia Iy (flexão lateral)</dt>
          <dd>{fmtAuto(sec.Iy)} m⁴</dd>
          <dt>Torção J</dt>
          <dd>{fmtAuto(sec.J)} m⁴</dd>
        </dl>
      )}
      <button className="btn btn-primary" disabled={typeof sec === 'string'} onClick={add}>
        Adicionar ao modelo
      </button>
      <p className="note lib-note">
        No tabuleiro, h é a altura da seção (flexão vertical). Em torres e pilares, h fica na direção longitudinal da ponte e b na
        transversal. As propriedades saem da geometria (torção de Bredt na seção vazada).
      </p>
    </div>
  )
}

export function LibraryTab({ model }: { model: BridgeModel; results: BridgeResults | null }) {
  const updateModel = useStore((s) => s.updateModel)
  const notify = useStore((s) => s.notify)
  const [sub, setSub] = useState<Sub>('materials')

  const hasMaterial = (it: LibraryMaterial): boolean => !addLibraryMaterial(model, it).added
  const hasSection = (it: LibrarySection): boolean => !addLibrarySection(model, it).added

  const addMat = (it: LibraryMaterial) => {
    const r = addLibraryMaterial(model, it)
    if (!r.added) return
    updateModel(() => r.model)
    notify(`${it.label} adicionado ao modelo`)
  }
  const addSec = (it: LibrarySection) => {
    const r = addLibrarySection(model, it)
    if (!r.added) return
    updateModel(() => r.model)
    notify(`${it.label} adicionada ao modelo`)
  }

  return (
    <div>
      <div className="panel-title">
        Biblioteca
        <span className="grow" />
        <span className="chip">{model.materials.length} materiais · {model.sections.length} seções no modelo</span>
      </div>
      <div className="lib-subs">
        {(
          [
            ['materials', 'Materiais'],
            ['sections', 'Seções'],
            ['calc', 'Calculadora de seção'],
          ] as [Sub, string][]
        ).map(([k, label]) => (
          <button key={k} className={sub === k ? 'active' : ''} onClick={() => setSub(k)}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'materials' &&
        groups(LIBRARY_MATERIALS).map(([g, items]) => (
          <div key={g} className="lib-group">
            <div className="lib-group-title">{g}</div>
            {items.map((it) => {
              const has = hasMaterial(it)
              return (
                <div className="lib-row" key={it.key}>
                  <div className="lib-info">
                    <div className="lib-label">{it.label}</div>
                    <div className="lib-detail">{it.detail}</div>
                  </div>
                  {has ? <span className="chip ok">no modelo</span> : <button className="btn" onClick={() => addMat(it)}>Adicionar</button>}
                </div>
              )
            })}
          </div>
        ))}

      {sub === 'sections' &&
        groups(LIBRARY_SECTIONS).map(([g, items]) => (
          <div key={g} className="lib-group">
            <div className="lib-group-title">{g}</div>
            {items.map((it) => {
              const has = hasSection(it)
              return (
                <div className="lib-row" key={it.key}>
                  <div className="lib-info">
                    <div className="lib-label">{it.label}</div>
                    <div className="lib-detail">{it.detail}</div>
                  </div>
                  {has ? <span className="chip ok">no modelo</span> : <button className="btn" onClick={() => addSec(it)}>Adicionar</button>}
                </div>
              )
            })}
          </div>
        ))}

      {sub === 'calc' && <Calculator model={model} />}

      {sub !== 'calc' && (
        <p className="note lib-note">
          {sub === 'materials'
            ? 'Concreto: módulo secante Ecs da NBR 6118:2023 (agregado granítico). Aços: E = 200 GPa. Cabos: o peso específico inclui bainha e proteção. Depois de adicionar, os valores podem ser editados na aba Dados.'
            : 'Geometrias típicas, com propriedades calculadas da geometria. As seções de tabuleiro já trazem uma carga permanente adicional (pavimento e barreiras) e podem ser ajustadas na aba Seções.'}
        </p>
      )}
    </div>
  )
}
