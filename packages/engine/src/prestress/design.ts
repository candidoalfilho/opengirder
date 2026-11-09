/**
 * Pré-dimensionamento da protensão de uma viga contínua.
 *
 * `designTendon`: balanceamento de cargas (T. Y. Lin) — a força P∞ é a que equilibra uma fração
 * `balance` da carga permanente g no vão crítico: P = balance·g·L²/(8·f), com f = flecha do
 * traçado no vão (ponto baixo em relação à corda entre os pontos sobre os apoios). O nº de
 * cordoalhas sai de P∞ ≈ `efficiency`·σpi·Ap (perdas totais estimadas em 22%). O padrão é
 * balancear toda a carga permanente: em vigas contínuas o hiperestático de protensão (positivo
 * nos vãos) consome parte da folga, e com 100% a descompressão na combinação quase permanente
 * costuma ser atendida sem ajuste.
 *
 * `refineTendons`: com os resultados de uma análise, aumenta o nº de cordoalhas o necessário
 * p/ atender as verificações de tração em serviço (ELS-D e ELS-F), que são lineares em P.
 */

import type { BridgeModel, Section } from '../model/types'
import type { BridgeResults } from '../analysis/types'
import type { PrestressSection, Tendon } from './types'
import { TENDON_DEFAULTS, defaultSigmaPi } from './types'
import { autoProfile, buildProfile } from './profile'

export interface TendonDesignOptions {
  /** fração da carga permanente balanceada no vão crítico; padrão 1,0 */
  balance?: number
  /** distância do centro do cabo resultante à face do concreto (m); padrão 0,15 */
  cover?: number
  strandArea?: number
  fptk?: number
  /** P∞/Pi estimado; padrão 0,78 */
  efficiency?: number
  /** id da faixa que define o eixo; padrão: a primeira */
  lane?: string
  level?: 'limitada' | 'completa'
}

/** seção de concreto do tabuleiro ao longo de uma faixa, com os padrões de yTop/yBot */
export function deckPrestressSection(model: BridgeModel, laneId?: string): { sec: PrestressSection; section: Section; g: number } | null {
  const lane = laneId ? model.lanes.find((l) => l.id === laneId) : model.lanes[0]
  if (!lane || lane.nodes.length < 2) return null
  const inLane = new Set(lane.nodes)
  const el = model.elements.find((e) => e.kind === 'frame' && inLane.has(e.n1) && inLane.has(e.n2))
  if (!el || el.kind !== 'frame') return null
  const section = model.sections.find((s) => s.id === el.sec)
  const mat = model.materials.find((m) => m.id === el.mat)
  if (!section || !mat) return null
  const depth = section.depth && section.depth > 0 ? section.depth : 2 * Math.sqrt((3 * section.Iz) / section.A)
  return {
    section,
    sec: {
      A: section.A, I: section.Iz,
      yTop: section.yTop && section.yTop > 0 ? section.yTop : depth / 2,
      yBot: section.yBot && section.yBot > 0 ? section.yBot : depth / 2,
      Ec: mat.E,
      fck: mat.fck && mat.fck > 0 ? mat.fck : 40e3,
    },
    g: mat.gamma * section.A + (section.extraDead ?? 0),
  }
}

/** vãos ao longo da faixa: distâncias entre nós com apoio vertical (ou ligados a pilares) */
function spansAlong(model: BridgeModel, laneId?: string): number[] {
  const lane = laneId ? model.lanes.find((l) => l.id === laneId) : model.lanes[0]
  if (!lane) return []
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const pierTop = new Set<number>()
  for (const e of model.elements) {
    if (e.kind === 'frame' && e.group === 'pier') {
      pierTop.add(e.n1)
      pierTop.add(e.n2)
    }
  }
  const sup: number[] = []
  let acc = 0
  let prev: { x: number; y: number; z: number } | null = null
  for (const id of lane.nodes) {
    const nd = byId.get(id)
    if (!nd) continue
    if (prev) acc += Math.hypot(nd.x - prev.x, nd.y - prev.y, nd.z - prev.z)
    prev = nd
    if (nd.fix?.[2] || pierTop.has(id)) sup.push(acc)
  }
  if (sup.length === 0 || sup[0] > 1e-6) sup.unshift(0)
  if (acc - sup[sup.length - 1] > 1e-6) sup.push(acc)
  const spans: number[] = []
  for (let i = 1; i < sup.length; i++) if (sup[i] - sup[i - 1] > 1e-6) spans.push(sup[i] - sup[i - 1])
  return spans
}

