import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { BridgeModel, BridgeResults } from '@opengirder/engine'
import type { Overlay, Selection, Theme, ViewState } from '../store'
import { fmt, fmtAuto, MODE_KIND_LABEL } from '../format'
import {
  buildDiagram,
  buildIndex,
  cableColors,
  cableScale,
  displaced,
  fillCables,
  fillFrameMatrices,
  frameColors,
  ghostLines,
  maxTranslation,
  PALETTES,
  RAMP_CSS,
  type CableScale,
  type DiagramData,
  type Palette,
  type SceneIndex,
} from './scene'

export type CameraPreset = 'iso' | 'elev' | 'plan' | 'front'

export interface ViewerProps {
  model: BridgeModel
  results: BridgeResults | null
  view: ViewState
  selection: Selection | null
  onSelect?: (s: Selection | null) => void
  /** muda → reenquadra a câmera */
  fitKey: number | string
  theme: Theme
  /** comando de câmera vindo da barra: `n` muda a cada clique */
  cameraCmd?: { preset: CameraPreset; n: number }
  showLegend?: boolean
  /** campo de deslocamentos extra (modo 'custom'): flambagem, caso de carga, fase… */
  overlay?: Overlay | null
}

interface Anim {
  shape: number[]
  amp: number
}

/** período visual da animação dos modos (s) — o período real aparece na legenda */
const ANIM_PERIOD = 2.4

const DIAGRAM_UNIT: Record<string, string> = { Mz: 'kN·m', Vy: 'kN', N: 'kN' }
const DIAGRAM_LABEL: Record<string, string> = {
  Mz: 'Momento fletor Mz',
  Vy: 'Força cortante Vy',
  N: 'Força normal N',
}

