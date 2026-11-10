/**
 * Modelo estrutural de ponte — OpenGirder.
 *
 * Unidades internas SI: m, kN, kN·m, kPa (kN/m²), massa em t (= kN·s²/m).
 * Sistema global: X ao longo da ponte, Y transversal, Z para cima (gravidade em −Z).
 *
 * Tudo aqui é dado puro (JSON-serializável) — o modelo vai para Web Worker e para arquivo.
 */

import type { SectionGeometry } from '../sections/geometry'

export type Vec3 = [number, number, number]

/** 6 GDL por nó: ux, uy, uz, rx, ry, rz */
export type Dof6<T> = [T, T, T, T, T, T]

export interface BridgeNode {
  id: number
  x: number
  y: number
  z: number
  /** GDL restritos (true = fixo). Ausente = livre. */
  fix?: Dof6<boolean>
  /** molas de apoio por GDL (kN/m ou kN·m/rad); 0 = sem mola */
  springs?: Dof6<number>
  /** papel do nó, só p/ visualização/pós-processamento */
  role?: 'deck' | 'tower' | 'cable' | 'anchor' | 'pier' | 'other'
}

export type MaterialKind = 'concrete' | 'steel' | 'cable' | 'rigid'

export interface Material {
  id: string
  name: string
  kind: MaterialKind
  /** módulo de elasticidade (kPa) */
  E: number
  /** módulo de cisalhamento (kPa) */
  G: number
  /** peso específico (kN/m³) — gera peso próprio e massa */
  gamma: number
  /** resistência característica à tração (kPa) — cordoalhas/fios (f_ptk) */
  fpk?: number
  /** fck (kPa) — concreto */
  fck?: number
  /** fy (kPa) — aço estrutural */
  fy?: number
}

export interface Section {
  id: string
  name: string
  /** área (m²) */
  A: number
  /** inércia p/ flexão com deslocamento em z local — lateral no tabuleiro (m⁴) */
  Iy: number
  /** inércia p/ flexão com deslocamento em y local — vertical no tabuleiro (m⁴) */
  Iz: number
  /** constante de torção (m⁴) */
  J: number
  /** carga permanente adicional (revestimento, barreiras, guarda-corpo…) em kN/m */
  extraDead?: number
  /** raio de giração polar da massa adicional p/ inércia torcional (m); padrão √((Iy+Iz)/A) */
  massRadius?: number
  /** altura da seção (m) — só p/ desenho */
  depth?: number
  /** largura da seção (m) — só p/ desenho */
  width?: number
  shape?: 'box' | 'girder' | 'truss' | 'tower' | 'rigid' | 'generic'
  /** fração da força de vento do tabuleiro que esta barra recebe (grelha: bordas 0,5, internas 0);
   *  padrão 1 */
  windShare?: number
  /** largura do tabuleiro inteiro p/ o coeficiente de arrasto, quando `width` é só a da peça */
  windWidth?: number
  /** deslocamento vertical só do DESENHO (m): a peça é desenhada acima (+) do eixo do modelo */
  drawOffset?: number
  /** segunda peça só de DESENHO (ex.: a laje sobre a nervura): altura × largura (m) e
   *  deslocamentos ao longo de y local (vertical) e de z local */
  drawExtra?: { depth: number; width: number; offset: number; offsetZ?: number }
  /** distância do centroide à fibra superior / inferior (m), p/ tensões; padrão depth/2 */
  yTop?: number
  yBot?: number
  /** geometria paramétrica que originou as propriedades (desenho e dimensionamento) */
  geometry?: SectionGeometry
}

/**
 * Barra de pórtico espacial (Euler-Bernoulli, 12 GDL) com formulação corrotacional
 * p/ análise não linear geométrica.
 * Eixos locais: x = n1→n2; y local = projeção de `up` ⟂ x (padrão: +Z global; p/ barras
 * verticais, +X global). Assim, no tabuleiro, Mz/Vy são os esforços de flexão vertical.
 */
export interface FrameElement {
  kind: 'frame'
  id: number
  n1: number
  n2: number
  mat: string
  sec: string
  up?: Vec3
  group?: ElementGroup
  /** ordem de execução (fase construtiva em que o elemento é montado); ausente = desde o início */
  stage?: number
}

/**
 * Cabo — elemento de catenária elástica exata (Irvine), 3 GDL de translação por nó.
 * Só tração. O estado de protensão é dado pelo comprimento indeformado L0 (resultado
 * do form-finding) ou, na falta dele, por uma força-alvo `pretension`.
 */
export interface CableElement {
  kind: 'cable'
  id: number
  n1: number
  n2: number
  mat: string
  /** área metálica (m²) */
  A: number
  /** comprimento indeformado (m) */
  L0?: number
  /** força-alvo inicial (kN) usada p/ estimar L0 quando ausente */
  pretension?: number
  /** nº de cordoalhas (informativo) */
  strands?: number
  group?: ElementGroup
  /** ordem de execução (fase construtiva em que o cabo é instalado); ausente = desde o início */
  stage?: number
}

export type ElementGroup = 'deck' | 'tower' | 'stay' | 'main-cable' | 'hanger' | 'pier' | 'rigid' | 'crossbeam' | 'arch'

export type Element = FrameElement | CableElement

/** Carga nodal (kN, kN·m) */
export interface NodalLoad {
  node: number
  F: Dof6<number>
}

