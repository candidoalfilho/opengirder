# Validação

Tudo aqui é verificado automaticamente por `npm test` (145 testes do motor em `packages/engine/test` e 43 da interface em `apps/desktop/test`). Os números abaixo são os que os testes conferem.

## 1. Elementos, contra solução fechada

| Verificação | Referência | Resultado |
|---|---|---|
| Cabo inextensível nivelado | Catenária clássica: H = w·a, V = w·S/2 | 3 casas decimais em H |
| Rigidez tangente do cabo | Derivada numérica das forças internas | coincide (10⁻³ kN/m) |
| Pendural vertical tenso | T = EA·ε; rigidez transversal T/L | exato |
| Rigidez axial aparente de estai longo | Módulo de Ernst (estai de 323 m a 400 MPa) | dentro de 3% |
| Viga biapoiada, carga uniforme | M = qL²/8; δ = 5qL⁴/384EI | exato (8 casas) |
| Balanço inclinado no espaço | δ = PL³/3EI | exato |
| Viga-coluna com P = 0,5·Pcr | Amplificação 1/(1 − P/Pcr) = 2,00 | 1,99 a 2,02 |
| Viga tracionada com N = Pe | Fator 1/(1 + N/Pe) = 0,50 | 0,495 a 0,505 |
| Rigidez tangente do pórtico + cabo | Diferença finita das forças internas | erro relativo < 2·10⁻³ |
| Modos de viga biapoiada | fₙ = n²π/(2L²)·√(EI/m) | 1º e 2º: 0,5%; 3º: 5% (malha) |
| Modos de corda tensa | fₙ = n/(2L)·√(T/m) | 0,5% |
| Cabo em 10 trechos × 1 trecho | Mesma catenária | H igual em 7 casas |
| Viga estaiada com form-finding | Viga contínua sobre apoios rígidos | flecha < 1 mm nas ancoragens |

## 2. Carga móvel NBR 7188

| Verificação | Referência | Resultado |
|---|---|---|
| CIV, CNF, CIA | Fórmulas da norma | exato |
| Viga biapoiada de 30 m, momento no meio do vão | p·L²/8 + eixos de 120 kN em L/2 e L/2 ± 1,5 m | 4 casas |
| Idem, cortante no apoio | p·L/2 + eixos em 0, 1,5 e 3 m | 3 casas |
| Viga contínua de dois vãos, momento no apoio central | −p·L²/8 + veículo na pior posição da linha de influência analítica | 3 casas |

A carga por eixo é 150 − 30 = 120 kN: a distribuída é mantida sob o veículo e o que ela já aplica na área de 3 × 6 m é descontado dos três eixos.

## 3. Golden Gate Bridge

Geometria global das fontes oficiais (vãos de 343 + 1 280 + 343 m, torres de 227 m, cabos de 0,92 m com 27 572 fios, pendurais a cada 15,24 m). Propriedades de seção estimadas: carga permanente suspensa de 225 kN/m; treliça de rigidez com Iz = 5 m⁴; torção J = 1,0 m⁴ (fórmula de Bredt para o caixão treliçado, reduzida pela distorção); massa concentrada nas treliças de borda.

| Grandeza | Referência | OpenGirder | Diferença |
|---|---|---|---|
| Tração no cabo principal | 213 a 253 MN (48 a 57 mil kip) | 224 a 257 MN | dentro da faixa, +2% no topo |
| 1º modo transversal | 20,495 s | 20,88 s | +1,9% |
| 1º modo longitudinal | 11,631 s | 12,57 s | +8,1% |
| 1º modo vertical simétrico | 7,808 s | 7,86 s | +0,7% |
| 1º modo torcional | 8,98 s | 6,68 s | −26% |
| Tabuleiro sob carga permanente | no greide | flecha < 0,01 mm nas ancoragens dos pendurais | — |
| Pendurais | carga de um painel ÷ 2 = 1 715 kN | 1 630 a 1 882 kN | — |
| Σ reações verticais | peso total do modelo | igual em 6 casas | — |

Períodos de referência: modelo ADINA do retrofit sísmico (HDR, 2013), com 11 420 nós.

