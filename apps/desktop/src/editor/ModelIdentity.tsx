/**
 * Nome e tipo do modelo, editáveis no painel esquerdo enquanto o modo de edição está ligado.
 * O tipo decide os textos da interface e quais abas aparecem (ex.: Fases só em estaiadas).
 */

import { useEffect, useState } from 'react'
import type { BridgeType } from '@opengirder/engine'
import { useStore } from '../store'
import { TYPE_LABEL } from '../format'

const TYPES: BridgeType[] = ['girder', 'arch', 'cable-stayed', 'suspension']

export function ModelIdentity() {
  const active = useStore((s) => s.edit.active)
  const model = useStore((s) => s.model)
  const rename = useStore((s) => s.renameModel)
  const updateModel = useStore((s) => s.updateModel)
  const [name, setName] = useState(model?.name ?? '')
  useEffect(() => setName(model?.name ?? ''), [model?.name])
  if (!active || !model) return null
  const commit = () => {
    const t = name.trim()
    if (t && t !== model.name) rename(t)
    else setName(model.name)
  }
  return (
    <div className="edt-identity">
      <div className="field">
        <label className="label">Nome da obra</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="field">
        <label className="label">Tipo de ponte</label>
        <select
          className="select"
          value={model.type}
          onChange={(e) => {
            const type = e.target.value as BridgeType
            const keep = useStore.getState().edit.sel
            updateModel((m) => ({ ...m, type }))
            useStore.getState().setEdit({ sel: keep })
          }}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
