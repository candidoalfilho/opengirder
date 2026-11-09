/**
 * Form-finding dos cabos sob carga permanente.
 *
 * Incógnitas: comprimento indeformado L0 de cada estai/pendural. Mínimos quadrados
 * (Gauss–Newton) sobre três famílias de resíduos adimensionais:
 *
 * 1. Forças-alvo — método das reações de apoio rígido. Analisa-se a estrutura SEM cabos,
 *    com o tabuleiro apoiado verticalmente em cada ancoragem e torres/pilares
 *    indeslocáveis (viga contínua sobre apoios rígidos). A reação R_j é a força vertical
 *    que o cabo j deve aplicar no tabuleiro: resíduo (F_j − R_j)/R̄.
 *
 * 2. Greide — deslocamento vertical nulo do tabuleiro nas ancoragens (método do
 *    deslocamento nulo): resíduo d_j/δ_ref, δ_ref = 50 mm.
 *
 * 3. Prumo da torre — deslocamento horizontal nulo da torre na ancoragem de cada estai,
 *    na direção do estai: resíduo d_t/δ_t, δ_t = 100 mm. Nos estais de ancoragem (nó do
 *    tabuleiro sobre um apoio, sem reação-alvo) esta é a única condição e entra com peso
 *    cheio; nos demais, é ela que reparte o desequilíbrio entre vãos desiguais.
 *
 * Num sistema ideal (1) e (2) são a mesma condição e os dois resíduos zeram juntos. Na
 * prática divergem em dois casos, e é por isso que entram os dois:
 *  - junto a apoios que recalcam (tabuleiro monolítico com um pilone que encurta 15 mm),
 *    impor só flecha nula exigiria um estai com 10× a força e os vizinhos frouxos — as
 *    forças-alvo mantêm a distribuição suave e o tabuleiro acompanha o recalque;
 *  - nos modos "moles" (a inclinação de um vão inteiro por uma rotação mínima da torre),
 *    as forças quase não mudam e só a condição de greide segura o tabuleiro no lugar.
 *
 * As linhas de força têm peso adaptativo: se a força de um cabo sai da faixa 0,5·R a 2,5·R
 * (a caminho de afrouxar ou de sobrecarregar), o peso dele cresce — greide e prumo só são
 * atendidos até onde a redistribuição de forças permite. Uma configuração desbalanceada
 * (vãos desiguais sem estai de ancoragem, tabuleiro curvo puxando o mastro) termina com a
 * torre fletida, e não com cabos frouxos.
 *
 * A cada iteração faz-se a análise não linear completa; o jacobiano sai de uma
 * retrossubstituição por cabo na rigidez tangente já fatorada.
 */

import type { BridgeModel } from '../model/types'
import type { FormFindingResult } from '../analysis/types'
import { evalCable, newCableState } from '../analysis/catenary'
import { type StaticSolution, solveStatic } from '../analysis/static'
import { type BridgeSystem, type CableEl, buildSystem } from '../analysis/system'

interface Unknown {
  cable: CableEl
  /** nó do tabuleiro e nó oposto (torre / cabo principal) */
  deck: number
  other: number
  deckIsJ: boolean
  /** true = estai de ancoragem (alvo: deslocamento horizontal da torre) */
  anchor: boolean
  /** o nó oposto pertence a uma torre que pode se deslocar na horizontal */
  tower: boolean
  /** direção horizontal torre→tabuleiro (estais de ancoragem) */
  ex: number
  ey: number
  /** reação-alvo (kN) */
  R: number
}

function pickUnknowns(sys: BridgeSystem): Unknown[] {
  const deckLike = new Uint8Array(sys.nNodes)
  const towerLike = new Uint8Array(sys.nNodes)
  for (const f of sys.frames) {
    if (f.group === 'deck' || f.group === 'crossbeam') {
      deckLike[f.a] = 1
      deckLike[f.b] = 1
    } else if (f.group === 'tower' || f.group === 'pier') {
      towerLike[f.a] = 1
      towerLike[f.b] = 1
    }
  }
  const out: Unknown[] = []
  for (const c of sys.cables) {
    if (c.group !== 'stay' && c.group !== 'hanger') continue
    let deck = -1
    let other = -1
    if (deckLike[c.a] && !deckLike[c.b]) {
      deck = c.a
      other = c.b
    } else if (deckLike[c.b] && !deckLike[c.a]) {
      deck = c.b
      other = c.a
    } else continue
    const free = sys.eq[6 * deck + 2] >= 0
    const dx = sys.X[3 * deck] - sys.X[3 * other]
    const dy = sys.X[3 * deck + 1] - sys.X[3 * other + 1]
    const lh = Math.hypot(dx, dy)
    const tower = !!towerLike[other] && (sys.eq[6 * other] >= 0 || sys.eq[6 * other + 1] >= 0) && lh > 1e-6
    // estai de ancoragem: precisa de uma torre que se desloque na horizontal
    if (!free && !tower) continue
    out.push({
      cable: c, deck, other, deckIsJ: deck === c.b, anchor: !free, tower,
      ex: lh > 0 ? dx / lh : 0, ey: lh > 0 ? dy / lh : 0, R: 0,
    })
  }
  return out
}

