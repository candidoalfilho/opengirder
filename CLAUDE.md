# CLAUDE.md

OpenGirder — análise de pontes (vigas, estaiadas, pênseis) com normas ABNT. Gratuito, MIT. Irmão do HyperFrame.

## Comandos

```bash
npm run dev                              # interface em http://localhost:5193
npm test                                 # testes do motor e da interface (vitest)
npm run typecheck                        # tsc nos dois pacotes
npm run build                            # typecheck + vite build
npm run presets -w @opengirder/engine    # resumo numérico dos modelos de referência
npm run sweep -w @opengirder/engine      # 27 variações de gabarito — rodar após mexer em form-finding ou geradores
```

## Arquitetura

- `packages/engine` — TypeScript puro, **zero dependências, zero DOM**. Tudo que entra e sai é JSON (vai para Web Worker e para arquivo).
- `apps/desktop` — Tauri 2 + React 19 + three.js (R3F) + Zustand. A análise roda em `src/workers/analysis.worker.ts`.
- Contrato entre os dois: `model/types.ts`, `analysis/types.ts`, `templates/types.ts` e `index.ts` do motor.

Pipeline de `analyzeBridge`: form-finding → carga permanente não linear → modal → carga móvel → verificação dos cabos → extensões (casos adicionais e protensão → combinações NBR 8681 → verificação de seções, flambagem, aerodinâmica, fases). Com `sizeCables`, repete até o número de cordoalhas estabilizar; as extensões só rodam no passe final.

## Como estender

- **Caso de carga novo** (temperatura, vento, protensão…): montar um `CaseLoad` e resolver com `ctx.lin.solve()` (`analysis/linear.ts`) — incrementos linearizados sobre a tangente do estado permanente. Empurrar um `LoadCaseResult` em `ctx.cases` no marcador `[ext:casos]` de `analyze.ts`.
- **Pós-processamento novo** (verificação, estabilidade, fases): função `runX(ctx)` chamada no marcador `[ext:verificacoes]`, escrevendo um campo opcional novo em `BridgeResults`. Envolver em `guard('Nome', () => …)` para uma falha virar aviso, não erro.
- **Aba nova no painel direito**: componente em `apps/desktop/src/panels/features/` + uma entrada em `panels/registry.tsx`.
- **Operação de modelagem nova** (editor gráfico): função pura em `apps/desktop/src/editor/ops.ts` + uma entrada em `EDIT_ACTIONS` (`editor/actions.ts`); o menu Operações e o formulário saem do registro. O motor só exige de um modelo feito à mão o grupo de cada elemento (tabuleiro, torre, estai…) e uma pista (criada sozinha ao analisar).
- **Editar dados de entrada pela interface**: `useStore.getState().updateModel(fn)` (descarta resultados). **Mostrar um campo de deslocamentos no 3D**: `showOverlay({ label, u, animate, hideElements })`.

## Convenções

- Interface e comentários em pt-BR; decimais com vírgula na tela.
- Unidades internas: m, kN, kPa, t. Eixos globais: X ao longo da ponte, Y transversal, Z para cima.
- Barras: eixo y local = projeção de +Z (barras verticais: +X). No tabuleiro, Mz/Vy são a flexão vertical; Mz > 0 traciona a fibra inferior.
- Cabos: o cabo exerce (H·e, V0) no nó I e −(H·e, Vj) no nó J; `fI`/`fJ` são forças internas (sinal oposto).
- Vetores "por nó" seguem a ordem de `model.nodes`: `u[6*i + d]`.

## Coisas que já deram errado (não repetir)

- **Rotações como vetor aditivo de 1ª ordem** na barra corrotacional: com transversinas rígidas o erro de 2ª ordem vira momento espúrio enorme e o Newton trava. A cinemática usa Rodrigues exato (`rotateTriad`).
- **Busca linear pela norma do resíduo**: sobe num passo bom por causa das ligações rígidas. Usa-se busca em energia.
- **Form-finding só por deslocamento nulo**: mal condicionado junto a apoios que recalcam (estai com 10× a força, vizinhos frouxos). **Só por mínima energia de flexão**: zigue-zague de forças. O que funciona está documentado no cabeçalho de `formfinding/formFinding.ts`.
- **Linha de influência nodal vale 0 sobre o apoio**; o limite pela esquerda e pela direita não. `loads/moving.ts` duplica os pontos de apoio.
- **Catenária com H → 0** (pendural vertical): as fórmulas ingênuas cancelam. Usar as formas estáveis de `catenaryFlex`.
- **Montantes curtos monolíticos em arco inferior** atraem momentos enormes do movimento relativo arco–tabuleiro: o gerador os faz pendulares abaixo de 10× a largura.
- **Ancoragens de harpa em cotas quase iguais** dos dois lados da torre geravam barras de milímetros: cotas a menos de 0,6 m são unificadas.
- **Lockfile gerado no macOS sem os pacotes opcionais das outras plataformas** (`@esbuild/*`): quebra o `npm ci` no CI. Regenerar o lock numa pasta sem `node_modules`.
- Primeiro estai muito longe da torre (mais de ~2× o espaçamento) descarrega o segundo — é física, não bug.

## Regras

- Não portar código de OpenSees, PGSuper nem de projetos GPL/AGPL (o projeto é MIT).
- Propriedades de obras reais são estimativas: sempre dizer "inspirado em", nunca afirmar que reproduz o projeto.
- Toda mudança no motor passa por `npm test` e `npm run sweep`.
- Coeficientes de norma: citar item e edição no cabeçalho do arquivo; o que não foi conferido no texto oficial entra na lista de VALIDATION.md.
- Publicação: push na `main` republica o site (GitHub Pages); tag `v*` gera os instaladores e o Release.
