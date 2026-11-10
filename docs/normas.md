# Conferência normativa

Este documento registra, coeficiente por coeficiente, de onde vêm os valores de norma usados no motor e como cada um foi conferido.

**Os textos oficiais da ABNT são pagos e não foram consultados.** A conferência foi feita em fontes públicas: apostilas e notas de aula de universidades, teses, dissertações e trabalhos de conclusão que reproduzem as tabelas, publicações do DNIT, palestras e notícias da ABECE e artigos técnicos. "Conferido" aqui significa "conferido em fontes públicas", nunca "conferido no texto da norma". Antes de usar o programa em projeto, confira os valores na edição vigente de cada norma.

Situação de cada item:

| Marca | Significado |
|---|---|
| ✔ | Conferido em duas ou mais fontes públicas independentes que concordam |
| ◐ | Conferido em uma fonte pública (às vezes com uma dedução que fecha) |
| ✎ | Estava diferente e foi corrigido nesta conferência |
| ? | Não confirmado em fonte pública; vale o valor de uso corrente na bibliografia |

Última conferência: novembro de 2026.

## O que mudou no código nesta conferência

| Item | Antes | Depois | Por quê |
|---|---|---|---|
| Fator S3 padrão do vento (`loads/site.ts`) | 1,10 | 1,11 | A NBR 6123:2023 elevou o grupo 1 de 1,10 para 1,11 e passou a citar pontes rodoviárias e ferroviárias nesse grupo |
| fct,m para fck > 50 MPa (`checks/nbr6118.ts`, `prestress/checks.ts`) | 2,12·ln(1 + 0,11·fck) | 2,12·ln[1 + 0,1·(fck + 8)] | Expressão da NBR 6118:2023 (a anterior era a de 2014) |
| ψ da carga móvel em passarelas (`combos/nbr8681.ts`) | 0,7 / 0,5 / 0,3 | 0,6 / 0,4 / 0,3 | A Tabela 6 da NBR 8681 tem linha própria para passarelas de pedestres |
| Frenagem em passarelas (`loads/braking.ts`) | gerava o caso FR | não gera | A frenagem é ação de veículos rodoviários; a seção de passarelas da NBR 7188 não a prevê |
| Deslocamentos do sismo (`loads/seismic.ts`) | elásticos × I | elásticos (Cd/R com Cd = R) | Na NBR 15421 os deslocamentos são multiplicados por Cd/R; o fator de importância I não entra neles |

Impacto nos modelos de referência: a pressão de vento sobe 1,8% (S3² = 1,11²/1,10²); a passarela estaiada passa a combinar a multidão com ψ1 = 0,4 e deixa de ter frenagem; nenhum modelo de referência usa concreto acima de C50 nem sismo ligado por padrão.

## NBR 7188 — carga móvel rodoviária e de pedestres

Edição conferida: 2013. A edição vigente é a de 2024 (publicada em 17/01/2024, com errata em 12/2024). Segundo a ABECE, a revisão mudou o título, suprimiu a seção de garagens (que foi para a NBR 6120) e fez uma revisão geral do texto, **sem alterar o item principal: o TB-450 continua sendo a carga padrão**. Os demais coeficientes da edição de 2024 não foram conferidos um a um.

