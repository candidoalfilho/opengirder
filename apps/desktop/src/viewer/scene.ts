/**
 * Geometria do visualizador — funções puras (sem React) que transformam
 * modelo + resultados em buffers p/ three.js.
 *
 * Tudo é desenhado em coordenadas CENTRADAS (posição − centro do modelo): em
 * float32, 2,7 km com precisão de milímetro só cabe se a origem estiver perto.
 */
import * as THREE from 'three'
import {
  cablePolyline,
  frameAxes,
  type BridgeModel,
  type BridgeResults,
  type CableElement,
  type FrameElement,
  type FrameForces,
  type Vec3,
} from '@opengirder/engine'
import type { DiagramKind, Selection, ViewState } from '../store'

export interface FrameItem {
  el: FrameElement
  i1: number
  i2: number
  /** altura (ao longo de y local) e largura (z local) desenhadas (m) */
  h: number
  w: number
  group: string
  matKind: string
}

export interface CableItem {
  el: CableElement
  i1: number
  i2: number
  group: string
  radius: number
  /** flecha vertical no meio do vão (m) — do resultado de carga permanente */
  sag: number
  /** nº de segmentos de desenho e índice do primeiro no buffer */
  segs: number
  firstSeg: number
}

export interface SupportItem {
  i: number
  kind: 'pin' | 'fixed'
}

export interface SceneIndex {
  model: BridgeModel
  nNodes: number
  /** posições centradas, 3 por nó (ordem de model.nodes) */
  base: Float64Array
  center: Vec3
  /** dimensões da caixa envolvente e diagonal */
  size: Vec3
  diag: number
  /** cota mínima, já centrada */
  zMin: number
  nodeIndex: Map<number, number>
  frames: FrameItem[]
  cables: CableItem[]
  totalSegs: number
  /** segmento de desenho → índice em `cables` */
  segCable: Int32Array
  supports: SupportItem[]
  /** grupos presentes no modelo (inclusive os ocultos), com contagem */
  groups: { group: string; count: number; cable: boolean }[]
}

const SAG_SEGMENTS = 12

function frameDims(model: BridgeModel, el: FrameElement, secById: Map<string, BridgeModel['sections'][number]>) {
  const sec = secById.get(el.sec)
  const thin = el.group === 'rigid' || el.group === 'crossbeam' || sec?.shape === 'rigid'
  const fallback = thin ? 0.3 : Math.min(6, Math.max(0.25, Math.sqrt(Math.max(sec?.A ?? 0.1, 1e-4))))
  const h = sec?.depth && sec.depth > 0 ? sec.depth : fallback
  const w = sec?.width && sec.width > 0 ? sec.width : fallback
  return thin && !(sec?.depth && sec?.width) ? { h: Math.min(h, 0.4), w: Math.min(w, 0.4) } : { h, w }
}

