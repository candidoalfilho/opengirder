import { describe, expect, it } from 'vitest'
import { analyzeBridge } from '../src/analyze'
import { buildSystem } from '../src/analysis/system'
import { solveStatic } from '../src/analysis/static'
import { solveBuckling } from '../src/analysis/buckling'
import { aeroChecks, selbergFlutter, torsionalDivergence, vortexSpeed } from '../src/checks/aero'
import { cqcCoefficient, designSpectrum, soilFactors } from '../src/loads/seismic'
import { G } from '../src/analysis/geometry'
import { generateModel, PRESETS } from '../src/templates'
import type { BridgeModel, BridgeNode, Element } from '../src/model/types'
import { beam, model, SEC, STEEL } from './helpers'

function buckle(m: BridgeModel, nonlinear: boolean, modes = 3) {
  const sys = buildSystem(m)
  const sol = solveStatic(sys, null, { nonlinear })
  expect(sol.converged).toBe(true)
  return solveBuckling(sys, { modes })!
}

const EIy = STEEL.E * SEC.Iy
const EIz = STEEL.E * SEC.Iz

describe('flambagem linearizada', () => {
  it('coluna biarticulada de Euler: λ·P = π²EI/L² nos dois planos (8 elementos)', () => {
    const L = 10
    const P = 100
    const m = beam(L, 8)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[8].fix = [false, true, true, false, false, false]
    m.loadCases = [{ id: 'p', name: 'p', nodal: [{ node: 9, F: [-P, 0, 0, 0, 0, 0] }] }]
    for (const nonlinear of [false, true]) {
      const r = buckle(m, nonlinear)
      expect(r.converged).toBe(true)
      const pcr1 = (Math.PI ** 2 * EIy) / L ** 2
      const pcr2 = (Math.PI ** 2 * EIz) / L ** 2
      expect((r.modes[0].factor * P) / pcr1).toBeCloseTo(1, 2)
      expect((r.modes[1].factor * P) / pcr2).toBeCloseTo(1, 2)
      // 3º modo: 2ª semionda no plano fraco (4·Pcr1 = 2·Pcr2 aqui coincide em múltiplos; só ordem)
      expect(r.modes[2].factor).toBeGreaterThan(r.modes[1].factor * 0.999)
      expect(r.modes[0].group).toBe('deck')
    }
  })

  it('coluna engastada-livre: λ·P = π²EI/(4L²)', () => {
    const L = 6
    const P = 50
    const m = beam(L, 8)
    m.nodes[0].fix = [true, true, true, true, true, true]
    m.loadCases = [{ id: 'p', name: 'p', nodal: [{ node: 9, F: [-P, 0, 0, 0, 0, 0] }] }]
    const r = buckle(m, false)
    expect((r.modes[0].factor * P) / ((Math.PI ** 2 * EIy) / (4 * L * L))).toBeCloseTo(1, 3)
    expect((r.modes[1].factor * P) / ((Math.PI ** 2 * EIz) / (4 * L * L))).toBeCloseTo(1, 3)
  })

  it('pórtico plano engastado, deslocável (viga = pilar): kh/tan(kh) = −6 ⇒ Pcr = 7,38·EI/h²', () => {
    const h = 5
    const n = 8
    const nodes: BridgeNode[] = []
    const elements: Element[] = []
    let id = 0
    const plane: [boolean, boolean, boolean, boolean, boolean, boolean] = [false, true, false, true, false, true]
    const add = (x: number, z: number, fixAll = false): number => {
      nodes.push({ id: ++id, x, y: 0, z, fix: fixAll ? [true, true, true, true, true, true] : [...plane] })
      return id
    }
    let eid = 0
    const line = (a: [number, number], b: [number, number], first: number | null, last: number | null): number[] => {
      const ids: number[] = []
      for (let i = 0; i <= n; i++) {
        if (i === 0 && first) ids.push(first)
        else if (i === n && last) ids.push(last)
        else ids.push(add(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n))
      }
      for (let i = 0; i < n; i++) elements.push({ kind: 'frame', id: ++eid, n1: ids[i], n2: ids[i + 1], mat: 's', sec: 'sec', group: 'tower' })
      return ids
    }
    const b1 = add(0, 0, true)
    const b2 = add(h, 0, true)
    const c1 = line([0, 0], [0, h], b1, null)
    const c2 = line([h, 0], [h, h], b2, null)
    line([0, h], [h, h], c1[n], c2[n])
    const P = 200
    const m = model(nodes, elements, {
      loadCases: [{ id: 'p', name: 'p', nodal: [c1[n], c2[n]].map((node) => ({ node, F: [0, 0, -P, 0, 0, 0] as [number, number, number, number, number, number] })) }],
    })
    const r = buckle(m, false, 2)
    // raiz de kh/tan(kh) = −6 (Timoshenko & Gere, Theory of Elastic Stability, 2.4): kh = 2,7165
    const kh = 2.71646
    expect(kh / Math.tan(kh)).toBeCloseTo(-6, 3)
    const pcr = (kh * kh * EIz) / (h * h)
    expect((r.modes[0].factor * P) / pcr).toBeCloseTo(1, 2)
    expect(r.modes[0].group).toBe('tower')
  })

  it('sem barra comprimida não há análise', () => {
    const m = beam(10, 4)
    m.nodes[0].fix = [true, true, true, true, false, false]
    m.nodes[4].fix = [false, true, true, false, false, false]
    m.loadCases = [{ id: 'p', name: 'p', nodal: [{ node: 5, F: [100, 0, 0, 0, 0, 0] }] }]
    const sys = buildSystem(m)
    solveStatic(sys, null, { nonlinear: false })
    expect(solveBuckling(sys)).toBeNull()
  })

  it('estaiada de três vãos: λ finito e maior que 1', () => {
    const p = PRESETS.find((x) => x.id === 'estaiada-3-vaos')!
    const t0 = performance.now()
    const r = analyzeBridge(generateModel(p.template), { modal: false, moving: false })
    const dt = performance.now() - t0
    expect(r.buckling).toBeDefined()
    const b = r.buckling!
    console.log(
      `estaiada-3-vaos: λ = ${b.modes.map((m) => `${m.factor.toFixed(2)} (${m.group} ${(100 * m.share).toFixed(0)}%)`).join(', ')}; ` +
        `iter ${b.iterations}; conv ${b.converged}; flambagem ${r.timings.flambagem} ms; total ${dt.toFixed(0)} ms`,
    )
    expect(b.modes[0].factor).toBeGreaterThan(1)
    expect(b.modes[0].factor).toBeLessThan(200)
  })
})

