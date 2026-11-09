# Validação

Tudo aqui é verificado automaticamente por `npm test` (27 testes em `packages/engine/test`). Os números abaixo são os que os testes conferem.

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

## 4. Estaiada de São Paulo, Rio Negro e três vãos

Não há resultados publicados de projeto para comparar; os testes conferem consistência:

| Modelo | Estais | Tração permanente | Tabuleiro (perm.) | Verificação dos estais |
|---|---|---|---|---|
| Estaiada de São Paulo | 144 | 768 a 2 919 kN | ±15 mm | todos passam |
| Ponte Rio Negro | 104 | 3 036 a 4 129 kN | ±12,5 mm | todos passam |
| Estaiada de três vãos | 96 | 2 058 a 9 556 kN | ±8 mm | todos passam |

Em todos: análise não linear converge, form-finding converge e nenhum cabo fica frouxo. Na estaiada de São Paulo os testes conferem ainda Σ reações = peso total (6 casas) e o topo do mastro a menos de 5 cm do prumo. O deslocamento residual do tabuleiro é o encurtamento elástico das torres, que o form-finding deliberadamente não combate (ver `formfinding/formFinding.ts`).

O modelo de São Paulo é **inspirado** na Ponte Octávio Frias de Oliveira: mastro em X de 138 m, dois tabuleiros curvos de raio 275 m em cotas diferentes, vãos estaiados de 140 e 150 m, 144 estais. O traçado em planta, as seções e a posição das ancoragens são aproximações.

## 5. Robustez

`npm run sweep -w @opengirder/engine` roda 20 variações de gabarito (um e dois planos, harpa, leque, vãos desiguais, tabuleiro curvo, torre inclinada, torre em X, aço e concreto, pênsil com várias flechas, vigas com e sem pilares). Dezenove convergem com todos os cabos aprovados; a vigésima — pênsil com vão lateral de 60 m — reprova o cabo principal no trecho íngreme, que é o resultado correto para a área informada.

## Hipóteses a ter em mente

- Carga móvel e modal são **linearizadas** em torno do estado de carga permanente. Em pontes pênseis muito carregadas isso superestima flechas (a rigidez cresce com a carga).
- Acima de 200 m de vão a NBR 7188 pede estudo específico de amplificação dinâmica; o programa usa o CIV de 200 m e avisa.
- Limites dos cabos: 0,45·Fu em serviço e φ = 0,65 no ELU (fib Bulletin 30, PTI DC45.1) — a ABNT não tem norma de estais.
- Combinação última: 1,35·G + 1,5·Q.