export function buildIndex(model: BridgeModel, results: BridgeResults | null, hidden: string[]): SceneIndex {
  const n = model.nodes.length
  const nodeIndex = new Map<number, number>()
  let min: Vec3 = [Infinity, Infinity, Infinity]
  let max: Vec3 = [-Infinity, -Infinity, -Infinity]
  model.nodes.forEach((nd, i) => {
    nodeIndex.set(nd.id, i)
    min = [Math.min(min[0], nd.x), Math.min(min[1], nd.y), Math.min(min[2], nd.z)]
    max = [Math.max(max[0], nd.x), Math.max(max[1], nd.y), Math.max(max[2], nd.z)]
  })
  if (n === 0) {
    min = [0, 0, 0]
    max = [1, 1, 1]
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const diag = Math.max(1, Math.hypot(size[0], size[1], size[2]))
  const base = new Float64Array(3 * n)
  model.nodes.forEach((nd, i) => {
    base[3 * i] = nd.x - center[0]
    base[3 * i + 1] = nd.y - center[1]
    base[3 * i + 2] = nd.z - center[2]
  })

  const secById = new Map(model.sections.map((s) => [s.id, s]))
  const matById = new Map(model.materials.map((m) => [m.id, m]))
  const sagById = new Map<number, number>()
  results?.deadLoad.cables.forEach((c) => sagById.set(c.id, Number.isFinite(c.sag) ? c.sag : 0))

  const hiddenSet = new Set(hidden)
  const groupCount = new Map<string, { count: number; cable: boolean }>()
  const frames: FrameItem[] = []
  const cables: CableItem[] = []
  let totalSegs = 0

  for (const el of model.elements) {
    const i1 = nodeIndex.get(el.n1)
    const i2 = nodeIndex.get(el.n2)
    if (i1 === undefined || i2 === undefined) continue
    const group = el.group ?? 'other'
    const g = groupCount.get(group) ?? { count: 0, cable: el.kind === 'cable' }
    g.count++
    groupCount.set(group, g)
    if (hiddenSet.has(group)) continue
    if (el.kind === 'frame') {
      const { h, w } = frameDims(model, el, secById)
      frames.push({ el, i1, i2, h, w, group, matKind: matById.get(el.mat)?.kind ?? 'steel' })
    } else {
      const sag = sagById.get(el.id) ?? 0
      const dx = base[3 * i2] - base[3 * i1]
      const dy = base[3 * i2 + 1] - base[3 * i1 + 1]
      const dz = base[3 * i2 + 2] - base[3 * i1 + 2]
      const chord = Math.hypot(dx, dy, dz)
      let segs = 1
      if (sag > 0.0015 * chord && chord > 0) {
        // o engine define se `n` conta pontos ou trechos: mede uma vez e guarda
        const pts = cablePolyline(
          [base[3 * i1], base[3 * i1 + 1], base[3 * i1 + 2]],
          [base[3 * i2], base[3 * i2 + 1], base[3 * i2 + 2]],
          sag,
          SAG_SEGMENTS,
        )
        segs = Math.max(1, pts.length - 1)
      }
      const radius = Math.max(0.03, Math.sqrt(Math.max(el.A, 0) / Math.PI))
      cables.push({ el, i1, i2, group, radius, sag, segs, firstSeg: totalSegs })
      totalSegs += segs
    }
  }

  const segCable = new Int32Array(totalSegs)
  cables.forEach((c, k) => {
    for (let s = 0; s < c.segs; s++) segCable[c.firstSeg + s] = k
  })

  const supports: SupportItem[] = []
  model.nodes.forEach((nd, i) => {
    if (!nd.fix) return
    const trans = nd.fix[0] || nd.fix[1] || nd.fix[2]
    if (!trans) return
    const all = nd.fix.every(Boolean)
    supports.push({ i, kind: all ? 'fixed' : 'pin' })
  })

  const order = ['deck', 'tower', 'pier', 'main-cable', 'stay', 'hanger', 'crossbeam', 'rigid', 'other']
  const groups = [...groupCount.entries()]
    .map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))

  return {
    model,
    nNodes: n,
    base,
    center,
    size,
    diag,
    zMin: min[2] - center[2],
    nodeIndex,
    frames,
    cables,
    totalSegs,
    segCable,
    supports,
    groups,
  }
}

/** posições = base + escala · vetor de deslocamentos (6 por nó; só translações) */
export function displaced(idx: SceneIndex, u: ArrayLike<number> | undefined, scale: number, out?: Float64Array): Float64Array {
  const pos = out ?? new Float64Array(idx.base.length)
  const n = idx.nNodes
  if (!u || u.length < 6 * n || scale === 0) {
    pos.set(idx.base)
    return pos
  }
  for (let i = 0; i < n; i++) {
    pos[3 * i] = idx.base[3 * i] + scale * u[6 * i]
    pos[3 * i + 1] = idx.base[3 * i + 1] + scale * u[6 * i + 1]
    pos[3 * i + 2] = idx.base[3 * i + 2] + scale * u[6 * i + 2]
  }
  return pos
}

/** maior translação (m) e o nó onde ocorre */
export function maxTranslation(u: ArrayLike<number> | undefined, n: number): { value: number; node: number } {
  let value = 0
  let node = -1
  if (!u) return { value, node }
  for (let i = 0; i < n && 6 * i + 2 < u.length; i++) {
    const d = Math.hypot(u[6 * i], u[6 * i + 1], u[6 * i + 2])
    if (d > value) {
      value = d
      node = i
    }
  }
  return { value, node }
}

const _m = new THREE.Matrix4()

function vec(pos: Float64Array, i: number): Vec3 {
  return [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]
}

export function fillFrameMatrices(mesh: THREE.InstancedMesh, idx: SceneIndex, pos: Float64Array): void {
  const frames = idx.frames
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k]
    const p1 = vec(pos, f.i1)
    const p2 = vec(pos, f.i2)
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
    if (!(L > 1e-9)) {
      _m.makeScale(0, 0, 0)
    } else {
      const ax = frameAxes(p1, p2, f.el.up)
      const { ex, ey, ez } = ax
      _m.set(
        ex[0] * L, ey[0] * f.h, ez[0] * f.w, (p1[0] + p2[0]) / 2,
        ex[1] * L, ey[1] * f.h, ez[1] * f.w, (p1[1] + p2[1]) / 2,
        ex[2] * L, ey[2] * f.h, ez[2] * f.w, (p1[2] + p2[2]) / 2,
        0, 0, 0, 1,
      )
    }
    mesh.setMatrixAt(k, _m)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.boundingSphere = null
  mesh.boundingBox = null
}