| Coeficiente | Valor no código | Onde | Situação | Fontes |
|---|---|---|---|---|
| TB-450: 6 rodas de 75 kN, 3 eixos a 1,5 m, veículo de 3 × 6 m, p = 5 kN/m² | igual | `loads/nbr7188.ts` | ✔ | [1] [2] [3] |
| TB-240: rodas de 40 kN, p = 4 kN/m² | igual | `loads/nbr7188.ts` | ✔ | [3] [5] |
| CIV = 1,35 (vão < 10 m); 1 + 1,06·20/(Liv + 50) (10 a 200 m) | igual | `civ()` | ✔ | [1] [2] [3] |
| Liv: vão isostático; média dos vãos contínuos; comprimento do balanço | média dos vãos em vigas contínuas, vão principal nos demais | `analyze.ts` | ✔ | [1] [4] |
| Acima de 200 m: estudo específico | usa o CIV de 200 m e avisa | `analyze.ts` | ✔ | [1] [5] |
| CNF = 1 − 0,05·(n − 2) > 0,9 | igual | `cnf()` | ✔ | [1] [2] [3] |
| CIA = 1,25 (concreto e mistas); 1,15 (aço); a menos de 5 m de juntas | igual | `ciaFactor()`, `loads/moving.ts` | ✔ | [1] [2] [3] |
| Frenagem Hf = 0,25·B·L·CNF ≥ 135 kN | igual | `loads/braking.ts` | ✔ | [1] [5] |
| Passarelas: p = 5,0 kN/m² entre guarda-corpos, sem impacto | igual | `VEHICLES.Pedestres` | ✔ | [1] [6] [5] |
| Edição de 2024: TB-450 mantido | — | — | ◐ | [7] |

Não implementado: força centrífuga, colisão em dispositivos de contenção e em pilares, carga excepcional de 100 kN em passarelas, veículos especiais.

## NBR 8681 — ações e segurança

Edição conferida: 2003. Uma nova edição foi publicada em setembro de 2025; a ABECE informa que a revisão atualiza termos e compatibiliza a norma com as demais, e a comissão não previa alterações profundas. **Os valores da edição de 2025 não foram conferidos.**

| Coeficiente | Valor no código | Onde | Situação | Fontes |
|---|---|---|---|---|
| γg permanentes agrupadas, pontes em geral: 1,35 / 1,0; excepcional 1,15 / 1,0 | igual | `GAMMA` | ✔ | [8] [9] |
| γg de "grandes pontes" (peso próprio > 75% das permanentes): 1,30 / 1,0 | não usado — vale 1,35, a favor da segurança | `GAMMA` | ✔ | [8] [9] |
| γq em separado: temperatura 1,2; vento 1,4; variáveis em geral 1,5; excepcional 1,0 | igual | `GAMMA` | ✔ | [8] [9] |
| γε de recalques e retração: 1,2 desfavorável / 0 favorável | igual | `GAMMA.settlement` | ✔ | [8] [9] |
| ψ0 / ψ1 / ψ2 de pontes rodoviárias: 0,7 / 0,5 / 0,3 | igual | `PSI.moving` | ✔ | [8] [9] |
| ψ de passarelas de pedestres: 0,6 / 0,4 / 0,3 | igual | `PSI.pedestrian` | ✎ ✔ | [8] [9] |
| ψ do vento: 0,6 / 0,3 / 0 | igual | `PSI.wind` | ✔ | [8] [9] |
| ψ da temperatura: 0,6 / 0,5 / 0,3 | igual | `PSI.temperature` | ✔ | [8] [9] |
| Combinação excepcional com sismo: admite-se ψ2 = 0 | usa ψ2 da carga móvel (0,3), a favor da segurança | `runCombinations` | ◐ | [8] |
| γp da protensão: 1,2 / 0,9 | igual | `GAMMA` | ? | NBR 6118, Tabela 11.1 (não conferida) |
| ψ de pontes ferroviárias (0,8 / 0,7 / 0,5 e 1,0 / 1,0 / 0,6) | não implementado | — | ✔ | [8] [9] |

A fonte [10], uma apostila que reproduz a edição de 1984, traz valores diferentes (pontes rodoviárias 0,6 / 0,4 / 0,2; vento 0,4 / 0,2 / 0). São os da edição anterior e não valem mais.

## NBR 6123 — vento

Edições: 1988 e 2023 (publicada em 20/12/2023, com errata em 2025).