export function Viewer(props: ViewerProps) {
  const { model, results, view, selection, onSelect, fitKey, theme, cameraCmd, showLegend = true } = props
  const pal = PALETTES[theme]
  const overlay = view.mode === 'custom' ? (props.overlay ?? null) : null
  const hideIds = overlay?.hideElements

  const idx = useMemo(() => buildIndex(model, results, view.hidden, hideIds), [model, results, view.hidden, hideIds])

  const deform = useMemo(() => {
    const u = overlay ? (overlay.animate ? null : overlay.u) : view.mode === 'deformed' ? results?.deadLoad.u : null
    if (!u) return null
    const mx = maxTranslation(u, idx.nNodes)
    const auto = mx.value > 1e-9 ? (0.04 * idx.diag) / mx.value : 1
    const scale = auto * view.scaleMul
    return { scale, max: mx, pos: displaced(idx, u, scale) }
  }, [view.mode, view.scaleMul, results, idx, overlay])

  const mode = view.mode === 'mode' ? (results?.modal?.modes[view.modeIndex] ?? null) : null
  const anim = useMemo<Anim | null>(() => {
    const shape = mode?.shape ?? (overlay?.animate ? overlay.u : null)
    if (!shape) return null
    // formas não normalizadas (overlay): a amplitude de desenho é relativa à maior translação
    const mx = mode ? 1 : maxTranslation(shape, idx.nNodes).value || 1
    return { shape, amp: (0.035 * idx.diag * view.scaleMul) / mx }
  }, [mode, overlay, idx.diag, idx.nNodes, view.scaleMul])

  const cscale = useMemo(
    () => (view.mode === 'cables' ? cableScale(idx, results, view.cableBy) : null),
    [view.mode, view.cableBy, idx, results],
  )

  const diagram = useMemo(
    () => (view.mode === 'diagram' && results ? buildDiagram(idx, results, view.diagram, view.scaleMul) : null),
    [view.mode, view.diagram, view.scaleMul, idx, results],
  )

  const pos = deform?.pos ?? idx.base

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        camera={{ up: [0, 0, 1], fov: 32, near: 0.5, far: 100000, position: [-idx.diag, -idx.diag, idx.diag * 0.5] }}
        gl={{ logarithmicDepthBuffer: true, antialias: true, alpha: true }}
        dpr={[1, 2]}
        frameloop={anim ? 'always' : 'demand'}
        onPointerMissed={() => onSelect?.(null)}
      >
        <CameraRig idx={idx} fitKey={fitKey} cameraCmd={cameraCmd} />
        <ambientLight intensity={1.15} />
        <hemisphereLight args={['#ffffff', '#3a3226', 0.7]} />
        <directionalLight position={[-0.5 * idx.diag, -0.9 * idx.diag, 1.1 * idx.diag]} intensity={1.9} />
        <directionalLight position={[0.6 * idx.diag, 0.8 * idx.diag, 0.4 * idx.diag]} intensity={0.6} />
        <Ground idx={idx} pal={pal} />
        <BridgeScene
          idx={idx}
          pos={pos}
          anim={anim}
          cscale={cscale}
          diagram={diagram}
          pal={pal}
          selection={selection}
          onSelect={onSelect}
          showNodes={view.showNodes}
          dimFrames={view.mode === 'cables'}
          ghost={view.mode === 'deformed' || view.mode === 'mode' || view.mode === 'custom'}
        />
      </Canvas>
      {showLegend && (
        <Legend
          view={view}
          results={results}
          idx={idx}
          deform={deform ? { scale: deform.scale, max: deform.max.value, node: deform.max.node } : null}
          overlay={overlay}
          cscale={cscale}
          diagram={diagram}
          pal={pal}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ câmera */

function CameraRig({
  idx,
  fitKey,
  cameraCmd,
}: {
  idx: SceneIndex
  fitKey: number | string
  cameraCmd?: { preset: CameraPreset; n: number }
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const raycaster = useThree((s) => s.raycaster)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useRef<any>(null)
  const idxRef = useRef(idx)
  idxRef.current = idx

  const fit = (preset: CameraPreset) => {
    const { diag, size: box } = idxRef.current
    const dirs: Record<CameraPreset, [number, number, number]> = {
      iso: [-0.5, -0.82, 0.3],
      elev: [0, -1, 0.05],
      plan: [0, -0.002, 1],
      front: [-1, 0, 0.12],
    }
    const dir = new THREE.Vector3(...dirs[preset]).normalize()
    const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1.6
    const fovV = (camera.fov * Math.PI) / 180
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect)
    // projeta os 8 cantos da caixa envolvente nos eixos da câmera p/ enquadrar justo
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), dir).normalize()
    const camUp = new THREE.Vector3().crossVectors(dir, right)
    const c = new THREE.Vector3()
    let halfW = 0
    let halfH = 0
    let depth = 0
    for (let k = 0; k < 8; k++) {
      c.set(((k & 1 ? 1 : -1) * box[0]) / 2, ((k & 2 ? 1 : -1) * box[1]) / 2, ((k & 4 ? 1 : -1) * box[2]) / 2)
      halfW = Math.max(halfW, Math.abs(c.dot(right)))
      halfH = Math.max(halfH, Math.abs(c.dot(camUp)))
      depth = Math.max(depth, c.dot(dir))
    }
    const margin = 1.14
    const dist =
      Math.max((halfW * margin) / Math.tan(fovH / 2), (halfH * margin) / Math.tan(fovV / 2), diag * 0.02) + depth
    camera.position.copy(dir.multiplyScalar(dist))
    camera.near = Math.max(0.05, diag / 5000)
    camera.far = diag * 60
    camera.updateProjectionMatrix()
    if (controls.current) {
      controls.current.target.set(0, 0, 0)
      controls.current.update()
    }
    invalidate()
  }

  useEffect(() => {
    fit('iso')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  useEffect(() => {
    if (cameraCmd && cameraCmd.n > 0) fit(cameraCmd.preset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraCmd?.n])

  useEffect(() => {
    raycaster.params.Line = { threshold: idx.diag * 0.003 }
  }, [raycaster, idx.diag])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.14}
      zoomToCursor
      minDistance={idx.diag * 0.002}
      maxDistance={idx.diag * 10}
    />
  )
}

/* ------------------------------------------------------------------- solo */

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))))
  const f = x / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

function Ground({ idx, pal }: { idx: SceneIndex; pal: Palette }) {
  const step = niceStep(idx.diag / 24)
  const divisions = Math.max(8, 2 * Math.ceil((idx.diag * 1.3) / step))
  const z = idx.zMin
  return (
    <group>
      <mesh position={[0, 0, z - idx.diag * 2e-4]} raycast={() => null}>
        <circleGeometry args={[(divisions * step) / 2, 72]} />
        <meshBasicMaterial color={pal.ground} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <gridHelper
        key={`${step}-${divisions}-${pal.grid}`}
        args={[divisions * step, divisions, pal.grid, pal.grid]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, z]}
        raycast={() => null}
      >
        <lineBasicMaterial attach="material" color={pal.grid} transparent opacity={0.55} depthWrite={false} />
      </gridHelper>
    </group>
  )
}

/* ------------------------------------------------------------------- cena */