/**
 * Preenche o buffer de linhas (2 vértices por segmento) e, se houver, as matrizes
 * dos cilindros instanciados (cilindro unitário: raio 1, altura 1 ao longo de Y).
 */
export function fillCables(
  idx: SceneIndex,
  pos: Float64Array,
  linePos: Float32Array,
  tubes: THREE.InstancedMesh | null,
): void {
  for (const c of idx.cables) {
    const p1 = vec(pos, c.i1)
    const p2 = vec(pos, c.i2)
    const pts = c.segs > 1 ? cablePolyline(p1, p2, c.sag, SAG_SEGMENTS) : [p1, p2]
    const last = pts.length - 1
    for (let s = 0; s < c.segs; s++) {
      const a = pts[Math.min(s, last)]
      const b = pts[Math.min(s + 1, last)]
      const o = (c.firstSeg + s) * 6
      linePos[o] = a[0]
      linePos[o + 1] = a[1]
      linePos[o + 2] = a[2]
      linePos[o + 3] = b[0]
      linePos[o + 4] = b[1]
      linePos[o + 5] = b[2]
      if (tubes) {
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const dz = b[2] - a[2]
        const len = Math.hypot(dx, dy, dz)
        if (!(len > 1e-9)) {
          _m.makeScale(0, 0, 0)
        } else {
          // base ortonormal (u, d, v): d ao longo do cabo
          let ux: number, uy: number, uz: number
          if (Math.abs(dz) / len < 0.9) {
            // d × Z
            ux = dy
            uy = -dx
            uz = 0
          } else {
            // d × X
            ux = 0
            uy = dz
            uz = -dy
          }
          const ul = Math.hypot(ux, uy, uz)
          ux /= ul
          uy /= ul
          uz /= ul
          // v = u × d̂ → (u, d, v) dextrógira (não inverte as faces do cilindro)
          const vx = (uy * dz - uz * dy) / len
          const vy = (uz * dx - ux * dz) / len
          const vz = (ux * dy - uy * dx) / len
          const r = c.radius
          _m.set(
            ux * r, dx, vx * r, (a[0] + b[0]) / 2,
            uy * r, dy, vy * r, (a[1] + b[1]) / 2,
            uz * r, dz, vz * r, (a[2] + b[2]) / 2,
            0, 0, 0, 1,
          )
        }
        tubes.setMatrixAt(c.firstSeg + s, _m)
      }
    }
  }
  if (tubes) {
    tubes.instanceMatrix.needsUpdate = true
    tubes.boundingSphere = null
    tubes.boundingBox = null
  }
}

/* ------------------------------------------------------------------ cores */

export interface Palette {
  concrete: string
  steel: string
  rigid: string
  stay: string
  mainCable: string
  hanger: string
  cableOther: string
  dim: string
  selection: string
  support: string
  node: string
  ghost: string
  diagram: string
  envelope: string
  ground: string
  grid: string
}

export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    concrete: '#c4bdac',
    steel: '#c8452f',
    rigid: '#6b6454',
    stay: '#f5c62e',
    mainCable: '#e8502f',
    hanger: '#ff9272',
    cableOther: '#d9d2c0',
    dim: '#5a554b',
    selection: '#4da3ff',
    support: '#3ecf8e',
    node: '#e9e4d6',
    ghost: '#6a6457',
    diagram: '#ff7a50',
    envelope: '#4da3ff',
    ground: '#1d242b',
    grid: '#2c3640',
  },
  light: {
    concrete: '#b9b3a3',
    steel: '#c0362c',
    rigid: '#9c9585',
    stay: '#d9a400',
    mainCable: '#c0362c',
    hanger: '#d8674a',
    cableOther: '#6b645a',
    dim: '#bdb7a8',
    selection: '#2f6fd0',
    support: '#1e9e66',
    node: '#3a352c',
    ghost: '#a8a190',
    diagram: '#d2481f',
    envelope: '#2f6fd0',
    ground: '#cfd9df',
    grid: '#b9c6cf',
  },
}

export function groupColor(pal: Palette, group: string, matKind?: string): string {
  switch (group) {
    case 'stay':
      return pal.stay
    case 'main-cable':
      return pal.mainCable
    case 'hanger':
      return pal.hanger
    case 'rigid':
    case 'crossbeam':
      return pal.rigid
    default:
      if (matKind === 'cable') return pal.cableOther
      if (matKind === 'rigid') return pal.rigid
      return matKind === 'steel' ? pal.steel : pal.concrete
  }
}

