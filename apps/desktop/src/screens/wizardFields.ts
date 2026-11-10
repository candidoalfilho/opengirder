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
  /** listas: aceita a lista vazia */
  allowEmpty?: boolean
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isGrid = (p: any): boolean => p.deckModel === 'grillage'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byProps = (p: any): boolean => !p.deck?.geometry && !isGrid(p)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byBox = (p: any): boolean => p.deck?.geometry?.kind === 'box' && !isGrid(p)

/** `geometry` = oferece definir a seção por um caixão paramétrico (A, I e J calculados) */
const deckSection = (title = 'Seção do tabuleiro', geometry = false): FieldGroup => ({
  title,
  fields: [
    ...(geometry
      ? ([
          {
            key: '__boxGeometry',
            label: 'Definir a seção por geometria (caixão de concreto)',
            kind: 'bool',
            wide: true,
            hint: 'Área, inércias e torção são calculadas das dimensões; outros tipos de seção na aba Seções',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            show: (p: any) => !isGrid(p),
          },
          { key: 'deck.geometry.topWidth', label: 'Largura da laje superior', unit: 'm', show: byBox },
          { key: 'deck.geometry.bottomWidth', label: 'Largura do fundo', unit: 'm', show: byBox },
          { key: 'deck.geometry.depth', label: 'Altura', unit: 'm', show: byBox },
          { key: 'deck.geometry.cantilever', label: 'Balanço de cada lado', unit: 'm', show: byBox },
          { key: 'deck.geometry.topSlab', label: 'Laje superior', unit: 'm', show: byBox },
          { key: 'deck.geometry.bottomSlab', label: 'Laje inferior', unit: 'm', show: byBox },
          { key: 'deck.geometry.web', label: 'Espessura das almas', unit: 'm', show: byBox },
          { key: 'deck.geometry.cells', label: 'Nº de células', kind: 'int', show: byBox },
        ] as Field[])
      : []),
    { key: 'deck.A', label: 'Área', unit: 'm²', show: geometry ? byProps : undefined },
    { key: 'deck.depth', label: 'Altura', unit: 'm', show: geometry ? byProps : undefined },
    { key: 'deck.Iz', label: 'Inércia vertical Iz', unit: 'm⁴', show: geometry ? byProps : undefined },
    { key: 'deck.Iy', label: 'Inércia lateral Iy', unit: 'm⁴', show: geometry ? byProps : undefined },
    { key: 'deck.J', label: 'Constante de torção J', unit: 'm⁴', show: geometry ? byProps : undefined },
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
      {
        key: 'prestress.enabled',
        label: 'Tabuleiro protendido (pós-tração pré-dimensionada)',
        kind: 'bool',
        wide: true,
        hint: 'Cabo resultante parabólico que balanceia a carga permanente; ajuste na aba Protensão',
        show: (p) => p.deckMaterial === 'concrete' && !isGrid(p),
      },
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
  {
    title: 'Modelo do tabuleiro',
    fields: [
      {
        key: 'deckModel',
        label: 'Como o tabuleiro entra no modelo',
        kind: 'select',
        wide: true,
        options: [
          { value: 'spine', label: 'Espinha — uma barra no eixo (caixão, seção única)' },
          { value: 'grillage', label: 'Grelha — longarinas, laje e transversinas (vigas múltiplas)' },
        ],
        hint: 'A grelha dá os esforços de cada longarina e a repartição transversal da carga móvel',
      },
      { key: 'grillage.girders', label: 'Nº de longarinas', kind: 'int', show: isGrid },
      { key: 'grillage.spacing', label: 'Distância entre longarinas', unit: 'm', show: isGrid },
      { key: 'grillage.depth', label: 'Altura da longarina', unit: 'm', hint: 'Laje incluída', show: isGrid },
      { key: 'grillage.web', label: 'Largura da alma', unit: 'm', show: isGrid },
      { key: 'grillage.slab', label: 'Espessura da laje', unit: 'm', show: isGrid },
      {
        key: 'grillage.diaphragms',
        label: 'Transversinas',
        kind: 'select',
        options: [
          { value: 'supports', label: 'Só nos apoios' },
          { value: 'supports+mid', label: 'Apoios e meio dos vãos' },
          { value: 'spacing', label: 'A cada distância' },
        ],
        show: isGrid,
      },
      {
        key: 'grillage.diaphragmSpacing',
        label: 'Distância entre transversinas',
        unit: 'm',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        show: (p: any) => isGrid(p) && p.grillage?.diaphragms === 'spacing',
      },
    ],
  },
  deckSection('Seção do tabuleiro', true),
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
      {
        key: 'liveLoad',
        label: 'Carga móvel de projeto',
        kind: 'select',
        options: [
          { value: 'TB-450', label: 'TB-450 (rodoviária)' },
          { value: 'TB-240', label: 'TB-240 (vicinal)' },
          { value: 'Pedestres', label: 'Pedestres — passarela (5 kN/m²)' },
        ],
      },
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

const ARCH: FieldGroup[] = [
  {
    title: 'Geometria',
    fields: [
      { key: 'name', label: 'Nome', kind: 'text', wide: true },
      {
        key: 'layout',
        label: 'Posição do tabuleiro',
        kind: 'select',
        wide: true,
        options: [
          { value: 'through', label: 'Arco superior — tabuleiro suspenso por pendurais' },
          { value: 'half-through', label: 'Tabuleiro intermediário — pendurais e montantes' },
          { value: 'deck', label: 'Arco inferior — tabuleiro sobre montantes' },
        ],
      },
      {
        key: 'tied',
        label: 'Arco atirantado (bowstring): o tabuleiro é o tirante',
        kind: 'bool',
        wide: true,
        hint: 'Sem empuxo nas fundações: um apoio fixo e os demais móveis',
        show: (p) => p.layout === 'through',
      },
      { key: 'span', label: 'Vão do arco', unit: 'm' },
      { key: 'rise', label: 'Flecha', unit: 'm', hint: 'Típico entre vão/7 e vão/5' },
      {
        key: 'shape',
        label: 'Eixo do arco',
        kind: 'select',
        options: [
          { value: 'parabola', label: 'Parábola' },
          { value: 'catenary', label: 'Catenária' },
          { value: 'funicular', label: 'Funicular da carga permanente' },
        ],
      },
      { key: 'panels', label: 'Painéis', kind: 'int', hint: 'Pendurais ou montantes = painéis − 1' },
      { key: 'springLevel', label: 'Cota das nascenças', unit: 'm' },
      {
        key: 'deckOffset',
        label: 'Tabuleiro acima das nascenças',
        unit: 'm',
        show: (p) => p.layout === 'half-through',
      },
      {
        key: 'deckOffset',
        label: 'Folga entre o fecho e o tabuleiro',
        unit: 'm',
        hint: 'Mínimo de 1 m',
        show: (p) => p.layout === 'deck',
      },
      {
        key: 'hinges',
        label: 'Nascenças',
        kind: 'select',
        options: [
          { value: 'fixed', label: 'Engastadas' },
          { value: 'two-hinged', label: 'Articuladas (biarticulado)' },
        ],
        show: (p) => !(p.layout === 'through' && p.tied),
      },
      { key: 'elementLength', label: 'Tamanho dos elementos', unit: 'm' },
      {
        key: 'approachSpans',
        label: 'Vãos de acesso de cada lado',
        unit: 'm',
        kind: 'list',
        wide: true,
        allowEmpty: true,
        hint: 'Do arco para fora, separados por ponto e vírgula. Vazio = sem acessos',
      },
    ],
  },
  {
    title: 'Arcos',
    fields: [
      {
        key: 'planes',
        label: 'Arcos',
        kind: 'select',
        options: [
          { value: 1, label: '1 — no eixo' },
          { value: 2, label: '2 — laterais' },
        ],
      },
      { key: 'archSpacing', label: 'Distância entre os arcos', unit: 'm', show: (p) => p.planes === 2 },
      {
        key: 'inclinationDeg',
        label: 'Inclinação para dentro',
        unit: '°',
        hint: 'Arcos em "alça de cesto"',
        show: (p) => p.planes === 2 && p.layout !== 'deck',
      },
      { key: 'braced', label: 'Travessas de contraventamento entre os arcos', kind: 'bool', wide: true, show: (p) => p.planes === 2 },
      {
        key: 'arch.material',
        label: 'Material',
        kind: 'select',
        options: [
          { value: 'steel', label: 'Aço' },
          { value: 'concrete', label: 'Concreto' },
        ],
      },
      { key: 'arch.fck', label: 'fck', unit: 'MPa', show: (p) => p.arch?.material === 'concrete' },
      { key: 'arch.depth', label: 'Altura da seção', unit: 'm' },
      { key: 'arch.width', label: 'Largura da seção', unit: 'm' },
      { key: 'arch.A', label: 'Área', unit: 'm²' },
      { key: 'arch.I', label: 'Inércia no plano do arco', unit: 'm⁴' },
      { key: 'arch.Iout', label: 'Inércia fora do plano', unit: 'm⁴' },
      { key: 'arch.J', label: 'Constante de torção J', unit: 'm⁴' },
    ],
  },
  {
    title: 'Pendurais e montantes',
    fields: [
      { key: 'hangerArea', label: 'Área de cada pendural', unit: 'cm²', scale: 1e4, show: (p) => p.layout !== 'deck' },
      { key: 'hangerFpk', label: 'fptk dos pendurais', unit: 'MPa', show: (p) => p.layout !== 'deck' },
      { key: 'column.width', label: 'Largura do montante', unit: 'm', show: (p) => p.layout !== 'through' },
      { key: 'column.A', label: 'Área do montante', unit: 'm²', show: (p) => p.layout !== 'through' },
      { key: 'column.I', label: 'Inércia do montante', unit: 'm⁴', show: (p) => p.layout !== 'through' },
      { key: 'column.J', label: 'Torção do montante J', unit: 'm⁴', show: (p) => p.layout !== 'through' },
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

export const WIZARD_FIELDS: Record<TemplateKind, FieldGroup[]> = {
  girder: GIRDER,
  'cable-stayed': CABLE_STAYED,
  suspension: SUSPENSION,
  arch: ARCH,
}

export const WIZARD_TITLE: Record<TemplateKind, string> = {
  girder: 'Ponte de vigas',
  'cable-stayed': 'Ponte estaiada',
  suspension: 'Ponte pênsil',
  arch: 'Ponte em arco',
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