| Coeficiente | Valor no código | Onde | Situação | Fontes |
|---|---|---|---|---|
| q = 0,613·Vk² (N/m²) | igual | `dynamicPressure()` | ✔ | [11] [12] |
| S2 = b·Fr·(z/10)^p | igual | `s2Factor()` | ✔ | [11] |
| Parâmetros b e p das categorias I a V, classes A, B e C; Fr = 1,00 / 0,98 / 0,95 | igual | `S2_B`, `S2_P`, `S2_FR` | ✔ | [11] e transcrições públicas da Tabela 1; os 30 valores de S2 tabelados em [11] para z = 10 m e z = 30 m foram recalculados com a expressão e fecham em duas casas |
| Classes por maior dimensão: A até 20 m, B até 50 m, C acima | igual | `windClass()` | ✔ | [11] |
| Re = 70 000·Vk·d | igual | `cableDrag()` | ◐ | [11] |
| S3 do grupo 1: 1,10 (1988) → 1,11 (2023), com pontes citadas no grupo | 1,11 | `DEFAULT_SITE` | ✎ ✔ | [13] [14] |
| S1 e S2: procedimento mantido em 2023 | — | — | ◐ | [15] |
| Tabuleiro: Ca = 2,5 − 0,3·B/d entre 1,3 e 2,4 | curva da EN 1991-1-4, Fig. 8.3 | `deckDrag()` | ? | não conferida em fonte pública nesta rodada |
| Capítulo de pontes da NBR 6123:2023 (item 11: Cx, Cz, classificação aerodinâmica) | **não implementado** | — | ? | [13] descreve o capítulo, mas as expressões só aparecem em figuras |
| Torres e pilares: Ca = 2,0 | prisma retangular de cantos vivos | `TOWER_DRAG` | ? | valor conservador; [13] cita 2,0 como o que se usava para tabuleiros pela formulação de muros e placas |
| Cabos: Ca = 1,2 abaixo do Re crítico e 0,7 acima | igual | `cableDrag()` | ? | valores usuais de estais com tubo de PEAD; não conferidos |

## NBR 6118 — concreto

Edições: 2014 e 2023 (com errata de 22/11/2023 e emenda de 03/2026). Várias fontes abaixo já seguem a edição de 2023.

