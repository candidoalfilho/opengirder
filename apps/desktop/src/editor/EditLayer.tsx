/**
 * Camada de edição dentro do Canvas 3D: plano de trabalho com malha, captura do cursor
 * (nó → barra → malha), ferramentas de desenho, seleção por clique e por janela, e mover.
 *
 * O ponteiro é tratado por eventos do DOM (não pelos eventos de objeto do R3F): a captura é
 * feita em pixels de tela sobre a projeção dos nós e das barras, o que independe do tamanho
 * com que eles são desenhados. O que muda a cada movimento do mouse (marcador, linha
 * elástica, rótulo) é atualizado de forma imperativa, sem re-renderizar o React.
 */

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { BridgeModel, Vec3 } from '@opengirder/engine'
import { useStore } from '../store'
import type { Palette, SceneIndex } from '../viewer/scene'
import { fmt } from '../format'
import type { EditSelection, EditState } from './types'
import { nodeAt, selectionNodes, translateNodes, type PointTarget } from './draw'
import { commitPoint, useEditSession } from './session'
import {
  boxSelect,
  planeAxes,
  pointSegment2D,
  rayPlane,
  raySegmentParam,
  snapAlong,
  snapToGrid,
  type ScreenPoint,
} from './snap'

const NODE_PX = 12
const ELEMENT_PX = 8
const DRAG_PX = 4
const ACCENT = '#ff6a3d'

const c3 = (v: number): string => fmt(v, Math.abs(v - Math.round(v)) < 5e-4 ? 0 : 2)
const coordText = (p: Vec3): string => `${c3(p[0])}; ${c3(p[1])}; ${c3(p[2])}`

/** passo de desenho da malha: o da captura, alargado até caber em ~160 linhas por direção */
function drawStep(snap: number, range: number): number {
  let g = snap > 0 ? snap : 1
  const mult = [2, 2.5, 2] // 1 → 2 → 5 → 10 → …
  let k = 0
  while (range / g > 160) g *= mult[k++ % 3]
  return g
}

interface Live {
  idx: SceneIndex
  edit: EditState
  model: BridgeModel
  pending: number | null
}

