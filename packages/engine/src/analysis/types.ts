/**
 * Resultados de análise — objetos puros, JSON-serializáveis (vão do Web Worker p/ UI).
 *
 * Indexação: arrays "por nó" seguem a ORDEM de `model.nodes` (índice, não id).
 * Deslocamentos `u` são planos: u[6*i + d], d = ux, uy, uz, rx, ry, rz.
 */

/** Esforços de barra em 3 estações (início, meio, fim). Convenções:
 *  N tração +; Mz > 0 traciona a fibra inferior do tabuleiro (y local p/ cima);
 *  Vy, Vz, T, My conforme diagramas do HyperFrame (ver analysis/frame.ts). */
export interface FrameForces {
  id: number
  L: number
  N: [number, number, number]
  Vy: [number, number, number]
  Vz: [number, number, number]
  T: [number, number, number]
  My: [number, number, number]
  Mz: [number, number, number]
}

export interface CableForces {
  id: number
  /** tração na extremidade n1 / n2 (kN) */
  Ti: number
  Tj: number
  /** componente horizontal (kN) */
  H: number
  /** comprimento indeformado usado (m) */
  L0: number
  /** comprimento da corda deformada (m) */
  chord: number
  /** flecha vertical abaixo da corda, no meio do vão (m) — aproximação parabólica */
  sag: number
  slack: boolean
}

export interface Reaction {
  node: number
  R: [number, number, number, number, number, number]
}

export interface StaticState {
  converged: boolean
  iterations: number
  /** nº de passos de carga (a carga permanente é aplicada de uma vez: sempre 1) */
  loadSteps: number
  /** norma do resíduo final (kN) */
  residual: number
  u: number[]
  frames: FrameForces[]
  cables: CableForces[]
  reactions: Reaction[]
}

export interface FormFindingResult {
  converged: boolean
  iterations: number
  /** maior deslocamento remanescente nos pontos-alvo (m), por iteração */
  history: number[]
  /** deslocamento residual final (m) */
  residual: number
  /** nº de cabos ajustados e de alvos */
  nUnknowns: number
  nTargets: number
}

export type ModeKind = 'vertical' | 'transversal' | 'longitudinal' | 'torcional' | 'misto'

export interface Mode {
  index: number
  period: number
  frequency: number
  /** forma modal normalizada: maior translação = 1 (u plano, 6 por nó) */
  shape: number[]
  /** massa modal efetiva em % da massa total, nas direções X, Y, Z */
  massPct: [number, number, number]
  kind: ModeKind
}

export interface ModalResult {
  modes: Mode[]
  totalMass: number
  iterations: number
  converged: boolean
}

/** envoltória de uma grandeza: [mín, máx] nas 3 estações */
export interface Env3 {
  min: [number, number, number]
  max: [number, number, number]
}

export interface MovingLoadResult {
  vehicle: 'TB-450' | 'TB-240' | 'Pedestres'
  /** coeficientes NBR 7188 aplicados */
  CIV: number
  CNF: number
  CIA: number
  Liv: number
  lanes: string[]
  /** carga por eixo já reduzida da distribuída sob o veículo (kN) e distribuída (kN/m) */
  axleLoad: number
  axleSpacing: number
  nAxles: number
  distributed: number
  /** envoltórias de esforços (só carga móvel, já com coeficientes) */
  frames: { id: number; Mz: Env3; Vy: Env3; N: Env3; T: Env3; My: Env3 }[]
  /** variação de tração nos cabos (kN) */
  cables: { id: number; min: number; max: number }[]
  /** deslocamento vertical por nó (m): mín/máx (índice do nó) */
  uzMin: number[]
  uzMax: number[]
  /** envoltória das reações de apoio (kN, kN·m), na ordem de `deadLoad.reactions` */
  reactions?: { node: number; min: Reaction['R']; max: Reaction['R'] }[]
  /** linhas de influência amostradas p/ inspeção: cada uma com estacas e ordenadas */
  influence: { label: string; s: number[]; eta: number[] }[]
}

export interface CableCheck {
  id: number
  group: string
  /** tração permanente (kN) */
  TG: number
  /** máx. variação por carga móvel (kN) */
  dTQ: number
  /** ELS característica: TG + ΔTQ */
  Tels: number
  /** ELU: 1,35·TG + 1,5·ΔTQ */
  Telu: number
  /** resistência à tração do cabo A·fpk (kN) */
  Fu: number
  /** ELS / (0,45·Fu) — limite usual fib Bulletin 30 / PTI DC45.1 */
  ratioEls: number
  /** ELU / (0,65·Fu) — φ = 0,65 (PTI DC45.1) */
  ratioElu: number
  /** faixa de tensão p/ fadiga, ΔσQ (MPa) */
  dSigma: number
  ok: boolean
}

