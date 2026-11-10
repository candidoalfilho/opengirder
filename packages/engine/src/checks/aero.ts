/**
 * Estabilidade aerodinâmica do tabuleiro — verificações SIMPLIFICADAS de triagem, a partir
 * dos modos de vibração. Não substituem ensaio em túnel de vento nem a análise com
 * derivadas de flutter da seção real.
 *
 * 1. Flutter acoplado flexão–torção — fórmula de Selberg (1961) p/ placa plana:
 *      Vcr = 3,71·fT·B·√[ (m·r/(ρ·B³))·(1 − (fV/fT)²) ]
 *    (m = massa por comprimento, r = raio de giração da massa, B = largura total, ρ = massa
 *    específica do ar; é a mesma expressão 0,44·B·√[(ωT² − ωV²)·√ν/μ] com ν = 8r²/B² e
 *    μ = πρB²/(2m) — Dyrbye & Hansen, "Wind Loads on Structures", 8.6). A seção real é
 *    considerada por um fator de forma η ≤ 1 (valores indicativos da literatura — Selberg
 *    1961; Klöppel & Thiele 1967): placa/caixão carenado 1,0; caixão convencional com
 *    balanços 0,7; treliça de rigidez 0,8; vigas de alma cheia abertas (seção em H ou π,
 *    tipo Tacoma) 0,35; não classificada 0,5.
 * 2. Divergência torcional (estática): Vd = √[ 2·Kα/(ρ·B²·C'm) ], Kα = I·ωT² (rigidez
 *    torcional generalizada por comprimento) e C'm = dCm/dα = π/2 (placa plana, momento
 *    ½·ρ·V²·B²·Cm) — Simiu & Scanlan, "Wind Effects on Structures", 6.2.
 * 3. Desprendimento de vórtices: Vv = f·D/St, com St = 0,12 (tabuleiros: 0,10 a 0,15;
 *    EN 1991-1-4, Anexo E) p/ o 1º modo vertical e o 1º torcional. É um fenômeno de
 *    amplitude limitada: o resultado é informativo.
 *
 * Velocidade de comparação: Vk = V0·S1·S2·S3 da NBR 6123 na cota do tabuleiro (rajada de 3 s,
 * classe pela maior dimensão). Os critérios de flutter costumam pedir Vcr ≥ 1,2 a 1,5 vezes a
 * velocidade MÉDIA de 10 min; a rajada de 3 s já é 1,3 a 1,5 vezes essa média, por isso
 * compara-se Vcr diretamente com Vk.
 *
 * Simplificações: usa o modo vertical e o torcional de menor frequência (sem conferir a
 * semelhança das formas); massa e inércia polar médias do tabuleiro, somadas às dos cabos
 * principais e pendurais em pontes pênseis; sem efeito do ângulo de ataque nem da turbulência.
 */

import type { AeroCheck, AeroResult } from '../analysis/types'
import type { AnalysisContext } from '../analysis/context'
import { G } from '../analysis/geometry'
import { resolveSite } from '../loads/site'
import { s2Factor, windClass } from '../loads/wind'

/** massa específica do ar (t/m³) — a mesma do q = 0,613·V² da NBR 6123 */
export const RHO_AIR = 1.226e-3
const STROUHAL = 0.12

/** velocidade crítica de flutter da placa plana (m/s) — Selberg. Unidades coerentes (t, m, Hz). */
export function selbergFlutter(B: number, m: number, r: number, fV: number, fT: number, rho = RHO_AIR): number {
  if (!(fT > fV) || !(B > 0) || !(m > 0) || !(r > 0)) return NaN
  return 3.71 * fT * B * Math.sqrt(((m * r) / (rho * B ** 3)) * (1 - (fV / fT) ** 2))
}

/** velocidade de divergência torcional (m/s); dCm = dCm/dα referido a B² */
export function torsionalDivergence(B: number, m: number, r: number, fT: number, dCm = Math.PI / 2, rho = RHO_AIR): number {
  if (!(B > 0) || !(fT > 0)) return NaN
  const k = m * r * r * (2 * Math.PI * fT) ** 2
  return Math.sqrt((2 * k) / (rho * B * B * dCm))
}

/** velocidade crítica de desprendimento de vórtices (m/s) */
export function vortexSpeed(f: number, D: number, St = STROUHAL): number {
  return (f * D) / St
}

/** fator de forma η da seção sobre a velocidade de flutter da placa plana */
export function flutterShapeFactor(shape: string | undefined): number {
  switch (shape) {
    case 'box': return 0.7
    case 'truss': return 0.8
    case 'girder': return 0.35
    default: return 0.5
  }
}

export interface AeroInput {
  B: number
  D: number
  /** massa por comprimento (t/m) e raio de giração (m) */
  mass: number
  radius: number
  fV: number
  fT: number
  shapeFactor: number
  /** velocidade de comparação (m/s) */
  Vk: number
}