/**
 * Reações do tabuleiro sobre apoios rígidos nas ancoragens: modelo sem cabos, com uz fixo
 * nos nós de ancoragem. Reparte a reação entre os cabos que chegam ao mesmo nó.
 */
function rigidSupportReactions(sys: BridgeSystem, unknowns: Unknown[]): void {
  const model = sys.model
  const anchors = new Map<number, number>()
  for (const q of unknowns) if (!q.anchor) anchors.set(q.deck, (anchors.get(q.deck) ?? 0) + 1)
  const support = new Uint8Array(sys.nNodes)
  for (const f of sys.frames) {
    if (f.group === 'tower' || f.group === 'pier') {
      support[f.a] = 1
      support[f.b] = 1
    }
  }
  const rigid: BridgeModel = {
    ...model,
    nodes: model.nodes.map((nd, i) => {
      if (!anchors.has(i) && !support[i]) return nd
      const fix = (nd.fix ? [...nd.fix] : [false, false, false, false, false, false]) as NonNullable<typeof nd.fix>
      fix[2] = true
      // torres e pilares não se deslocam (só giram) no modelo de apoios rígidos
      if (support[i]) fix[0] = fix[1] = true
      return { ...nd, fix }
    }),
    elements: model.elements.filter((e) => e.kind === 'frame'),
  }
  let rs = buildSystem(rigid)
  let sol: StaticSolution
  try {
    sol = solveStatic(rs, null, { nonlinear: false })
  } catch {
    // tabuleiro que só os cabos seguram na horizontal (pendular): trava também ux, uy nas ancoragens
    rigid.nodes = rigid.nodes.map((nd, i) =>
      anchors.has(i) ? { ...nd, fix: [true, true, true, !!nd.fix?.[3], !!nd.fix?.[4], !!nd.fix?.[5]] } : nd,
    )
    rs = buildSystem(rigid)
    sol = solveStatic(rs, null, { nonlinear: false })
  }
  for (const q of unknowns) {
    if (q.anchor) continue
    const g = 6 * q.deck + 2
    q.R = (sol.fint[g] - rs.fext[g]) / (anchors.get(q.deck) ?? 1)
  }
  // piso: nenhum cabo com alvo frouxo (ou de compressão)
  const pos = unknowns.filter((q) => !q.anchor && q.R > 0).map((q) => q.R).sort((a, b) => a - b)
  const median = pos.length > 0 ? pos[pos.length >> 1] : 1
  for (const q of unknowns) if (!q.anchor && q.R < 0.2 * median) q.R = 0.2 * median
}

/** eliminação de Gauss com pivoteamento parcial; devolve false se singular */
function gaussSolve(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let k = 0; k < n; k++) {
    let piv = k
    let big = Math.abs(A[k * n + k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k])
      if (v > big) {
        big = v
        piv = i
      }
    }
    if (!(big > 1e-300)) return false
    if (piv !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j]
        A[k * n + j] = A[piv * n + j]
        A[piv * n + j] = t
      }
      const t = b[k]
      b[k] = b[piv]
      b[piv] = t
    }
    const d = A[k * n + k]
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / d
      if (f === 0) continue
      for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j]
      b[i] -= f * b[k]
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j]
    b[i] = s / A[i * n + i]
  }
  return b.every(Number.isFinite)
}

export interface FormFindingOptions {
  nonlinear: boolean
  maxIter?: number
  /** tolerância: variação relativa de L0 no último passo */
  tol?: number
  onProgress?: (fraction: number) => void
}

