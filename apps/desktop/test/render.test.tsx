/**
 * Fumaça de renderização (sem DOM): cada tabela do editor e a barra de exportação montam
 * sem lançar exceção, com modelo grande, modelo sem cabos e modelo sem faixas/cargas.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { PRESETS, generateModel, type BridgeModel } from '@opengirder/engine'

// o store aplica o tema no <html> ao ser criado
;(globalThis as Record<string, unknown>).document = { documentElement: { dataset: {} } }

const load = async () => {
  const tab = await import('../src/panels/features/DataTab')
  const bar = await import('../src/panels/features/TopBarExtras')
  const { useStore } = await import('../src/store')
  return { tab, bar, useStore }
}

const models: [string, BridgeModel][] = [
  ['golden-gate', generateModel(PRESETS.find((p) => p.id === 'golden-gate')!.template)],
  ['viaduto', generateModel(PRESETS.find((p) => p.id === 'viaduto')!.template)],
  ['vazio', { schema: 'opengirder/1', name: 'vazio', type: 'girder', nodes: [], materials: [], sections: [], elements: [], loadCases: [], lanes: [] }],
]

describe.each(models)('editor de dados — %s', (_name, model) => {
  it('todas as sub-abas renderizam', async () => {
    const { tab, bar, useStore } = await load()
    useStore.setState({ model, results: null })
    const withLoads: BridgeModel = {
      ...model,
      loadCases: [
        ...model.loadCases,
        { id: 'X', name: 'extra', nodal: model.nodes[0] ? [{ node: model.nodes[0].id, F: [0, 0, -10, 0, 0, 0] }] : [], uniform: [] },
      ],
    }
    const html = [
      renderToString(<tab.DataTab model={model} />),
      renderToString(<tab.NodesTable model={model} />),
      renderToString(<tab.FramesTable model={model} />),
      renderToString(<tab.CablesTable model={model} />),
      renderToString(<tab.SectionsTable model={model} />),
      renderToString(<tab.MaterialsTable model={model} />),
      renderToString(<tab.LoadsPanel model={withLoads} />),
      renderToString(<bar.TopBarExtras />),
    ].join('')
    expect(html).not.toMatch(/NaN|undefined|\[object Object\]/)
    // paginação: no máximo 200 linhas por tabela
    const nodesHtml = renderToString(<tab.NodesTable model={model} />)
    expect((nodesHtml.match(/<tr data-id/g) ?? []).length).toBe(Math.min(200, model.nodes.length))
  })
})

describe('desfazer / refazer', () => {
  it('updateModel empilha, undo/redo percorrem e carregar outro modelo limpa a pilha', async () => {
    const { useStore } = await load()
    const m0 = models[1][1]
    useStore.getState().loadModel(m0)
    expect(useStore.getState().past.length).toBe(0)
    useStore.getState().updateModel((m) => ({ ...m, name: 'a' }))
    useStore.getState().updateModel((m) => ({ ...m, name: 'b' }))
    expect(useStore.getState().past.length).toBe(2)
    useStore.getState().undo()
    expect(useStore.getState().model!.name).toBe('a')
    expect(useStore.getState().future.length).toBe(1)
    useStore.getState().redo()
    expect(useStore.getState().model!.name).toBe('b')
    useStore.getState().undo()
    useStore.getState().undo()
    expect(useStore.getState().model!.name).toBe(m0.name)
    useStore.getState().undo() // pilha vazia: não faz nada
    expect(useStore.getState().model!.name).toBe(m0.name)
    useStore.getState().updateModel((m) => ({ ...m, name: 'c' }))
    expect(useStore.getState().future.length).toBe(0)
    for (let i = 0; i < 40; i++) useStore.getState().updateModel((m) => ({ ...m, name: `n${i}` }))
    expect(useStore.getState().past.length).toBe(30)
    useStore.getState().loadModel(m0)
    expect(useStore.getState().past.length + useStore.getState().future.length).toBe(0)
  })
})
