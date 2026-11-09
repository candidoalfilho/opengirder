import type { BridgeModel } from '../model/types'
import type {
  ArchParams,
  CableStayedParams,
  GirderBridgeParams,
  Preset,
  SuspensionParams,
  TemplateKind,
  TemplateParams,
} from './types'
import { generateGirder } from './girder'
import { generateCableStayed } from './cableStayed'
import { generateSuspension } from './suspension'
import { generateArch } from './arch'

export function generateModel(t: TemplateParams): BridgeModel {
  let model: BridgeModel
  if (t.kind === 'girder') model = generateGirder(t.params)
  else if (t.kind === 'cable-stayed') model = generateCableStayed(t.params)
  else if (t.kind === 'arch') model = generateArch(t.params)
  else model = generateSuspension(t.params)
  const live = (t.params as { liveLoad?: 'TB-450' | 'TB-240' | 'Pedestres' }).liveLoad
  if (live && model.meta) model.meta.liveLoad = live
  // modelos de referência levam junto os valores publicados p/ comparação
  const preset = PRESETS.find((q) => q.template.kind === t.kind && q.template.params.name === t.params.name)
  if (preset?.reference && model.meta) model.meta.reference = preset.reference
  return model
}

// ---------------------------------------------------------------------------------------
// Modelos de referência. Geometria global de fontes públicas; propriedades de seção são
// ESTIMATIVAS de ordem de grandeza (os projetos executivos não são públicos) — ver
// VALIDATION.md. Servem p/ demonstrar e validar o motor, não p/ reavaliar as obras.
// ---------------------------------------------------------------------------------------

const GOLDEN_GATE: SuspensionParams = {
  name: 'Golden Gate Bridge',
  mainSpan: 1280.2,
  sideSpan: 343,
  sagRatio: 143.3 / 1280.2,
  towerHeight: 152,
  deckLevel: 75,
  hangerSpacing: 15.24,
  cableSpacing: 27.43,
  carriageway: 18.9,
  deckMaterial: 'steel',
  // treliça de rigidez de 7,6 m (com contraventamento inferior de 1954) + tabuleiro ortotrópico de 1986
  // J: fórmula de Bredt p/ o caixão treliçado dá ≈ 1,6 m⁴ (governado pelo contraventamento inferior);
  // reduzido p/ 1,0 pela distorção da seção. Massa concentrada nas treliças de borda: r ≈ 11,2 m.
  deck: { A: 1.0, Iz: 5.0, Iy: 70, J: 1.0, depth: 7.6, extraDead: 148, massRadius: 11.2 },
  // 27 572 fios Ø 4,9 mm por cabo (Ø externo 0,92 m)
  cableArea: 0.515,
  cableFpk: 1520,
  hangerArea: 0.0075,
  tower: { A: 4.0, I: 50, J: 40, width: 8 },
  subdivisions: 1,
}

const OCTAVIO_FRIAS: CableStayedParams = {
  name: 'Estaiada de São Paulo (inspirada na Ponte Octávio Frias de Oliveira)',
  towers: 1,
  mainSpan: 150,
  sideSpan: 140,
  towerHeight: 126,
  deckLevel: 12,
  towerAnchorSpacing: 1.6,
  staysPerSide: 18,
  planes: 2,
  layout: 'semi-fan',
  firstStayOffset: 14,
  deckWidth: 16,
  carriageway: 11,
  deckMaterial: 'concrete',
  fck: 50,
  deck: { A: 8.5, Iz: 3.2, Iy: 170, J: 1.2, depth: 2.0, extraDead: 45 },
  tower: { A: 14, I: 45, J: 60, width: 5.5, fck: 50 },
  towerTiltDeg: 0,
  planRadius: 275.1,
  strandArea: 150e-6,
  strandFpk: 1770,
  strandsMin: 9,
  strandsMax: 25,
  elementLength: 7,
  towerShape: 'X',
  xLegs: { base: 18, top: 6 },
  twin: { level2: 24 },
}

