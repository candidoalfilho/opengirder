/**
 * Capacidades da plataforma — ÚNICO ponto que decide o que é exclusivo do app
 * desktop (Tauri) e o que roda no navegador.
 *
 * Detecção: `__TAURI_INTERNALS__` injetado pelo WebView do Tauri. Override de
 * build: `VITE_WEB_BUILD=1` força o modo web mesmo dentro de um WebView.
 */

const forceWeb = ['1', 'true'].includes(String(import.meta.env.VITE_WEB_BUILD ?? '').toLowerCase())

export const isTauri = (): boolean =>
  !forceWeb && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface PlatformCaps {
  /** rodando no app desktop (Tauri) */
  native: boolean
  /** diálogos nativos de abrir/salvar + escrita direta em caminho absoluto */
  nativeFileDialogs: boolean
}

export const platform: PlatformCaps = (() => {
  const native = isTauri()
  return { native, nativeFileDialogs: native }
})()
