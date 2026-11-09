# OpenGirder

**Análise de pontes — vigas, estaiadas e pênseis — com as normas brasileiras. Gratuito e de código aberto (MIT).**

O OpenGirder modela e calcula pontes de verdade no seu computador: uma ponte pênsil de 1 280 m de vão (Golden Gate) roda em cerca de 1 segundo; uma estaiada com mastro em X, dois tabuleiros curvos e 144 estais (inspirada na Ponte Octávio Frias de Oliveira, em São Paulo), em cerca de 2 segundos.

É o irmão do [HyperFrame](https://github.com/candidoalfilho/hyperframe) (edifícios): mesma pilha, mesmo princípio — motor de cálculo próprio, sem dependências, auditável.

## O que ele calcula

| | |
|---|---|
| **Cabos** | Elemento de catenária elástica exata (Irvine) para estais, cabos principais e pendurais — flecha, afrouxamento e rigidez geométrica saem da formulação, sem módulo de Ernst |
| **Não linearidade geométrica** | Barras corrotacionais com rotação finita exata e rigidez geométrica (P-Δ e P-δ); Newton-Raphson com busca linear em energia |
| **Form-finding** | Comprimento indeformado de cada estai e pendural pelo método das reações de apoio rígido + greide + prumo da torre; forma do cabo de ponte pênsil por catenária trecho a trecho |
| **Dimensionamento dos estais** | Número de cordoalhas para 0,45·Fu em serviço e 0,65·Fu no ELU, com reanálise |
| **Modal** | Iteração por subespaço sobre a rigidez tangente do estado de carga permanente; massas efetivas e classificação do modo (vertical, transversal, longitudinal, torcional) |
| **Carga móvel NBR 7188** | TB-450 e TB-240 por linhas de influência de todas as respostas; CIV, CNF e CIA; envoltórias de esforços, de tração nos cabos e de flechas |
| **Verificações** | Estais, cabos principais e pendurais em ELS e ELU; variação de tensão para fadiga |

Modelos prontos: **Golden Gate**, **Estaiada de São Paulo**, **Ponte Rio Negro**, estaiada de três vãos e viaduto em viga caixão. Assistentes paramétricos geram qualquer variação — vãos, número de estais, harpa/leque/semi-leque, um ou dois planos de cabos, tabuleiro curvo, torre em X, tabuleiros gêmeos.

## Rodar

```bash
npm install
npm run dev          # abre em http://localhost:5193
npm test             # 27 testes do motor (soluções analíticas + modelos de referência)
npm run tauri dev    # aplicativo desktop (precisa do Rust)
```

A interface foi testada no navegador. O empacotamento desktop (Tauri) está configurado, mas ainda não foi compilado nesta versão.

O motor também roda sozinho, sem interface:

```ts
import { PRESETS, generateModel, analyzeBridge } from '@opengirder/engine'

const model = generateModel(PRESETS.find((p) => p.id === 'golden-gate')!.template)
const r = analyzeBridge(model, { modal: { modes: 12 }, sizeCables: true })

r.modal!.modes[0].period            // 20,88 s — 1º modo transversal
r.checks.cables[0].TG               // tração permanente no cabo (kN)
r.moving!.frames[0].Mz              // envoltória de momento por carga móvel
```

`npm run presets -w @opengirder/engine` imprime o resumo dos cinco modelos; `npm run sweep -w @opengirder/engine` roda 20 variações de gabarito.

## Estrutura

```
packages/engine    motor de cálculo — TypeScript puro, zero dependências, zero DOM
  src/analysis       skyline LDLᵀ, RCM, barra corrotacional, catenária, Newton, modal
  src/formfinding    form-finding dos cabos
  src/loads          NBR 7188: coeficientes, linhas de influência, envoltórias
  src/templates      geradores paramétricos e modelos de referência
  test               soluções analíticas e regressão dos modelos
apps/desktop       interface — Tauri 2 + React 19 + three.js; a análise roda em Web Worker
```

Unidades internas: m, kN, kPa. Eixos globais: X ao longo da ponte, Y transversal, Z para cima.

## Validação e limites

Cada peça do motor é conferida contra solução fechada, e os modelos de referência contra valores publicados — veja [VALIDATION.md](VALIDATION.md). Em resumo, para a Golden Gate: tração no cabo principal de 224 a 257 MN (publicado: 213 a 253 MN); 1º modo transversal em 20,88 s (referência 20,50 s); 1º vertical simétrico em 7,86 s (referência 7,81 s).

**O que ainda não faz** (ver [ROADMAP.md](ROADMAP.md)): fases construtivas, fluência e retração, protensão do tabuleiro, vento, sismo, temperatura, grelha/casca para distribuição transversal, dimensionamento de seções de concreto e aço. O tabuleiro é uma "espinha" de barras — adequado à análise global, não ao detalhamento da seção.

As propriedades de seção dos modelos de obras reais são **estimativas** a partir de dados públicos: os modelos servem para demonstrar e validar o motor, não para reavaliar aquelas obras. Como em qualquer programa de análise estrutural, o resultado é responsabilidade do engenheiro que o usa.

## Licença

MIT — use, modifique e distribua à vontade.