const RIO_NEGRO: CableStayedParams = {
  name: 'Ponte Rio Negro (Manaus–Iranduba) — trecho estaiado',
  towers: 1,
  mainSpan: 200,
  sideSpan: 200,
  towerHeight: 110,
  deckLevel: 55,
  towerAnchorSpacing: 3,
  staysPerSide: 26,
  planes: 2,
  layout: 'harp',
  firstStayOffset: 12,
  deckWidth: 22.6,
  carriageway: 20.6,
  deckMaterial: 'concrete',
  fck: 50,
  deck: { A: 14, Iz: 9, Iy: 500, J: 15, depth: 2.4, extraDead: 65 },
  tower: { A: 30, I: 250, J: 300, width: 9, fck: 40 },
  towerTiltDeg: 0,
  planRadius: 0,
  strandArea: 150e-6,
  strandFpk: 1770,
  strandsMin: 18,
  strandsMax: 50,
  elementLength: 7.5,
}

const THREE_SPAN: CableStayedParams = {
  name: 'Estaiada de três vãos',
  towers: 2,
  mainSpan: 320,
  sideSpan: 140,
  towerHeight: 80,
  deckLevel: 30,
  towerAnchorSpacing: 2.5,
  staysPerSide: 12,
  planes: 2,
  layout: 'semi-fan',
  firstStayOffset: 14,
  deckWidth: 20,
  carriageway: 17,
  deckMaterial: 'concrete',
  fck: 50,
  deck: { A: 11, Iz: 6, Iy: 330, J: 8, depth: 2.2, extraDead: 55 },
  tower: { A: 22, I: 110, J: 140, width: 7, fck: 40 },
  towerTiltDeg: 0,
  planRadius: 0,
  strandArea: 150e-6,
  strandFpk: 1770,
  strandsMin: 15,
  strandsMax: 91,
  elementLength: 6,
}

const VIADUCT: GirderBridgeParams = {
  name: 'Viaduto em viga caixão contínua',
  spans: [30, 40, 30],
  deckWidth: 13,
  carriageway: 12.2,
  deckMaterial: 'concrete',
  fck: 40,
  // caixão unicelular: laje superior de 13 m × 28 cm com balanços de 3 m, almas de 55 cm, fundo de 6 m × 22 cm.
  // A, Iz, Iy e J abaixo são o espelho das propriedades calculadas dessa geometria.
  deck: {
    A: 6.384, Iz: 3.493, Iy: 62.98, J: 7.96, depth: 2.0, extraDead: 35,
    geometry: {
      kind: 'box', topWidth: 13, bottomWidth: 6, depth: 2.0, topSlab: 0.28, bottomSlab: 0.22, web: 0.55,
      cells: 1, cantilever: 3, cantileverTip: 0.2,
    },
  },
  pierHeight: 12,
  elementLength: 2.5,
  monolithic: false,
  prestress: { enabled: true },
}

const GENERIC_SUSPENSION: SuspensionParams = {
  name: 'Ponte pênsil',
  mainSpan: 600,
  sideSpan: 180,
  sagRatio: 0.1,
  towerHeight: 75,
  deckLevel: 40,
  hangerSpacing: 12,
  cableSpacing: 22,
  carriageway: 15,
  deckMaterial: 'steel',
  deck: { A: 0.9, Iz: 2.5, Iy: 45, J: 4, depth: 3.5, extraDead: 80 },
  cableArea: 0.16,
  cableFpk: 1770,
  hangerArea: 0.004,
  tower: { A: 2.5, I: 20, J: 15, width: 5 },
  subdivisions: 1,
}

// arco atirantado metálico (bowstring) com tabuleiro misto como tirante: dois arcos-caixão
// 1,2 × 1,6 m (chapas de 30 mm), pendurais de 16 cordoalhas a cada 10 m
const BOWSTRING: ArchParams = {
  name: 'Arco atirantado metálico (bowstring)',
  layout: 'through',
  tied: true,
  span: 130,
  rise: 22,
  shape: 'parabola',
  panels: 13,
  springLevel: 12,
  deckOffset: 0,
  hinges: 'fixed',
  planes: 2,
  archSpacing: 14,
  inclinationDeg: 0,
  braced: true,
  arch: { material: 'steel', fck: 40, A: 0.168, I: 0.066, Iout: 0.043, J: 0.079, depth: 1.6, width: 1.2 },
  hangerArea: 16 * 150e-6,
  hangerFpk: 1770,
  column: { A: 0.08, I: 0.01, J: 0.015, width: 0.8 },
  approachSpans: [],
  deckWidth: 13,
  carriageway: 11,
  deckMaterial: 'composite',
  fck: 40,
  // vigas-tirante de aço + laje de 25 cm homogeneizada em aço; o peso da laje e do pavimento vai em extraDead
  deck: { A: 0.6, Iz: 0.35, Iy: 12, J: 0.1, depth: 1.8, extraDead: 115 },
  elementLength: 5,
}

