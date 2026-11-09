import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRESETS, analyzeBridge, generateModel, type BridgeModel, type BridgeResults } from '@opengirder/engine'
import { buildDxf, csvNum, csvTables, csvText, resultsJson } from '../src/io/export'
import { buildReport } from '../src/report/build'
import { REPORT_SECTIONS } from '../src/report/sections'

/** REPORT_OUT=<pasta> grava os arquivos gerados p/ inspeção visual */
const OUT = process.env.REPORT_OUT

function run(id: string): { model: BridgeModel; results: BridgeResults } {
  const preset = PRESETS.find((p) => p.id === id)!
  const model = generateModel(preset.template)
  if (preset.reference) model.meta = { ...model.meta, reference: preset.reference }
  const results = analyzeBridge(model, {})
  return { model, results }
}

const cases = (process.env.REPORT_PRESETS ?? 'viaduto,estaiada-3-vaos').split(',')

describe.each(cases)('exportação e memorial — %s', (id) => {
  const { model, results } = run(id)

  it('DXF R12: seções, layers declaradas e uma LINE por elemento (ou mais, com flecha)', () => {
    const dxf = buildDxf(model, results, { nodes: true })
    const lines = dxf.split('\r\n')
    expect(lines.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'HEADER'])
    expect(lines[lines.length - 2]).toBe('EOF')
    // pares código/valor
    expect((lines.length - 1) % 2).toBe(0)
    const declared = new Set<string>()
    const used = new Set<string>()
    let nLine = 0
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i] === '0' && lines[i + 1] === 'LAYER') declared.add(lines[i + 3])
      if (lines[i] === '0' && lines[i + 1] === 'LINE') nLine++
      if (lines[i] === '8') used.add(lines[i + 1])
    }
    expect(nLine).toBeGreaterThanOrEqual(model.elements.length)
    for (const l of used) expect(declared.has(l)).toBe(true)
    expect(dxf).not.toMatch(/NaN|undefined/)
    const def = buildDxf(model, results, { deformed: true, scale: 50 })
    expect(def).toMatch(/_DEF/)
    expect(buildDxf(model, null)).toMatch(/ENTITIES/)
    if (OUT) writeFileSync(`${OUT}/${id}.dxf`, dxf)
  })

  it('CSV: colunas consistentes, BOM e vírgula decimal', () => {
    const tables = csvTables(model, results)
    expect(tables.length).toBeGreaterThanOrEqual(4)
    for (const t of tables) {
      for (const r of t.rows) expect(r.length, `${t.key}`).toBe(t.header.length)
      const text = csvText(t)
      expect(text.charCodeAt(0)).toBe(0xfeff)
      expect(text).not.toMatch(/NaN|undefined|\[object/)
      const first = text.split('\r\n')[1] ?? ''
      // nenhuma célula numérica com ponto decimal
      for (const cell of first.split(';')) expect(cell).not.toMatch(/^-?\d+\.\d+$/)
    }
    expect(csvNum(1234.5)).toBe('1234,5')
    expect(csvNum(NaN)).toBe('')
    expect(csvNum(-0.000012345)).toBe('-0,000012345')
    expect(csvNum(1.5e-9)).toBe('1,5E-9')
    // só modelo, sem resultados
    expect(csvTables(model, null).map((t) => t.key)).toEqual(['nodes', 'elements'])
    expect(JSON.parse(resultsJson(model, results, '0.0.0')).results.nNodes).toBe(results.nNodes)
  })

  it('memorial: HTML autônomo, sem valores inválidos, com todas as seções habilitadas', () => {
    const html = buildReport(model, results, { version: '0.0.0-teste', annexes: true, date: new Date(2026, 10, 9, 22, 30), fileName: `${id}.opengirder.json` })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/NaN|undefined|\[object Object\]|Infinity/)
    const enabled = REPORT_SECTIONS.filter((s) => s.enabled(model, results))
    for (const s of enabled) expect(html).toContain(`id="sec-${s.key}"`)
    expect(html).not.toContain('não pôde ser gerada')
    // sem anexos: mais curto e sem as seções de anexo
    const short = buildReport(model, results, { version: '0.0.0-teste' })
    expect(short.length).toBeLessThan(html.length)
    expect(short).not.toContain('id="sec-anexo-cabos"')
    if (OUT) {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(`${OUT}/${id}.html`, html)
    }
  })
})
