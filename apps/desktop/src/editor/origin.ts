/**
 * Origem fixa da cena durante a edição. Fora da edição a cena é centrada na caixa envolvente
 * do modelo; se isso valesse enquanto se desenha, cada nó novo fora da caixa faria o modelo
 * inteiro "andar" na tela. No modo de edição a origem é congelada (por modelo carregado) e
 * há uma caixa mínima de trabalho, para a câmera e o tamanho dos nós fazerem sentido mesmo
 * com o modelo vazio.
 */

import { useMemo, useRef } from 'react'
import type { BridgeModel, Vec3 } from '@opengirder/engine'
import { useStore } from '../store'

export interface FixedFrame {
  origin: Vec3
  box: [Vec3, Vec3]
}

/** caixa de trabalho de um modelo vazio: 120 m de extensão, 60 m de altura */
const EMPTY_BOX: [Vec3, Vec3] = [[0, -10, 0], [120, 10, 60]]

export function workBox(model: BridgeModel): [Vec3, Vec3] {
  if (model.nodes.length === 0) return [[...EMPTY_BOX[0]], [...EMPTY_BOX[1]]]
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const n of model.nodes) {
    min[0] = Math.min(min[0], n.x); min[1] = Math.min(min[1], n.y); min[2] = Math.min(min[2], n.z)
    max[0] = Math.max(max[0], n.x); max[1] = Math.max(max[1], n.y); max[2] = Math.max(max[2], n.z)
  }
  // modelo ainda pequeno: garante uma caixa de pelo menos 60 × 30 m em elevação
  const padX = Math.max(0, 60 - (max[0] - min[0])) / 2
  const padZ = Math.max(0, 30 - (max[2] - min[2]))
  return [[min[0] - padX, min[1], min[2]], [max[0] + padX, max[1], max[2] + padZ]]
}

/** devolve a origem fixa enquanto o modo de edição estiver ativo nesta vista; senão undefined */
export function useEditOrigin(model: BridgeModel, allowed: boolean, fitKey: number | string): FixedFrame | undefined {
  const active = useStore((s) => s.edit.active)
  const on = allowed && active
  const modelRef = useRef(model)
  modelRef.current = model
  return useMemo(() => {
    if (!on) return undefined
    const box = workBox(modelRef.current)
    const origin: Vec3 = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2]
    return { origin, box }
    // o modelo fica fora das dependências de propósito: a origem só muda com outro modelo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, fitKey])
}