**O modo torcional não fecha.** O tabuleiro aqui é uma barra com torção de Saint-Venant; a treliça real distorce e é bem mais flexível à torção do que qualquer seção fechada equivalente. Para torção de tabuleiros treliçados ou abertos, este modelo de espinha não é suficiente — precisa do tabuleiro em grelha ou casca (está no roadmap). Os modos transversal, longitudinal e verticais, governados pela rigidez geométrica dos cabos, fecham.

Sensibilidade do 1º modo torcional (os modos verticais e o transversal não mudam):

| J (m⁴) | Raio de giração da massa (m) | 1º torcional | Contra 8,98 s |
|---|---|---|---|
| 1,0 | 11,2 (modelo atual) | 6,68 s | −26% |
| 0,3 | 11,2 | 7,98 s | −11% |
| 0,05 | 11,2 | 8,66 s | −4% |

A estimativa de Bredt para a treliça contraventada dá J entre 0,3 e 1 m⁴. O modelo mantém J = 1,0 para não ajustar um dado estimado ao resultado; modelar o tabuleiro como grelha não muda esse número.

## 4. Estaiada de São Paulo, Rio Negro e três vãos

Não há resultados publicados de projeto para comparar; os testes conferem consistência:

| Modelo | Estais | Tração permanente | Tabuleiro (perm.) | Verificação dos estais |
|---|---|---|---|---|
| Estaiada de São Paulo | 144 | 768 a 2 919 kN | ±15 mm | todos passam |
| Ponte Rio Negro | 104 | 3 036 a 4 129 kN | ±12,5 mm | todos passam |
| Estaiada de três vãos | 96 | 2 058 a 9 556 kN | ±8 mm | todos passam |

Em todos: análise não linear converge, form-finding converge e nenhum cabo fica frouxo. Na estaiada de São Paulo os testes conferem ainda Σ reações = peso total (6 casas) e o topo do mastro a menos de 5 cm do prumo. O deslocamento residual do tabuleiro é o encurtamento elástico das torres, que o form-finding deliberadamente não combate (ver `formfinding/formFinding.ts`).

O modelo de São Paulo é **inspirado** na Ponte Octávio Frias de Oliveira: mastro em X de 138 m, dois tabuleiros curvos de raio 275 m em cotas diferentes, vãos estaiados de 140 e 150 m, 144 estais. O traçado em planta, as seções e a posição das ancoragens são aproximações.

## 5. Casos de carga adicionais e combinações

Todos os casos são incrementos lineares sobre a rigidez tangente do estado de carga permanente (`analysis/linear.ts`).

| Verificação | Referência | Resultado |
|---|---|---|
| Carga uniforme em viga biapoiada | M = qL²/8, R = qL/2, δ = 5qL⁴/384EI | exato |
| Gradiente térmico, viga biengastada | M = EI·α·ΔT/h constante, sem flecha | exato |
| Gradiente térmico, viga biapoiada | M = 0, contraflecha κL²/8 | exato |
| Variação uniforme, barra impedida | N = −EA·α·ΔT | exato |
| Recalque do apoio central, viga de 2 vãos | M = 3EIδ/L², ΔR = −6EIδ/L³ | exato |
| Cabo com L0 alongado, ancoragens presas | ΔT = −EA·ΔL0/L0 | 3 casas |
| Vento NBR 6123 | S2, q = 0,613·Vk² e força por metro conferidos à mão; viga biapoiada My = f·L²/8 | exato |
| Frenagem NBR 7188 | Hf = 0,25·B·L·CNF ≥ 135 kN, toda no apoio fixo | exato |
| Combinações NBR 8681 | ELU, rara, frequente e quase permanente de G + Q + vento + frenagem conferidas à mão | exato |
| Ações alternativas (TU+ × TU−) | entra só uma do par | confere |
| Sismo NBR 15421, oscilador de 1 GDL | cortante na base = m·Sa(T)·g·I/R | erro < 10⁻⁶ |

## 6. Protensão