/** Carga uniformemente distribuída em barra, em eixos GLOBAIS (kN/m) */
export interface UniformLoad {
  element: number
  w: Vec3
}

export interface LoadCase {
  id: string
  name: string
  /** inclui peso próprio (γ·A) + `extraDead` das seções */
  selfWeight?: boolean
  nodal?: NodalLoad[]
  uniform?: UniformLoad[]
}

/**
 * Faixa de tráfego p/ carga móvel: caminho ordenado de nós do tabuleiro.
 * A carga unitária é aplicada no eixo do caminho; a excentricidade do veículo é
 * tratada por uma segunda linha de influência (momento torçor unitário).
 */
export interface Lane {
  id: string
  name: string
  /** nós do tabuleiro em ordem ao longo do eixo */
  nodes: number[]
  /** largura carregável da pista p/ a carga distribuída (m) */
  width: number
  /** excentricidade máxima do eixo do veículo em relação ao eixo do caminho (m) */
  maxEccentricity: number
  /** posições de juntas/extremidades (estacas, m) p/ o CIA — padrão: início e fim */
  joints?: number[]
  /**
   * Tabuleiro em grelha: linhas longitudinais de nós que recebem a carga (longarinas), cada
   * uma com a posição transversal `y` (m) em relação ao eixo da pista e um nó por estaca de
   * `nodes` (mesma quantidade, mesma ordem). Com `lines`, cada roda e cada faixa da carga
   * distribuída são repartidas entre as duas linhas vizinhas pela regra da alavanca, em vez
   * de força + torçor no eixo.
   */
  lines?: { y: number; nodes: number[] }[]
}

export type BridgeType = 'girder' | 'cable-stayed' | 'suspension' | 'arch'

/**
 * Ações ambientais e de utilização do local da obra. Tudo opcional: o que faltar usa os
 * padrões de `DEFAULT_SITE` (loads/site.ts). `false` desliga a ação.
 */
export interface SiteActions {
  /** temperatura (NBR 6118 11.4.2 / NBR 7187) */
  temperature?: false | {
    /** variação uniforme ± (°C) */
    uniform: number
    /** gradiente no tabuleiro: face superior − inferior (°C); aplicado nos dois sentidos (+ΔT e −ΔT/2) */
    gradient: number
    /** variação diferencial ± dos cabos em relação à estrutura (°C) */
    cables: number
  }
  /** vento NBR 6123 */
  wind?: false | {
    /** velocidade básica V0 (m/s) — isopletas */
    V0: number
    S1: number
    /** categoria de rugosidade do terreno */
    category: 1 | 2 | 3 | 4 | 5
    S3: number
  }
  /** frenagem e aceleração NBR 7188 5.2.1 */
  braking?: boolean
  /** sismo NBR 15421 */
  seismic?: false | {
    /** aceleração característica horizontal em rocha, fração de g (zona 0: 0,025 … zona 4: 0,15) */
    ag: number
    /** classe do terreno */
    soil: 'A' | 'B' | 'C' | 'D' | 'E'
    /** coeficiente de modificação de resposta */
    R: number
    /** fator de importância */
    I: number
  }
  /** efeitos diferidos do concreto — fluência e retração (NBR 6118, Anexo A). Padrão: ligado
   *  quando há barras de concreto, com os valores de `DEFAULT_LONG_TERM` (timedep/params.ts) */
  longTerm?: false | {
    enabled?: boolean
    /** umidade relativa do ambiente (%) */
    humidity?: number
    /** idade do concreto (dias) quando a carga permanente passa a atuar */
    t0?: number
    cement?: 'CP I-II' | 'CP III-IV' | 'CP V-ARI'
    /** abatimento (cm) */
    slump?: '0-4' | '5-9' | '10-15'
    /** temperatura média do ambiente (°C) */
    temperature?: number
    /** idade final de referência (dias) */
    tInf?: number
    /** coeficiente de envelhecimento χ (AAEM) */
    chi?: number
  }
}

export interface BridgeModel {
  schema: 'opengirder/1'
  name: string
  type: BridgeType
  nodes: BridgeNode[]
  materials: Material[]
  sections: Section[]
  elements: Element[]
  loadCases: LoadCase[]
  lanes: Lane[]
  /** ações do local (temperatura, vento, frenagem, sismo) */
  site?: SiteActions
  /** cabos de protensão do tabuleiro (pós-tração aderente) — ver prestress/types.ts */
  tendons?: import('../prestress/types').Tendon[]
  /** parâmetros do gerador que criou o modelo (p/ reabrir o assistente) */
  template?: { kind: string; params: unknown }
  /** metadados de projeto */
  meta?: {
    description?: string
    /** comprimento do maior vão (m) — usado no CIV */
    mainSpan?: number
    /** vãos (m) */
    spans?: number[]
    /** carga móvel de projeto do modelo (a interface a seleciona ao abrir): 'Pedestres' em passarelas */
    liveLoad?: 'TB-450' | 'TB-240' | 'Pedestres'
    /** material do tabuleiro p/ o CIA */
    deckMaterial?: 'concrete' | 'steel' | 'composite'
    /** dados de referência p/ comparar resultados (ex.: períodos medidos) */
    reference?: { label: string; value: number; unit: string; source: string }[]
  }
}
