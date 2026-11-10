# Roadmap

## Feito

### v0.4

- Tabuleiro em grelha para pontes de vigas múltiplas (longarinas, faixas de laje, transversinas), com repartição transversal da carga móvel
- Fluência e retração (NBR 6118, Anexo A): efeitos diferidos na obra pronta, nas perdas de protensão e por fase construtiva
- Conferência dos coeficientes de norma em fontes públicas, com cinco correções (docs/normas.md)

### v0.3

- Editor gráfico: modelo em branco, desenho de nós, barras e cabos no 3D, seleção múltipla, mover, propriedades da seleção
- Operações de modelagem: linha de barras, geração de estais e pendurais, copiar, espelhar, girar, dividir, unir nós
- Pistas de carga móvel automáticas, biblioteca de materiais e seções, diagnóstico do modelo

### v0.2

- Casos de carga linearizados: temperatura, vento NBR 6123, frenagem NBR 7188, sismo NBR 15421
- Combinações NBR 8681 (ELU, ELU excepcional, ELS rara, frequente e quase permanente)
- Protensão do tabuleiro: traçado, perdas, hiperestático, verificação de tensões e pré-dimensionamento
- Seções por geometria (caixão, vigas T, laje, mistas, torres) e verificação NBR 6118 e NBR 8800
- Flambagem global, triagem aerodinâmica (flutter, divergência, vórtices) e conforto de passarelas
- Fases construtivas de estaiadas por análise regressiva
- Pontes em arco (inferior, superior, atirantado, intermediário), extradorso e passarelas
- Editor de dados com desfazer e refazer; exportação DXF, CSV, JSON e PNG; memorial de cálculo
- Versão web no GitHub Pages e instaladores para Windows, macOS e Linux

### v0.1

- Motor não linear geométrico: barra corrotacional, cabo de catenária elástica, Newton-Raphson
- Form-finding de estaiadas e pênseis; dimensionamento dos estais
- Análise modal no estado deformado
- Carga móvel NBR 7188 (TB-450, TB-240) por linhas de influência
- Geradores paramétricos: viga contínua, estaiada, pênsil
- Modelos de referência: Golden Gate, Estaiada de São Paulo, Rio Negro
- Interface 3D: deformada, trações, diagramas, modos animados, envoltórias, linhas de influência

## Próximo

1. **Grelha, 2ª etapa** — duas vigas de borda em estaiadas e pênseis, protensão por longarina, laje ortotrópica e elementos de casca; calibrar J e o raio de giração da Golden Gate (o modo torcional depende desses dois parâmetros, não da topologia)
2. **Análise progressiva no tempo** — fases com redistribuição acumulada, retensionamento de estais, balanços sucessivos de vigas, relaxação dos estais
3. **Normas, 2ª etapa** — conferir no texto oficial o que ficou só em fonte pública; incorporar NBR 7188:2024, NBR 8681:2025, NBR 15421:2023 e o capítulo de pontes da NBR 6123:2023
4. **Verificações completas** — fadiga, fissuração, efeitos locais de 2ª ordem em pilares, flambagem local e lateral do aço (NBR 8800, NBR 16694)
5. **Protensão por tramos** — vários cabos por seção, emendas, protensão externa e de estais extradorso
6. **Infraestrutura** — aparelhos de apoio, encontros, fundações com molas de solo
7. **Editor gráfico, 2ª etapa** — vista ortográfica, liberações de extremidade (rótulas), cargas desenhadas no 3D, importação de DXF
8. **Ferrovias** — trens-tipo da NBR 7189
9. **Exportação IFC**
10. **Inspeção e avaliação de pontes existentes** — NBR 9452, capacidade de carga de pontes antigas (TB-36, TB-45)