export function findForm(
  sys: BridgeSystem,
  opts: FormFindingOptions,
): { result: FormFindingResult; solution: StaticSolution } {
  const maxIter = opts.maxIter ?? 25
  const tol = opts.tol ?? 1e-7
  const unknowns = pickUnknowns(sys)
  const m = unknowns.length
  let sol = solveStatic(sys, null, { nonlinear: opts.nonlinear })
  const history: number[] = []
  const result: FormFindingResult = {
    converged: m === 0, iterations: 0, history, residual: 0, nUnknowns: m, nTargets: m,
  }
  if (m === 0) return { result, solution: sol }

  rigidSupportReactions(sys, unknowns)
  const regular = unknowns.filter((q) => !q.anchor)
  const Rref = regular.length > 0 ? regular.reduce((s, q) => s + q.R, 0) / regular.length : 1

  // linhas: m (força; torre nos estais de ancoragem) + m (greide) + m (prumo da torre)
  const nRows = 3 * m
  /** peso da linha de força de cada cabo — cresce se a força sair da faixa admissível */
  const wF = new Float64Array(m).fill(1)
  const DREF = 0.05
  const TREF = 0.1
  const g = new Float64Array(nRows)
  const J = new Float64Array(nRows * m)
  const A = new Float64Array(m * m)
  const rhs = new Float64Array(m)
  const p = new Float64Array(sys.nEq)
  const st = newCableState()
  const nd = 6 * sys.nNodes
  const duFull = new Float64Array(nd)
  const { eq, X } = sys

  /** força vertical do cabo sobre o nó do tabuleiro (p/ cima +) */
  const lift = (q: Unknown, s = q.cable.st): number => -(q.deckIsJ ? s.fJ[2] : s.fI[2])
  /** resíduos; devolve [½‖g‖², flecha máx nas ancoragens] */
  const measure = (u: Float64Array): [number, number] => {
    let dMax = 0
    let U = 0
    unknowns.forEach((q, i) => {
      if (q.anchor) {
        const d = q.ex * u[6 * q.other] + q.ey * u[6 * q.other + 1]
        g[i] = (d * q.cable.EA) / q.cable.L0 / Rref
        g[m + i] = 0
        g[2 * m + i] = 0
      } else {
        const d = u[6 * q.deck + 2]
        g[i] = (wF[i] * (lift(q) - q.R)) / Rref
        g[m + i] = d / DREF
        g[2 * m + i] = q.tower ? (q.ex * u[6 * q.other] + q.ey * u[6 * q.other + 1]) / TREF : 0
        dMax = Math.max(dMax, Math.abs(d))
      }
      U += g[i] * g[i] + g[m + i] * g[m + i] + g[2 * m + i] * g[2 * m + i]
    })
    return [0.5 * U, dMax]
  }

  let [U, dMax] = measure(sol.u)
  history.push(dMax)
  for (let it = 0; it < maxIter; it++) {
    opts.onProgress?.(it / maxIter)
    const u = sol.u
    for (let j = 0; j < m; j++) {
      const c = unknowns[j].cable
      const a6 = 6 * c.a
      const b6 = 6 * c.b
      const dx = X[3 * c.b] + u[b6] - X[3 * c.a] - u[a6]
      const dy = X[3 * c.b + 1] + u[b6 + 1] - X[3 * c.a + 1] - u[a6 + 1]
      const dz = X[3 * c.b + 2] + u[b6 + 2] - X[3 * c.a + 2] - u[a6 + 2]
      const h = 1e-6 * c.L0
      st.H = c.st.H
      st.V0 = c.st.V0
      evalCable(dx, dy, dz, { EA: c.EA, w: c.w, L0: c.L0 + h }, st)
      // pseudo-carga −∂f_int/∂L0 e resposta da estrutura
      p.fill(0)
      for (let k = 0; k < 3; k++) {
        const ga = eq[a6 + k]
        const gb = eq[b6 + k]
        if (ga >= 0) p[ga] -= (st.fI[k] - c.st.fI[k]) / h
        if (gb >= 0) p[gb] -= (st.fJ[k] - c.st.fJ[k]) / h
      }
      const direct = (lift(unknowns[j], st) - lift(unknowns[j])) / h
      const du = sol.K.solve(p)
      for (let i = 0; i < nd; i++) duFull[i] = eq[i] >= 0 ? du[eq[i]] : 0
      for (let i = 0; i < m; i++) {
        const q = unknowns[i]
        if (q.anchor) {
          J[i * m + j] =
            ((q.ex * duFull[6 * q.other] + q.ey * duFull[6 * q.other + 1]) * q.cable.EA) / q.cable.L0 / Rref
          J[(m + i) * m + j] = 0
          J[(2 * m + i) * m + j] = 0
        } else {
          // d(f_J) = k3·dΔ ; d(f_I) = −k3·dΔ, com dΔ = du_J − du_I
          const cc = q.cable
          const k = cc.st.k3
          const ddx = duFull[6 * cc.b] - duFull[6 * cc.a]
          const ddy = duFull[6 * cc.b + 1] - duFull[6 * cc.a + 1]
          const ddz = duFull[6 * cc.b + 2] - duFull[6 * cc.a + 2]
          const dfz = k[6] * ddx + k[7] * ddy + k[8] * ddz
          let v = q.deckIsJ ? -dfz : dfz
          if (i === j) v += direct
          J[i * m + j] = (wF[i] * v) / Rref
          J[(m + i) * m + j] = duFull[6 * q.deck + 2] / DREF
          J[(2 * m + i) * m + j] = q.tower
            ? (q.ex * duFull[6 * q.other] + q.ey * duFull[6 * q.other + 1]) / TREF
            : 0
        }
      }
    }
    // Gauss–Newton: (JᵀJ + μ·diag)·ΔL = −Jᵀ·g
    A.fill(0)
    rhs.fill(0)
    for (let r = 0; r < nRows; r++) {
      const o = r * m
      const gr = g[r]
      for (let a = 0; a < m; a++) {
        const ja = J[o + a]
        if (ja === 0) continue
        rhs[a] -= ja * gr
        for (let b = a; b < m; b++) A[a * m + b] += ja * J[o + b]
      }
    }
    for (let a = 0; a < m; a++) {
      A[a * m + a] *= 1 + 1e-10
      for (let b = a + 1; b < m; b++) A[b * m + a] = A[a * m + b]
    }
    if (!gaussSolve(A, rhs, m)) break
    // limita o passo: |ΔL0| ≤ máx(5% de L0; 0,5 m)
    let scale = 1
    let rel = 0
    for (let j = 0; j < m; j++) {
      const lim = Math.max(0.05 * unknowns[j].cable.L0, 0.5)
      if (Math.abs(rhs[j]) * scale > lim) scale = lim / Math.abs(rhs[j])
    }
    const L0old = unknowns.map((q) => q.cable.L0)
    let Un = U
    let dn = dMax
    let trial = sol
    let ok = false
    for (let back = 0; back < 4; back++) {
      unknowns.forEach((q, j) => (q.cable.L0 = L0old[j] + scale * rhs[j]))
      trial = solveStatic(sys, sol.u, { nonlinear: opts.nonlinear })
      ;[Un, dn] = measure(trial.u)
      if (trial.converged && Un <= U) {
        ok = true
        break
      }
      scale *= 0.4
    }
    if (!ok) {
      unknowns.forEach((q, j) => (q.cable.L0 = L0old[j]))
      sol = solveStatic(sys, sol.u, { nonlinear: opts.nonlinear })
      ;[U, dMax] = measure(sol.u)
      result.converged = true
      break
    }
    for (let j = 0; j < m; j++) rel = Math.max(rel, Math.abs(scale * rhs[j]) / L0old[j])
    const gain = U > 0 ? (U - Un) / U : 0
    sol = trial
    U = Un
    dMax = dn
    history.push(dMax)
    result.iterations = it + 1
    // Faixa admissível de força: 0,5·R a 2,5·R. Greide e prumo da torre só podem ser
    // comprados com redistribuição de força dentro dela; quem sai tem o peso aumentado.
    let reweighted = false
    unknowns.forEach((q, i) => {
      if (q.anchor) return
      const F = lift(q)
      if ((F < 0.5 * q.R || F > 2.5 * q.R) && wF[i] < 1e3) {
        wF[i] *= 4
        reweighted = true
      }
    })
    if (reweighted) {
      ;[U, dMax] = measure(sol.u)
      continue
    }
    if (rel < tol || gain < 1e-6 || U < 1e-14) {
      result.converged = true
      break
    }
  }
  result.converged = result.converged && sol.converged
  result.residual = dMax
  opts.onProgress?.(1)
  return { result, solution: sol }
}