/* ------------------------------------------------------------------ ações e combinações */

export type ActionKind = 'temperature' | 'wind' | 'braking' | 'seismic' | 'prestress' | 'settlement' | 'creep' | 'other'

/**
 * Resultado de um caso de carga linearizado em torno do estado permanente (incrementos).
 * `frames`/`cables` seguem a ordem de `deadLoad.frames`/`deadLoad.cables`.
 */
export interface LoadCaseResult {
  /** identificador curto e único: 'TU+', 'TG+', 'W', 'FR', 'E', 'P'… */
  id: string
  name: string
  kind: ActionKind
  /** 'both' = sentido indefinido (vento, sismo, frenagem): entra nas combinações como ± */
  sign: 'fixed' | 'both'
  u: number[]
  frames: FrameForces[]
  cables: { id: number; dT: number }[]
  reactions: Reaction[]
  /** grandezas que caracterizam a ação (pressão de vento, força de frenagem…) p/ o memorial */
  info?: { label: string; value: number; unit: string }[]
}

/** envoltória [mín, máx] de cada esforço nas 3 estações */
export interface EnvForces {
  N: Env3
  Vy: Env3
  Vz: Env3
  T: Env3
  My: Env3
  Mz: Env3
}

export type LimitState = 'ELU' | 'ELU-EXC' | 'ELS-R' | 'ELS-F' | 'ELS-QP'

export interface CombinationDef {
  id: string
  name: string
  limit: LimitState
  /** fator por ação: 'G' (permanente), 'Q' (carga móvel) e os `id` dos casos (`LoadCaseResult.id`) */
  factors: Record<string, number>
}

/**
 * Combinações NBR 8681. As envoltórias são por esforço (não concomitantes), exceto
 * `NatMz`: força normal concomitante com o Mz mínimo e com o Mz máximo do ELU.
 */
export interface CombinationResult {
  list: CombinationDef[]
  /** na ordem de `deadLoad.frames` */
  frames: {
    id: number
    elu: EnvForces
    elsRare: EnvForces
    elsFreq: EnvForces
    elsQp: EnvForces
    /** N concomitante no ELU: com o Mz mínimo e com o Mz máximo, nas 3 estações */
    NatMz: { min: [number, number, number]; max: [number, number, number] }
  }[]
  /** tração total [mín, máx] por cabo, na ordem de `deadLoad.cables` */
  cables: { id: number; elu: [number, number]; elsRare: [number, number]; elsFreq: [number, number]; elsQp: [number, number] }[]
  /** flecha vertical por nó (m) nas combinações frequentes, só ações variáveis: [mín, máx] */
  uzFreq: { min: number[]; max: number[] }
  /** reações de apoio [mín, máx] no ELU e na combinação rara */
  reactions: { node: number; elu: { min: Reaction['R']; max: Reaction['R'] }; elsRare: { min: Reaction['R']; max: Reaction['R'] } }[]
}

/* ------------------------------------------------------------------ estabilidade, vento, sismo */

export interface BucklingMode {
  index: number
  /** fator crítico λ sobre os esforços normais da carga permanente */
  factor: number
  /** forma normalizada: maior translação = 1 (u plano, 6 por nó) */
  shape: number[]
  /** grupo de barras comprimidas que mais alimenta a instabilidade ('tower', 'deck', 'pier'…) */
  group: string
  /** fração do trabalho desestabilizante que vem desse grupo (0–1) */
  share: number
}

/** flambagem linearizada no estado de carga permanente — ver analysis/buckling.ts */
export interface BucklingResult {
  /** em ordem crescente de λ */
  modes: BucklingMode[]
  iterations: number
  converged: boolean
  /** maior compressão nas barras sob carga permanente (kN) */
  maxCompression: number
  /** λ mínimo usual p/ estabilidade elástica global (referência do aviso) */
  minFactor: number
}

/** uma verificação aerodinâmica simplificada — ver checks/aero.ts */
export interface AeroCheck {
  key: 'flutter' | 'divergence' | 'vortex-v' | 'vortex-t'
  label: string
  /** velocidade crítica (m/s) */
  value: number
  unit: string
  /** velocidade de comparação (m/s) */
  limit?: number
  /** limit / value (> 1 reprova) */
  ratio?: number
  /** ausente = informativo (não aprova nem reprova) */
  ok?: boolean
  note: string
}

