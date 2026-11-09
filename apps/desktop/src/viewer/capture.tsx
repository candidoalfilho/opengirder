/**
 * Captura da vista 3D como PNG. O `<CaptureBridge />` (dentro do Canvas) registra o
 * renderizador; `captureView()` renderiza um quadro e lê o canvas na mesma tarefa — assim não
 * é preciso `preserveDrawingBuffer` (que custaria desempenho em todo quadro).
 */

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { Camera, Scene, WebGLRenderer } from 'three'

let current: { gl: WebGLRenderer; scene: Scene; camera: Camera } | null = null

export function CaptureBridge() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const me = { gl, scene, camera }
    current = me
    return () => {
      if (current === me) current = null
    }
  }, [gl, scene, camera])
  return null
}

/**
 * Data URL (PNG) da vista 3D atual, sobre o fundo do tema (o canvas é transparente).
 * Devolve null se não houver vista ativa ou se a leitura falhar.
 */
export function captureView(): string | null {
  if (!current) return null
  try {
    const { gl, scene, camera } = current
    gl.render(scene, camera)
    const src = gl.domElement
    if (!src.width || !src.height) return null
    const cv = document.createElement('canvas')
    cv.width = src.width
    cv.height = src.height
    const ctx = cv.getContext('2d')
    if (!ctx) return src.toDataURL('image/png')
    const css = getComputedStyle(document.documentElement)
    const top = css.getPropertyValue('--canvas-top').trim() || '#1c2129'
    const bottom = css.getPropertyValue('--canvas-bottom').trim() || '#13110d'
    const g = ctx.createLinearGradient(0, 0, 0, cv.height)
    g.addColorStop(0, top)
    g.addColorStop(1, bottom)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.drawImage(src, 0, 0)
    return cv.toDataURL('image/png')
  } catch {
    return null
  }
}