| Coeficiente | Valor no código | Onde | Situação | Fontes |
|---|---|---|---|---|
| Eci = αE·5600·√fck (fck ≤ 50); 21 500·αE·(fck/10 + 1,25)^(1/3) acima | igual, com αE = 1,0 | `templates/builder.ts` | ✔ | [16] [17] |
| Ecs = αi·Eci, αi = 0,8 + 0,2·fck/80 ≤ 1,0 | igual | `templates/builder.ts` | ◐ | [16] |
| fct,m = 0,3·fck^(2/3) (fck ≤ 50) | igual | `fctm()` | ✔ | [16] [17] |
| fct,m para fck > 50: 2,12·ln[1 + 0,1·(fck + 8)] (2023) | igual | `fctm()` | ✎ ✔ | [16] [18] |
| fctk,inf = 0,7·fct,m | igual | `concreteParams()` | ◐ | [16] |
| Diagrama de cálculo: σcd = 0,85·ηc·fcd, com ηc = (40/fck)^(1/3) para fck > 40 MPa (2023) | igual | `concreteParams()` | ✔ | [16] [19] [20] |
| εc2 = 2,0‰ + 0,085‰·(fck − 50)^0,53; εcu = 2,6‰ + 35‰·[(90 − fck)/100]⁴ | igual | `concreteParams()` | ◐ | [16] |
| λ = 0,8 e αc = 0,85 (fck ≤ 50); reduções para fck > 50 | igual | `concreteParams()` | ? | não conferidas nesta rodada |
| x/d ≤ 0,45 (fck ≤ 50) e 0,35 acima | igual | `concreteParams()` | ? | não conferido nesta rodada |
| Taxas mínimas de armadura de flexão (Tabela 17.3) | 0,150% a 0,256% | `rhoMin()` | ? | valores da edição de 2014, não conferidos em fonte pública; a edição de 2023 pode tê-los alterado |
| γc = 1,4; γs = 1,15; Es = 210 GPa | igual | `checks/nbr6118.ts` | ◐ | [16] |
| Cortante, modelo I: VRd2 = 0,27·αv2·fcd·bw·d; αv2 = 1 − fck/250; Vc0 = 0,6·fctd·bw·d | igual | `shearELU()` | ✔ | [17] [21] |
| Armadura transversal mínima: ρsw = 0,2·fct,m/fywk | igual | `shearELU()` | ? | não conferido nesta rodada |
| Torção: TRd2 = 0,5·αv2·fcd·Ae·he (θ = 45°) | igual | `torsionELU()` | ? | não conferido nesta rodada |
| Pilares: As,mín = 0,15·Nd/fyd ≥ 0,4% Ac; máximo de 8% | igual | `columnELU()` | ? | não conferido nesta rodada |
| Dilatação térmica do concreto: 10⁻⁵/°C | igual | `thermalAlpha()` | ◐ | [16] |
| Variação uniforme de temperatura: 10 a 15 °C (menor dimensão até 50 cm); 5 a 10 °C (acima de 70 cm) | padrão de ±15 °C, editável | `DEFAULT_SITE` | ◐ | [16] |
| Variação não uniforme: gradiente linear, no mínimo 5 °C entre faces | padrão de 10 °C (15 °C em aço e mistas), editável | `DEFAULT_SITE` | ◐ | [16] |
| Gradientes térmicos da NBR 7187:2021 para tabuleiros | **não implementados** | — | ? | a norma de pontes de concreto prescreve gradientes próprios, não consultados |

### Protensão

| Coeficiente | Valor no código | Onde | Situação | Fontes |
|---|---|---|---|---|
| σpi na pós-tração, edição de 2014: 0,74·fptk e 0,82·fpyk (relaxação baixa) | o menor dos dois (≈ 0,738·fptk) | `defaultSigmaPi()` | ✔ | [21] [18] |
| σpi na edição de 2023: limites só em função de fptk, sem fpyk | não alterado | `defaultSigmaPi()` | ? | [18] e [19] registram a mudança de formato; [18] dá 0,77·fptk para pós-tração aderente, valor que pode ter sido alterado pela errata de 11/2023. O valor do código é menor que qualquer das leituras, logo a favor da segurança |
| Atrito: μ = 0,50 / 0,30 / 0,20 / 0,10 / 0,05 conforme cabo e bainha | padrão 0,20 (cordoalha em bainha metálica) | `prestress/types.ts` | ◐ | [21] |
| k = 0,01·μ por metro | igual | `prestress/types.ts` | ✔ | [21] [22] (usa k = 0,002/m com μ = 0,2) |
| Ato da protensão: γp = 1,1, compressão ≤ 0,7·fckj, tração ≤ 1,2·fct,m | igual | `prestress/checks.ts` | ◐ | [22] |
| Níveis de protensão: limitada (ELS-F na frequente, ELS-D na quase permanente); completa (ELS-F na rara, ELS-D na frequente) | igual | `prestress/checks.ts` | ◐ | [22] |
| fct,f = α·fctk,inf, com α = 1,2 em seções T e caixão | igual | `prestress/checks.ts` | ? | não conferido nesta rodada |
| ψ1000 de cordoalhas de relaxação baixa: 1,3% a 0,6·fptk; 2,5% a 0,7·fptk | igual | `psi1000RB()` | ✔ | [22] [21] |
| ψ1000 a 0,5·fptk (0) e a 0,8·fptk (3,5%) | igual | `psi1000RB()` | ? | não conferidos nesta rodada |
| Relaxação a tempo infinito: 2,5·ψ1000; χ = −ln(1 − ψ) | igual | `progressiveLoss()` | ✔ | [22] [23] |
| Perdas progressivas pelo processo simplificado (9.6.3.4.2) | expressão do cabeçalho de `losses.ts` | `progressiveLoss()` | ? | só a parcela da relaxação foi conferida |
| Compressão em serviço ≤ 0,6·fck | só referência (EN 1992-1-1) | `prestress/checks.ts` | — | não é limite da NBR 6118 |

