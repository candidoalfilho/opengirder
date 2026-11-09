/**
 * Verificação das seções de tabuleiro, torres e pilares no ELU.
 *
 * Esforços: envoltória ELU das combinações NBR 8681 (`res.combos`); na falta delas,
 * 1,35·G (ou 1,0·G quando favorável) + 1,5·Q + protensão, com G e Q de `deadLoad`/`moving`.
 *
 *  - concreto, tabuleiro: flexão composta reta de seção T/caixão — armadura
 *    inferior p/ o momento positivo e superior p/ o negativo, cada um com a força normal
 *    concomitante (a compressão dos estais entra) —, cortante (modelo I) e torção de seção
 *    vazada, com a interação das bielas (checks/nbr6118.ts);
 *  - concreto, torres, pilares e arcos: flexo-compressão oblíqua de seção retangular maciça ou
 *    vazada com armadura distribuída no contorno, momento mínimo de 1ª ordem; os efeitos
 *    LOCAIS de 2ª ordem (NBR 6118 15.8) não são somados — os globais já estão nos esforços
 *    da análise não linear geométrica;
 *  - aço: nível de tensões elásticas (checks/nbr8800.ts), sem flambagem local/lateral.
 *
 * Protensão: com o caso 'P' nos esforços (N = −P, M = P·e + hiperestático), o cabo entra no
 * equilíbrio do ELU só com o ACRÉSCIMO de tensão até fpyd = 0,9·fptk/1,15.
 *
 * Seções sem geometria detalhada (só A, I, largura e altura) são convertidas num caixão ou
 * tubo retangular equivalente de mesma área — resultado marcado com `approx`.
 */

import type { Material, Section } from '../model/types'
import type { EnvForces, FrameForces, SectionCheck } from '../analysis/types'
import type { AnalysisContext } from '../analysis/context'
import { type DesignSection, type TorsionSection, sectionProperties } from '../sections/properties'
import { columnELU, concreteParams, flexureELU, minMoment, shearELU, shearTorsionRatio, torsionELU } from './nbr6118'
import { steelStressCheck } from './nbr8800'

const GROUPS = new Set(['deck', 'tower', 'pier', 'arch'])
type Triple = [number, number, number]
const COMPS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'] as const

interface DesignData {
  dsg: DesignSection
  torsion?: TorsionSection
  approx: boolean
  A: number
  Iz: number
  Iy: number
  yTop: number
  yBot: number
  h: number
  b: number
  /** seção retangular vazada equivalente (torres/pilares): espessuras */
  tw?: number
  tf?: number
  Aw?: number
}

/** seção de dimensionamento: da geometria, se houver; senão, equivalente de mesma área */
export function designData(sec: Section, column: boolean): DesignData {
  if (sec.geometry) {
    const p = sectionProperties(sec.geometry)
    const g = sec.geometry
    const out: DesignData = {
      dsg: p.design, torsion: p.torsion, approx: false, A: p.A, Iz: p.Iz, Iy: p.Iy,
      yTop: p.yTop, yBot: p.yBot, h: p.depth, b: p.width, Aw: p.Aw,
    }
    if (g.kind === 'hollow-rect') {
      out.tw = g.wall
      out.tf = g.wallDepth ?? g.wall
    }
    return out
  }
  const h = sec.depth && sec.depth > 0 ? sec.depth : Math.sqrt((12 * sec.Iz) / sec.A)
  const b = sec.width && sec.width > 0 ? sec.width : sec.A / h
  const base = {
    approx: true, A: sec.A, Iz: sec.Iz, Iy: sec.Iy,
    yTop: sec.yTop ?? h / 2, yBot: sec.yBot ?? h / 2, h, b,
  }
  const solid: DesignSection = { bf: b, hf: h, bw: b, h, bfBot: b, hfBot: h }
  if (sec.A >= 0.95 * b * h) return { ...base, approx: sec.A > 1.05 * b * h, dsg: solid }
  if (column) {
    // tubo retangular de parede constante t: A = b·h − (b − 2t)(h − 2t)
    const disc = (b + h) ** 2 - 4 * sec.A
    const t = disc > 0 ? (b + h - Math.sqrt(disc)) / 4 : Math.min(b, h) / 2
    return {
      ...base, tw: t, tf: t,
      dsg: { bf: b, hf: t, bw: 2 * t, h, bfBot: b, hfBot: t },
      torsion: { Ae: (b - t) * (h - t), he: t, ue: 2 * (b + h - 2 * t) },
    }
  }
  // tabuleiro: caixão com laje superior na largura toda, fundo com metade dela e 2 almas
  let hf = Math.min(0.4 * h, Math.max(0.2, Math.min(0.35, 0.12 * h)))
  let hfb = 0.8 * hf
  const bfb = 0.5 * b
  let bw = (sec.A - b * hf - bfb * hfb) / (h - hf - hfb)
  if (!(bw > 0.05 * bfb)) {
    // área menor que a das duas lajes: reduz as lajes na proporção e deixa almas mínimas
    const k = (0.8 * sec.A) / (b * hf + bfb * hfb)
    hf *= Math.min(1, k)
    hfb *= Math.min(1, k)
    bw = Math.max(0.05 * bfb, (sec.A - b * hf - bfb * hfb) / (h - hf - hfb))
  }
  bw = Math.min(bw, bfb)
  const he = Math.min(hf, hfb, bw / 2)
  const bm = bfb - bw / 2
  const hm = h - hf / 2 - hfb / 2
  return {
    ...base,
    dsg: { bf: b, hf, bw, h, bfBot: bfb, hfBot: hfb },
    torsion: bm > 0 && hm > 0 && he > 0 ? { Ae: bm * hm, he, ue: 2 * (bm + hm) } : undefined,
  }
}

