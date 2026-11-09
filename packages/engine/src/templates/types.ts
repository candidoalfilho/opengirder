/**
 * Parâmetros dos geradores paramétricos de pontes (assistentes da UI).
 * Unidades: m, kN, MPa só onde indicado (materiais) — o gerador converte p/ kPa.
 */

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

export type TemplateKind = 'girder' | 'cable-stayed' | 'suspension'

export type TemplateParams =
  | { kind: 'girder'; params: GirderBridgeParams }
  | { kind: 'cable-stayed'; params: CableStayedParams }
  | { kind: 'suspension'; params: SuspensionParams }

export interface Preset {
  id: string
  label: string
  description: string
  template: TemplateParams
  /** referências p/ comparação (ex.: períodos medidos, forças publicadas) */
  reference?: { label: string; value: number; unit: string; source: string }[]
}