### Fluência e retração (Anexo A)

| Item | Onde | Situação |
|---|---|---|
| φ(t, t0) = φa + φf∞·[βf(t) − βf(t0)] + φd∞·βd; εcs(t, t0) = εcs∞·[βs(t) − βs(t0)]; espessura fictícia; idade fictícia | `timedep/nbr6118a.ts` | **não confirmado** — expressões e polinômios escritos de bibliografia, sem fonte pública consultada. Conferência indireta: reproduzem a Tabela A.1 e ficam a até 5% (retração) e 10% (fluência) da Tabela 8.2 para umidade de 40 a 75%; a 90% a retração diverge até 30% |
| γ da fluência e da retração nas combinações (1,2 desfavorável / 0 favorável) | `combos/nbr8681.ts` | **não confirmado** — adotado por analogia com recalques e variações de temperatura |

## NBR 15421 — sismo

Edição conferida: 2006. A edição de 2023 passou a ter seis classes de terreno (A a F).

| Coeficiente | Valor no código | Onde | Situação | Fontes |
|---|---|---|---|---|
| Zonas 0 a 4 e faixas de ag (0,025 g a 0,15 g) | igual | `SEISMIC_ZONES` | ✔ | [24] [25] |
| Ca e Cv por classe de terreno (A a E) e ag | igual | `CA`, `CV` | ◐ | [24]; classe E conferida também para a edição de 2023 em [26] |
| Interpolação linear entre 0,10 g e 0,15 g | igual | `soilFactors()` | ◐ | resumo de busca de um TCC |
| Ramos do espectro: ags0·(18,75·T·Ca/Cv + 1); 2,5·ags0; ags1/T | igual | `designSpectrum()` | ✔ | [24] [25] |
| Esforços × I/R; deslocamentos × Cd/R | I/R; Cd = R | `seismicCase()` | ✎ ◐ | [26] |
| Aceleração vertical: 50% da horizontal | igual | `seismicCase()` | ? | não conferido nesta rodada |
| Direções: 100% + 30% | igual | `seismicCase()` | ? | não conferido nesta rodada |
| R e I | dados do usuário | `DEFAULT_SITE` | — | a NBR 15421 trata de edifícios e não traz R para pontes |

## NBR 8800 — aço

| Coeficiente | Valor no código | Onde | Situação | Fontes |
|---|---|---|---|---|
| γa1 = 1,10 | igual | `checks/nbr8800.ts` | ◐ | [2] |
| E = 200 GPa; G = 77 GPa | igual | `templates/builder.ts` | ? | valores de uso corrente; não conferidos nesta rodada |
| Dilatação térmica do aço: 1,2·10⁻⁵/°C | igual | `thermalAlpha()` | ? | não conferido nesta rodada |

## Cabos, estais e pendurais

Não há norma ABNT para estais. Os critérios vêm de recomendações internacionais, que **não foram conferidas em fonte pública nesta rodada**: os documentos são pagos (PTI DC45.1, fib Bulletin 30) ou não foram localizados (recomendações do SETRA).

| Critério | Valor no código | Onde | Situação |
|---|---|---|---|
| Serviço: T ≤ 0,45·Fu | igual | `analyze.ts` | ? — a única confirmação obtida é indireta: o adendo de 2014 do PTI DC45.1-12 fixa em 0,45·f's a tensão superior dos ensaios de fadiga de qualificação |
| ELU: 1,35·G + 1,5·Q ≤ 0,65·Fu | igual | `analyze.ts` | ? |
| Extradorso: até 0,60·fptk quando a variação de tensão é pequena | só informado na descrição do modelo | `templates/index.ts` | ? |
| E de cordoalhas: 195 GPa; de fios paralelos: 200 GPa | igual | `templates/builder.ts`, modelos | ? |