export function EditLayer({ idx, pal }: { idx: SceneIndex; pal: Palette }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const controls = useThree((s) => s.controls)
  const edit = useStore((s) => s.edit)
  const dark = useStore((s) => s.theme) === 'dark'
  const pending = useEditSession((s) => s.pending)

  const live = useRef<Live>({ idx, edit, model: idx.model, pending })
  live.current = { idx, edit, model: idx.model, pending }

  const marker = useRef<THREE.Mesh>(null)
  const rubber = useRef<THREE.LineSegments>(null)
  const ghost = useRef<THREE.Points>(null)
  const labelEl = useRef<HTMLDivElement | null>(null)

  /* ---------------------------------------------------------------- malha do plano */
  const grid = useMemo(() => {
    const { plane, snap } = edit
    const { u, v, n } = planeAxes(plane.kind)
    const lo: Vec3 = [0, 0, 0]
    const hi: Vec3 = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      lo[i] = idx.center[i] + idx.boxCenter[i] - idx.size[i] / 2
      hi[i] = idx.center[i] + idx.boxCenter[i] + idx.size[i] / 2
    }
    const span = Math.max(hi[u] - lo[u], hi[v] - lo[v], 20)
    const margin = Math.max(10, 0.2 * span)
    let u0 = lo[u] - margin
    let u1 = hi[u] + margin
    let v0 = lo[v] - margin
    let v1 = hi[v] + margin
    // em elevação e em corte a malha não desce abaixo do terreno (z = cota mínima ou 0)
    if (v === 2) v0 = Math.min(lo[2], 0)
    const g = drawStep(snap, Math.max(u1 - u0, v1 - v0))
    u0 = Math.floor(u0 / g) * g
    u1 = Math.ceil(u1 / g) * g
    v0 = Math.floor(v0 / g) * g
    v1 = Math.ceil(v1 / g) * g
    const minor: number[] = []
    const major: number[] = []
    const pt = (a: number, b: number): Vec3 => {
      const p: Vec3 = [0, 0, 0]
      p[u] = a - idx.center[u]
      p[v] = b - idx.center[v]
      p[n] = plane.offset - idx.center[n]
      return p
    }
    const isMajor = (x: number): boolean => Math.abs(x / (g * 5) - Math.round(x / (g * 5))) < 1e-6
    for (let a = u0; a <= u1 + 1e-9; a += g) (isMajor(a) ? major : minor).push(...pt(a, v0), ...pt(a, v1))
    for (let b = v0; b <= v1 + 1e-9; b += g) (isMajor(b) ? major : minor).push(...pt(u0, b), ...pt(u1, b))
    const mk = (arr: number[]): THREE.BufferGeometry => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3))
      return geo
    }
    return { minor: mk(minor), major: mk(major) }
  }, [edit.plane.kind, edit.plane.offset, edit.snap, idx.center, idx.boxCenter, idx.size])
  useEffect(
    () => () => {
      grid.minor.dispose()
      grid.major.dispose()
    },
    [grid],
  )

  /* ---------------------------------------------------------------- nós sempre visíveis */
  const nodesGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(idx.base), 3))
    return geo
  }, [idx])
  useEffect(() => () => nodesGeo.dispose(), [nodesGeo])

  /* ---------------------------------------------------------------- seleção desenhada */
  const selGeo = useMemo(() => {
    const pts: number[] = []
    for (const id of edit.sel.nodes) {
      const i = idx.nodeIndex.get(id)
      if (i !== undefined) pts.push(idx.base[3 * i], idx.base[3 * i + 1], idx.base[3 * i + 2])
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    return geo
  }, [edit.sel, idx])
  useEffect(() => () => selGeo.dispose(), [selGeo])

  const pendGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const i = pending !== null ? idx.nodeIndex.get(pending) : undefined
    const arr = i !== undefined ? [idx.base[3 * i], idx.base[3 * i + 1], idx.base[3 * i + 2]] : []
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3))
    return geo
  }, [pending, idx])
  useEffect(() => () => pendGeo.dispose(), [pendGeo])

  const rubberGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    return geo
  }, [])
  const ghostGeo = useMemo(() => new THREE.BufferGeometry(), [])
  useEffect(
    () => () => {
      rubberGeo.dispose()
      ghostGeo.dispose()
    },
    [rubberGeo, ghostGeo],
  )

  /* ---------------------------------------------------------------- botões da câmera */
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = controls as any
    if (!c?.mouseButtons) return
    const prev = { ...c.mouseButtons }
    // selecionar e mover usam o arrasto com o botão esquerdo; nas ferramentas de desenho o
    // arrasto esquerdo continua orbitando (o clique sem arrasto é que cria)
    const leftFree = edit.tool === 'select' || edit.tool === 'move'
    c.mouseButtons = { LEFT: leftFree ? -1 : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    return () => {
      c.mouseButtons = prev
    }
  }, [controls, edit.tool])

  /* ---------------------------------------------------------------- ponteiro */
  useEffect(() => {
    const canvas = gl.domElement
    const host = canvas.parentElement ?? canvas
    const label = document.createElement('div')
    label.className = 'edt-cursor'
    label.style.display = 'none'
    const box = document.createElement('div')
    box.className = 'edt-box'
    box.style.display = 'none'
    host.appendChild(label)
    host.appendChild(box)
    labelEl.current = label

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const tmp = new THREE.Vector3()

    const rect = () => canvas.getBoundingClientRect()
    const toScreen = (x: number, y: number, z: number, w: number, h: number): ScreenPoint => {
      tmp.set(x, y, z).project(camera)
      return { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h, ok: tmp.z > -1 && tmp.z < 1 }
    }
    /** raio do ponteiro em coordenadas do modelo */
    const ray = (px: number, py: number, w: number, h: number): { o: Vec3; d: Vec3 } => {
      ndc.set((px / w) * 2 - 1, 1 - (py / h) * 2)
      raycaster.setFromCamera(ndc, camera)
      const { origin, direction } = raycaster.ray
      const c = live.current.idx.center
      return { o: [origin.x + c[0], origin.y + c[1], origin.z + c[2]], d: [direction.x, direction.y, direction.z] }
    }
    const nodeScreens = (w: number, h: number): ScreenPoint[] => {
      const { idx: ix } = live.current
      const out: ScreenPoint[] = new Array(ix.nNodes)
      for (let i = 0; i < ix.nNodes; i++) out[i] = toScreen(ix.base[3 * i], ix.base[3 * i + 1], ix.base[3 * i + 2], w, h)
      return out
    }
    const pickNode = (px: number, py: number, sc: ScreenPoint[], skip?: Set<number>): number => {
      const { model } = live.current
      let best = -1
      let bd = NODE_PX
      for (let i = 0; i < sc.length; i++) {
        if (!sc[i].ok || (skip && skip.has(model.nodes[i].id))) continue
        const d = Math.hypot(sc[i].x - px, sc[i].y - py)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      return best
    }
    /** elemento visível mais próximo do ponteiro (na tela); `framesOnly` p/ dividir barras */
    const pickElement = (px: number, py: number, sc: ScreenPoint[], framesOnly: boolean): { id: number; i1: number; i2: number } | null => {
      const { idx: ix } = live.current
      let best: { id: number; i1: number; i2: number } | null = null
      let bd = ELEMENT_PX
      const test = (id: number, i1: number, i2: number) => {
        const a = sc[i1]
        const b = sc[i2]
        if (!a.ok || !b.ok) return
        const { dist } = pointSegment2D(px, py, a.x, a.y, b.x, b.y)
        if (dist < bd) {
          bd = dist
          best = { id, i1, i2 }
        }
      }
      for (const f of ix.frames) test(f.el.id, f.i1, f.i2)
      if (!framesOnly) for (const c of ix.cables) test(c.el.id, c.i1, c.i2)
      return best
    }
    const nodeP = (i: number): Vec3 => {
      const n = live.current.model.nodes[i]
      return [n.x, n.y, n.z]
    }

    /** alvo do ponteiro: nó existente → ponto sobre barra → ponto da malha do plano */
    const target = (px: number, py: number, forDraw: boolean, skip?: Set<number>): (PointTarget & { label: string }) | null => {
      const r = rect()
      const w = r.width
      const h = r.height
      const { edit: ed, model, idx: ix } = live.current
      const sc = nodeScreens(w, h)
      const ni = pickNode(px, py, sc, skip)
      if (ni >= 0) return { p: nodeP(ni), node: model.nodes[ni].id, label: `nó ${model.nodes[ni].id}` }
      const { o, d } = ray(px, py, w, h)
      if (forDraw) {
        const el = pickElement(px, py, sc, true)
        if (el) {
          const a = nodeP(el.i1)
          const b = nodeP(el.i2)
          const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
          const t = snapAlong(raySegmentParam(o, d, a, b), L, ed.snap)
          if (t === 0) return { p: a, node: model.nodes[el.i1].id, label: `nó ${model.nodes[el.i1].id}` }
          if (t === 1) return { p: b, node: model.nodes[el.i2].id, label: `nó ${model.nodes[el.i2].id}` }
          const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
          return { p, frame: { id: el.id, t }, label: `sobre a barra ${el.id}` }
        }
      }
      const hit = rayPlane(o, d, ed.plane)
      if (!hit) return null
      if (Math.hypot(hit[0] - o[0], hit[1] - o[1], hit[2] - o[2]) > 60 * ix.diag) return null
      const g = snapToGrid(hit, ed.plane, ed.snap)
      const near = nodeAt(model, g)
      if (near && !(skip && skip.has(near.id))) return { p: [near.x, near.y, near.z], node: near.id, label: `nó ${near.id}` }
      return { p: g, label: '' }
    }

    /** tamanho em unidades de cena que ocupa `px` pixels na distância do ponto */
    const worldPerPx = (p: THREE.Vector3, h: number): number => {
      const cam = camera as THREE.PerspectiveCamera
      const dist = cam.position.distanceTo(p)
      return (2 * dist * Math.tan(((cam.fov ?? 32) * Math.PI) / 360)) / Math.max(h, 1)
    }
    const toScene = (p: Vec3, out: THREE.Vector3): THREE.Vector3 => {
      const c = live.current.idx.center
      return out.set(p[0] - c[0], p[1] - c[1], p[2] - c[2])
    }
    const sv = new THREE.Vector3()

    let hover: (PointTarget & { label: string }) | null = null
    let down: { x: number; y: number; shift: boolean; button: number } | null = null
    let dragging = false
    let move: { start: Vec3; ids: number[]; d: Vec3 } | null = null

    const hideAll = () => {
      label.style.display = 'none'
      if (marker.current) marker.current.visible = false
      if (rubber.current) rubber.current.visible = false
      invalidate()
    }

    const showHover = (px: number, py: number) => {
      const r = rect()
      const { edit: ed, model, pending: pend } = live.current
      const drawTool = ed.tool === 'node' || ed.tool === 'frame' || ed.tool === 'cable'
      const m = marker.current
      const rb = rubber.current
      if (!hover || (!drawTool && !move)) {
        if (m) m.visible = false
        if (rb) rb.visible = false
        label.style.display = 'none'
        invalidate()
        return
      }
      toScene(hover.p, sv)
      if (m) {
        m.visible = true
        m.position.copy(sv)
        const s = worldPerPx(sv, r.height) * 5.5
        m.scale.setScalar(s)
      }
      let text = coordText(hover.p)
      if (hover.label) text += `  ·  ${hover.label}`
      const pn = !move && pend !== null ? model.nodes.find((n) => n.id === pend) : undefined
      const fp: Vec3 | null = move ? move.start : pn ? [pn.x, pn.y, pn.z] : null
      if (rb) {
        if (fp && (ed.tool === 'frame' || ed.tool === 'cable' || move)) {
          const arr = (rubberGeo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
          const c = live.current.idx.center
          arr[0] = fp[0] - c[0]; arr[1] = fp[1] - c[1]; arr[2] = fp[2] - c[2]
          arr[3] = sv.x; arr[4] = sv.y; arr[5] = sv.z
          rubberGeo.getAttribute('position').needsUpdate = true
          rubberGeo.computeBoundingSphere()
          rb.visible = true
          const dx = hover.p[0] - fp[0]
          const dy = hover.p[1] - fp[1]
          const dz = hover.p[2] - fp[2]
          text += move
            ? `\nΔ ${c3(dx)}; ${c3(dy)}; ${c3(dz)}`
            : `\nL = ${fmt(Math.hypot(dx, dy, dz), 2)} m`
        } else rb.visible = false
      }
      label.textContent = text
      label.style.display = 'block'
      label.style.left = `${Math.max(4, Math.min(px + 16, r.width - label.offsetWidth - 6))}px`
      label.style.top = `${Math.max(4, Math.min(py + 16, r.height - label.offsetHeight - 6))}px`
      invalidate()
    }

    const local = (e: PointerEvent | MouseEvent): { x: number; y: number; inside: boolean } => {
      const r = rect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      return { x, y, inside: x >= 0 && y >= 0 && x <= r.width && y <= r.height }
    }

    const setGhost = (ids: number[], d: Vec3) => {
      const { idx: ix } = live.current
      const arr: number[] = []
      for (const id of ids) {
        const i = ix.nodeIndex.get(id)
        if (i !== undefined) arr.push(ix.base[3 * i] + d[0], ix.base[3 * i + 1] + d[1], ix.base[3 * i + 2] + d[2])
      }
      ghostGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3))
      ghostGeo.computeBoundingSphere()
      if (ghost.current) ghost.current.visible = arr.length > 0
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== canvas) return
      const p = local(e)
      down = { x: p.x, y: p.y, shift: e.shiftKey, button: e.button }
      dragging = false
      const { edit: ed, model } = live.current
      if (ed.tool === 'move') {
        let sel = ed.sel
        const t0 = target(p.x, p.y, false)
        // sem seleção: pega o nó sob o cursor
        if (sel.nodes.length === 0 && sel.elements.length === 0 && t0?.node !== undefined) {
          sel = { nodes: [t0.node], elements: [] }
          useStore.getState().setEditSel(sel)
        }
        const ids = selectionNodes(model, sel)
        if (ids.length && t0) move = { start: t0.p, ids, d: [0, 0, 0] }
      }
    }

    const onMove = (e: PointerEvent) => {
      const p = local(e)
      const { edit: ed } = live.current
      if (down && !dragging && Math.hypot(p.x - down.x, p.y - down.y) > DRAG_PX) dragging = true
      if (down && dragging && ed.tool === 'select') {
        const x0 = Math.min(down.x, p.x)
        const y0 = Math.min(down.y, p.y)
        box.style.display = 'block'
        box.style.left = `${x0}px`
        box.style.top = `${y0}px`
        box.style.width = `${Math.abs(p.x - down.x)}px`
        box.style.height = `${Math.abs(p.y - down.y)}px`
        box.classList.toggle('crossing', p.x < down.x)
        return
      }
      if (move) {
        const skip = new Set(move.ids)
        hover = target(p.x, p.y, false, skip)
        if (hover) {
          const d: Vec3 = [hover.p[0] - move.start[0], hover.p[1] - move.start[1], hover.p[2] - move.start[2]]
          // fora de um nó, o movimento fica no plano de trabalho
          if (hover.node === undefined) d[planeAxes(ed.plane.kind).n] = 0
          move.d = d
          hover = { ...hover, p: [move.start[0] + d[0], move.start[1] + d[1], move.start[2] + d[2]] }
          setGhost(move.ids, d)
        }
        showHover(p.x, p.y)
        return
      }
      if (!p.inside || (e.buttons !== 0 && dragging)) {
        hover = null
        hideAll()
        return
      }
      const drawTool = ed.tool === 'node' || ed.tool === 'frame' || ed.tool === 'cable'
      hover = drawTool ? target(p.x, p.y, true) : null
      showHover(p.x, p.y)
    }

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return
      const p = local(e)
      const start = down
      const wasDrag = dragging
      down = null
      dragging = false
      const st = useStore.getState()
      const { edit: ed, model } = live.current

      if (move) {
        const m = move
        move = null
        setGhost([], [0, 0, 0])
        if (m.d[0] !== 0 || m.d[1] !== 0 || m.d[2] !== 0) {
          const keep = ed.sel
          st.updateModel((cur) => translateNodes(cur, m.ids, m.d))
          useStore.getState().setEdit({ sel: keep })
          useEditSession.getState().set({ last: null })
        }
        hover = null
        hideAll()
        return
      }

      if (ed.tool === 'select') {
        box.style.display = 'none'
        const r = rect()
        const sc = nodeScreens(r.width, r.height)
        let picked: EditSelection
        if (wasDrag) {
          const { idx: ix } = live.current
          picked = boxSelect(
            model.nodes.map((n, i) => ({ id: n.id, s: sc[i] })),
            [...ix.frames, ...ix.cables].map((x) => ({ id: x.el.id, a: sc[x.i1], b: sc[x.i2] })),
            start.x, start.y, p.x, p.y,
          )
        } else {
          const ni = pickNode(p.x, p.y, sc)
          const el = ni < 0 ? pickElement(p.x, p.y, sc, false) : null
          picked = { nodes: ni >= 0 ? [model.nodes[ni].id] : [], elements: el ? [el.id] : [] }
        }
        if (start.shift) {
          // Shift: acrescenta; clique num item já selecionado o retira
          const nodes = new Set(ed.sel.nodes)
          const els = new Set(ed.sel.elements)
          for (const id of picked.nodes) {
            if (!wasDrag && nodes.has(id)) nodes.delete(id)
            else nodes.add(id)
          }
          for (const id of picked.elements) {
            if (!wasDrag && els.has(id)) els.delete(id)
            else els.add(id)
          }
          st.setEditSel({ nodes: [...nodes], elements: [...els] })
        } else st.setEditSel(picked)
        return
      }

      if (wasDrag || !p.inside) return
      const t = target(p.x, p.y, true)
      if (!t) {
        st.notify('O cursor não encontra o plano de trabalho nesta vista — mude o plano ou gire a câmera.', 'err')
        return
      }
      commitPoint(t)
    }

    const onLeave = () => {
      if (down) return
      hover = null
      hideAll()
    }
    host.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    host.addEventListener('pointerleave', onLeave)
    return () => {
      host.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointerleave', onLeave)
      labelEl.current = null
      label.remove()
      box.remove()
    }
  }, [camera, gl, invalidate, rubberGeo, ghostGeo])

  // ao trocar de ferramenta, some o que era do comando anterior
  useEffect(() => {
    if (marker.current) marker.current.visible = false
    if (rubber.current) rubber.current.visible = false
    if (labelEl.current) labelEl.current.style.display = 'none'
    invalidate()
  }, [edit.tool, pending, invalidate])

  return (
    <group>
      <lineSegments geometry={grid.minor} raycast={() => null} renderOrder={1}>
        <lineBasicMaterial color={dark ? '#5d6f8c' : '#8794a8'} transparent opacity={dark ? 0.2 : 0.3} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={grid.major} raycast={() => null} renderOrder={1}>
        <lineBasicMaterial color={dark ? '#7f93b4' : '#66758c'} transparent opacity={dark ? 0.45 : 0.55} depthWrite={false} />
      </lineSegments>

      {/* nós por cima das barras: dentro de um tabuleiro largo a esfera do nó fica escondida */}
      <points geometry={nodesGeo} raycast={() => null} renderOrder={19} frustumCulled={false}>
        <pointsMaterial color={dark ? '#f2ede4' : '#2a2620'} size={idx.nNodes > 200 ? 3 : 5} sizeAttenuation={false} depthTest={false} toneMapped={false} />
      </points>

      <points geometry={selGeo} raycast={() => null} renderOrder={20} frustumCulled={false}>
        <pointsMaterial color={pal.selection} size={edit.sel.nodes.length > 40 ? 6 : 11} sizeAttenuation={false} depthTest={false} toneMapped={false} />
      </points>
      <points geometry={pendGeo} raycast={() => null} renderOrder={21} frustumCulled={false}>
        <pointsMaterial color={ACCENT} size={13} sizeAttenuation={false} depthTest={false} toneMapped={false} />
      </points>
      <points ref={ghost} geometry={ghostGeo} raycast={() => null} renderOrder={22} frustumCulled={false} visible={false}>
        <pointsMaterial color={ACCENT} size={9} sizeAttenuation={false} depthTest={false} toneMapped={false} />
      </points>

      <lineSegments ref={rubber} geometry={rubberGeo} raycast={() => null} renderOrder={23} frustumCulled={false} visible={false}>
        <lineBasicMaterial color={ACCENT} depthTest={false} toneMapped={false} />
      </lineSegments>
      <mesh ref={marker} raycast={() => null} renderOrder={24} visible={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshBasicMaterial color={ACCENT} depthTest={false} toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}
