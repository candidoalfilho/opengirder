/**
 * Diagnóstico do modelo — o que impede ou compromete a análise de um modelo montado à mão,
 * em linguagem de engenheiro, com a seleção do que está errado e, quando existe, a operação
 * que corrige (`fix` = chave de `EDIT_ACTIONS`).
 *
 * Função pura: não altera o modelo.
 */

import { validateModel, type BridgeModel, type BridgeNode } from '@opengirder/engine'
import type { EditSelection, EditValues } from './types'
import { mergeCoincidentNodes } from './ops'
import { deckSupportNodes } from './lanes'

export interface Diagnostic {
  severity: 'erro' | 'aviso' | 'dica'
  text: string
  /** o que selecionar p/ ver o problema */
  select?: EditSelection
  /** chave da ação de `EDIT_ACTIONS` que resolve */
  fix?: string
  /** valores da ação, quando os padrões não servem */
  fixValues?: EditValues
  /** rótulo do botão de correção */
  fixLabel?: string
}

const CABLE_GROUPS = new Set(['stay', 'hanger', 'main-cable'])
const list = (ids: number[], max = 8): string => `${ids.slice(0, max).join(', ')}${ids.length > max ? '…' : ''}`
const restrained = (n: BridgeNode, d: number): boolean => !!n.fix?.[d] || (n.springs?.[d] ?? 0) > 0