describe('estabilidade aerodinâmica', () => {
  it('Selberg: caso manual e equivalência com a forma 0,44·B·√[(ωT² − ωV²)·√ν/μ]', () => {
    const B = 30, m = 20, r = 9, fV = 0.1, fT = 0.25, rho = 1.25e-3
    const v = selbergFlutter(B, m, r, fV, fT, rho)
    // à mão: m·r/(ρB³) = 180/33,75 = 5,3333; (1 − 0,16) = 0,84; √4,48 = 2,11660; 3,71·0,25·30·2,1166 = 58,89
    expect(v).toBeCloseTo(58.89, 1)
    const nu = (8 * r * r) / (B * B)
    const mu = (Math.PI * rho * B * B) / (2 * m)
    const alt = 0.44 * B * Math.sqrt((((2 * Math.PI) ** 2 * (fT * fT - fV * fV)) * Math.sqrt(nu)) / mu)
    expect(v / alt).toBeCloseTo(1, 2)
    expect(Number.isNaN(selbergFlutter(B, m, r, 0.3, 0.25))).toBe(true)
  })

  it('divergência torcional e vórtices: fórmulas fechadas', () => {
    const B = 20, m = 10, r = 6, fT = 0.4, rho = 1.25e-3
    const k = m * r * r * (2 * Math.PI * fT) ** 2
    expect(torsionalDivergence(B, m, r, fT, Math.PI / 2, rho)).toBeCloseTo(Math.sqrt((2 * k) / (rho * B * B * (Math.PI / 2))), 9)
    expect(vortexSpeed(0.5, 3, 0.12)).toBeCloseTo(12.5, 9)
  })

  it('Tacoma Narrows (1940): reprova no vento do dia do colapso (18,8 m/s)', () => {
    // B = 11,9 m; m = 4,25 t/m; I = 177,7 t·m²/m (r = 6,47 m); fV ≈ 0,13 Hz; fT ≈ 0,20 Hz
    // (Larsen, "Aerodynamics of the Tacoma Narrows Bridge — 60 years later", SEI 4/2000)
    const r = Math.sqrt(177.7 / 4.25)
    const plate = selbergFlutter(11.9, 4.25, r, 0.13, 0.2)
    expect(plate).toBeGreaterThan(22)
    expect(plate).toBeLessThan(27)
    const checks = aeroChecks({ B: 11.9, D: 2.4, mass: 4.25, radius: r, fV: 0.13, fT: 0.2, shapeFactor: 0.35, Vk: 18.8 })
    const fl = checks.find((c) => c.key === 'flutter')!
    expect(fl.value).toBeGreaterThan(7)
    expect(fl.value).toBeLessThan(10)
    expect(fl.ok).toBe(false)
    // vórtices no modo vertical: poucos m/s — as oscilações verticais que a ponte tinha desde a inauguração
    const vv = checks.find((c) => c.key === 'vortex-v')!
    expect(vv.value).toBeCloseTo((0.13 * 2.4) / 0.12, 6)
    expect(vv.ok).toBeUndefined()
  })
})