// arco inferior de concreto, biengastado, seção caixão ≈ 11 × 4,5 m — vão e extensão total da
// Ponte da Amizade (dados públicos); flecha, seções e vãos de acesso são ESTIMATIVAS
const CONCRETE_ARCH: ArchParams = {
  name: 'Arco de concreto de 290 m (inspirado na Ponte da Amizade)',
  layout: 'deck',
  tied: false,
  span: 290,
  rise: 53,
  shape: 'funicular',
  panels: 16,
  springLevel: 0,
  deckOffset: 2.5,
  hinges: 'fixed',
  planes: 1,
  archSpacing: 0,
  inclinationDeg: 0,
  braced: false,
  arch: { material: 'concrete', fck: 40, A: 11, I: 38, Iout: 160, J: 95, depth: 4.5, width: 11 },
  hangerArea: 0.003,
  hangerFpk: 1770,
  column: { A: 3, I: 0.75, J: 1.27, width: 1.73 },
  approachSpans: [45, 45, 41],
  deckWidth: 13.5,
  carriageway: 11,
  deckMaterial: 'concrete',
  fck: 35,
  deck: { A: 6, Iz: 2.2, Iy: 70, J: 4, depth: 1.8, extraDead: 40 },
  elementLength: 6,
}

// extradorso: torres baixas (≈ vão/9), tabuleiro-caixão rígido que leva a maior parte da carga
// móvel; os estais, pouco inclinados, funcionam como protensão externa de grande excentricidade
const EXTRADOSED: CableStayedParams = {
  name: 'Ponte extradorso',
  towers: 2,
  mainSpan: 150,
  sideSpan: 72,
  towerHeight: 17,
  deckLevel: 18,
  towerAnchorSpacing: 0.8,
  staysPerSide: 10,
  planes: 2,
  layout: 'fan',
  firstStayOffset: 20,
  deckWidth: 16,
  carriageway: 13,
  deckMaterial: 'concrete',
  fck: 50,
  deck: { A: 10, Iz: 14, Iy: 150, J: 22, depth: 3.5, extraDead: 45 },
  tower: { A: 12, I: 14, J: 20, width: 3.5, fck: 50 },
  towerTiltDeg: 0,
  planRadius: 0,
  strandArea: 150e-6,
  strandFpk: 1860,
  strandsMin: 19,
  strandsMax: 55,
  elementLength: 5,
}

// passarela estaiada metálica: mastro único, vãos desiguais com estai de ancoragem
const FOOTBRIDGE: CableStayedParams = {
  name: 'Passarela estaiada',
  towers: 1,
  mainSpan: 70,
  sideSpan: 35,
  towerHeight: 28,
  deckLevel: 6.5,
  towerAnchorSpacing: 1.2,
  staysPerSide: 5,
  planes: 2,
  layout: 'semi-fan',
  firstStayOffset: 12,
  deckWidth: 4,
  carriageway: 3.5,
  deckMaterial: 'steel',
  fck: 40,
  // caixão metálico esbelto + laje de piso; guarda-corpos e revestimento em extraDead
  deck: { A: 0.09, Iz: 0.045, Iy: 0.3, J: 0.06, depth: 1.0, extraDead: 9 },
  tower: { A: 2.2, I: 1.2, J: 1.5, width: 1.6, fck: 40 },
  towerTiltDeg: 0,
  planRadius: 0,
  strandArea: 150e-6,
  strandFpk: 1770,
  strandsMin: 2,
  strandsMax: 7,
  elementLength: 2.5,
  liveLoad: 'Pedestres',
}

export function defaultTemplate(kind: TemplateKind): TemplateParams {
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  if (kind === 'girder') return { kind, params: copy(VIADUCT) }
  if (kind === 'cable-stayed') return { kind, params: copy(THREE_SPAN) }
  if (kind === 'arch') return { kind, params: copy(BOWSTRING) }
  return { kind, params: copy(GENERIC_SUSPENSION) }
}

