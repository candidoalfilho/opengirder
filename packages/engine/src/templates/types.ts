/**
 * Parâmetros dos geradores paramétricos de pontes (assistentes da UI).
 * Unidades: m, kN, MPa só onde indicado (materiais) — o gerador converte p/ kPa.
 */

import type { SectionGeometry } from '../sections/geometry'

export interface DeckSectionInput {
  /** área (m²) */
  A: number
  /** inércia flexão vertical (m⁴) */
  Iz: number
  /** inércia flexão lateral (m⁴) */
  Iy: number
  /** torção (m⁴) */
  J: number
  /** altura (m) — desenho */
  depth: number
  /** carga permanente adicional (kN/m): pavimento, barreiras, guarda-corpo */
  extraDead: number
  /** raio de giração da massa em torno do eixo (m), p/ modos de torção.
   *  Padrão: massa uniforme na largura, √((b² + h²)/12) */
  massRadius?: number
  /** geometria paramétrica da seção: quando presente, A, Iz, Iy, J, altura e as distâncias
   *  às fibras extremas são calculadas dela (os campos acima ficam só como espelho) */
  geometry?: SectionGeometry
}

/** tabuleiro em grelha: longarinas + faixas de laje + transversinas (templates/grillage.ts) */
export interface GrillageParams {
  /** nº de longarinas (≥ 2) */
  girders: number
  /** distância entre eixos de longarinas (m) */
  spacing: number
  /** largura da alma (m) e altura total da longarina, laje incluída (m) */
  web: number
  depth: number
  /** espessura da laje (m) */
  slab: number
  /** propriedades explícitas de UMA longarina com a mesa colaborante (m², m⁴) — obrigatório em
   *  tabuleiro de aço/misto; em concreto, se ausente, saem da seção T (alma + laje tributária) */
  girder?: { A: number; Iz: number; Iy: number; J: number }
  /** transversinas: só nos apoios, apoios + meio de cada vão, ou a cada `diaphragmSpacing` */
  diaphragms: 'supports' | 'supports+mid' | 'spacing'
  diaphragmSpacing?: number
  /** nervura da transversina: largura × altura total, laje incluída (m); padrão 0,30 × 0,8·depth */
  diaphragm?: { width: number; depth: number }
}

export interface GirderBridgeParams {
  name: string
  /** vãos em sequência (m) */
  spans: number[]
  /** largura total do tabuleiro (m) */
  deckWidth: number
  /** largura carregável (pista + acostamentos) (m) */
  carriageway: number
  deckMaterial: 'concrete' | 'steel' | 'composite'
  /** fck do concreto (MPa) */
  fck: number
  deck: DeckSectionInput
  /** altura dos pilares (m); 0 = apoios diretos */
  pierHeight: number
  /** comprimento-alvo dos elementos do tabuleiro (m) */
  elementLength: number
  /** pilares engastados no tabuleiro (pórtico) ou sobre aparelhos de apoio */
  monolithic: boolean
  /** modelo do tabuleiro: 'spine' (barra única no eixo, padrão) ou 'grillage' (grelha de
   *  longarinas, faixas de laje e transversinas — distribuição transversal da carga) */
  deckModel?: 'spine' | 'grillage'
  /** dados da grelha; se ausente e a seção tiver geometria 't-girders', sai dela */
  grillage?: GrillageParams
  /** protensão longitudinal do tabuleiro (pós-tração aderente), pré-dimensionada por
   *  balanceamento de cargas — só p/ tabuleiro de concreto */
  prestress?: {
    enabled: boolean
    /** fração da carga permanente balanceada no vão crítico; padrão 1,0 */
    balance?: number
    /** distância do centro do cabo resultante à face do concreto (m); padrão 0,15 */
    cover?: number
    /** área de cada cordoalha (m²); padrão 1,40e-4 (Ø15,2 mm) */
    strandArea?: number
    /** fptk das cordoalhas (MPa); padrão 1900 (CP 190 RB) */
    strandFptk?: number
  }
}

export interface CableStayedParams {
  name: string
  /** nº de torres: 1 (mastro único, vão estaiado de cada lado) ou 2 (vão central + laterais) */
  towers: 1 | 2
  /** vão principal (m) — com 1 torre: vão estaiado de um lado */
  mainSpan: number
  /** vão lateral (m) — com 1 torre: vão estaiado do outro lado */
  sideSpan: number
  /** altura da torre acima do tabuleiro (m) */
  towerHeight: number
  /** cota do tabuleiro (m) */
  deckLevel: number
  /** distância vertical entre ancoragens no mastro (m) */
  towerAnchorSpacing: number
  /** nº de estais por semi-vão, por plano */
  staysPerSide: number
  /** 1 plano central ou 2 planos laterais */
  planes: 1 | 2
  layout: 'harp' | 'semi-fan' | 'fan'
  /** distância do 1º estai à torre, no tabuleiro (m) */
  firstStayOffset: number
  deckWidth: number
  carriageway: number
  deckMaterial: 'concrete' | 'steel' | 'composite'
  fck: number
  deck: DeckSectionInput
  tower: { A: number; I: number; J: number; width: number; fck: number }
  /** inclinação do mastro no plano longitudinal (graus, + p/ o vão lateral) */
  towerTiltDeg: number
  /** raio de curvatura do tabuleiro em planta (m); 0 = reto */
  planRadius: number
  /** área de cada cordoalha (m²) — padrão Ø15,7 mm = 150 mm² */
  strandArea: number
  /** f_ptk das cordoalhas (MPa) — CP 190 RB = 1900 */
  strandFpk: number
  /** nº de cordoalhas mín/máx (interpolado do estai mais curto ao mais longo) */
  strandsMin: number
  strandsMax: number
  elementLength: number
  /** 'mast' (padrão) = pilone único no eixo; 'X' = duas pernas inclinadas que se cruzam
   *  no plano transversal (tipo Octávio Frias de Oliveira) */
  towerShape?: 'mast' | 'X'
  /** torre em X: semi-afastamento das pernas na base e no topo (m) */
  xLegs?: { base: number; top: number }
  /** carga móvel de projeto: 'Pedestres' p/ passarelas (padrão TB-450) */
  liveLoad?: 'TB-450' | 'TB-240' | 'Pedestres'
  /** 2º tabuleiro curvo espelhado (y → −y), em outra cota: os dois passam sobrepostos sob a
   *  torre e se afastam em planta, formando um X. Exige planRadius > 0 e towers = 1. */
  twin?: { level2: number }
}

