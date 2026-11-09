import type { TemplateKind } from '@opengirder/engine'

export interface Field {
  /** caminho no objeto de parâmetros, ex.: "deck.Iz" */
  key: string
  label: string
  unit?: string
  kind?: 'number' | 'int' | 'select' | 'text' | 'list' | 'bool'
  options?: { value: string | number; label: string }[]
  hint?: string
  /** valor exibido = valor do parâmetro × scale (ex.: m² → mm²) */
  scale?: number
  wide?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  show?: (p: any) => boolean
}

export interface FieldGroup {
  title: string
  fields: Field[]
}

const DECK_MATERIAL = [
  { value: 'concrete', label: 'Concreto' },
  { value: 'steel', label: 'Aço' },
  { value: 'composite', label: 'Mista aço-concreto' },
]

const deckSection = (title = 'Seção do tabuleiro'): FieldGroup => ({
  title,
  fields: [
    { key: 'deck.A', label: 'Área', unit: 'm²' },
    { key: 'deck.depth', label: 'Altura', unit: 'm' },
    { key: 'deck.Iz', label: 'Inércia vertical Iz', unit: 'm⁴' },
    { key: 'deck.Iy', label: 'Inércia lateral Iy', unit: 'm⁴' },
    { key: 'deck.J', label: 'Constante de torção J', unit: 'm⁴' },
    { key: 'deck.extraDead', label: 'Permanente adicional', unit: 'kN/m', hint: 'Pavimento, barreiras, guarda-corpo' },
  ],
})

const GIRDER: FieldGroup[] = [
  {
    title: 'Geometria',
    fields: [
      { key: 'name', label: 'Nome', kind: 'text', wide: true },
      { key: 'spans', label: 'Vãos em sequência', unit: 'm', kind: 'list', wide: true, hint: 'Separe por ponto e vírgula. Ex.: 30; 40; 30' },
      { key: 'pierHeight', label: 'Altura dos pilares', unit: 'm', hint: '0 = apoios diretos' },
      { key: 'elementLength', label: 'Tamanho dos elementos', unit: 'm' },
      { key: 'monolithic', label: 'Pilares engastados no tabuleiro (pórtico)', kind: 'bool', wide: true },
    ],
  },
  {
    title: 'Tabuleiro',
    fields: [
      { key: 'deckWidth', label: 'Largura total', unit: 'm' },
      { key: 'carriageway', label: 'Largura carregável', unit: 'm', hint: 'Pista + acostamentos' },
      { key: 'deckMaterial', label: 'Material', kind: 'select', options: DECK_MATERIAL },
      { key: 'fck', label: 'fck do concreto', unit: 'MPa' },
    ],
  },
  deckSection(),
]