export function diagnose(model: BridgeModel): Diagnostic[] {
  const out: Diagnostic[] = []
  const byId = new Map(model.nodes.map((n) => [n.id, n]))

  // ---- validação básica do motor
  for (const msg of validateModel(model)) {
    const sel: EditSelection = { nodes: [], elements: [] }
    const el = /(?:Elemento|Barra|Cabo) (\d+)/.exec(msg)
    const nd = /Nó (\d+)/.exec(msg)
    if (el) sel.elements.push(Number(el[1]))
    if (nd) sel.nodes.push(Number(nd[1]))
    out.push({ severity: 'erro', text: msg, ...(sel.nodes.length || sel.elements.length ? { select: sel } : {}) })
  }
  if (model.nodes.length === 0) return out

  const frameAt = new Map<number, number>()
  const cableAt = new Map<number, number>()
  const adj = new Map<number, number[]>()
  for (const e of model.elements) {
    if (!byId.has(e.n1) || !byId.has(e.n2)) continue
    const m = e.kind === 'frame' ? frameAt : cableAt
    m.set(e.n1, (m.get(e.n1) ?? 0) + 1)
    m.set(e.n2, (m.get(e.n2) ?? 0) + 1)
    adj.set(e.n1, [...(adj.get(e.n1) ?? []), e.n2])
    adj.set(e.n2, [...(adj.get(e.n2) ?? []), e.n1])
  }

  // ---- nós soltos
  const loose = model.nodes.filter((n) => !adj.has(n.id)).map((n) => n.id)
  if (loose.length && model.elements.length) {
    out.push({ severity: 'aviso', text: `${loose.length} nó(s) solto(s), sem nenhum elemento: ${list(loose)}. São ignorados na análise.`, select: { nodes: loose, elements: [] }, fix: 'loose', fixLabel: 'Remover nós soltos' })
  }

  // ---- nós coincidentes e elementos duplicados
  const merged = mergeCoincidentNodes(model)
  if (merged.merged > 0) {
    const kept = new Set(merged.model.nodes.map((n) => n.id))
    const gone = model.nodes.filter((n) => !kept.has(n.id)).map((n) => n.id)
    out.push({
      severity: 'aviso',
      text: `${gone.length} nó(s) no mesmo lugar de outro (a menos de 1 mm): ${list(gone)}. Barras que deveriam se encontrar ali não estão ligadas.`,
      select: { nodes: gone, elements: [] },
      fix: 'merge',
      fixLabel: 'Unir nós',
    })
  }
  const pair = new Map<string, number>()
  const dup: number[] = []
  for (const e of model.elements) {
    const k = `${Math.min(e.n1, e.n2)}-${Math.max(e.n1, e.n2)}`
    if (pair.has(k)) dup.push(e.id)
    else pair.set(k, e.id)
  }
  if (dup.length) {
    out.push({ severity: 'aviso', text: `${dup.length} elemento(s) repetido(s) entre os mesmos dois nós: ${list(dup)}. A rigidez e o peso entram em dobro.`, select: { nodes: [], elements: dup }, fix: 'merge', fixLabel: 'Remover repetidos' })
  }

  // ---- partes separadas
  const comp = new Map<number, number>()
  const comps: number[][] = []
  for (const start of adj.keys()) {
    if (comp.has(start)) continue
    const idx = comps.length
    const nodes: number[] = []
    const queue = [start]
    comp.set(start, idx)
    while (queue.length) {
      const cur = queue.pop()!
      nodes.push(cur)
      for (const nb of adj.get(cur) ?? []) {
        if (!comp.has(nb)) {
          comp.set(nb, idx)
          queue.push(nb)
        }
      }
    }
    comps.push(nodes)
  }
  if (comps.length > 1) {
    const sorted = [...comps].sort((a, b) => b.length - a.length)
    const others = new Set(sorted.slice(1).flat())
    const els = model.elements.filter((e) => others.has(e.n1)).map((e) => e.id)
    out.push({
      severity: 'aviso',
      text: `A estrutura tem ${comps.length} partes separadas, sem ligação entre si. Se deveriam estar ligadas, falta uma barra ou há nós que não coincidem.`,
      select: { nodes: [], elements: els },
    })
  }
  for (const nodes of comps) {
    if (nodes.some((id) => [0, 1, 2, 3, 4, 5].some((d) => restrained(byId.get(id)!, d)))) continue
    const set = new Set(nodes)
    out.push({
      severity: 'erro',
      text: `Parte da estrutura sem nenhum apoio (${nodes.length} nós, a partir do nó ${Math.min(...nodes)}): é um mecanismo.`,
      select: { nodes: [], elements: model.elements.filter((e) => set.has(e.n1)).map((e) => e.id) },
    })
  }

  // ---- apoios
  const sup = model.nodes.filter((n) => adj.has(n.id) && [0, 1, 2, 3, 4, 5].some((d) => restrained(n, d)))
  if (sup.length) {
    const count = sup.reduce((s, n) => s + [0, 1, 2, 3, 4, 5].filter((d) => restrained(n, d)).length, 0)
    const names = ['ux (ao longo da ponte)', 'uy (transversal)', 'uz (vertical)']
    for (let d = 0; d < 3; d++) {
      if (!sup.some((n) => restrained(n, d))) {
        out.push({ severity: 'erro', text: `Nenhum apoio impede o deslocamento ${names[d]}: a estrutura fica solta nessa direção.`, select: { nodes: sup.map((n) => n.id), elements: [] } })
      }
    }
    if (count < 6) {
      out.push({ severity: 'erro', text: `Só ${count} restrição(ões) de apoio: são precisas ao menos 6 para impedir o movimento de corpo rígido.`, select: { nodes: sup.map((n) => n.id), elements: [] } })
    }
    // torção global: apoios verticais todos na mesma linha longitudinal e nenhum segura rx
    const vert = sup.filter((n) => restrained(n, 2))
    if (vert.length && !sup.some((n) => restrained(n, 3))) {
      const y0 = vert[0].y
      if (vert.every((n) => Math.abs(n.y - y0) < 0.05)) {
        out.push({
          severity: 'erro',
          text: 'Nada impede a rotação em torno do eixo da ponte (torção): os apoios verticais estão alinhados e nenhum segura rx. Marque rx num apoio do tabuleiro ou use apoios afastados na transversal.',
          select: { nodes: vert.map((n) => n.id), elements: [] },
        })
      }
    }
  }

  // ---- tabuleiro
  const deck = model.elements.filter((e) => e.kind === 'frame' && e.group === 'deck')
  const deckNodes = new Set(deck.flatMap((e) => [e.n1, e.n2]))
  if (deck.length) {
    // torção do tabuleiro: algum nó com rx, ou ligado a barra de outro grupo (torre, pilar, transversina)
    let held = false
    for (const id of deckNodes) if (restrained(byId.get(id)!, 3)) held = true
    if (!held) {
      for (const e of model.elements) {
        if (e.kind === 'frame' && e.group !== 'deck' && (deckNodes.has(e.n1) || deckNodes.has(e.n2))) {
          held = true
          break
        }
      }
    }
    if (!held) {
      const ends = [...deckNodes].filter((id) => restrained(byId.get(id)!, 2))
      out.push({
        severity: 'aviso',
        text: 'O tabuleiro não tem restrição à torção: nenhum nó dele segura rx nem está ligado a torre, pilar ou transversina. Marque rx nos apoios de extremidade.',
        select: { nodes: ends.length ? ends : [...deckNodes].slice(0, 2), elements: [] },
      })
    }
    // malha grossa
    let total = 0
    const len = new Map<number, number>()
    for (const e of deck) {
      const a = byId.get(e.n1)
      const b = byId.get(e.n2)
      if (!a || !b) continue
      const L = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
      len.set(e.id, L)
      total += L
    }
    const long = deck.filter((e) => (len.get(e.id) ?? 0) > Math.max(10, total / 12)).map((e) => e.id)
    if (long.length) {
      out.push({
        severity: 'dica',
        text: `${long.length} barra(s) longa(s) no tabuleiro (mais de ${Math.max(10, total / 12).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m). A carga móvel e os diagramas usam os nós do tabuleiro: divida em trechos menores.`,
        select: { nodes: [], elements: long },
        fix: 'divide-spacing',
        fixValues: { spacing: Math.max(2, Math.min(10, Math.round(total / 24))) },
        fixLabel: 'Dividir',
      })
    }
  }

  // ---- cabos
  const cables = model.elements.filter((e) => e.kind === 'cable')
  const noGroup = cables.filter((e) => !CABLE_GROUPS.has(e.group ?? '')).map((e) => e.id)
  if (noGroup.length) {
    out.push({
      severity: 'aviso',
      text: `${noGroup.length} cabo(s) sem grupo de cabo (Estai, Pendural ou Cabo principal): ${list(noGroup)}. O form-finding só ajusta estais e pendurais.`,
      select: { nodes: [], elements: noGroup },
      fix: 'assign-group',
      fixValues: { group: 'stay' },
      fixLabel: 'Marcar como estais',
    })
  }
  const dangling: number[] = []
  for (const e of cables) {
    for (const id of [e.n1, e.n2]) {
      const n = byId.get(id)
      if (!n) continue
      const alone = !(frameAt.get(id) ?? 0) && (cableAt.get(id) ?? 0) < 2 && ![0, 1, 2].some((d) => restrained(n, d))
      if (alone && !dangling.includes(e.id)) dangling.push(e.id)
    }
  }
  if (dangling.length) {
    out.push({
      severity: 'erro',
      text: `${dangling.length} cabo(s) terminam num nó sem barra, sem outro cabo e sem apoio: ${list(dangling)}. A ponta do cabo precisa estar ancorada.`,
      select: { nodes: [], elements: dangling },
    })
  }
  const stays = cables.filter((e) => e.group === 'stay')
  if (stays.length && deck.length === 0) {
    out.push({
      severity: 'erro',
      text: 'Há estais, mas nenhuma barra do grupo Tabuleiro: o form-finding precisa saber quais barras são o tabuleiro. Atribua o grupo Tabuleiro às barras da pista.',
      select: { nodes: [], elements: stays.map((e) => e.id) },
    })
  }
  if (stays.length && !model.elements.some((e) => e.kind === 'frame' && (e.group === 'tower' || e.group === 'pier'))) {
    out.push({ severity: 'aviso', text: 'Há estais, mas nenhuma barra do grupo Torre: o form-finding controla o prumo das barras desse grupo.' })
  }

  // ---- pistas
  if (model.elements.length && model.lanes.length === 0) {
    out.push(
      deck.length
        ? { severity: 'aviso', text: 'O modelo não tem pista de carga móvel: sem pista, a carga móvel (NBR 7188), a frenagem e as combinações com tráfego não são calculadas.', fix: 'auto-lanes', fixLabel: 'Criar pista' }
        : { severity: 'aviso', text: 'O modelo não tem pista de carga móvel nem barras do grupo Tabuleiro. Atribua o grupo Tabuleiro às barras da pista e gere a pista automática.' },
    )
  }
  for (const l of model.lanes) {
    const off = l.nodes.filter((id) => !deckNodes.has(id) && byId.has(id))
    if (off.length && deck.length) {
      out.push({ severity: 'dica', text: `A pista "${l.name}" passa por ${off.length} nó(s) que não são do tabuleiro: ${list(off)}.`, select: { nodes: off, elements: [] } })
    }
  }
  if (model.lanes.length && deck.length && deckSupportNodes(model).size === 0) {
    out.push({ severity: 'aviso', text: 'Nenhum nó do tabuleiro tem apoio vertical nem ligação com torre ou pilar.' })
  }

  // ---- não usados
  const usedSec = new Set(model.elements.flatMap((e) => (e.kind === 'frame' ? [e.sec] : [])))
  const usedMat = new Set(model.elements.map((e) => e.mat))
  const idleSec = model.sections.filter((s) => !usedSec.has(s.id)).map((s) => s.name)
  const idleMat = model.materials.filter((m) => !usedMat.has(m.id)).map((m) => m.name)
  if (model.elements.length && idleSec.length) out.push({ severity: 'dica', text: `Seção(ões) não usada(s): ${idleSec.slice(0, 5).join('; ')}${idleSec.length > 5 ? '…' : ''}.` })
  if (model.elements.length && idleMat.length) out.push({ severity: 'dica', text: `Material(is) não usado(s): ${idleMat.slice(0, 5).join('; ')}${idleMat.length > 5 ? '…' : ''}.` })

  const rank = { erro: 0, aviso: 1, dica: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