export interface AeroResult {
  /** velocidade característica do vento na cota do tabuleiro, Vk (m/s) — NBR 6123 */
  Vk: number
  /** cota do tabuleiro usada em S2 (m) */
  z: number
  /** largura B e altura D do tabuleiro (m) */
  B: number
  D: number
  /** massa (t/m) e raio de giração da massa (m) do tabuleiro */
  mass: number
  radius: number
  /** frequências usadas (Hz) e nº dos modos; 0 = modo não encontrado */
  fV: number
  fT: number
  modeV: number
  modeT: number
  /** fator de forma da seção aplicado à velocidade de flutter da placa plana */
  shapeFactor: number
  checks: AeroCheck[]
}

/** protensão numa barra, vista pelas verificações de seção (3 estações) */
export interface PrestressAtFrame {
  /** área de aço de protensão (m²) */
  Ap: [number, number, number]
  /** excentricidade do cabo resultante em relação ao centroide (m); + = abaixo do centroide */
  e: [number, number, number]
  /** força de protensão após todas as perdas (kN) */
  P: [number, number, number]
}

/** resultados da protensão do tabuleiro (os demais campos são do módulo prestress/) */
export interface PrestressResult {
  /** na ordem de `deadLoad.frames`; null = barra sem cabo */
  atFrames: (PrestressAtFrame | null)[]
  /** traçado, forças após cada grupo de perdas e momentos de protensão, por família de cabos */
  tendons?: import('../prestress/types').TendonResult[]
  /** verificações de tensões normais (ato da protensão e serviço) */
  checks?: import('../prestress/types').PrestressCheck[]
  /** todas as verificações normativas atendidas */
  ok?: boolean
}

/**
 * Verificação/dimensionamento de uma barra de tabuleiro, torre ou pilar no ELU.
 * Valores no pior dos 3 pontos da barra (cada grandeza no seu ponto mais desfavorável).
 * Áreas de aço em m² (×10⁴ = cm²); esforços em kN e kN·m; tensões em kPa.
 */
export interface SectionCheck {
  /** id da barra */
  id: number
  group: string
  /** critério: concreto armado/protendido, aço (elástico) ou só nível de tensões */
  method: 'NBR 6118' | 'NBR 8800' | 'tensões'
  /** tipo de dimensionamento: viga (flexão composta reta, armaduras superior e inferior)
   *  ou pilar (torres, pilares e arcos: flexo-compressão oblíqua, armadura total no contorno) */
  member: 'beam' | 'column' | 'stress'
  /** true = mesa/almas deduzidas de A, largura e altura (a seção não tem geometria detalhada) */
  approx: boolean
  /** posição do meio da barra: x (tabuleiro) ou z (torres e pilares), em m */
  s: number
  /** momentos de cálculo positivo (traciona embaixo) e negativo, em módulo, e a normal concomitante */
  MdPos: number
  MdNeg: number
  NdPos: number
  NdNeg: number
  /** envoltória da força normal de cálculo [mín, máx], tração + */
  Nd: [number, number]
  /** momento lateral, cortante e torçor de cálculo (módulos) */
  MydAbs: number
  Vd: number
  Td: number
  /** armadura longitudinal necessária na face inferior / superior (vigas) */
  AsInf?: number
  AsSup?: number
  /** armadura longitudinal total (pilares e torres) */
  AsTotal?: number
  /** armadura mínima correspondente (por face nas vigas; total nos pilares) */
  AsMin?: number
  /** estribos: Asw/s total das almas (m²/m), incluindo a parcela de torção quando há */
  AswS?: number
  /** armadura longitudinal adicional de torção (m²) */
  AslTorsion?: number
  /** taxa geométrica total de armadura longitudinal */
  rho?: number
  /** maior x/d da flexão */
  xd?: number
  /** maior tensão normal em módulo (kPa) — aço e verificações por tensões */
  sigma?: number
  /** aproveitamentos (≤ 1 passa) */
  ratios: {
    /** flexão: taxa de armadura / 4 % (vigas) ou interação N-M (pilares) ou σ/σ_lim (aço) */
    bending: number
    /** bielas: Vsd/VRd2 + Tsd/TRd2 */
    shear?: number
  }
  ratio: number
  ok: boolean
  notes?: string[]
}