| Verificação | Referência | Resultado |
|---|---|---|
| Viga biapoiada, cabo parabólico | carga equivalente 8·P·f/L²; M = −P·e; reações nulas; contraflecha 5wL⁴/384EI | exato |
| Viga contínua de 2 vãos, cabo reto excêntrico | hiperestático 1,5·P·e no apoio central; reação −3·P·e/L | exato |
| Perda por atrito | P(x) = Pi·e^−(μ·Σα + k·x) | exato |
| Acomodação da ancoragem | comprimento afetado √(δ·Ep·Ap/p), queda 2·p·w | exato |
| Viaduto 30 + 40 + 30 m | 150 cordoalhas, perdas totais de 24,6%, ELS-D e ELS-F atendidos | regressão |

## 7. Seções e verificações

| Verificação | Referência | Resultado |
|---|---|---|
| Propriedades de retângulo, T, círculo e seção mista | fórmulas fechadas e teorema de Steiner | exato |
| Torção de tubo de parede fina e de caixão | Bredt: J = 4·Am²/∮ds/t | exato |
| Flexão simples NBR 6118 | tabelas KMD (0,100 → KX 0,157; 0,200 → KX 0,341); seção 20 × 50, C25, Md = 140 kN·m → 8,23 cm² | confere |
| Seção T com linha neutra na alma, armadura dupla | cálculo manual | confere |
| Cortante, modelo I | VRd2, Vc0, Asw/s e armadura mínima de exemplo manual | confere |
| Pilar | compressão e tração centradas; momento resistente sem aço | exato |

## 8. Estabilidade

| Verificação | Referência | Resultado |
|---|---|---|
| Coluna de Euler biarticulada (8 elementos) | Pcr = π²EI/L² | erro < 0,5% |
| Coluna engastada-livre | Pcr = π²EI/4L² | erro < 0,05% |
| Pórtico engastado deslocável | Pcr = 7,38·EI/h² | erro < 0,5% |
| Flutter de Selberg | cálculo manual e forma alternativa da fórmula | exato |
| Tacoma Narrows (1940), seção em H | colapso com vento de 18,8 m/s | Vcr ≈ 8,5 m/s: reprova |

Fatores críticos de flambagem dos modelos de referência (sobre a carga permanente): Golden Gate 15,1 (torres); São Paulo 20,9 (mastro); Rio Negro 7,3; três vãos 8,3; arco atirantado 9,2.

## 9. Arcos e fases construtivas

| Verificação | Referência | Resultado |
|---|---|---|
| Arco parabólico biarticulado, carga uniforme | H = qL²/8f, M ≈ 0 | H dentro de 0,5%; M < 0,4% de qL²/8 |
| Bowstring de 130 m | reação horizontal nula; N do tirante = empuxo | Σ Rx < 10⁻⁶; N a menos de 0,5% |
| Balanço com um estai, fase sem estai | δ = wL⁴/8EI, M = wL²/2 | exato |
| Fases construtivas, última fase | reproduz o estado final de projeto | trações iguais (5·10⁻⁷ %) |

## Efeitos diferidos (fluência e retração)

Modelo do Anexo A da NBR 6118 (`timedep/nbr6118a.ts`) e método do módulo efetivo ajustado pela idade, χ = 0,8 (`timedep/aaem.ts`).

| Verificação | Referência | Resultado |
|---|---|---|
| Pilar livre sob carga constante | encurtamento (1 + φ)·NL/EA + εcs·L | exato |
| Barra biengastada com retração | N = εcs·EA/(1 + χφ) | exato |
| Concreto em paralelo com aço | transferência de carga pela fórmula fechada | exato |
| Viga contínua homogênea | flechas × φ, sem redistribuição de momentos | ±1%; ΔM < 0,5% |
| Balanço numa fase construtiva | ponta desce Δφ·wL⁴/8EI | exato |
| Coeficientes φ e εcs | Tabela 8.2 da NBR 6118 (valores de memória, umidade de 40 a 75%) | retração até 5%, fluência até 10% |

Em t = ∞ (umidade de 70%, carga aos 28 dias): na Ponte Rio Negro o tabuleiro desce 253 mm e as trações dos estais variam de −17,7% a +2,7%; em São Paulo, 121 mm e −13,4% a +2,9%. Nenhum estai fica frouxo e as verificações continuam atendidas. As expressões do Anexo A foram implementadas de bibliografia e não conferidas no texto oficial.