export function designTendon(model: BridgeModel, opts: TendonDesignOptions = {}): Tendon | null {
  const lane = opts.lane ? model.lanes.find((l) => l.id === opts.lane) : model.lanes[0]
  const deck = deckPrestressSection(model, lane?.id)
  if (!lane || !deck) return null
  const spans = spansAlong(model, lane.id)
  if (spans.length === 0) return null
  const cover = Math.min(opts.cover ?? 0.15, 0.45 * Math.min(deck.sec.yTop, deck.sec.yBot))
  const points = autoProfile(spans, deck.sec, cover)
  const profile = buildProfile(points)
  const balance = opts.balance ?? 1
  // força necessária em cada vão com a flecha máxima do traçado
  const need: { f: number; P: number }[] = []
  let x0 = 0
  for (const L of spans) {
    const x1 = x0 + L
    let f = 0
    for (let i = 1; i < 40; i++) {
      const s = x0 + (L * i) / 40
      const chord = profile.e(x0) + ((profile.e(x1) - profile.e(x0)) * (s - x0)) / L
      f = Math.max(f, profile.e(s) - chord)
    }
    need.push({ f, P: f > 1e-6 ? (balance * deck.g * L * L) / (8 * f) : 0 })
    x0 = x1
  }
  const P = Math.max(...need.map((q) => q.P))
  if (!(P > 0)) return null
  // o cabo é contínuo (mesma força em todos os vãos): nos vãos que pedem menos força a flecha
  // é reduzida na mesma proporção, p/ balancear a mesma fração da carga em todos eles
  let span = 0
  for (const pt of points) {
    if (pt.kind !== 'span') continue
    const q = need[span++]
    if (q && q.P < P) pt.e -= q.f * (1 - q.P / P)
  }
  const strandArea = opts.strandArea ?? TENDON_DEFAULTS.strandArea
  const fptk = opts.fptk ?? TENDON_DEFAULTS.fptk
  const perStrand = (opts.efficiency ?? 0.78) * defaultSigmaPi(fptk) * strandArea
  const nStrands = Math.max(1, Math.ceil(P / perStrand))
  return {
    id: 'P1',
    name: 'Cabo resultante',
    lane: lane.id,
    nStrands,
    strandArea,
    fptk,
    jacking: 'both',
    profile: points,
    ...(opts.level ? { level: opts.level } : {}),
  }
}

/**
 * Um passo de ajuste pelas verificações de tração da última análise (as tensões são lineares
 * em P). Onde a protensão comprime a fibra que falha, aumenta o nº de cordoalhas; onde é a
 * própria protensão que traciona a fibra (cabo excêntrico demais para o lado oposto), reduz em
 * 15% as excentricidades desse lado. Devolve o modelo alterado, ou null se nada muda.
 */
export function refineTendons(model: BridgeModel, res: BridgeResults): BridgeModel | null {
  const checks = res.prestress?.checks
  if (!model.tendons?.length || !checks) return null
  let changed = false
  const tendons = model.tendons.map((t) => {
    let ratio = 1
    let flattenTop = false // reduzir excentricidades negativas (cabo alto)
    let flattenBottom = false // reduzir excentricidades positivas (cabo baixo)
    for (const c of checks) {
      if (c.tendon !== t.id || c.ok || c.kind !== 'tension' || c.informative) continue
      if (c.sigmaP < 0 && c.key !== 'transfer-t') {
        // σ = σ_cargas + σ_P, com σ_P < 0 (compressão) proporcional ao nº de cordoalhas
        const sigmaLoads = c.value - c.sigmaP
        ratio = Math.max(ratio, (sigmaLoads - c.limit) / -c.sigmaP)
      } else if (c.sigmaP >= 0) {
        if (c.fibre === 'inferior') flattenTop = true
        else flattenBottom = true
      }
    }
    if (ratio <= 1 && !flattenTop && !flattenBottom) return t
    changed = true
    const out: Tendon = { ...t }
    if (ratio > 1) out.nStrands = Math.ceil(t.nStrands * Math.min(ratio, 3) * 1.02)
    if (flattenTop || flattenBottom) {
      out.profile = t.profile.map((p) =>
        (flattenTop && p.e < 0) || (flattenBottom && p.e > 0) ? { ...p, e: 0.85 * p.e } : p,
      )
    }
    return out
  })
  return changed ? { ...model, tendons } : null
}
