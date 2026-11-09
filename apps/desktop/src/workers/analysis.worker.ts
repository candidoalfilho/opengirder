import { analyzeBridge, type AnalysisOptions, type BridgeModel, type BridgeResults } from '@opengirder/engine'

export interface AnalysisRequest {
  model: BridgeModel
  options: AnalysisOptions
}

export type AnalysisMessage =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; results: BridgeResults; elapsed: number }
  | { type: 'error'; error: string }

const post = (m: AnalysisMessage) => (self as unknown as Worker).postMessage(m)

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const { model, options } = e.data
  const t0 = performance.now()
  let last = 0
  let lastStage = ''
  try {
    const results = analyzeBridge(model, {
      ...options,
      // chamado de forma síncrona pelo engine; limita a ~30 mensagens/s
      onProgress: (stage: string, fraction: number) => {
        const now = performance.now()
        if (now - last < 33 && fraction < 1 && stage === lastStage) return
        last = now
        lastStage = stage
        post({ type: 'progress', stage, fraction })
      },
    })
    post({ type: 'done', results, elapsed: performance.now() - t0 })
  } catch (err) {
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