interface SceneProps {
  idx: SceneIndex
  pos: Float64Array
  anim: Anim | null
  cscale: CableScale | null
  diagram: DiagramData | null
  pal: Palette
  selection: Selection | null
  onSelect?: (s: Selection | null) => void
  showNodes: boolean
  dimFrames: boolean
  ghost: boolean
}

const _nm = new THREE.Matrix4()

function BridgeScene(p: SceneProps) {
  const { idx, pos, anim, cscale, diagram, pal, selection, onSelect, showNodes, dimFrames, ghost } = p
  const invalidate = useThree((s) => s.invalidate)
  const frameRef = useRef<THREE.InstancedMesh>(null)
  const tubeRef = useRef<THREE.InstancedMesh>(null)
  const nodeRef = useRef<THREE.InstancedMesh>(null)
  const supportRef = useRef<THREE.InstancedMesh>(null)
  const scratch = useRef<Float64Array>(new Float64Array(0))

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(idx.totalSegs * 6), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(idx.totalSegs * 6), 3))
    return g
  }, [idx])
  useEffect(() => () => lineGeo.dispose(), [lineGeo])

  const nodeR = idx.diag * 0.0026
  const supportR = Math.min(Math.max(idx.diag * 0.008, 0.6), 14)

  const supportGeo = useMemo(() => {
    // cone com o vértice na origem apontando p/ +Z (apoio fica abaixo do nó)
    const g = new THREE.ConeGeometry(0.62, 1, 4)
    g.rotateX(Math.PI / 2)
    g.translate(0, 0, -0.5)
    return g
  }, [])
  useEffect(() => () => supportGeo.dispose(), [supportGeo])

  const place = (positions: Float64Array) => {
    if (frameRef.current) fillFrameMatrices(frameRef.current, idx, positions)
    const lp = lineGeo.getAttribute('position') as THREE.BufferAttribute
    fillCables(idx, positions, lp.array as Float32Array, tubeRef.current)
    lp.needsUpdate = true
    const nm = nodeRef.current
    if (nm) {
      for (let i = 0; i < idx.nNodes; i++) {
        _nm.makeScale(nodeR, nodeR, nodeR).setPosition(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2])
        nm.setMatrixAt(i, _nm)
      }
      nm.instanceMatrix.needsUpdate = true
      nm.boundingSphere = null
    }
  }

  // geometria estática (modelo, deformada); também restaura ao sair da animação
  useLayoutEffect(() => {
    place(pos)
    lineGeo.computeBoundingSphere()
    const sm = supportRef.current
    if (sm) {
      idx.supports.forEach((s, k) => {
        const r = s.kind === 'fixed' ? supportR * 1.15 : supportR
        _nm.makeScale(r, r, r).setPosition(idx.base[3 * s.i], idx.base[3 * s.i + 1], idx.base[3 * s.i + 2])
        sm.setMatrixAt(k, _nm)
      })
      sm.instanceMatrix.needsUpdate = true
      sm.boundingSphere = null
    }
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, pos, anim, lineGeo, showNodes])

  useLayoutEffect(() => {
    if (frameRef.current) frameColors(frameRef.current, idx, pal, dimFrames, selection)
    const lc = lineGeo.getAttribute('color') as THREE.BufferAttribute
    cableColors(idx, pal, cscale, selection, lc.array as Float32Array, tubeRef.current)
    lc.needsUpdate = true
    invalidate()
  }, [idx, pal, cscale, selection, dimFrames, lineGeo, invalidate])

  useFrame(({ clock }) => {
    if (!anim) return
    if (scratch.current.length !== idx.base.length) scratch.current = new Float64Array(idx.base.length)
    const s = anim.amp * Math.sin((clock.elapsedTime * 2 * Math.PI) / ANIM_PERIOD)
    place(displaced(idx, anim.shape, s, scratch.current))
  })

  const clickFrame = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect || e.delta > 3 || e.instanceId === undefined) return
    e.stopPropagation()
    const f = idx.frames[e.instanceId]
    if (f) onSelect({ kind: 'element', id: f.el.id })
  }
  const clickTube = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect || e.delta > 3 || e.instanceId === undefined) return
    e.stopPropagation()
    const c = idx.cables[idx.segCable[e.instanceId]]
    if (c) onSelect({ kind: 'element', id: c.el.id })
  }
  const clickLine = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect || e.delta > 3 || e.index === undefined) return
    e.stopPropagation()
    const c = idx.cables[idx.segCable[Math.floor(e.index / 2)]]
    if (c) onSelect({ kind: 'element', id: c.el.id })
  }
  const clickNode = (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect || e.delta > 3 || e.instanceId === undefined) return
    e.stopPropagation()
    const nd = idx.model.nodes[e.instanceId]
    if (nd) onSelect({ kind: 'node', id: nd.id })
  }

  const selNode = selection?.kind === 'node' ? idx.nodeIndex.get(selection.id) : undefined
  const interactive = !!onSelect

  return (
    <group>
      {idx.frames.length > 0 && (
        <instancedMesh
          key={`f${idx.frames.length}`}
          ref={frameRef}
          args={[undefined, undefined, idx.frames.length]}
          frustumCulled={false}
          onClick={interactive ? clickFrame : undefined}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial roughness={0.78} metalness={0.04} side={THREE.DoubleSide} />
        </instancedMesh>
      )}

      {idx.totalSegs > 0 && (
        <>
          <instancedMesh
            key={`t${idx.totalSegs}`}
            ref={tubeRef}
            args={[undefined, undefined, idx.totalSegs]}
            frustumCulled={false}
            onClick={interactive ? clickTube : undefined}
          >
            <cylinderGeometry args={[1, 1, 1, 8, 1, true]} />
            <meshStandardMaterial roughness={0.55} metalness={0.1} />
          </instancedMesh>
          <lineSegments geometry={lineGeo} frustumCulled={false} onClick={interactive ? clickLine : undefined}>
            <lineBasicMaterial vertexColors toneMapped={false} />
          </lineSegments>
        </>
      )}

      {showNodes && idx.nNodes > 0 && (
        <instancedMesh
          key={`n${idx.nNodes}`}
          ref={nodeRef}
          args={[undefined, undefined, idx.nNodes]}
          frustumCulled={false}
          onClick={interactive ? clickNode : undefined}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color={pal.node} toneMapped={false} />
        </instancedMesh>
      )}

      {idx.supports.length > 0 && (
        <instancedMesh
          key={`s${idx.supports.length}`}
          ref={supportRef}
          args={[supportGeo, undefined, idx.supports.length]}
          frustumCulled={false}
          raycast={() => null}
        >
          <meshStandardMaterial color={pal.support} roughness={0.6} flatShading />
        </instancedMesh>
      )}

      {selNode !== undefined && (
        <mesh position={[pos[3 * selNode], pos[3 * selNode + 1], pos[3 * selNode + 2]]} raycast={() => null}>
          <sphereGeometry args={[nodeR * 2.2, 16, 12]} />
          <meshBasicMaterial color={pal.selection} toneMapped={false} />
        </mesh>
      )}

      {ghost && <GhostLines idx={idx} color={pal.ghost} />}
      {diagram && <DiagramMesh data={diagram} pal={pal} />}
    </group>
  )
}