function fallbackEnvelope(G: FrameForces, Q: Partial<Record<(typeof COMPS)[number], { min: Triple; max: Triple }>> | undefined, P: FrameForces | undefined): { elu: EnvForces; NatMz: { min: Triple; max: Triple } } {
  const env = {} as EnvForces
  for (const c of COMPS) {
    const min: Triple = [0, 0, 0]
    const max: Triple = [0, 0, 0]
    for (let s = 0; s < 3; s++) {
      const g = G[c][s]
      const p = P ? P[c][s] : 0
      const q = Q?.[c]
      max[s] = Math.max(1.35 * g, g) + 1.5 * Math.max(q ? q.max[s] : 0, 0) + p
      min[s] = Math.min(1.35 * g, g) + 1.5 * Math.min(q ? q.min[s] : 0, 0) + p
    }
    env[c] = { min, max }
  }
  const nat = (unfavPositive: boolean): Triple =>
    [0, 1, 2].map((s) => {
      const gm = G.Mz[s]
      const gamma = (gm > 0) === unfavPositive ? 1.35 : 1
      return gamma * G.N[s] + (P ? P.N[s] : 0)
    }) as Triple
  return { elu: env, NatMz: { min: nat(false), max: nat(true) } }
}

const absMax = (e: { min: Triple; max: Triple }, s: number): number => Math.max(Math.abs(e.min[s]), Math.abs(e.max[s]))