## Aerodinâmica e passarelas

| Critério | Valor no código | Onde | Situação |
|---|---|---|---|
| Flutter de Selberg: Vcr = 3,71·fT·B·√[m·r/(ρ·B³)·(1 − (fV/fT)²)] | igual | `selbergFlutter()` | ? — a constante não foi achada em fonte pública; os testes conferem a expressão contra a forma alternativa 0,44·B·√[(ωT² − ωV²)·√ν/μ], e as duas fecham |
| Fatores de forma da seção (0,35 a 1,0) | indicativos | `flutterShapeFactor()` | ? |
| Divergência torcional com dCm/dα = π/2 | placa plana | `torsionalDivergence()` | ? |
| Strouhal de tabuleiros: 0,12 | igual | `checks/aero.ts` | ? |
| Faixas críticas do passo: vertical 1,6 a 2,4 Hz; lateral 0,8 a 1,2 Hz | igual | `PEDESTRIAN_RANGES` | ? — são as faixas clássicas da bibliografia; guias mais recentes (Sétra, HiVoSS) usam faixas um pouco mais largas, não conferidas |
| NBR 6118, Tabela 23.1: frequência crítica de passarelas de 4,5 Hz | só citado | `checks/pedestrian.ts` | ? |

## O que continua dependendo do texto oficial

1. **Edições novas não lidas.** NBR 7188:2024, NBR 8681:2025, NBR 6123:2023 (capítulo de pontes), NBR 15421:2023 e a emenda de 2026 da NBR 6118.
2. **NBR 6118:2023, item 9.6.1.2.1.** O limite de σpi na operação de protensão mudou de formato; o valor exato depende da errata.
3. **NBR 6118, itens marcados com "?"**: Tabela 17.3, x/d, λ e αc para fck > 50, armadura transversal mínima, torção, pilares, fct,f, extremos da Tabela 8.4 e o processo simplificado de perdas progressivas.
4. **NBR 7187:2021.** Gradientes térmicos e demais prescrições específicas de pontes de concreto.
5. **Recomendações de estais** (PTI DC45.1, fib Bulletin 30, SETRA) e as referências de aerodinâmica.

## Fontes

