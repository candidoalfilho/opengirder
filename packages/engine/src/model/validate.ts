import type { BridgeModel } from './types'

/** Valida o modelo; devolve a lista de erros (vazia = ok). */
export function validateModel(model: BridgeModel): string[] {
  const errors: string[] = []
  if (!model || model.schema !== 'opengirder/1') return ['Arquivo não é um modelo OpenGirder (schema opengirder/1).']
  const ids = new Set<number>()
  for (const n of model.nodes) {
    if (ids.has(n.id)) errors.push(`Nó ${n.id} duplicado.`)
    ids.add(n.id)
    if (![n.x, n.y, n.z].every(Number.isFinite)) errors.push(`Nó ${n.id} com coordenada inválida.`)
  }
  if (model.nodes.length < 2) errors.push('O modelo precisa de pelo menos 2 nós.')
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  for (const m of model.materials) {
    if (!(m.E > 0)) errors.push(`Material "${m.name}": módulo de elasticidade deve ser positivo.`)
  }
  const pos = new Map(model.nodes.map((n) => [n.id, n]))
  const eids = new Set<number>()
  let nEl = 0
  for (const e of model.elements) {
    if (eids.has(e.id)) errors.push(`Elemento ${e.id} duplicado.`)
    eids.add(e.id)
    const a = pos.get(e.n1)
    const b = pos.get(e.n2)
    if (!a || !b) {
      errors.push(`Elemento ${e.id} referencia nó inexistente.`)
      continue
    }
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9) errors.push(`Elemento ${e.id} tem comprimento nulo.`)
    if (!mats.has(e.mat)) errors.push(`Elemento ${e.id}: material "${e.mat}" não existe.`)
    if (e.kind === 'frame') {
      const s = secs.get(e.sec)
      if (!s) errors.push(`Barra ${e.id}: seção "${e.sec}" não existe.`)
      else if (!(s.A > 0 && s.Iy > 0 && s.Iz > 0 && s.J > 0)) {
        errors.push(`Seção "${s.name}": A, Iy, Iz e J devem ser positivos.`)
      }
    } else {
      if (!(e.A > 0)) errors.push(`Cabo ${e.id}: área deve ser positiva.`)
      if (e.L0 !== undefined && !(e.L0 > 0)) errors.push(`Cabo ${e.id}: comprimento indeformado inválido.`)
    }
    nEl++
  }
  if (nEl === 0) errors.push('O modelo não tem elementos.')
  if (!model.nodes.some((n) => n.fix?.some(Boolean) || n.springs?.some((k) => k > 0))) {
    errors.push('O modelo não tem apoios.')
  }
  for (const l of model.lanes) {
    if (l.nodes.some((id) => !pos.has(id))) errors.push(`Faixa "${l.name}" referencia nó inexistente.`)
    if (!(l.width > 0)) errors.push(`Faixa "${l.name}": largura deve ser positiva.`)
  }
  return Array.from(new Set(errors)).slice(0, 50)
}
