# Roadmap

## Feito

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

1. **Tabuleiro em grelha** — distribuição transversal (vigas múltiplas, lajes), torção de seções abertas e treliçadas; fecha o modo torcional da Golden Gate
2. **Fluência e retração nas fases construtivas** — análise progressiva no tempo, retensionamento de estais, balanços sucessivos de vigas
3. **Conferência normativa** — revisar cada coeficiente contra o texto das normas (lista em VALIDATION.md) e implementar o capítulo de pontes da NBR 6123:2023
4. **Verificações completas** — fadiga, fissuração, efeitos locais de 2ª ordem em pilares, flambagem local e lateral do aço (NBR 8800, NBR 16694)
5. **Protensão por tramos** — vários cabos por seção, emendas, protensão externa e de estais extradorso
6. **Infraestrutura** — aparelhos de apoio, encontros, fundações com molas de solo
7. **Editor gráfico** — criar e mover nós e barras direto no 3D; liberações de extremidade
8. **Ferrovias** — trens-tipo da NBR 7189
9. **Exportação IFC** e importação de DXF
10. **Inspeção e avaliação de pontes existentes** — NBR 9452, capacidade de carga de pontes antigas (TB-36, TB-45)