/** as verificações, a partir das grandezas do tabuleiro (função pura, testável) */
export function aeroChecks(a: AeroInput): AeroCheck[] {
  const out: AeroCheck[] = []
  const judge = (c: Omit<AeroCheck, 'limit' | 'ratio' | 'ok'>, pass: boolean): AeroCheck =>
    a.Vk > 0 && c.value > 0 ? { ...c, limit: a.Vk, ratio: a.Vk / c.value, ok: pass && c.value >= a.Vk } : { ...c }
  if (a.fV > 0 && a.fT > 0) {
    const plate = selbergFlutter(a.B, a.mass, a.radius, a.fV, a.fT)
    if (Number.isFinite(plate)) {
      out.push(judge({
        key: 'flutter',
        label: 'Flutter flexão–torção (Selberg)',
        value: a.shapeFactor * plate,
        unit: 'm/s',
        note: `placa plana ${plate.toFixed(1)} m/s × fator de forma ${a.shapeFactor.toFixed(2)}; fT/fV = ${(a.fT / a.fV).toFixed(2)}`,
      }, true))
    } else {
      out.push({
        key: 'flutter',
        label: 'Flutter flexão–torção (Selberg)',
        value: 0,
        unit: 'm/s',
        limit: a.Vk > 0 ? a.Vk : undefined,
        ok: false,
        note: `frequência torcional (${a.fT.toFixed(3)} Hz) não é maior que a vertical (${a.fV.toFixed(3)} Hz): a fórmula não se aplica e a seção é suscetível a acoplamento — exige estudo específico`,
      })
    }
  }
  if (a.fT > 0) {
    out.push(judge({
      key: 'divergence',
      label: 'Divergência torcional',
      value: torsionalDivergence(a.B, a.mass, a.radius, a.fT),
      unit: 'm/s',
      note: "dCm/dα = π/2 (placa plana)",
    }, true))
  }
  const vortex = (key: 'vortex-v' | 'vortex-t', what: string, f: number): void => {
    if (!(f > 0) || !(a.D > 0)) return
    const v = vortexSpeed(f, a.D)
    out.push({
      key,
      label: `Desprendimento de vórtices — 1º modo ${what}`,
      value: v,
      unit: 'm/s',
      limit: a.Vk > 0 ? a.Vk : undefined,
      note:
        `St = ${STROUHAL.toFixed(2).replace('.', ',')}; ` +
        (a.Vk > 0 && v < a.Vk
          ? 'dentro da faixa de ventos de serviço — avaliar amplitude e conforto (EN 1991-1-4, Anexo E)'
          : 'acima da velocidade de projeto'),
    })
  }
  vortex('vortex-v', 'vertical', a.fV)
  vortex('vortex-t', 'torcional', a.fT)
  return out
}

/** [ext:verificacoes] — exige análise modal e tabuleiro com largura definida */
export function runAero(ctx: AnalysisContext): void {
  const { sys, model, res } = ctx
  const modes = res.modal?.modes
  if (!modes || modes.length === 0) return
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  const elSec = new Map<number, string>()
  for (const e of model.elements) if (e.kind === 'frame') elSec.set(e.id, e.sec)

  // tabuleiro: médias ponderadas pelo comprimento
  let len = 0
  let mL = 0
  let jL = 0
  let bL = 0
  let dL = 0
  let zL = 0
  let yL = 0
  let shape: string | undefined
  for (const f of sys.frames) {
    if (f.group !== 'deck') continue
    const sec = secs.get(elSec.get(f.id) ?? '')
    if (!sec || !(sec.width && sec.width > 0)) continue
    // tabuleiro em grelha: a triagem de seção única (B, m, r do tabuleiro) não se aplica
    if (sec.windShare !== undefined) return
    len += f.L0
    mL += f.mass * f.L0
    jL += f.polar * f.L0
    bL += sec.width * f.L0
    dL += (sec.depth ?? 0) * f.L0
    zL += ((sys.X[3 * f.a + 2] + sys.X[3 * f.b + 2]) / 2) * f.L0
    yL += ((sys.X[3 * f.a + 1] + sys.X[3 * f.b + 1]) / 2) * f.L0
    shape ??= sec.shape
  }
  if (!(len > 0) || !(mL > 0)) return
  const B = bL / len
  const D = dL / len
  let mass = mL / len
  let polar = jL / len
  // pontes pênseis: cabos principais e pendurais vibram com o tabuleiro
  const yDeck = yL / len
  let mc = 0
  let jc = 0
  for (const c of sys.cables) {
    if (c.group !== 'main-cable' && c.group !== 'hanger') continue
    const mEl = (c.w * c.L0) / G
    const y = (sys.X[3 * c.a + 1] + sys.X[3 * c.b + 1]) / 2 - yDeck
    mc += mEl
    jc += mEl * y * y
  }
  mass += mc / len
  polar += jc / len
  const radius = Math.sqrt(polar / mass)

  const mV = modes.find((m) => m.kind === 'vertical')
  const mT = modes.find((m) => m.kind === 'torcional')
  if (!mV && !mT) return

  // velocidade característica na cota do tabuleiro (NBR 6123)
  let zMin = Infinity
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < sys.nNodes; i++) {
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], sys.X[3 * i + c])
      hi[c] = Math.max(hi[c], sys.X[3 * i + c])
    }
    zMin = Math.min(zMin, sys.X[3 * i + 2])
  }
  const z = Math.max(10, zL / len - zMin)
  const w = resolveSite(model).wind
  const Vk = w ? w.V0 * w.S1 * s2Factor(w.category, windClass(Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])), z) * w.S3 : 0

  const shapeFactor = flutterShapeFactor(shape)
  const fV = mV?.frequency ?? 0
  const fT = mT?.frequency ?? 0
  const checks = aeroChecks({ B, D, mass, radius, fV, fT, shapeFactor, Vk })
  if (checks.length === 0) return
  const out: AeroResult = {
    Vk, z, B, D, mass, radius, fV, fT,
    modeV: mV?.index ?? 0,
    modeT: mT?.index ?? 0,
    shapeFactor,
    checks,
  }
  res.aero = out
  const bad = checks.filter((c) => c.ok === false)
  if (bad.length > 0) {
    ctx.warnings.push(
      `Estabilidade aerodinâmica (triagem simplificada): ${bad.map((c) => c.label.toLowerCase()).join(' e ')} ` +
        `abaixo da velocidade de projeto Vk = ${Vk.toFixed(1)} m/s — exige estudo aerodinâmico específico.`,
    )
  }
  ctx.lap('aerodinamica')
}
