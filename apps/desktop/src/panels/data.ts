/** Derivações de resultados p/ os painéis — funções puras. */
import type { BridgeModel, BridgeResults, Env3, FrameForces, Lane } from '@opengirder/engine'

export interface LanePath {
  lane: Lane
  /** índice (em model.nodes) de cada nó da faixa */
  nodeIdx: number[]
  /** estaca acumulada de cada nó (m) */
  s: number[]
  /** barra que liga cada par consecutivo de nós (null se não houver) e se está invertida */
  segs: ({ id: number; flip: boolean } | null)[]
  length: number
  /** estacas dos nós com apoio vertical */
  supports: number[]
}

export function lanePaths(model: BridgeModel): LanePath[] {
  const index = new Map(model.nodes.map((n, i) => [n.id, i]))
  const byPair = new Map<string, { id: number; n1: number }>()
  for (const e of model.elements) {
    if (e.kind !== 'frame') continue
    const key = e.n1 < e.n2 ? `${e.n1}:${e.n2}` : `${e.n2}:${e.n1}`
    if (!byPair.has(key)) byPair.set(key, { id: e.id, n1: e.n1 })
  }
  return (model.lanes ?? []).map((lane) => {
    const ids = lane.nodes.filter((id) => index.has(id))
    const nodeIdx = ids.map((id) => index.get(id)!)
    const s: number[] = []
    const segs: LanePath['segs'] = []
    const supports: number[] = []
    let acc = 0
    ids.forEach((id, k) => {
      const nd = model.nodes[nodeIdx[k]]
      if (k > 0) {
        const pv = model.nodes[nodeIdx[k - 1]]
        acc += Math.hypot(nd.x - pv.x, nd.y - pv.y, nd.z - pv.z)
        const a = ids[k - 1]
        const key = a < id ? `${a}:${id}` : `${id}:${a}`
        const el = byPair.get(key)
        segs.push(el ? { id: el.id, flip: el.n1 !== a } : null)
      }
      s.push(acc)
      if (nd.fix?.[2]) supports.push(acc)
    })
    return { lane, nodeIdx, s, segs, length: acc, supports }
  })
}

export type Quantity = 'Mz' | 'Vy' | 'N' | 'T' | 'My'
type Triple = [number, number, number]

function along(path: LanePath, get: (id: number) => Triple | undefined): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  path.segs.forEach((seg, k) => {
    const a = path.s[k]
    const b = path.s[k + 1]
    const v = seg ? get(seg.id) : undefined
    if (!seg || !v) {
      x.push(a, b)
      y.push(NaN, NaN)
      return
    }
    const t: Triple = seg.flip ? [v[2], v[1], v[0]] : v
    x.push(a, (a + b) / 2, b)
    y.push(t[0], t[1], t[2])
  })
  return { x, y }
}

export function deadAlong(path: LanePath, frames: FrameForces[], q: Quantity) {
  const byId = new Map(frames.map((f) => [f.id, f]))
  return along(path, (id) => byId.get(id)?.[q])
}

export function envelopeAlong(
  path: LanePath,
  frames: NonNullable<BridgeResults['moving']>['frames'],
  q: Quantity,
) {
  const byId = new Map(frames.map((f) => [f.id, f]))
  const env = (id: number): Env3 | undefined => byId.get(id)?.[q]
  return {
    min: along(path, (id) => env(id)?.min),
    max: along(path, (id) => env(id)?.max),
  }
}

/* --------------------------------------------------------- referências */

type Ref = NonNullable<NonNullable<BridgeModel['meta']>['reference']>[number]

const KIND_WORDS: [RegExp, string][] = [
  [/transvers|lateral/i, 'transversal'],
  [/vertical/i, 'vertical'],
  [/longitudinal/i, 'longitudinal'],
  [/tor[cs]/i, 'torcional'],
]

/**
 * Tenta achar o valor calculado correspondente a uma referência. Só casa períodos e
 * frequências (pelo tipo do modo citado no rótulo); demais grandezas ficam sem par —
 * melhor não comparar do que comparar a coisa errada.
 */