## Tabuleiro em grelha

Vigas múltiplas modeladas como grelha (`templates/grillage.ts`): longarinas em seção T, faixas de laje em cada estaca e transversinas; a carga móvel é repartida entre as longarinas vizinhas pela regra da alavanca (`loads/transverse.ts`) e o restante da repartição sai do próprio modelo.

| Verificação | Referência | Resultado |
|---|---|---|
| Carga permanente, 5 longarinas, vão de 30 m | soma dos momentos das longarinas = momento da viga única; Σ reações = peso | 0,02% e 0,1% |
| Flecha média das longarinas | viga única com a soma das inércias | dentro de 3% |
| Carga concentrada excêntrica, transversina rígida no meio do vão | Courbon/Engesser: 0,60 / 0,40 / 0,20 / 0 / −0,20 | 0,600 / 0,400 / 0,199 / 0,000 / −0,199 |
| Idem, sem transversina no vão e laje de 12 cm | a longarina carregada fica com mais que Courbon (0,60) | mais de 0,75 |
| TB-450, longarina de borda, vão de 30 m | Courbon com as faixas desfavoráveis e o veículo a 4,6 m do eixo: 3 640 kN·m | 3 459 kN·m (−5%), 1,53 × a média |

A transversina de apoio rígida à torção engasta parcialmente as longarinas umas nas outras e reduz a redistribuição de Courbon (de 0,60 para 0,42 na borda com uma nervura de 1,5 × 4 m); por isso a comparação com Courbon usa transversinas sem rigidez à torção. A grelha não representa a flexão local da laje sob a roda, o efeito de casca, a largura colaborante variável nem os balanços da laje (o peso deles vai para a longarina de borda); a protensão automática ainda só existe no modelo de espinha.

## 10. Robustez

`npm run sweep -w @opengirder/engine` roda 30 variações de gabarito (um e dois planos, harpa, leque, vãos desiguais, tabuleiro curvo, torre inclinada, torre em X, aço e concreto, pênsil com várias flechas, vigas com e sem pilares, sete arcos, três grelhas). Vinte e nove convergem com todos os cabos aprovados; a outra — pênsil com vão lateral de 60 m — reprova o cabo principal no trecho íngreme, que é o resultado correto para a área informada.

A interface é exercitada num navegador headless: os dez modelos prontos rodam e todas as abas renderizam sem erro de console.

**Modelo feito à mão.** Uma estaiada montada só com as operações do editor, sem assistente (tabuleiro de 2 × 60 m dividido a cada 10 m, torre de 60 m, 5 estais por lado gerados, pista automática), é analisada em `packages/engine/test/scratch.test.ts` e em `apps/desktop/test`: converge, nenhum estai frouxo, tabuleiro a menos de 30 mm do greide, todos os estais aprovados após o dimensionamento, em leque, semi-leque e harpa. No navegador, a partir do modelo em branco, uma estaiada de 2 × 120 m com torre de 85 m e 20 estais gerados roda em 0,14 s com o mesmo resultado (tabuleiro a 5 mm do greide).

## Hipóteses a ter em mente

- Carga móvel, modal e todas as ações variáveis são **linearizadas** em torno do estado de carga permanente. Em pontes pênseis muito carregadas isso superestima flechas (a rigidez cresce com a carga).
- Acima de 200 m de vão a NBR 7188 pede estudo específico de amplificação dinâmica; o programa usa o CIV de 200 m e avisa.
- Limites dos cabos: 0,45·Fu em serviço e φ = 0,65 no ELU (fib Bulletin 30, PTI DC45.1) — a ABNT não tem norma de estais.
- As envoltórias das combinações são por esforço, não concomitantes (exceto a normal associada ao momento extremo). No ELU, γg multiplica o esforço permanente, não a carga.
- Vento só transversal, sem sustentação nem momento aerodinâmico; o arrasto do tabuleiro segue a curva da EN 1991-1-4, porque o capítulo de pontes da NBR 6123:2023 não está implementado.
- Fases construtivas: o estado de cada fase vem da análise regressiva elástica (comprimentos de fabricação = estado final); a fluência e a retração entram como incremento por fase somado a esse estado, sem retensionamento.
- Verificação de seções sobre o modelo de espinha: sem geometria detalhada, mesa e almas são deduzidas da área e o resultado é indicativo. Efeitos locais de 2ª ordem em pilares (NBR 6118, 15.8), flambagem local e lateral do aço não são verificados.
- A triagem aerodinâmica usa fatores de forma indicativos e não substitui ensaio em túnel de vento.