export const PRESETS: Preset[] = [
  {
    id: 'golden-gate',
    label: 'Golden Gate Bridge',
    description:
      'Pênsil de 343 + 1 280 + 343 m (São Francisco, 1937). Cabos de 0,92 m com 27 572 fios, ' +
      '250 pares de pendurais, torres de 227 m.',
    template: { kind: 'suspension', params: GOLDEN_GATE },
    reference: [
      { label: '1º modo transversal — período', value: 20.495, unit: 's', source: 'modelo ADINA do retrofit sísmico (HDR)' },
      { label: '1º modo vertical antissimétrico — período', value: 11.631, unit: 's', source: 'modelo ADINA do retrofit sísmico (HDR)' },
      { label: '1º modo vertical simétrico — período', value: 7.808, unit: 's', source: 'modelo ADINA do retrofit sísmico (HDR)' },
      { label: '1º modo torcional — período', value: 8.98, unit: 's', source: 'modelo ADINA do retrofit sísmico (HDR)' },
      { label: 'Tração no cabo principal', value: 235, unit: 'MN', source: 'faixa publicada 213–253 MN (48–57 mil kip)' },
    ],
  },
  {
    id: 'octavio-frias',
    label: 'Estaiada de São Paulo',
    description:
      'Inspirada na Ponte Octávio Frias de Oliveira: mastro em X de 138 m, dois tabuleiros curvos ' +
      '(R = 275 m) em cotas diferentes cruzando sob o mastro, 144 estais.',
    template: { kind: 'cable-stayed', params: OCTAVIO_FRIAS },
    reference: [
      { label: 'Nº de estais', value: 144, unit: '', source: 'dados públicos da obra' },
      { label: 'Cordoalhas por estai', value: 25, unit: 'máx.', source: 'dados públicos da obra (9 a 25)' },
    ],
  },
  {
    id: 'rio-negro',
    label: 'Ponte Rio Negro',
    description:
      'Trecho estaiado da ponte Manaus–Iranduba: dois vãos de 200 m, pilone central, 104 estais em harpa, ' +
      'tabuleiro de concreto de 22,6 m.',
    template: { kind: 'cable-stayed', params: RIO_NEGRO },
    reference: [{ label: 'Nº de estais', value: 104, unit: '', source: 'dados públicos da obra' }],
  },
  {
    id: 'estaiada-3-vaos',
    label: 'Estaiada de três vãos',
    description: 'Duas torres, 140 + 320 + 140 m, semi-leque, com estais de ancoragem nos encontros.',
    template: { kind: 'cable-stayed', params: THREE_SPAN },
  },
  {
    id: 'arco-atirantado',
    label: 'Arco atirantado metálico',
    description:
      'Bowstring rodoviário de 130 m: dois arcos-caixão de aço (flecha 22 m), 24 pendurais e tabuleiro misto ' +
      'trabalhando como tirante — os apoios não recebem empuxo.',
    template: { kind: 'arch', params: BOWSTRING },
  },
  {
    id: 'arco-concreto',
    label: 'Arco de concreto de 290 m',
    description:
      'Arco inferior biengastado de concreto, inspirado na Ponte da Amizade (Foz do Iguaçu–Ciudad del Este, 1965): ' +
      'vão do arco de 290 m e 552 m de extensão (dados públicos; há fontes que citam 303 m de vão livre). ' +
      'Flecha, seções e vãos de acesso são estimativas; o eixo é o funicular da carga permanente.',
    template: { kind: 'arch', params: CONCRETE_ARCH },
    reference: [{ label: 'Vão do arco', value: 290, unit: 'm', source: 'dados públicos da obra' }],
  },
  {
    id: 'extradorso',
    label: 'Ponte extradorso',
    description:
      '72 + 150 + 72 m, torres de 17 m (≈ vão/9) e tabuleiro-caixão de 3,5 m. Os estais são verificados aqui com o ' +
      'limite de estaiadas (0,45·fptk em serviço); em extradorso, onde a variação de tensão é pequena, admite-se até 0,60·fptk.',
    template: { kind: 'cable-stayed', params: EXTRADOSED },
  },
  {
    id: 'passarela',
    label: 'Passarela estaiada',
    description:
      'Passarela metálica de 35 + 70 m com mastro único, carga de multidão de 5 kN/m² (NBR 7188, sem impacto). ' +
      'Confira na aba Modos as frequências na faixa crítica do passo: vertical 1,6–2,4 Hz, lateral 0,8–1,2 Hz.',
    template: { kind: 'cable-stayed', params: FOOTBRIDGE },
  },
  {
    id: 'viaduto',
    label: 'Viaduto em viga caixão',
    description: 'Viga contínua de concreto protendido 30 + 40 + 30 m sobre aparelhos de apoio, TB-450.',
    template: { kind: 'girder', params: VIADUCT },
  },
]
