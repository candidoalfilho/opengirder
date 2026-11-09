/**
 * Gravação de arquivos exportados. No app desktop (Tauri): diálogo nativo + escrita direta;
 * no navegador: download.
 */

import { isTauri } from '../platform'

export interface FileKind {
  name: string
  extensions: string[]
  mime: string
}

export const KIND_DXF: FileKind = { name: 'Desenho DXF', extensions: ['dxf'], mime: 'application/dxf' }
export const KIND_CSV: FileKind = { name: 'Planilha CSV', extensions: ['csv'], mime: 'text/csv;charset=utf-8' }
export const KIND_JSON: FileKind = { name: 'JSON', extensions: ['json'], mime: 'application/json' }
export const KIND_HTML: FileKind = { name: 'Documento HTML', extensions: ['html'], mime: 'text/html;charset=utf-8' }
export const KIND_PNG: FileKind = { name: 'Imagem PNG', extensions: ['png'], mime: 'image/png' }

function browserDownload(data: BlobPart, name: string, mime: string): void {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Salva um arquivo de texto. Devolve o caminho/nome gravado, ou null se o usuário cancelou. */
export async function saveText(name: string, text: string, kind: FileKind): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({ title: 'Exportar', defaultPath: name, filters: [{ name: kind.name, extensions: kind.extensions }] })
    if (!path) return null
    await writeTextFile(path, text)
    return path
  }
  browserDownload(text, name, kind.mime)
  return name
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Salva uma imagem dada como data URL (PNG). */
export async function saveDataUrl(name: string, dataUrl: string, kind: FileKind = KIND_PNG): Promise<string | null> {
  const bytes = dataUrlBytes(dataUrl)
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({ title: 'Exportar imagem', defaultPath: name, filters: [{ name: kind.name, extensions: kind.extensions }] })
    if (!path) return null
    await writeFile(path, bytes)
    return path
  }
  browserDownload(bytes as unknown as BlobPart, name, kind.mime)
  return name
}

/**
 * Salva vários arquivos de texto de uma vez. Desktop: pergunta UMA pasta e grava todos nela.
 * Navegador: downloads em sequência (o navegador pode pedir permissão p/ vários downloads).
 * Devolve quantos foram gravados, ou null se cancelado.
 */
export async function saveManyText(files: { name: string; text: string }[], kind: FileKind): Promise<number | null> {
  if (files.length === 0) return 0
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const dir = await open({ title: 'Pasta de destino', directory: true, multiple: false })
    if (!dir || Array.isArray(dir)) return null
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    for (const f of files) await writeTextFile(`${dir}${dir.endsWith(sep) ? '' : sep}${f.name}`, f.text)
    return files.length
  }
  for (const f of files) {
    browserDownload(f.text, f.name, kind.mime)
    await new Promise((r) => setTimeout(r, 220))
  }
  return files.length
}