/** conforto de pedestres: modos de vibração dentro das faixas críticas de passo */
export interface PedestrianComfort {
  /** faixas críticas de frequência (Hz) */
  ranges: { vertical: [number, number]; lateral: [number, number] }
  /** modos dentro de uma faixa crítica */
  critical: { mode: number; frequency: number; kind: ModeKind; direction: 'vertical' | 'lateral' }[]
  /** menor frequência vertical / lateral encontrada entre os modos calculados (Hz); 0 = nenhuma */
  fVertical: number
  fLateral: number
  ok: boolean
}

export interface BridgeResults {
  nNodes: number
  nElements: number
  nDofs: number
  formFinding?: FormFindingResult
  deadLoad: StaticState
  modal?: ModalResult
  moving?: MovingLoadResult
  /** casos de carga adicionais (temperatura, vento, frenagem, sismo, protensão…) */
  cases?: LoadCaseResult[]
  /** combinações NBR 8681 e envoltórias */
  combos?: CombinationResult
  /** protensão do tabuleiro (caso 'P' em `cases`) */
  prestress?: PrestressResult
  /** flambagem linearizada no estado permanente */
  buckling?: BucklingResult
  /** estabilidade aerodinâmica simplificada (flutter, divergência, vórtices) */
  aero?: AeroResult
  /** conforto de pedestres (só com a carga móvel 'Pedestres' e análise modal) */
  pedestrian?: PedestrianComfort
  checks: { cables: CableCheck[]; sections?: SectionCheck[] }
  /** L0 finais por cabo (aplicar no modelo p/ reaproveitar o form-finding); com `sizeCables`,
   *  traz também a área e o nº de cordoalhas redimensionados */
  cableL0: { id: number; L0: number; A?: number; strands?: number }[]
  /** fases construtivas — análise regressiva (só com `AnalysisOptions.stages`) */
  stages?: StagesResult
  /** efeitos diferidos (fluência e retração) na obra pronta; o estado final é o caso 'CS' de `cases` */
  longTerm?: LongTermResult
  warnings: string[]
  timings: Record<string, number>
}

/* ------------------------------------------------------------------ efeitos diferidos */

/** coeficientes de fluência e retração de uma seção de concreto (NBR 6118, Anexo A) */
export interface LongTermSection {
  sec: string
  mat: string
  name: string
  /** espessura fictícia hfic (m) */
  hfic: number
  /** true = perímetro estimado pela caixa envolvente (seção sem geometria detalhada) */
  approx: boolean
  /** fck (kPa) */
  fck: number
  /** φ(t∞, t0) */
  phi: number
  /** εcs(t∞, t0), negativa */
  epsCs: number
  nFrames: number
}

/** resumo dos incrementos diferidos num instante (em relação ao estado em t0) */
export interface LongTermInstant {
  /** idade do concreto (dias) */
  t: number
  /** φ(t, t0) e εcs(t, t0) da seção de referência (a de mais barras) */
  phi: number
  epsCs: number
  /** deslocamento vertical de maior módulo no tabuleiro (m, com sinal) e nó */
  uzDeck: number
  uzNode: number
  /** variação de tração nos cabos [mín, máx] (kN) */
  dT: [number, number]
  /** maior encurtamento axial acumulado de torre/pilar: deslocamento vertical do topo (m) */
  uzTower: number
}

export interface LongTermResult {
  params: {
    humidity: number
    t0: number
    tInf: number
    cement: string
    slump: string
    temperature: number
    chi: number
  }
  sections: LongTermSection[]
  /** evolução no tempo (um passo AAEM de t0 a cada instante); o último é t∞ = caso 'CS' */
  instants: LongTermInstant[]
  /** curvas φ(t, t0) e εcs(t, t0) da seção de referência */
  curve: { t: number[]; phi: number[]; epsCs: number[] }
  /** id do caso de carga com o estado final completo */
  caseId: string
  /** variação relativa da tração permanente dos cabos em t∞ [mín, máx] (fração) */
  cableChange?: [number, number]
}

/* ------------------------------------------------------------------ fases construtivas */