export interface SuspensionParams {
  name: string
  mainSpan: number
  sideSpan: number
  /** flecha do cabo no vão central / vão (típico 1/9–1/11) */
  sagRatio: number
  /** altura do topo da torre acima do tabuleiro (m) */
  towerHeight: number
  deckLevel: number
  /** espaçamento dos pendurais (m) */
  hangerSpacing: number
  /** distância entre os dois cabos principais (m) */
  cableSpacing: number
  carriageway: number
  deckMaterial: 'concrete' | 'steel' | 'composite'
  /** treliça/viga de rigidez equivalente */
  deck: DeckSectionInput
  /** área metálica de cada cabo principal (m²) */
  cableArea: number
  /** f_pk do fio (MPa) */
  cableFpk: number
  /** área de cada pendural (m²) */
  hangerArea: number
  tower: { A: number; I: number; J: number; width: number }
  /** comprimento dos elementos do tabuleiro entre pendurais: 1 = um elemento por painel */
  subdivisions: number
}

export interface ArchParams {
  name: string
  /** 'deck' = arco inferior (tabuleiro sobre montantes); 'through' = arco superior, tabuleiro
   *  no nível das nascenças, suspenso por pendurais; 'half-through' = tabuleiro intermediário
   *  (pendurais no trecho central, montantes junto às nascenças) */
  layout: 'deck' | 'through' | 'half-through'
  /** arco atirantado (bowstring): o tabuleiro é o tirante e os apoios não recebem empuxo.
   *  Só vale p/ layout 'through' */
  tied: boolean
  /** vão do arco entre nascenças (m) */
  span: number
  /** flecha do eixo do arco (m) — típico vão/5 a vão/7 */
  rise: number
  /** forma do eixo: parábola, catenária ou funicular da carga permanente do próprio modelo */
  shape: 'parabola' | 'catenary' | 'funicular'
  /** nº de painéis (pendurais ou montantes = painéis − 1, por plano) */
  panels: number
  /** cota das nascenças do arco (m) */
  springLevel: number
  /** 'half-through': altura do tabuleiro acima das nascenças (m);
   *  'deck': folga entre o fecho do arco e o eixo do tabuleiro (m, mín. 1) */
  deckOffset: number
  /** vinculação do arco nas nascenças (ignorado no arco atirantado, que nasce do tabuleiro) */
  hinges: 'fixed' | 'two-hinged'
  /** 1 arco no eixo ou 2 arcos laterais */
  planes: 1 | 2
  /** distância entre os planos dos arcos nas nascenças (m) */
  archSpacing: number
  /** inclinação dos arcos p/ dentro (graus) — "basket handle"; só arcos superiores */
  inclinationDeg: number
  /** travessas de contraventamento entre os dois arcos */
  braced: boolean
  arch: {
    material: 'steel' | 'concrete'
    fck: number
    A: number
    /** inércia no plano do arco (m⁴) */
    I: number
    /** inércia fora do plano (m⁴) */
    Iout: number
    J: number
    /** altura (no plano) e largura da seção (m) */
    depth: number
    width: number
  }
  /** área de cada pendural (m²) e f_ptk (MPa) */
  hangerArea: number
  hangerFpk: number
  /** montantes (pilaretes entre arco e tabuleiro) */
  column: { A: number; I: number; J: number; width: number }
  /** vãos de acesso de CADA lado, do arco p/ fora (m); vazio = sem acessos */
  approachSpans: number[]
  deckWidth: number
  carriageway: number
  deckMaterial: 'concrete' | 'steel' | 'composite'
  fck: number
  deck: DeckSectionInput
  elementLength: number
}

export type TemplateKind = 'girder' | 'cable-stayed' | 'suspension' | 'arch'

export type TemplateParams =
  | { kind: 'girder'; params: GirderBridgeParams }
  | { kind: 'cable-stayed'; params: CableStayedParams }
  | { kind: 'suspension'; params: SuspensionParams }
  | { kind: 'arch'; params: ArchParams }

export interface Preset {
  id: string
  label: string
  description: string
  template: TemplateParams
  /** referências p/ comparação (ex.: períodos medidos, forças publicadas) */
  reference?: { label: string; value: number; unit: string; source: string }[]
}