function useBufferGeometry(positions: Float32Array): THREE.BufferGeometry {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [positions])
  useEffect(() => () => geo.dispose(), [geo])
  return geo
}

function GhostLines({ idx, color }: { idx: SceneIndex; color: string }) {
  const positions = useMemo(() => ghostLines(idx), [idx])
  const geo = useBufferGeometry(positions)
  return (
    <lineSegments geometry={geo} frustumCulled={false} raycast={() => null}>
      <lineBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} depthWrite={false} />
    </lineSegments>
  )
}

function DiagramMesh({ data, pal }: { data: DiagramData; pal: Palette }) {
  const fill = useBufferGeometry(data.fill)
  const line = useBufferGeometry(data.line)
  const env = useBufferGeometry(data.env)
  return (
    <group>
      <mesh geometry={fill} frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial
          color={pal.diagram}
          transparent
          opacity={0.32}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={line} frustumCulled={false} raycast={() => null}>
        <lineBasicMaterial color={pal.diagram} toneMapped={false} />
      </lineSegments>
      {data.hasEnvelope && (
        <lineSegments geometry={env} frustumCulled={false} raycast={() => null}>
          <lineBasicMaterial color={pal.envelope} toneMapped={false} />
        </lineSegments>
      )}
    </group>
  )
}

/* ----------------------------------------------------------------- legenda */