describe('sismo NBR 15421', () => {
  it('espectro de projeto: ramos, continuidade e Tabela 3', () => {
    expect(soilFactors('D', 0.05)).toEqual({ Ca: 1.6, Cv: 2.4 })
    expect(soilFactors('D', 0.15)).toEqual({ Ca: 1.5, Cv: 2.2 })
    const f = soilFactors('E', 0.125)
    expect(f.Ca).toBeCloseTo(2.3, 9)
    expect(f.Cv).toBeCloseTo(3.45, 9)
    const p = { ag: 0.1, soil: 'C' as const }
    const r = 1.7 / 1.2
    expect(designSpectrum(p, 0)).toBeCloseTo(0.12, 9)
    expect(designSpectrum(p, 0.08 * r)).toBeCloseTo(0.3, 9)
    expect(designSpectrum(p, 0.2)).toBeCloseTo(0.3, 9)
    expect(designSpectrum(p, 0.4 * r)).toBeCloseTo(0.3, 9)
    expect(designSpectrum(p, 2)).toBeCloseTo(0.17 / 2, 9)
    expect(designSpectrum(p, 0.04 * r)).toBeCloseTo(0.12 * 1.75, 9)
  })

  it('CQC: ρ = 1 para modos iguais; ≈ SRSS para modos afastados', () => {
    expect(cqcCoefficient(3, 3)).toBeCloseTo(1, 12)
    expect(cqcCoefficient(3, 6)).toBeLessThan(0.02)
    expect(cqcCoefficient(3, 6)).toBeCloseTo(cqcCoefficient(6, 3), 12)
  })

  it('oscilador de 1 GDL por direção (pilar engastado-guiado): V = m·Sa(T)·g·I/R', () => {
    const L = 8
    const mat = { ...STEEL, gamma: 77 }
    const sec = { ...SEC, A: 0.5 }
    const m = model(
      [
        { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
        { id: 2, x: 0, y: 0, z: L, fix: [false, false, false, true, true, true] },
      ],
      [{ kind: 'frame', id: 1, n1: 1, n2: 2, mat: 's', sec: 'sec', group: 'pier' }],
      { materials: [mat], sections: [sec], site: { seismic: { ag: 0.15, soil: 'D', R: 2, I: 1.25 }, temperature: false, wind: false, braking: false } },
    )
    const r = analyzeBridge(m, { nonlinear: false, modal: { modes: 3 }, moving: false, buckling: false })
    const E = r.cases?.find((c) => c.id === 'E')
    expect(E).toBeDefined()
    const mass = (77 * 0.5 * L) / 2 / G
    // barra vertical: y local = +X ⇒ flexão em X usa Iz; em Y usa Iy
    const Tx = 2 * Math.PI * Math.sqrt(mass / ((12 * STEEL.E * SEC.Iz) / L ** 3))
    const Ty = 2 * Math.PI * Math.sqrt(mass / ((12 * STEEL.E * SEC.Iy) / L ** 3))
    const Tz = 2 * Math.PI * Math.sqrt(mass / ((STEEL.E * 0.5) / L))
    const periods = r.modal!.modes.map((x) => x.period).sort((a, b) => b - a)
    expect(periods[0] / Ty).toBeCloseTo(1, 6)
    expect(periods[1] / Tx).toBeCloseTo(1, 6)
    expect(periods[2] / Tz).toBeCloseTo(1, 6)
    const p = { ag: 0.15, soil: 'D' as const }
    const k = 1.25 / 2
    const Vx = mass * designSpectrum(p, Tx) * G * k
    const Vy = mass * designSpectrum(p, Ty) * G * k
    const Vz = mass * 0.5 * designSpectrum(p, Tz) * G * k
    const info = (label: string): number => E!.info!.find((i) => i.label.startsWith(label))!.value
    expect(info('Cortante na base em X') / Vx).toBeCloseTo(1, 6)
    expect(info('Cortante na base em Y') / Vy).toBeCloseTo(1, 6)
    expect(info('Massa participante em X')).toBeCloseTo(100, 6)
    // reações na base = cortantes (cada direção só excita o seu modo); momento = V·L/2
    const R = E!.reactions.find((x) => x.node === 1)!.R
    expect(R[0] / Vx).toBeCloseTo(1, 6)
    expect(R[1] / Vy).toBeCloseTo(1, 6)
    expect(R[2] / Vz).toBeCloseTo(1, 6)
    expect(R[4] / ((Vx * L) / 2)).toBeCloseTo(1, 6)
    // esforços na barra (valor absoluto): cortante e momento na base
    const f = E!.frames[0]
    expect(f.Vy[0] / Vx).toBeCloseTo(1, 6)
    expect(f.Mz[0] / ((Vx * L) / 2)).toBeCloseTo(1, 6)
    expect(f.N[0] / Vz).toBeCloseTo(1, 6)
    // deslocamento do topo: elástico (Cd/R com Cd = R; sem I e sem dividir por R)
    expect(E!.u[6 + 0] / ((mass * designSpectrum(p, Tx) * G) / ((12 * STEEL.E * SEC.Iz) / L ** 3))).toBeCloseTo(1, 6)
  })

  it('massa faltante: com 1 só modo, as outras direções respondem estaticamente a Sa do modo de corte', () => {
    const L = 8
    const mat = { ...STEEL, gamma: 77 }
    const sec = { ...SEC, A: 0.5 }
    const m = model(
      [
        { id: 1, x: 0, y: 0, z: 0, fix: [true, true, true, true, true, true] },
        { id: 2, x: 0, y: 0, z: L, fix: [false, false, false, true, true, true] },
      ],
      [{ kind: 'frame', id: 1, n1: 1, n2: 2, mat: 's', sec: 'sec', group: 'pier' }],
      { materials: [mat], sections: [sec], site: { seismic: { ag: 0.1, soil: 'B', R: 1, I: 1 }, temperature: false, wind: false, braking: false } },
    )
    const r = analyzeBridge(m, { nonlinear: false, modal: { modes: 1 }, moving: false, buckling: false })
    const E = r.cases!.find((c) => c.id === 'E')!
    const mass = (77 * 0.5 * L) / 2 / G
    const Ty = r.modal!.modes[0].period
    expect(Ty / (2 * Math.PI * Math.sqrt(mass / ((12 * STEEL.E * SEC.Iy) / L ** 3)))).toBeCloseTo(1, 6)
    const sa = designSpectrum({ ag: 0.1, soil: 'B' }, Ty) * G
    expect(Ty).toBeGreaterThan(0.4) // ramo descendente: Sa(Ty) < patamar
    const saMax = 2.5 * 0.1 * G // maior Sa até Ty = patamar 2,5·ags0
    const R = E.reactions.find((x) => x.node === 1)!.R
    expect(R[1] / (mass * sa)).toBeCloseTo(1, 6) // modal
    expect(R[0] / (mass * saMax)).toBeCloseTo(1, 6) // massa faltante em X
    expect(R[2] / (mass * 0.5 * saMax)).toBeCloseTo(1, 6) // massa faltante em Z
    expect(r.warnings.some((w) => w.includes('massa faltante'))).toBe(true)
  })
})
