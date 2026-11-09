import type { BridgeModel } from '../model/types'
import type {
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

export function generateModel(t: TemplateParams): BridgeModel {
  let model: BridgeModel
  if (t.kind === 'girder') model = generateGirder(t.params)
  else if (t.kind === 'cable-stayed') model = generateCableStayed(t.params)
  else model = generateSuspension(t.params)
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
  deck: { A: 6.5, Iz: 3.4, Iy: 60, J: 5.5, depth: 2.0, extraDead: 35 },
  pierHeight: 12,
  elementLength: 2.5,
  monolithic: false,
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

export function defaultTemplate(kind: TemplateKind): TemplateParams {
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  if (kind === 'girder') return { kind, params: copy(VIADUCT) }
  if (kind === 'cable-stayed') return { kind, params: copy(THREE_SPAN) }
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
    id: 'viaduto',
    label: 'Viaduto em viga caixão',
    description: 'Viga contínua de concreto protendido 30 + 40 + 30 m sobre aparelhos de apoio, TB-450.',
    template: { kind: 'girder', params: VIADUCT },
  },
]
