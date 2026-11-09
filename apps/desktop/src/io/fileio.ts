import type { BridgeModel } from '@opengirder/engine'
import { isTauri } from '../platform'

/**
 * Abrir/salvar modelo (.opengirder.json).
 *
 * No app desktop (Tauri): diálogos NATIVOS (plugin-dialog) + escrita direta no
 * caminho (plugin-fs) — "Salvar" grava no mesmo arquivo. No navegador: download
 * do arquivo e <input type="file"> p/ abrir.
 */

export const FILE_EXT = '.opengirder.json'
const FILTERS = [{ name: 'Modelo OpenGirder', extensions: ['json'] }]

export function suggestedName(model: BridgeModel): string {
  const base = model.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'ponte'
  return `${base}${FILE_EXT}`
}

export function serializeModel(model: BridgeModel): string {
  return JSON.stringify(model, null, 1)
}

/** valida o mínimo estrutural do arquivo; a validação de engenharia fica no engine */
export function parseModel(text: string): BridgeModel {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('O arquivo não é um JSON válido.')
  }
  const m = data as Partial<BridgeModel> | null
  if (!m || typeof m !== 'object' || typeof m.schema !== 'string' || !m.schema.startsWith('opengirder/')) {
    throw new Error('Este arquivo não é um modelo do OpenGirder (campo "schema" ausente).')
  }
  if (m.schema !== 'opengirder/1') {
    throw new Error(`Versão de arquivo não suportada: ${m.schema}. Atualize o OpenGirder.`)
  }
  if (!Array.isArray(m.nodes) || !Array.isArray(m.elements) || !Array.isArray(m.materials)) {
    throw new Error('Modelo incompleto: faltam nós, elementos ou materiais.')
  }
  return {
    ...(m as BridgeModel),
    sections: m.sections ?? [],
    loadCases: m.loadCases ?? [],
    lanes: m.lanes ?? [],
  }
}

function browserDownload(data: BlobPart, name: string, mime: string): string {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

/** "Salvar como…": sempre pergunta o destino. Retorna o caminho/nome ou null (cancelado). */
export async function saveModelAs(model: BridgeModel, currentPath?: string | null): Promise<string | null> {
  const text = serializeModel(model)
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({
      title: 'Salvar modelo',
      defaultPath: currentPath ?? suggestedName(model),
      filters: FILTERS,
    })
    if (!path) return null
    await writeTextFile(path, text)
    return path
  }
  return browserDownload(text, suggestedName(model), 'application/json')
}

/** "Salvar": grava direto no arquivo atual (Tauri, caminho conhecido); senão "Salvar como…". */
export async function saveModel(model: BridgeModel, filePath?: string | null): Promise<string | null> {
  if (isTauri() && filePath && /[\\/]/.test(filePath)) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(filePath, serializeModel(model))
    return filePath
  }
  return saveModelAs(model, filePath)
}

function pickFileInBrowser(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    let settled = false
    const done = (v: { name: string; text: string } | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(v)
    }
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return done(null)
      done({ name: f.name, text: await f.text() })
    }
    input.addEventListener('cancel', () => done(null))
    document.body.appendChild(input)
    input.click()
  })
}

/** Abre um modelo. Retorna null se o usuário cancelou; lança Error com mensagem em pt-BR se inválido. */
export async function openModel(): Promise<{ model: BridgeModel; path: string } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({ title: 'Abrir modelo', multiple: false, filters: FILTERS })
    if (!path || Array.isArray(path)) return null
    return { model: parseModel(await readTextFile(path)), path }
  }
  const picked = await pickFileInBrowser()
  if (!picked) return null
  return { model: parseModel(picked.text), path: picked.name }
}