/** estado da estrutura parcial numa fase de execução (stages/backward.ts) */
export interface StageResult {
  /** posição na ordem de execução (0 = primeira fase) */
  index: number
  name: string
  kind: 'base' | 'cantilever' | 'closure' | 'finish'
  note: string
  /** ids dos elementos montados nesta fase */
  added: number[]
  /** ids dos elementos AINDA NÃO montados (p/ esconder no 3D) */
  hidden: number[]
  converged: boolean
  iterations: number
  /** norma do resíduo final (kN) — a fase é aceita com desequilíbrio < 0,01% do peso montado */
  residual: number
  /** motivo, quando a fase não convergiu */
  error?: string
  /** deslocamentos em relação à geometria de projeto (6 por nó; zero nos nós ainda inexistentes) */
  u: number[]
  /** tração (extremidade mais tracionada) dos estais já instalados (kN) */
  stays: { id: number; T: number; slack: boolean }[]
  nSlack: number
  /** maior tração entre os estais instalados (kN) */
  Tmax: number
  /** pontas livres dos balanços: nó e deslocamento vertical (m) */
  tips: { node: number; uz: number }[]
  /** deslocamento vertical de maior módulo no tabuleiro montado (m, com sinal) */
  uzMax: number
  /** por torre: deslocamento longitudinal do topo (m) e momento longitudinal na base (kN·m) */
  towers: { topNode: number; ux: number; baseM: number }[]
  /** maior compressão no tabuleiro (kN, ≤ 0) */
  deckNmin: number
  /** fluência e retração ACUMULADAS desde o início da obra até o fim desta fase (só com
   *  `daysPerStage`): incrementos em relação ao estado elástico da fase */
  creep?: StageCreep
}

export interface StageCreep {
  /** idade da obra no fim da fase (dias desde a fase 0) */
  day: number
  /** deslocamentos acumulados de fluência + retração (6 por nó) */
  u: number[]
  /** parcela acumulada nas pontas dos balanços desta fase (m) */
  tips: { node: number; uz: number }[]
  /** deslocamento vertical acumulado de maior módulo no tabuleiro montado (m, com sinal) */
  uzMax: number
  /** variação acumulada de tração dos estais [mín, máx] (kN) */
  dT: [number, number]
  /** deslocamento longitudinal acumulado do topo de cada torre (m) */
  towersUx: number[]
}

export interface StagesResult {
  /** fases na ordem de execução; a última é o estado final de projeto */
  stages: StageResult[]
  /** por estai: fase em que é instalado, tração de instalação e tração final (kN) */
  stays: { id: number; stage: number; Tinstall: number; Tfinal: number }[]
  /** cota de montagem: deslocamento vertical de cada nó do tabuleiro na fase em que ele é montado (m) */
  erection: { node: number; stage: number; uz: number }[]
  /** carga de equipamento aplicada na ponta dos balanços (kN) */
  equipment: number
  /** true se algum aparelho de apoio tabuleiro–torre foi travado (engaste provisório) até a última fase */
  temporaryFixity: boolean
  warnings: string[]
  /** tempo total (ms) */
  elapsed: number
  /** passagem do tempo entre as fases (fluência e retração) — só com `daysPerStage` */
  time?: {
    daysPerStage: number
    /** dias entre a última fase e a abertura ao tráfego */
    tOpen: number
    /** idade do concreto de cada aduela ao ser carregada (dias) */
    t0: number
    /** efeito de fluência + retração da abertura até t∞ na estrutura completa */
    final: {
      u: number[]
      uzMax: number
      stays: { id: number; dT: number }[]
      dT: [number, number]
    }
    /** por estai: variação acumulada de tração durante a obra e até t∞ (kN) */
    stays: { id: number; dTbuild: number; dTfinal: number }[]
  }
}

export interface AnalysisOptions {
  /** ajusta L0 de estais/pendurais p/ deslocamento nulo do tabuleiro sob carga permanente */
  formFinding?: boolean
  /** não linearidade geométrica (cabos de catenária + corrotacional) — padrão true */
  nonlinear?: boolean
  /** pré-dimensiona os estais (nº de cordoalhas) p/ ELS 0,45·Fu e ELU 0,65·Fu e reanalisa;
   *  só aumenta. Exige carga móvel. */
  sizeCables?: boolean
  modal?: { modes: number } | false
  moving?: { vehicle: 'TB-450' | 'TB-240' | 'Pedestres'; lanes?: string[] } | false
  /** flambagem linearizada (padrão: 4 modos); false desliga */
  buckling?: { modes: number } | false
  /** fases construtivas de estaiadas por análise regressiva (dezenas de análises não lineares);
   *  `equipment` = carga concentrada na ponta de cada balanço (kN). Padrão: desligado */
  stages?: boolean | { equipment?: number; temporaryFixity?: boolean; daysPerStage?: number; tOpen?: number }
  /** false = pula as extensões (casos adicionais, combinações, verificações…); uso interno */
  extras?: boolean
  /** callback de progresso (só no mesmo thread) */
  onProgress?: (stage: string, fraction: number) => void
}