/** rampa azul → ciano → verde → amarelo → vermelho, t ∈ [0, 1] */
const RAMP = ['#3b6cf6', '#22b8cf', '#5fd068', '#ffd23f', '#ff4d4d'].map((c) => new THREE.Color(c))
export const RAMP_CSS = 'linear-gradient(90deg, #3b6cf6, #22b8cf, #5fd068, #ffd23f, #ff4d4d)'

export function rampColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], x - i)
}

export interface CableScale {
  by: ViewState['cableBy']
  min: number
  max: number
  /** valor por índice em idx.cables (NaN = sem resultado) */
  values: Float64Array
}

export function cableScale(idx: SceneIndex, results: BridgeResults | null, by: ViewState['cableBy']): CableScale | null {
  if (!results || idx.cables.length === 0) return null
  const values = new Float64Array(idx.cables.length).fill(NaN)
  let min = Infinity
  let max = -Infinity
  if (by === 'T') {
    const byId = new Map(results.deadLoad.cables.map((c) => [c.id, c]))
    idx.cables.forEach((c, k) => {
      const r = byId.get(c.el.id)
      if (!r) return
      const v = Math.max(r.Ti, r.Tj)
      values[k] = v
      min = Math.min(min, v)
      max = Math.max(max, v)
    })
  } else {
    const byId = new Map(results.checks.cables.map((c) => [c.id, c]))
    idx.cables.forEach((c, k) => {
      const r = byId.get(c.el.id)
      if (!r) return
      values[k] = r.ratioEls
      max = Math.max(max, r.ratioEls)
    })
    min = 0
    max = Math.max(1, max)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  if (max - min < 1e-12) max = min + 1
  return { by, min, max, values }
}

const _c = new THREE.Color()

export function frameColors(
  mesh: THREE.InstancedMesh,
  idx: SceneIndex,
  pal: Palette,
  dimmed: boolean,
  selection: Selection | null,
): void {
  idx.frames.forEach((f, k) => {
    if (selection?.kind === 'element' && selection.id === f.el.id) _c.set(pal.selection)
    else if (dimmed) _c.set(pal.dim)
    else _c.set(groupColor(pal, f.group, f.matKind))
    mesh.setColorAt(k, _c)
  })
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

export function cableColors(
  idx: SceneIndex,
  pal: Palette,
  scale: CableScale | null,
  selection: Selection | null,
  lineColor: Float32Array,
  tubes: THREE.InstancedMesh | null,
): void {
  idx.cables.forEach((c, k) => {
    if (selection?.kind === 'element' && selection.id === c.el.id) _c.set(pal.selection)
    else if (scale) {
      const v = scale.values[k]
      if (Number.isFinite(v)) rampColor((v - scale.min) / (scale.max - scale.min), _c)
      else _c.set(pal.dim)
    } else _c.set(groupColor(pal, c.group, 'cable'))
    for (let s = 0; s < c.segs; s++) {
      const o = (c.firstSeg + s) * 6
      lineColor[o] = lineColor[o + 3] = _c.r
      lineColor[o + 1] = lineColor[o + 4] = _c.g
      lineColor[o + 2] = lineColor[o + 5] = _c.b
      tubes?.setColorAt(c.firstSeg + s, _c)
    }
  })
  if (tubes?.instanceColor) tubes.instanceColor.needsUpdate = true
}

/* --------------------------------------------------------------- diagramas */

export interface DiagramData {
  /** triângulos preenchidos (carga permanente) */
  fill: Float32Array
  /** contorno da carga permanente (pares de vértices) */
  line: Float32Array
  /** envoltória permanente + móvel (pares de vértices); vazio sem carga móvel */
  env: Float32Array
  /** extremos da carga permanente e da envoltória total */
  deadMin: number
  deadMax: number
  envMin: number
  envMax: number
  /** fator m por unidade da grandeza */
  scale: number
  hasEnvelope: boolean
}

const DIAGRAM_GROUPS_SKIP = new Set(['rigid', 'crossbeam'])

type Triple = [number, number, number]

function pick(f: FrameForces, kind: DiagramKind): Triple {
  return kind === 'Mz' ? f.Mz : kind === 'Vy' ? f.Vy : f.N
}

/**
 * Diagrama de esforços ao longo de y local. Mz é desenhado do lado tracionado
 * (Mz > 0 traciona a fibra inferior → para −y); Vy e N para +y.
 */
export function buildDiagram(
  idx: SceneIndex,
  results: BridgeResults,
  kind: DiagramKind,
  scaleMul: number,
): DiagramData | null {
  const dead = new Map(results.deadLoad.frames.map((f) => [f.id, f]))
  const moving = results.moving ? new Map(results.moving.frames.map((f) => [f.id, f])) : null
  const items = idx.frames.filter((f) => !DIAGRAM_GROUPS_SKIP.has(f.group) && dead.has(f.el.id))
  if (items.length === 0) return null

  let deadMin = Infinity
  let deadMax = -Infinity
  let envMin = Infinity
  let envMax = -Infinity
  let hasEnvelope = false
  const rows: { f: FrameItem; d: Triple; lo: Triple | null; hi: Triple | null }[] = []
  for (const f of items) {
    const d = pick(dead.get(f.el.id)!, kind)
    const mv = moving?.get(f.el.id)
    let lo: Triple | null = null
    let hi: Triple | null = null
    if (mv) {
      const e = mv[kind]
      lo = [d[0] + e.min[0], d[1] + e.min[1], d[2] + e.min[2]]
      hi = [d[0] + e.max[0], d[1] + e.max[1], d[2] + e.max[2]]
      hasEnvelope = true
    }
    for (let s = 0; s < 3; s++) {
      deadMin = Math.min(deadMin, d[s])
      deadMax = Math.max(deadMax, d[s])
      envMin = Math.min(envMin, lo ? lo[s] : d[s])
      envMax = Math.max(envMax, hi ? hi[s] : d[s])
    }
    rows.push({ f, d, lo, hi })
  }
  const peak = Math.max(Math.abs(envMin), Math.abs(envMax), 1e-12)
  const scale = ((0.07 * idx.diag) / peak) * scaleMul
  const sign = kind === 'Mz' ? -1 : 1

  const fill = new Float32Array(rows.length * 4 * 9)
  const line = new Float32Array(rows.length * 4 * 6)
  const env = new Float32Array(hasEnvelope ? rows.length * 4 * 6 : 0)
  let fo = 0
  let lo_ = 0
  let eo = 0
  const put = (arr: Float32Array, o: number, p: Vec3) => {
    arr[o] = p[0]
    arr[o + 1] = p[1]
    arr[o + 2] = p[2]
  }
  for (const r of rows) {
    const p1 = vec(idx.base, r.f.i1)
    const p2 = vec(idx.base, r.f.i2)
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
    if (!(L > 1e-9)) continue
    const { ey } = frameAxes(p1, p2, r.f.el.up)
    const b: Vec3[] = [p1, [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2], p2]
    const off = (v: Triple): Vec3[] =>
      b.map((p, s) => {
        const k = sign * v[s] * scale
        return [p[0] + ey[0] * k, p[1] + ey[1] * k, p[2] + ey[2] * k] as Vec3
      })
    const o = off(r.d)
    for (let s = 0; s < 2; s++) {
      put(fill, fo, b[s])
      put(fill, fo + 3, b[s + 1])
      put(fill, fo + 6, o[s + 1])
      put(fill, fo + 9, b[s])
      put(fill, fo + 12, o[s + 1])
      put(fill, fo + 15, o[s])
      fo += 18
      put(line, lo_, o[s])
      put(line, lo_ + 3, o[s + 1])
      lo_ += 6
    }
    if (r.lo && r.hi) {
      const a = off(r.lo)
      const c = off(r.hi)
      for (let s = 0; s < 2; s++) {
        put(env, eo, a[s])
        put(env, eo + 3, a[s + 1])
        put(env, eo + 6, c[s])
        put(env, eo + 9, c[s + 1])
        eo += 12
      }
    }
  }
  return {
    fill: fill.subarray(0, fo),
    line: line.subarray(0, lo_),
    env: env.subarray(0, eo),
    deadMin,
    deadMax,
    envMin,
    envMax,
    scale,
    hasEnvelope,
  }
}

/** linhas-fantasma da geometria indeformada (pares de vértices por barra) */
export function ghostLines(idx: SceneIndex): Float32Array {
  const out = new Float32Array((idx.frames.length + idx.cables.length) * 6)
  let o = 0
  const push = (i1: number, i2: number) => {
    for (const i of [i1, i2]) {
      out[o++] = idx.base[3 * i]
      out[o++] = idx.base[3 * i + 1]
      out[o++] = idx.base[3 * i + 2]
    }
  }
  idx.frames.forEach((f) => {
    if (f.group !== 'rigid' && f.group !== 'crossbeam') push(f.i1, f.i2)
  })
  idx.cables.forEach((c) => push(c.i1, c.i2))
  return out.subarray(0, o)
}