1. ABECE — palestra "Considerações sobre a revisão da ABNT NBR 7188" (encontro mensal): http://www.abece.com.br/web/download/pdf/Palestra%20Encontro%20Mensal%20Junho.pdf
2. DNIT — IPR-751, Álbum de projetos-tipo de pontes semipermanentes, vol. 2 (memória de cálculo): https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-manuais/vigentes/publicacao_ipr_751_vol_2.pdf
3. A. A. Santos — TCC, UFS: https://ri.ufs.br/bitstream/riufs/15797/2/Alessandro_Alves_Santos.pdf
4. R. A. D. Rocha — TCC, UNIPAMPA, 2017: https://repositorio.unipampa.edu.br/bitstream/riu/1981/1/Raphael%20Alfredo%20Diniz%20Rocha%202017.pdf
5. Cópia do texto da NBR 7188:2013 disponível publicamente em página de material didático de terceiros (não oficial); usada só como conferência cruzada.
6. Trabalho da UFU sobre passarela metálica: https://repositorio.ufu.br/bitstream/123456789/32028/2/Verifica%c3%a7%c3%a3oDeDimensionamento.pdf
7. ABECE — "Publicada nova ABNT NBR 7188": https://site.abece.com.br/publicada-nova-abnt-nbr-7188/
8. "Ações e segurança em estruturas de madeira", Editora Científica, 2024 (reproduz as tabelas da NBR 8681:2003): https://downloads.editoracientifica.com.br/articles/240917637.pdf
9. Cópia do texto da NBR 8681:2003 disponível publicamente em site de terceiros (não oficial); usada só como conferência cruzada.
10. J. S. Camacho — "Concreto armado: estados limites de utilização", UNESP Ilha Solteira (edição antiga da norma): https://www.feis.unesp.br/Home/departamentos/engenhariacivil/nepae/estados-limites-de-servico.pdf
11. "Ação do vento segundo a NBR 6123/88", capítulo 6, Blucher Open Access: https://openaccess.blucher.com.br/download-pdf/243/3522
12. Tese da UFPB sobre velocidades de vento: https://repositorio.ufpb.br/jspui/bitstream/tede/5529/1/arquivototal.pdf
13. ISQ Brasil — "NBR 6123:2023: principais alterações na revisão da norma": https://isqbrasil.com.br/nbr-6123-principais-alteracoes-na-revisao-da-norma/
14. CAW — "Parâmetro S3 na NBR 6123 (1988/2023)": https://caw.com.br/parametro-s3-na-nbr-6123-1988-2023
15. Calculista de Aço — "ABNT NBR 6123:2023, principais mudanças": https://calculistadeaco.com.br/wp-content/uploads/2023/12/Principais-Mudancas-NBR6123-23.pdf
16. P. S. S. Bastos — "Fundamentos do concreto armado", UNESP Bauru (segue a NBR 6118:2023; lido pela cópia do Internet Archive): https://wwwp.feb.unesp.br/pbastos/concreto1/Fundamentos%20CA.pdf
17. DNIT — IPR RP-036, estudo comparativo da mudança dos critérios de projeto: https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/relatorios-de-pesquisa-1/ipr_rp_036_estudo-comparativo-da-mudanca-dos-criterios-de-projeto.pdf
18. E. O. Couto — TCC, IFS, sobre as alterações das normas de concreto (2014 → 2023): https://repositorio.ifs.edu.br/biblioteca/bitstream/123456789/2012/1/TCC-Eduardo%20Couto.pdf
19. Trabalho da UFU sobre as atualizações da NBR 6118: https://repositorio.ufu.br/bitstream/123456789/38372/1/Atualiza%C3%A7%C3%B5esABNTNBR.pdf
20. Sienge — "O que é a NBR 6118" (valores de ηc por classe): https://sienge.com.br/blog/nbr-6118/
21. Projeto de graduação da Escola Politécnica da UFRJ sobre longarina protendida: https://pantheon.ufrj.br/bitstream/11422/9684/1/monopoli10007004.pdf
22. TCC da UTFPR sobre dimensionamento de vigas protendidas: https://riut.utfpr.edu.br/jspui/bitstream/1/6156/1/concretoprotendidodimensionamentovigas.pdf
23. PUC-Rio, Sistema Maxwell — capítulo "Protensão": https://www.maxwell.vrac.puc-rio.br/27386/27386_3.PDF
24. Dissertação da Escola Politécnica da UFRJ (NBR 15421:2006): http://www.repositorio.poli.ufrj.br/dissertacoes/dissertpoli603.pdf
25. Dissertação da Escola Politécnica da UFRJ (comparação de normas sísmicas): http://www.repositorio.poli.ufrj.br/dissertacoes/dissertpoli855.pdf
26. Master em Modelagem — comparativo entre a NBR 15421:2023 e o Eurocode 8: https://www.masteremmodelagem.com.br/post/dimensionamento-de-estruturas-resistentes-a-sismos-comparativo-entre-a-nbr-15421-2023-e-o-eurocode

Outras notícias consultadas: ABECE sobre a NBR 6123:2023 (https://site.abece.com.br/em-vigor-a-nova-nbr-6123/) e sobre a NBR 8681:2025 (https://site.abece.com.br/em-vigor-a-nova-nbr-8681/).
