/**
 * Carga móvel NBR 7188 por linhas de influência.
 *
 * Em cada nó da faixa aplicam-se uma força vertical unitária e um momento torçor unitário
 * (em torno da tangente à faixa) sobre a rigidez tangente do estado de carga permanente —
 * análise linearizada em torno do estado deformado (em pontes pênseis isso é a
 * "deflection theory" linearizada). Daí saem as linhas de influência de TODAS as respostas
 * (esforços em 3 estações de cada barra, tração de cada cabo, flecha de cada nó), e as
 * envoltórias:
 *
 *  - carga distribuída p·largura nos trechos desfavoráveis (com a opção de carregar só
 *    meia pista, o que gera torção);
 *  - veículo-tipo (3 eixos) na posição e excentricidade mais desfavoráveis. A carga
 *    distribuída é mantida sob o veículo e a carga dos eixos é reduzida de p·(3×6)/3
 *    (homogeneização usual).
 */

import type { Env3, MovingLoadResult } from '../analysis/types'
import type { SkylineMatrix } from '../analysis/skyline'
import { type BridgeSystem, frameTangentLocal } from '../analysis/system'
import { stationForces, toGlobal, toLocal } from '../analysis/frame'
import { VEHICLES, type VehicleId, ciaFactor, civ, cnf, trafficLanes } from './nbr7188'
import { type LoadLine, transverseEnvelope } from './transverse'

export interface MovingOptions {
  vehicle: VehicleId
  lanes?: string[]
  nonlinear: boolean
  /** vão de referência do CIV (m) */
  Liv: number
  deckMaterial?: 'concrete' | 'steel' | 'composite'
  onProgress?: (fraction: number) => void
}

interface LaneData {
  id: string
  nodes: number[]
  s: Float64Array
  trib: Float64Array
  width: number
  ecc: number
  joints: number[]
  RF: Float64Array[]
  RT: Float64Array[]
  /** posições candidatas do veículo: índices e pesos de interpolação dos eixos */
  candIdx: Int32Array
  candW: Float64Array
  nCand: number
  /** grelha: linhas longitudinais (longarinas) que recebem a carga — ver loads/transverse.ts */
  lines?: LoadLine[]
}

const NF = 18