export function runSectionChecks(ctx: AnalysisContext): void {
  const { model, sys, res } = ctx
  const mats = new Map(model.materials.map((m) => [m.id, m]))
  const secs = new Map(model.sections.map((s) => [s.id, s]))
  const els = new Map(model.elements.map((e) => [e.id, e]))
  const pCase = (res.cases ?? ctx.cases).find((c) => c.kind === 'prestress')
  // aço de protensão: fptk do material de cabos de protensão, se houver; senão CP 190
  const tendonMat = model.materials.find((m) => m.kind === 'cable' && /tend|prot|cp/i.test(m.id))
  const fpyd = (0.9 * (tendonMat?.fpk ?? 1900e3)) / 1.15
  const cache = new Map<string, DesignData>()
  const out: SectionCheck[] = []

  sys.frames.forEach((f, i) => {
    const group = f.group ?? ''
    if (!GROUPS.has(group)) return
    const el = els.get(f.id)
    if (!el || el.kind !== 'frame') return
    const mat = mats.get(el.mat) as Material | undefined
    const sec = secs.get(el.sec)
    if (!mat || !sec || mat.kind === 'rigid' || mat.kind === 'cable' || sec.shape === 'rigid') return
    // treliça de rigidez modelada como barra equivalente: as tensões da viga equivalente não
    // representam as barras da treliça (banzos, diagonais) — fora do escopo desta verificação
    if (sec.shape === 'truss') return
    // aparelhos de apoio e ligações modelados como barra: não são seções a dimensionar
    if (sec.shape === 'generic' && (group === 'pier' || group === 'tower')) return
    // arcos trabalham à compressão: dimensionados como pilar (armadura no contorno)
    const column = group === 'tower' || group === 'pier' || group === 'arch'
    const key = `${sec.id}|${column}`
    let dd = cache.get(key)
    if (!dd) {
      dd = designData(sec, column)
      cache.set(key, dd)
    }
    const combo = res.combos?.frames[i]
    const { elu, NatMz } = combo
      ? { elu: combo.elu, NatMz: combo.NatMz }
      : fallbackEnvelope(res.deadLoad.frames[i], res.moving?.frames[i], pCase?.frames[i])

    const mid = group === 'deck' || group === 'arch' ? 0 : 2
    const s = (sys.X[3 * f.a + mid] + sys.X[3 * f.b + mid]) / 2
    const base = {
      id: f.id, group, approx: dd.approx, s,
      MdPos: Math.max(0, ...elu.Mz.max), MdNeg: Math.max(0, ...elu.Mz.min.map((v) => -v)),
      NdPos: NatMz.max[elu.Mz.max.indexOf(Math.max(...elu.Mz.max))],
      NdNeg: NatMz.min[elu.Mz.min.indexOf(Math.min(...elu.Mz.min))],
      Nd: [Math.min(...elu.N.min), Math.max(...elu.N.max)] as [number, number],
      MydAbs: Math.max(...[0, 1, 2].map((k) => absMax(elu.My, k))),
      Vd: Math.max(...[0, 1, 2].map((k) => Math.max(absMax(elu.Vy, k), column ? absMax(elu.Vz, k) : 0))),
      Td: Math.max(...[0, 1, 2].map((k) => absMax(elu.T, k))),
    }

    // ---------------- aço: tensões elásticas
    if (mat.kind === 'steel') {
      const Wtop = dd.Iz / dd.yTop
      const Wbot = dd.Iz / dd.yBot
      const Wy = dd.b > 0 ? dd.Iy / (dd.b / 2) : undefined
      let sigma = 0
      let ratio = 0
      let shear: number | undefined
      for (let k = 0; k < 3; k++) {
        for (const N of [elu.N.min[k], elu.N.max[k]]) {
          for (const M of [elu.Mz.min[k], elu.Mz.max[k]]) {
            const r = steelStressCheck({
              A: dd.A, Wtop, Wbot, Wy, Aw: dd.Aw, fy: mat.fy ?? 345e3,
              Nd: N, Mzd: M, Myd: absMax(elu.My, k), Vd: absMax(elu.Vy, k),
            })
            if (r.sigma > sigma) sigma = r.sigma
            if (r.ratio > ratio) ratio = r.ratio
            if (r.shearRatio !== undefined) shear = Math.max(shear ?? 0, r.shearRatio)
          }
        }
      }
      const homog = /mista|homogeneizada/i.test(mat.name)
      const notes = ['Flambagem local, lateral e global não verificadas.']
      if (homog) notes.push('Seção equivalente homogeneizada: tensões indicativas.')
      out.push({
        ...base, method: homog ? 'tensões' : 'NBR 8800', member: 'stress', sigma,
        ratios: { bending: ratio, shear }, ratio: Math.max(ratio, shear ?? 0),
        ok: ratio <= 1 && (shear ?? 0) <= 1, notes,
      })
      return
    }

    // ---------------- concreto
    const fck = mat.fck ?? 30e3
    const cp = concreteParams(fck)
    const notes: string[] = []

    if (column) {
      const cover = Math.min(0.08, 0.1 * Math.min(dd.h, dd.b))
      let As = 0
      let AsMin = 0
      let ratio = 0
      let okFlex = true
      for (let k = 0; k < 3; k++) {
        for (const N of new Set([elu.N.min[k], elu.N.max[k]])) {
          const r = columnELU({
            b: dd.b, h: dd.h, tw: dd.tw, tf: dd.tf, fck, cover, Nd: N,
            Md: Math.max(absMax(elu.Mz, k), minMoment(N, dd.h)),
            MdOther: Math.max(absMax(elu.My, k), minMoment(N, dd.b)),
          })
          if (r.As > As) As = r.As
          AsMin = Math.max(AsMin, r.AsMin)
          ratio = Math.max(ratio, r.ratio)
          if (!r.ok) {
            okFlex = false
            for (const n of r.notes) if (!notes.includes(n)) notes.push(n)
          }
        }
      }
      // cortante na direção mais solicitada, com a largura de alma correspondente
      let shearRatio = 0
      let AswS = 0
      for (let k = 0; k < 3; k++) {
        const vy = shearELU({ bw: dd.tw ? 2 * dd.tw : dd.b, d: dd.h - cover, fck, Vsd: absMax(elu.Vy, k) })
        const vz = shearELU({ bw: dd.tf ? 2 * dd.tf : dd.h, d: dd.b - cover, fck, Vsd: absMax(elu.Vz, k) })
        shearRatio = Math.max(shearRatio, vy.ratio, vz.ratio)
        AswS = Math.max(AswS, vy.AswS, vz.AswS)
      }
      const rho = As / dd.A
      notes.push('Efeitos locais de 2ª ordem (NBR 6118 15.8) não incluídos.')
      // com a armadura dimensionada a interação vale 1 por construção: o aproveitamento que
      // interessa é o da taxa de armadura; a interação só aparece quando nem 8 % resolvem
      const bending = Math.max(rho / 0.04, ratio > 1 + 1e-6 ? ratio : 0)
      out.push({
        ...base, method: 'NBR 6118', member: 'column', AsTotal: As, AsMin, AswS, rho,
        ratios: { bending, shear: shearRatio }, ratio: Math.max(bending, shearRatio),
        ok: okFlex && shearRatio <= 1, notes,
      })
      return
    }

    // viga: flexão composta reta
    const { dsg } = dd
    const cover = Math.min(0.07, 0.15 * dd.h)
    const d = dd.h - cover
    const pa = res.prestress?.atFrames[i] ?? null
    let AsInf = 0
    let AsSup = 0
    let AsMin = 0
    let xd = 0
    let okFlex = true
    let shearRatio = 0
    let AswS = 0
    let Asl = 0
    const addNotes = (ns: string[]): void => {
      for (const n of ns) if (!notes.includes(n)) notes.push(n)
    }
    for (let k = 0; k < 3; k++) {
      const tendon = (dpv: number): { Ap?: number; dp?: number; sigmaPd?: number } => {
        if (!pa || !(pa.Ap[k] > 0) || dpv < 0.5 * dd.h) return {}
        const sp = pa.P[k] / pa.Ap[k]
        return { Ap: pa.Ap[k], dp: Math.min(dpv, dd.h - 0.05), sigmaPd: pCase ? Math.max(0, fpyd - sp) : fpyd }
      }
      const Mpos = elu.Mz.max[k]
      if (Mpos > 0) {
        const r = flexureELU({
          bf: dsg.bf, hf: dsg.hf, bw: dsg.bw, h: dd.h, d, fck, Md: Mpos, Nd: NatMz.max[k], yc: dd.yTop, Ac: dd.A,
          dComp: cover, ...tendon(pa ? dd.yTop + pa.e[k] : 0),
        })
        AsInf = Math.max(AsInf, r.As)
        AsSup = Math.max(AsSup, r.AsComp)
        AsMin = r.AsMin
        xd = Math.max(xd, r.xd)
        if (!r.ok) okFlex = false
        addNotes(r.notes)
      }
      const Mneg = -elu.Mz.min[k]
      if (Mneg > 0) {
        const r = flexureELU({
          bf: dsg.bfBot, hf: dsg.hfBot, bw: dsg.bw, h: dd.h, d, fck, Md: Mneg, Nd: NatMz.min[k], yc: dd.yBot, Ac: dd.A,
          dComp: cover, ...tendon(pa ? dd.yBot - pa.e[k] : 0),
        })
        AsSup = Math.max(AsSup, r.As)
        AsInf = Math.max(AsInf, r.AsComp)
        AsMin = r.AsMin
        xd = Math.max(xd, r.xd)
        if (!r.ok) okFlex = false
        addNotes(r.notes)
      }
      // cortante + torção
      const Nmax = elu.N.max[k]
      const sh = shearELU({
        bw: dsg.bw, d, fck, Vsd: absMax(elu.Vy, k),
        Nd: Nmax / dd.A > 0.1 * cp.fctd ? Nmax : 0,
      })
      let web = sh.AswS
      let r = sh.ratio
      const Tsd = absMax(elu.T, k)
      if (dd.torsion && Tsd > 0) {
        const t = torsionELU({ ...dd.torsion, fck, Tsd })
        r = shearTorsionRatio(absMax(elu.Vy, k), sh.VRd2, Tsd, t.TRd2)
        // estribos de torção nas duas almas externas
        web += 2 * t.A90S
        Asl = Math.max(Asl, t.Asl)
      }
      shearRatio = Math.max(shearRatio, r)
      AswS = Math.max(AswS, web)
    }
    if (AsMin === 0) AsMin = flexureELU({ bf: dsg.bf, hf: dsg.hf, bw: dsg.bw, h: dd.h, d, fck, Md: 0, Ac: dd.A }).AsMin
    const rho = (AsInf + AsSup) / dd.A
    const bending = Math.max(rho / 0.04, okFlex ? 0 : 1.01)
    if (pa) notes.push('Cabos de protensão considerados com o acréscimo de tensão até fpyd.')
    out.push({
      ...base, method: 'NBR 6118', member: 'beam', AsInf, AsSup, AsMin, AswS,
      AslTorsion: Asl > 0 ? Asl : undefined, rho, xd,
      ratios: { bending, shear: shearRatio }, ratio: Math.max(bending, shearRatio),
      ok: okFlex && shearRatio <= 1 && rho <= 0.04, notes: notes.length ? notes : undefined,
    })
  })

  if (out.length > 0) res.checks.sections = out
  const fails = out.filter((c) => !c.ok)
  if (fails.length > 0) {
    const approx = fails.every((c) => c.approx)
    ctx.warnings.push(
      `${fails.length} barra(s) acima do limite na verificação de seções` +
        (approx ? ' (seções equivalentes estimadas — resultado indicativo)' : '') +
        ' — veja a aba Seções.',
    )
  }
  ctx.lap('verificacaoSecoes')
}