## Conferência normativa

Os textos oficiais da ABNT são pagos e não foram consultados. Cada coeficiente foi conferido em **fontes públicas** (apostilas de universidades, teses, publicações do DNIT, material da ABECE): duas ou mais fontes independentes sempre que possível. O detalhamento, com o valor no código, a situação e as fontes de cada item, está em [docs/normas.md](docs/normas.md).

| Norma | Conferido em 2+ fontes públicas | Conferido em 1 fonte | Não confirmado |
|---|---|---|---|
| NBR 7188:2013 (carga móvel) | TB-450, TB-240, CIV, definição de Liv, CNF, CIA, frenagem Hf, multidão de passarelas | manutenção do TB-450 na edição de 2024 | demais coeficientes da edição de 2024 |
| NBR 8681:2003 (combinações) | γg, γq, γε, ψ0/ψ1/ψ2 de pontes rodoviárias, passarelas, vento e temperatura | ψ2 = 0 admitido com sismo | γp da protensão; edição de 2025 |
| NBR 6123 (vento) | q = 0,613·Vk², tabela de b, p e Fr do S2, classes A/B/C, S3 do grupo 1 (2023) | Re = 70 000·Vk·d; S1 e S2 mantidos em 2023 | arrasto do tabuleiro, de torres e de cabos; capítulo de pontes de 2023 (não implementado) |
| NBR 6118 (concreto) | Eci, fct,m (inclusive a expressão de 2023 para fck > 50), ηc de 2023, cortante (VRd2, αv2, Vc0) | Ecs (αi), fctk,inf, εc2 e εcu, γc, γs, Es, dilatação térmica, variações de temperatura | Tabela 17.3, x/d, λ e αc acima de C50, estribo mínimo, torção, pilares |
| NBR 6118 (protensão) | σpi de 2014, k = 0,01·μ, ψ1000 a 0,6 e 0,7·fptk, relaxação 2,5·ψ1000 | atrito μ, ato da protensão, níveis de protensão | σpi de 2023 (mudou de formato), fct,f, extremos da Tabela 8.4, perdas progressivas simplificadas |
| NBR 15421:2006 (sismo) | zonas e ag, ramos do espectro | Ca e Cv, regra Cd/R dos deslocamentos | aceleração vertical, regra 100% + 30%, tabela de 2023 |
| NBR 8800 (aço) | — | γa1 = 1,10 | E, G e dilatação térmica |
| Estais, aerodinâmica e passarelas | — | — | limites 0,45·Fu e 0,65·Fu, extradorso, Selberg, Strouhal, faixas de frequência do passo |

**Corrigido nesta conferência** (antes → depois):

- Fator S3 padrão do vento: 1,10 → 1,11 (NBR 6123:2023, grupo 1, que passou a citar pontes). A pressão de vento dos modelos sobe 1,8%.
- Resistência média à tração do concreto acima de C50: 2,12·ln(1 + 0,11·fck) → 2,12·ln[1 + 0,1·(fck + 8)] (NBR 6118:2023).
- Carga móvel de passarelas nas combinações: ψ de pontes rodoviárias (0,7 / 0,5 / 0,3) → ψ de passarelas (0,6 / 0,4 / 0,3).
- Passarelas deixam de gerar o caso de frenagem, que é ação de veículos rodoviários.
- Deslocamentos do sismo: elásticos × I → elásticos (Cd/R com Cd = R).

**O que continua dependendo do texto oficial:** as edições novas ainda não lidas (NBR 7188:2024, NBR 8681:2025, capítulo de pontes da NBR 6123:2023, NBR 15421:2023, emenda de 2026 da NBR 6118), os gradientes térmicos da NBR 7187:2021 e as recomendações internacionais de estais (PTI DC45.1, fib Bulletin 30, SETRA), que são pagas ou não foram localizadas.