export function solveMovingLoad(sys: BridgeSystem, K: SkylineMatrix, opts: MovingOptions): MovingLoadResult | undefined {
  const model = sys.model
  const veh = VEHICLES[opts.vehicle]
  const lanesIn = model.lanes.filter((l) => !opts.lanes || opts.lanes.includes(l.id))
  if (lanesIn.length === 0) return undefined

  const nFr = sys.frames.length
  const nCb = sys.cables.length
  const nNd = sys.nNodes
  // reações: 6 por nó apoiado (GDL fixo ou com mola), na mesma ordem de deadLoad.reactions
  const supNodes: number[] = []
  model.nodes.forEach((nd, i) => {
    if (nd.fix?.some(Boolean) || nd.springs?.some((k) => k > 0)) supNodes.push(i)
  })
  const supSlot = new Int32Array(nNd).fill(-1)
  supNodes.forEach((i, k) => (supSlot[i] = k))
  const nResp = nFr * NF + nCb + nNd + 6 * supNodes.length
  const offC = nFr * NF
  const offU = offC + nCb
  const offR = offU + nNd
  const { eq, X } = sys

  // versores de tração dos cabos (extremidade mais tracionada) p/ linearizar ΔT
  const tdir = new Float64Array(3 * nCb)
  sys.cables.forEach((c, i) => {
    const st = c.st
    const useJ = st.Tj >= st.Ti
    const T = useJ ? st.Tj : st.Ti
    const V = useJ ? st.Vj : st.V0
    if (T > 0) {
      tdir[3 * i] = (st.H * st.ex) / T
      tdir[3 * i + 1] = (st.H * st.ey) / T
      tdir[3 * i + 2] = V / T
    }
  })
  const kts = sys.frames.map((f) => frameTangentLocal(f, opts.nonlinear, false, new Float64Array(144)))

  const UG = new Float64Array(12)
  const UL = new Float64Array(12)
  const FL = new Float64Array(12)
  const FGr = new Float64Array(12)
  const duFull = new Float64Array(6 * nNd)
  const respond = (p: Float64Array): Float64Array => {
    const du = K.solve(p)
    for (let i = 0; i < eq.length; i++) duFull[i] = eq[i] >= 0 ? du[eq[i]] : 0
    const r = new Float64Array(nResp)
    for (let e = 0; e < nFr; e++) {
      const f = sys.frames[e]
      for (let d = 0; d < 6; d++) {
        UG[d] = duFull[6 * f.a + d]
        UG[6 + d] = duFull[6 * f.b + d]
      }
      toLocal(f.R, UG, UL)
      const kt = kts[e]
      for (let i = 0; i < 12; i++) {
        let s = 0
        for (let j = 0; j < 12; j++) s += kt[i * 12 + j] * UL[j]
        FL[i] = s
      }
      stationForces(FL, f.L0, 0, 0, 0, r, e * NF)
      const sa = supSlot[f.a]
      const sb = supSlot[f.b]
      if (sa >= 0 || sb >= 0) {
        // forças de extremidade em eixos globais → reações nos GDL fixos
        toGlobal(f.R, FL, FGr)
        for (let d = 0; d < 6; d++) {
          if (sa >= 0 && eq[6 * f.a + d] < 0) r[offR + 6 * sa + d] += FGr[d]
          if (sb >= 0 && eq[6 * f.b + d] < 0) r[offR + 6 * sb + d] += FGr[6 + d]
        }
      }
    }
    for (let k = 0; k < supNodes.length; k++) {
      const i = supNodes[k]
      for (let d = 0; d < 6; d++) {
        const g = 6 * i + d
        if (eq[g] >= 0 && sys.springs[g] > 0) r[offR + 6 * k + d] = -sys.springs[g] * duFull[g]
      }
    }
    for (let i = 0; i < nCb; i++) {
      const c = sys.cables[i]
      const k = c.st.k3
      const dx = duFull[6 * c.b] - duFull[6 * c.a]
      const dy = duFull[6 * c.b + 1] - duFull[6 * c.a + 1]
      const dz = duFull[6 * c.b + 2] - duFull[6 * c.a + 2]
      const fx = k[0] * dx + k[1] * dy + k[2] * dz
      const fy = k[3] * dx + k[4] * dy + k[5] * dz
      const fz = k[6] * dx + k[7] * dy + k[8] * dz
      r[offC + i] = tdir[3 * i] * fx + tdir[3 * i + 1] * fy + tdir[3 * i + 2] * fz
      const sa = supSlot[c.a]
      const sb = supSlot[c.b]
      if (sa >= 0 || sb >= 0) {
        const f3 = [fx, fy, fz]
        for (let d = 0; d < 3; d++) {
          if (sa >= 0 && eq[6 * c.a + d] < 0) r[offR + 6 * sa + d] -= f3[d]
          if (sb >= 0 && eq[6 * c.b + d] < 0) r[offR + 6 * sb + d] += f3[d]
        }
      }
    }
    for (let i = 0; i < nNd; i++) r[offU + i] = duFull[6 * i + 2]
    return r
  }

  // ---- linhas de influência por faixa
  const a = veh.axleSpacing
  const axleOff: number[] = []
  for (let i = 0; i < veh.nAxles; i++) axleOff.push((i - (veh.nAxles - 1) / 2) * a)
  const lanes: LaneData[] = []
  const totalNodes = lanesIn.reduce((s, l) => s + l.nodes.length, 0)
  let done = 0
  const p = new Float64Array(sys.nEq)
  for (const lane of lanesIn) {
    let nodes = lane.nodes.map((id) => sys.nodeIndex.get(id)).filter((i): i is number => i !== undefined)
    let m = nodes.length
    if (m < 2) continue
    let s = new Float64Array(m)
    for (let k = 1; k < m; k++) {
      const i = nodes[k]
      const j = nodes[k - 1]
      s[k] = s[k - 1] + Math.hypot(X[3 * i] - X[3 * j], X[3 * i + 1] - X[3 * j + 1], X[3 * i + 2] - X[3 * j + 2])
    }
    let RF: Float64Array[] = []
    let RT: Float64Array[] = []
    for (let k = 0; k < m; k++) {
      const i = nodes[k]
      // força vertical unitária (p/ baixo)
      p.fill(0)
      if (eq[6 * i + 2] >= 0) p[eq[6 * i + 2]] = -1
      RF.push(respond(p))
      // torçor unitário em torno da tangente à faixa
      let k0 = Math.max(0, k - 1)
      let k1 = Math.min(m - 1, k + 1)
      // nós duplicados em juntas: usa o vizinho do mesmo lado
      if (s[k1] - s[k0] < 1e-9) {
        k0 = Math.max(0, k - 2)
        k1 = Math.min(m - 1, k + 2)
      }
      const i0 = nodes[k0]
      const i1 = nodes[k1]
      const tx = X[3 * i1] - X[3 * i0]
      const ty = X[3 * i1 + 1] - X[3 * i0 + 1]
      const tz = X[3 * i1 + 2] - X[3 * i0 + 2]
      const tl = Math.hypot(tx, ty, tz) || 1
      p.fill(0)
      const t = [tx / tl, ty / tl, tz / tl]
      for (let d = 0; d < 3; d++) if (eq[6 * i + 3 + d] >= 0) p[eq[6 * i + 3 + d]] = t[d]
      RT.push(respond(p))
      done++
      if (done % 8 === 0) opts.onProgress?.((0.8 * done) / totalNodes)
    }
    // tabuleiro em grelha: LI de força unitária em cada linha longitudinal (longarina)
    let lines: LoadLine[] | undefined
    if (lane.lines && lane.lines.length >= 2 && m === lane.nodes.length) {
      const idx = lane.lines.map((l) => l.nodes.map((id) => sys.nodeIndex.get(id)))
      if (idx.every((ln) => ln.length === m && ln.every((i) => i !== undefined))) {
        lines = lane.lines.map((l, li) => {
          const ln = idx[li] as number[]
          const same = ln.every((i, k) => i === nodes[k])
          const R: Float64Array[] = []
          if (same) R.push(...RF)
          else {
            for (const i of ln) {
              p.fill(0)
              if (eq[6 * i + 2] >= 0) p[eq[6 * i + 2]] = -1
              R.push(respond(p))
            }
          }
          return { y: l.y, nodes: ln, RF: R }
        })
      }
    }
    // Pontos de apoio: a carga aplicada exatamente sobre o apoio vai direto p/ ele e a linha de
    // influência nodal vale 0 ali, mas o limite pela esquerda e pela direita não (o cortante
    // junto ao apoio tem um salto unitário). Cada apoio vira dois pontos — limite à esquerda e à
    // direita — extrapolados dos nós vizinhos de cada lado.
    const flex = (k: number): number => Math.abs(RF[k][offU + nodes[k]])
    const isSupport = (k: number): boolean => {
      let ref = Infinity
      if (k > 0 && s[k] - s[k - 1] > 1e-9) ref = Math.min(ref, flex(k - 1))
      if (k < m - 1 && s[k + 1] - s[k] > 1e-9) ref = Math.min(ref, flex(k + 1))
      return Number.isFinite(ref) && flex(k) < 0.02 * ref
    }
    const sup = Array.from({ length: m }, (_, k) => isSupport(k))
    if (lines) {
      // na grelha a estaca é de apoio se alguma longarina está apoiada nela
      for (const l of lines) {
        const fl = (k: number): number => Math.abs(l.RF[k][offU + l.nodes[k]])
        for (let k = 0; k < m; k++) {
          let ref = Infinity
          if (k > 0 && s[k] - s[k - 1] > 1e-9) ref = Math.min(ref, fl(k - 1))
          if (k < m - 1 && s[k + 1] - s[k] > 1e-9) ref = Math.min(ref, fl(k + 1))
          if (Number.isFinite(ref) && fl(k) < 0.02 * ref) sup[k] = true
        }
      }
    }
    if (sup.some(Boolean)) {
      const nodes2: number[] = []
      const s2: number[] = []
      const RF2: Float64Array[] = []
      const RT2: Float64Array[] = []
      const L2 = (lines ?? []).map(() => ({ nodes: [] as number[], RF: [] as Float64Array[] }))
      const pushLines = (k: number, a: number, b2: number): void => {
        lines?.forEach((l, li) => {
          L2[li].nodes.push(l.nodes[k])
          L2[li].RF.push(a < 0 ? l.RF[k] : limit(l.RF, k, a, b2))
        })
      }
      const limit = (R: Float64Array[], k: number, a: number, b2: number): Float64Array => {
        // extrapola de a (vizinho) e b2 (vizinho do vizinho) até a estaca de k
        if (b2 < 0 || b2 >= m || sup[b2] || Math.abs(s[a] - s[b2]) < 1e-9) return R[a]
        const t = (s[k] - s[a]) / (s[a] - s[b2])
        const out = new Float64Array(nResp)
        const ra = R[a]
        const rb = R[b2]
        for (let j = 0; j < nResp; j++) out[j] = ra[j] + t * (ra[j] - rb[j])
        return out
      }
      for (let k = 0; k < m; k++) {
        const left = sup[k] && k > 0 && s[k] - s[k - 1] > 1e-9 && !sup[k - 1]
        const right = sup[k] && k < m - 1 && s[k + 1] - s[k] > 1e-9 && !sup[k + 1]
        if (left) {
          nodes2.push(nodes[k]); s2.push(s[k])
          RF2.push(limit(RF, k, k - 1, k - 2)); RT2.push(limit(RT, k, k - 1, k - 2))
          pushLines(k, k - 1, k - 2)
        }
        if (right) {
          nodes2.push(nodes[k]); s2.push(s[k])
          RF2.push(limit(RF, k, k + 1, k + 2)); RT2.push(limit(RT, k, k + 1, k + 2))
          pushLines(k, k + 1, k + 2)
        }
        if (!left && !right) {
          nodes2.push(nodes[k]); s2.push(s[k]); RF2.push(RF[k]); RT2.push(RT[k])
          pushLines(k, -1, -1)
        }
      }
      nodes = nodes2
      s = Float64Array.from(s2)
      RF = RF2
      RT = RT2
      m = nodes.length
      if (lines) lines = lines.map((l, li) => ({ y: l.y, nodes: L2[li].nodes, RF: L2[li].RF }))
    }
    const trib = new Float64Array(m)
    for (let k = 0; k < m; k++) trib[k] = ((k < m - 1 ? s[k + 1] : s[k]) - (k > 0 ? s[k - 1] : s[k])) / 2
    // posições candidatas: algum eixo sobre um nó
    const nAx = veh.nAxles
    const cand: number[] = []
    const candW: number[] = []
    let nCand = 0
    const locate = (pos: number, idx: number[], wt: number[]) => {
      if (pos < s[0] - 1e-9 || pos > s[m - 1] + 1e-9) return
      let lo = 0
      let hi = m - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (s[mid] <= pos) lo = mid
        else hi = mid
      }
      const L = s[hi] - s[lo]
      const t = L > 1e-12 ? Math.min(1, Math.max(0, (pos - s[lo]) / L)) : 0
      idx.push(lo, hi)
      wt.push(1 - t, t)
    }
    for (let k = 0; k < m; k++) {
      for (const o of axleOff) {
        const center = s[k] - o
        const idx: number[] = []
        const wt: number[] = []
        for (const ao of axleOff) locate(center + ao, idx, wt)
        while (idx.length < 2 * nAx) {
          idx.push(0)
          wt.push(0)
        }
        cand.push(...idx)
        candW.push(...wt)
        nCand++
      }
    }
    lanes.push({
      id: lane.id, nodes, s, trib, width: lane.width, ecc: lane.maxEccentricity,
      joints: lane.joints ?? [s[0], s[m - 1]],
      RF, RT, candIdx: Int32Array.from(cand), candW: Float64Array.from(candW), nCand, lines,
    })
  }
  if (lanes.length === 0) return undefined

  // ---- coeficientes de ponderação
  // passarelas (sem veículo): a carga de multidão não é majorada
  const crowd = veh.nAxles === 0
  const CIV = crowd ? 1 : civ(opts.Liv)
  const widest = Math.max(...lanes.map((l) => l.width))
  const CNF = crowd ? 1 : cnf(trafficLanes(widest))
  const CIA = crowd ? 1 : ciaFactor(opts.deckMaterial)
  const q = veh.distributed
  const axleFull = 2 * veh.wheelLoad
  const axleLoad = crowd ? 0 : axleFull - (q * veh.width * veh.length) / veh.nAxles

  // CIA: barras do tabuleiro a menos de 5 m de uma junta/extremidade
  const nearJoint = new Uint8Array(nFr)
  for (const lane of lanes) {
    const st = new Map<number, number[]>()
    lane.nodes.forEach((nd, k) => {
      const arr = st.get(nd)
      if (arr) arr.push(lane.s[k])
      else st.set(nd, [lane.s[k]])
    })
    lane.lines?.forEach((l) => l.nodes.forEach((nd, k) => {
      const arr = st.get(nd)
      if (arr) arr.push(lane.s[k])
      else st.set(nd, [lane.s[k]])
    }))
    sys.frames.forEach((f, e) => {
      const sa = st.get(f.a)
      const sb = st.get(f.b)
      if (!sa || !sb) return
      const lo = Math.min(sa[0], sb[0])
      const hi = Math.max(sa[0], sb[0])
      for (const j of lane.joints) if (j >= lo - 5 && j <= hi + 5) nearJoint[e] = 1
    })
  }

  // ---- envoltórias
  const envMax = new Float64Array(nResp)
  const envMin = new Float64Array(nResp)
  const vehMax = new Float64Array(nResp)
  const vehMin = new Float64Array(nResp)
  const nAx2 = 2 * veh.nAxles
  for (const lane of lanes) {
    const m = lane.nodes.length
    const etaF = new Float64Array(m)
    const etaT = new Float64Array(m)
    const pLine = q * lane.width
    const halfT = 0.5 * pLine * (lane.width / 4)
    // grelha: repartição transversal pela regra da alavanca entre as longarinas
    const grid = lane.lines
      ? transverseEnvelope(lane.lines, {
          trib: lane.trib, width: lane.width, ecc: lane.ecc, q, axleLoad, track: veh.track,
          candIdx: lane.candIdx, candW: lane.candW, nCand: lane.nCand, nAx2,
        })
      : null
    const g4 = new Float64Array(4)
    for (let j = 0; j < nResp; j++) {
      if (grid) {
        grid(j, g4)
        envMax[j] += g4[0]
        envMin[j] += g4[1]
        if (g4[2] > vehMax[j]) vehMax[j] = g4[2]
        if (g4[3] < vehMin[j]) vehMin[j] = g4[3]
        continue
      }
      for (let k = 0; k < m; k++) {
        etaF[k] = lane.RF[k][j]
        etaT[k] = lane.RT[k][j]
      }
      let dMax = 0
      let dMin = 0
      for (let k = 0; k < m; k++) {
        const full = pLine * etaF[k]
        const half = 0.5 * full
        const tq = halfT * Math.abs(etaT[k])
        const hi = Math.max(0, full, half + tq)
        const lo = Math.min(0, full, half - tq)
        dMax += hi * lane.trib[k]
        dMin += lo * lane.trib[k]
      }
      let vMax = 0
      let vMin = 0
      const ci = lane.candIdx
      const cw = lane.candW
      for (let c = 0; c < lane.nCand; c++) {
        let F = 0
        let T = 0
        const o = c * nAx2
        for (let t = 0; t < nAx2; t++) {
          const w = cw[o + t]
          if (w === 0) continue
          F += w * etaF[ci[o + t]]
          T += w * etaT[ci[o + t]]
        }
        F *= axleLoad
        T = Math.abs(T) * axleLoad * lane.ecc
        if (F + T > vMax) vMax = F + T
        if (F - T < vMin) vMin = F - T
      }
      envMax[j] += dMax
      envMin[j] += dMin
      // um único veículo em toda a obra: fica o da faixa mais desfavorável
      if (vMax > vehMax[j]) vehMax[j] = vMax
      if (vMin < vehMin[j]) vehMin[j] = vMin
    }
    opts.onProgress?.(0.8 + (0.2 * (lanes.indexOf(lane) + 1)) / lanes.length)
  }
  for (let j = 0; j < nResp; j++) {
    envMax[j] += vehMax[j]
    envMin[j] += vehMin[j]
  }

  const base = CIV * CNF
  const env3 = (e: number, comp: number, phi: number): Env3 => {
    const o = e * NF + comp * 3
    return {
      min: [phi * envMin[o], phi * envMin[o + 1], phi * envMin[o + 2]],
      max: [phi * envMax[o], phi * envMax[o + 1], phi * envMax[o + 2]],
    }
  }
  const frames = sys.frames.map((f, e) => {
    const phi = base * (nearJoint[e] ? CIA : 1)
    return {
      id: f.id,
      N: env3(e, 0, phi), Vy: env3(e, 1, phi), T: env3(e, 3, phi), My: env3(e, 4, phi), Mz: env3(e, 5, phi),
    }
  })
  const cables = sys.cables.map((c, i) => ({ id: c.id, min: base * envMin[offC + i], max: base * envMax[offC + i] }))
  const uzMin: number[] = []
  const uzMax: number[] = []
  for (let i = 0; i < nNd; i++) {
    uzMin.push(base * envMin[offU + i])
    uzMax.push(base * envMax[offU + i])
  }

  // ---- linhas de influência p/ inspeção (1ª faixa)
  const l0 = lanes[0]
  const sArr = Array.from(l0.s)
  const line = (j: number): number[] => l0.RF.map((r) => r[j])
  const influence: MovingLoadResult['influence'] = []
  const inLane = new Set(l0.nodes)
  let jMax = -1
  let jMin = -1
  sys.frames.forEach((f, e) => {
    if (!inLane.has(f.a) || !inLane.has(f.b)) return
    for (let s = 0; s < 3; s++) {
      const j = e * NF + 15 + s
      if (jMax < 0 || envMax[j] > envMax[jMax]) jMax = j
      if (jMin < 0 || envMin[j] < envMin[jMin]) jMin = j
    }
  })
  const where = (j: number): string => {
    const e = Math.floor(j / NF)
    const st = ['início', 'meio', 'fim'][(j - e * NF) % 3]
    return `barra ${sys.frames[e].id} (${st})`
  }
  if (jMax >= 0) influence.push({ label: `Mz positivo máximo — ${where(jMax)}`, s: sArr, eta: line(jMax) })
  if (jMin >= 0 && jMin !== jMax) influence.push({ label: `Mz negativo máximo — ${where(jMin)}`, s: sArr, eta: line(jMin) })
  if (nCb > 0) {
    let c = 0
    for (let i = 1; i < nCb; i++) if (envMax[offC + i] > envMax[offC + c]) c = i
    influence.push({ label: `Tração — cabo ${sys.cables[c].id}`, s: sArr, eta: line(offC + c) })
  }
  let nd = l0.nodes[0]
  for (const i of l0.nodes) if (envMin[offU + i] < envMin[offU + nd]) nd = i
  influence.push({ label: `Flecha — nó ${model.nodes[nd].id}`, s: sArr, eta: line(offU + nd) })

  return {
    vehicle: opts.vehicle,
    CIV, CNF, CIA, Liv: opts.Liv,
    lanes: lanes.map((l) => l.id),
    axleLoad, axleSpacing: a, nAxles: veh.nAxles,
    distributed: q * widest,
    frames, cables, uzMin, uzMax, influence,
    reactions: supNodes.map((i, k) => {
      const o = offR + 6 * k
      const pick = (v: Float64Array): [number, number, number, number, number, number] => [
        base * v[o], base * v[o + 1], base * v[o + 2], base * v[o + 3], base * v[o + 4], base * v[o + 5],
      ]
      return { node: model.nodes[i].id, min: pick(envMin), max: pick(envMax) }
    }),
  }
}
