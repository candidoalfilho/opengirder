/**
 * Blocos de HTML do memorial — funções puras (sem DOM). Quem escreve uma seção usa estes
 * auxiliares para manter tabelas, figuras e números com a mesma cara em todo o documento.
 */

import { fmt, fmtAuto, fmtInt } from '../format'

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** HTML já pronto (não é escapado ao entrar numa célula) */
export interface Raw {
  html: string
}
export const raw = (html: string): Raw => ({ html })

export type Cell = string | number | Raw | null | undefined

const cellHtml = (c: Cell): string => {
  if (c === null || c === undefined) return '—'
  if (typeof c === 'number') return fmtAuto(c)
  if (typeof c === 'string') return esc(c)
  return c.html
}

/** número com casas fixas e vírgula decimal ("—" se não finito) */
export const n = (v: number | null | undefined, digits = 2): string => {
  // evita "-0,0": valores que arredondam p/ zero saem sem sinal
  if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 0.5 * 10 ** -digits) return fmt(0, digits)
  return fmt(v, digits)
}
/** número com casas escolhidas pela magnitude */
export const na = (v: number | null | undefined): string => fmtAuto(v)
export const ni = (v: number | null | undefined): string => fmtInt(v)

export interface Col {
  label: string
  /** alinhamento: números à direita (padrão), texto à esquerda */
  left?: boolean
}

export interface TableOpts {
  /** linha(s) de rodapé (totais) */
  foot?: Cell[][]
  /** tabela densa (anexos) */
  compact?: boolean
  /** largura automática em vez de 100% */
  narrow?: boolean
  /** classe por linha (ex.: 'bad' p/ destacar reprovação) */
  rowClass?: (rowIndex: number) => string | undefined
}

export function table(cols: (string | Col)[], rows: Cell[][], opts: TableOpts = {}): string {
  const cs = cols.map((c) => (typeof c === 'string' ? { label: c } : c))
  const td = (c: Cell, i: number, tag: 'td' | 'th' = 'td'): string => `<${tag}${cs[i]?.left ? ' class="l"' : ''}>${cellHtml(c)}</${tag}>`
  const cls = ['t', opts.compact ? 'compact' : '', opts.narrow ? 'narrow' : ''].filter(Boolean).join(' ')
  const head = `<thead><tr>${cs.map((c) => `<th${c.left ? ' class="l"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>`
  const body = rows
    .map((r, k) => {
      const rc = opts.rowClass?.(k)
      return `<tr${rc ? ` class="${rc}"` : ''}>${r.map((c, i) => td(c, i)).join('')}</tr>`
    })
    .join('')
  const foot = opts.foot?.length ? `<tfoot>${opts.foot.map((r) => `<tr>${r.map((c, i) => td(c, i)).join('')}</tr>`).join('')}</tfoot>` : ''
  return `<table class="${cls}">${head}<tbody>${body}</tbody>${foot}</table>`
}

/** lista de pares rótulo–valor (duas colunas) */
export function kv(pairs: [string, Cell][]): string {
  const rows = pairs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${cellHtml(v)}</td></tr>`)
    .join('')
  return `<table class="kv">${rows}</table>`
}

export const p = (text: string): string => `<p>${text}</p>`
export const note = (text: string): string => `<p class="note">${text}</p>`
export const ul = (items: string[]): string => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`

/** selo aprovado / reprovado */
export const badge = (ok: boolean, yes = 'atende', no = 'não atende'): Raw =>
  raw(`<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? yes : no}</span>`)

/** expressão/equação em destaque */
export const eq = (text: string): string => `<div class="eq">${text}</div>`

/**
 * Contexto de renderização de uma seção: numera subtítulos, figuras e tabelas.
 * As seções podem ignorá-lo e devolver HTML simples.
 */
export class ReportContext {
  /** nº da seção em renderização ("4", "A"…) */
  num = ''
  private sub = 0
  private figN = 0
  private tabN = 0

  constructor(
    readonly opts: {
      version: string
      date: Date
      /** inclui os anexos com as tabelas completas */
      annexes: boolean
      /** imagem da vista 3D (data URL PNG), se capturada */
      image?: string | null
      fileName?: string | null
    },
  ) {}

  /** chamado pelo montador ao iniciar cada seção */
  begin(num: string): void {
    this.num = num
    this.sub = 0
  }

  /** subtítulo numerado: "4.2 Título" */
  h(title: string): string {
    this.sub++
    return `<h3><span class="num">${this.num}.${this.sub}</span> ${esc(title)}</h3>`
  }

  /** figura numerada com legenda */
  fig(content: string, caption: string): string {
    this.figN++
    return `<figure>${content}<figcaption><b>Figura ${this.figN}</b> — ${caption}</figcaption></figure>`
  }

  /** tabela numerada com título acima */
  tbl(caption: string, cols: (string | Col)[], rows: Cell[][], opts?: TableOpts): string {
    this.tabN++
    return `<div class="tblock"><div class="tcap"><b>Tabela ${this.tabN}</b> — ${caption}</div>${table(cols, rows, opts)}</div>`
  }
}