export function matchReference(ref: Ref, results: BridgeResults | null): { value: number; note: string } | null {
  const modes = results?.modal?.modes
  if (!modes || modes.length === 0) return null
  const unit = ref.unit.trim().toLowerCase()
  const isPeriod = unit === 's'
  const isFreq = unit === 'hz'
  if (!isPeriod && !isFreq) return null
  for (const [re, kind] of KIND_WORDS) {
    if (!re.test(ref.label)) continue
    const m = modes.find((x) => x.kind === kind)
    if (!m) return null
    return { value: isPeriod ? m.period : m.frequency, note: `modo ${m.index}` }
  }
  return null
}

/* ------------------------------------------------- grandezas principais */

export interface KeyFigure {
  label: string
  value: number
  unit: string
  digits?: number
}

export function keyFigures(model: BridgeModel, r: BridgeResults): KeyFigure[] {
  const out: KeyFigure[] = []
  const first = r.modal?.modes[0]
  if (first) out.push({ label: 'Período fundamental', value: first.period, unit: 's', digits: 3 })

  const groupOf = new Map<number, string>()
  for (const e of model.elements) groupOf.set(e.id, e.group ?? 'other')
  const maxT: Record<string, number> = {}
  for (const c of r.deadLoad.cables) {
    const g = groupOf.get(c.id) ?? 'other'
    maxT[g] = Math.max(maxT[g] ?? 0, c.Ti, c.Tj)
  }
  if (maxT['main-cable']) out.push({ label: 'Tração máx. cabo principal', value: maxT['main-cable'], unit: 'kN', digits: 0 })
  if (maxT['stay']) out.push({ label: 'Tração máx. nos estais', value: maxT['stay'], unit: 'kN', digits: 0 })
  if (maxT['hanger']) out.push({ label: 'Tração máx. nos pendurais', value: maxT['hanger'], unit: 'kN', digits: 0 })

  // deslocamento vertical do tabuleiro sob carga permanente
  const deckNodes = new Set<number>()
  for (const e of model.elements) {
    if (e.kind === 'frame' && (e.group ?? 'deck') === 'deck') {
      deckNodes.add(e.n1)
      deckNodes.add(e.n2)
    }
  }
  let uzMin = 0
  let uzMax = 0
  model.nodes.forEach((n, i) => {
    if (!deckNodes.has(n.id)) return
    const uz = r.deadLoad.u[6 * i + 2]
    if (Number.isFinite(uz)) {
      uzMin = Math.min(uzMin, uz)
      uzMax = Math.max(uzMax, uz)
    }
  })
  if (deckNodes.size) {
    const worst = Math.abs(uzMin) >= Math.abs(uzMax) ? uzMin : uzMax
    out.push({ label: 'Desloc. vertical do tabuleiro (perm.)', value: worst * 1000, unit: 'mm', digits: 1 })
  }
  if (r.moving) {
    let q = 0
    model.nodes.forEach((n, i) => {
      if (!deckNodes.has(n.id)) return
      const v = r.moving!.uzMin[i]
      if (Number.isFinite(v)) q = Math.min(q, v)
    })
    out.push({ label: 'Flecha máx. por carga móvel', value: q * 1000, unit: 'mm', digits: 1 })
  }

  let mMax = 0
  let mMin = 0
  for (const f of r.deadLoad.frames) {
    if ((groupOf.get(f.id) ?? '') !== 'deck') continue
    for (const v of f.Mz) {
      mMax = Math.max(mMax, v)
      mMin = Math.min(mMin, v)
    }
  }
  if (mMax !== 0 || mMin !== 0) {
    out.push({ label: 'Mz máx. no tabuleiro (perm.)', value: mMax, unit: 'kN·m', digits: 0 })
    out.push({ label: 'Mz mín. no tabuleiro (perm.)', value: mMin, unit: 'kN·m', digits: 0 })
  }

  const rz = r.deadLoad.reactions.reduce((a, x) => a + x.R[2], 0)
  if (r.deadLoad.reactions.length) out.push({ label: 'Soma das reações verticais', value: rz, unit: 'kN', digits: 0 })
  return out
}