function Legend({
  view,
  results,
  idx,
  deform,
  overlay,
  cscale,
  diagram,
  pal,
}: {
  view: ViewState
  results: BridgeResults | null
  idx: SceneIndex
  overlay: Overlay | null
  deform: { scale: number; max: number; node: number } | null
  cscale: CableScale | null
  diagram: DiagramData | null
  pal: Palette
}) {
  if (view.mode === 'model') return null
  if (view.mode === 'custom') {
    if (!overlay) return null
    const nd = deform && deform.node >= 0 ? idx.model.nodes[deform.node] : null
    return (
      <div className="view-legend">
        <div className="title">{overlay.label}</div>
        {overlay.note && <div className="line">{overlay.note}</div>}
        {deform && (
          <>
            <div className="line">
              Deslocamento máximo <b>{fmt(deform.max * 1000, 1)} mm</b>
              {nd ? <span className="dim">nó {nd.id}</span> : null}
            </div>
            <div className="line">
              Escala de desenho <b>×{fmtAuto(deform.scale)}</b>
            </div>
          </>
        )}
      </div>
    )
  }
  if (!results) {
    return (
      <div className="view-legend">
        <div className="title">Sem resultados</div>
        Rode a análise para ver esta visualização.
      </div>
    )
  }
  if (view.mode === 'deformed' && deform) {
    const nd = deform.node >= 0 ? idx.model.nodes[deform.node] : null
    return (
      <div className="view-legend">
        <div className="title">Deformada — carga permanente</div>
        <div className="line">
          Deslocamento máximo <b>{fmt(deform.max * 1000, 1)} mm</b>
          {nd ? <span className="dim">nó {nd.id}</span> : null}
        </div>
        <div className="line">
          Escala de desenho <b>×{fmtAuto(deform.scale)}</b>
        </div>
      </div>
    )
  }
  if (view.mode === 'cables') {
    if (!cscale) {
      return (
        <div className="view-legend">
          <div className="title">Cabos</div>
          {idx.cables.length === 0 ? 'Este modelo não tem cabos visíveis.' : 'Sem resultados de cabos nesta análise.'}
        </div>
      )
    }
    const isT = cscale.by === 'T'
    return (
      <div className="view-legend">
        <div className="title">{isT ? 'Tração permanente nos cabos (kN)' : 'Aproveitamento ELS: T / (0,45·Fu)'}</div>
        <div className="ramp" style={{ background: RAMP_CSS }} />
        <div className="ramp-labels">
          <span>{isT ? fmtAuto(cscale.min) : fmt(cscale.min, 2)}</span>
          <span>{isT ? fmtAuto((cscale.min + cscale.max) / 2) : fmt((cscale.min + cscale.max) / 2, 2)}</span>
          <span>{isT ? fmtAuto(cscale.max) : fmt(cscale.max, 2)}</span>
        </div>
      </div>
    )
  }
  if (view.mode === 'diagram') {
    if (!diagram) {
      return (
        <div className="view-legend">
          <div className="title">{DIAGRAM_LABEL[view.diagram]}</div>
          Sem barras com esforços para desenhar.
        </div>
      )
    }
    const unit = DIAGRAM_UNIT[view.diagram]
    return (
      <div className="view-legend">
        <div className="title">
          {DIAGRAM_LABEL[view.diagram]} ({unit})
        </div>
        <div className="line">
          <span className="swatch" style={{ background: pal.diagram }} />
          Permanente <b>{fmtAuto(diagram.deadMin)}</b> a <b>{fmtAuto(diagram.deadMax)}</b>
        </div>
        {diagram.hasEnvelope && (
          <div className="line">
            <span className="swatch" style={{ background: pal.envelope }} />
            Permanente + móvel <b>{fmtAuto(diagram.envMin)}</b> a <b>{fmtAuto(diagram.envMax)}</b>
          </div>
        )}
        {view.diagram === 'Mz' && <div className="line dim">Desenhado do lado tracionado</div>}
      </div>
    )
  }
  if (view.mode === 'mode') {
    const m = results.modal?.modes[view.modeIndex]
    if (!m) {
      return (
        <div className="view-legend">
          <div className="title">Modos de vibração</div>
          A análise modal não foi executada.
        </div>
      )
    }
    return (
      <div className="view-legend">
        <div className="title">
          Modo {m.index} — {MODE_KIND_LABEL[m.kind] ?? m.kind}
        </div>
        <div className="line">
          T = <b>{fmt(m.period, 3)} s</b> &nbsp; f = <b>{fmt(m.frequency, 4)} Hz</b>
        </div>
        <div className="line dim">
          Massa efetiva X {fmt(m.massPct[0], 1)}% · Y {fmt(m.massPct[1], 1)}% · Z {fmt(m.massPct[2], 1)}%
        </div>
      </div>
    )
  }
  return null
}