const CABLE_STAYED: FieldGroup[] = [
  {
    title: 'Geometria',
    fields: [
      { key: 'name', label: 'Nome', kind: 'text', wide: true },
      {
        key: 'towers',
        label: 'Torres',
        kind: 'select',
        options: [
          { value: 1, label: '1 — mastro único' },
          { value: 2, label: '2 — vão central + laterais' },
        ],
      },
      { key: 'deckLevel', label: 'Cota do tabuleiro', unit: 'm' },
      { key: 'mainSpan', label: 'Vão principal', unit: 'm' },
      { key: 'sideSpan', label: 'Vão lateral', unit: 'm' },
      { key: 'planRadius', label: 'Raio em planta', unit: 'm', hint: '0 = tabuleiro reto' },
      { key: 'elementLength', label: 'Tamanho dos elementos', unit: 'm' },
    ],
  },
  {
    title: 'Torre',
    fields: [
      { key: 'towerHeight', label: 'Altura acima do tabuleiro', unit: 'm' },
      {
        key: 'towerShape',
        label: 'Forma',
        kind: 'select',
        options: [
          { value: 'mast', label: 'Pilone único no eixo' },
          { value: 'X', label: 'Em X (pernas cruzadas)' },
        ],
      },
      { key: 'towerTiltDeg', label: 'Inclinação longitudinal', unit: '°', hint: 'Positiva para o vão lateral' },
      { key: 'tower.width', label: 'Largura da seção', unit: 'm' },
      { key: 'tower.A', label: 'Área', unit: 'm²' },
      { key: 'tower.I', label: 'Inércia', unit: 'm⁴' },
      { key: 'tower.J', label: 'Constante de torção J', unit: 'm⁴' },
      { key: 'tower.fck', label: 'fck', unit: 'MPa' },
      { key: 'xLegs.base', label: 'Semi-afastamento na base', unit: 'm', show: (p) => p.towerShape === 'X' },
      { key: 'xLegs.top', label: 'Semi-afastamento no topo', unit: 'm', show: (p) => p.towerShape === 'X' },
      {
        key: '__twin',
        label: '2º tabuleiro curvo espelhado, cruzando sob a torre',
        kind: 'bool',
        wide: true,
        hint: 'Exige 1 torre e raio em planta maior que zero',
      },
      { key: 'twin.level2', label: 'Cota do 2º tabuleiro', unit: 'm', show: (p) => !!p.twin },
    ],
  },
  {
    title: 'Estais',
    fields: [
      { key: 'staysPerSide', label: 'Estais por semi-vão, por plano', kind: 'int' },
      {
        key: 'planes',
        label: 'Planos de estais',
        kind: 'select',
        options: [
          { value: 1, label: '1 — plano central' },
          { value: 2, label: '2 — planos laterais' },
        ],
      },
      {
        key: 'layout',
        label: 'Arranjo',
        kind: 'select',
        options: [
          { value: 'harp', label: 'Harpa' },
          { value: 'semi-fan', label: 'Semi-leque' },
          { value: 'fan', label: 'Leque' },
        ],
      },
      { key: 'firstStayOffset', label: '1º estai até a torre', unit: 'm' },
      { key: 'towerAnchorSpacing', label: 'Espaçamento das ancoragens na torre', unit: 'm' },
      { key: 'strandArea', label: 'Área da cordoalha', unit: 'mm²', scale: 1e6, hint: 'Ø15,7 mm = 150 mm²' },
      { key: 'strandFpk', label: 'fptk da cordoalha', unit: 'MPa', hint: 'CP 190 RB = 1900' },
      { key: 'strandsMin', label: 'Cordoalhas (estai mais curto)', kind: 'int' },
      { key: 'strandsMax', label: 'Cordoalhas (estai mais longo)', kind: 'int' },
    ],
  },
  {
    title: 'Tabuleiro',
    fields: [
      { key: 'deckWidth', label: 'Largura total', unit: 'm' },
      { key: 'carriageway', label: 'Largura carregável', unit: 'm' },
      { key: 'deckMaterial', label: 'Material', kind: 'select', options: DECK_MATERIAL },
      { key: 'fck', label: 'fck do concreto', unit: 'MPa' },
    ],
  },
  deckSection(),
]

const SUSPENSION: FieldGroup[] = [
  {
    title: 'Geometria',
    fields: [
      { key: 'name', label: 'Nome', kind: 'text', wide: true },
      { key: 'mainSpan', label: 'Vão central', unit: 'm' },
      { key: 'sideSpan', label: 'Vão lateral', unit: 'm' },
      { key: 'sagRatio', label: 'Flecha / vão', hint: 'Típico entre 1/11 (0,091) e 1/9 (0,111)' },
      { key: 'towerHeight', label: 'Torre acima do tabuleiro', unit: 'm' },
      { key: 'deckLevel', label: 'Cota do tabuleiro', unit: 'm' },
      { key: 'hangerSpacing', label: 'Espaçamento dos pendurais', unit: 'm' },
      { key: 'cableSpacing', label: 'Distância entre os cabos', unit: 'm' },
      { key: 'subdivisions', label: 'Elementos por painel', kind: 'int' },
    ],
  },
  {
    title: 'Cabos',
    fields: [
      { key: 'cableArea', label: 'Área de cada cabo principal', unit: 'm²' },
      { key: 'cableFpk', label: 'fpk do fio', unit: 'MPa' },
      { key: 'hangerArea', label: 'Área de cada pendural', unit: 'cm²', scale: 1e4 },
    ],
  },
  {
    title: 'Torre',
    fields: [
      { key: 'tower.width', label: 'Largura da seção', unit: 'm' },
      { key: 'tower.A', label: 'Área', unit: 'm²' },
      { key: 'tower.I', label: 'Inércia', unit: 'm⁴' },
      { key: 'tower.J', label: 'Constante de torção J', unit: 'm⁴' },
    ],
  },
  {
    title: 'Tabuleiro',
    fields: [
      { key: 'carriageway', label: 'Largura carregável', unit: 'm' },
      { key: 'deckMaterial', label: 'Material', kind: 'select', options: DECK_MATERIAL },
    ],
  },
  deckSection('Viga de rigidez (seção equivalente)'),
]

export const WIZARD_FIELDS: Record<TemplateKind, FieldGroup[]> = {
  girder: GIRDER,
  'cable-stayed': CABLE_STAYED,
  suspension: SUSPENSION,
}

export const WIZARD_TITLE: Record<TemplateKind, string> = {
  girder: 'Ponte de vigas',
  'cable-stayed': 'Ponte estaiada',
  suspension: 'Ponte pênsil',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj)
}

/** cópia com o caminho alterado (não muta a entrada) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as object) }
  let cur = out
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    cur[k] = cur[k] && typeof cur[k] === 'object' ? { ...cur[k] } : {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = value
  return out as T
}
