/** Formatação numérica pt-BR (vírgula decimal) — toda a UI passa por aqui. */

export function fmt(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** nº de casas escolhido pela magnitude (≈ 3–4 algarismos significativos) */
export function fmtAuto(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (a >= 1000) return fmt(v, 0)
  if (a >= 100) return fmt(v, 1)
  if (a >= 1) return fmt(v, 2)
  if (a >= 0.01) return fmt(v, 4)
  return v.toLocaleString('pt-BR', { maximumSignificantDigits: 3 })
}

export function fmtInt(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—'
  return Math.round(v).toLocaleString('pt-BR')
}

/** número → texto editável (sem separador de milhar, vírgula decimal) */
export function numToInput(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return ''
  const s = Number(v.toPrecision(10)).toString()
  return s.includes('e') ? s : s.replace('.', ',')
}

/** aceita "1.234,5", "1234.5" e "1234,5" */
export function parseNum(text: string): number {
  let t = text.trim().replace(/\s/g, '')
  if (t === '') return NaN
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  return Number(t)
}

/** kPa → MPa */
export const mpa = (kpa: number): number => kpa / 1000

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${fmt(ms, 0)} ms`
  return `${fmt(ms / 1000, 2)} s`
}

export const GROUP_LABEL: Record<string, string> = {
  deck: 'Tabuleiro',
  tower: 'Torre',
  stay: 'Estais',
  'main-cable': 'Cabo principal',
  hanger: 'Pendurais',
  pier: 'Pilares',
  rigid: 'Ligações rígidas',
  crossbeam: 'Transversinas',
  other: 'Outros',
}

export const TYPE_LABEL: Record<string, string> = {
  girder: 'Ponte de vigas',
  'cable-stayed': 'Ponte estaiada',
  suspension: 'Ponte pênsil',
}

export const MATERIAL_KIND_LABEL: Record<string, string> = {
  concrete: 'Concreto',
  steel: 'Aço',
  cable: 'Cabo',
  rigid: 'Rígido',
}

export const MODE_KIND_LABEL: Record<string, string> = {
  vertical: 'Vertical',
  transversal: 'Transversal',
  longitudinal: 'Longitudinal',
  torcional: 'Torcional',
  misto: 'Misto',
}
