import { describe, expect, it } from 'vitest'
import { isShortCell, markShortCells } from './table-cells'

describe('isShortCell', () => {
  it('keeps short status and header words, in CJK or Latin, on one line', () => {
    for (const text of ['已验证', '状态', '偶发，非本次引起', '≈14px（「2h」）', 'Antigravity', ' npm run build ', '']) expect(isShortCell(text)).toBe(true)
  })

  it('lets sentences and paths wrap', () => {
    for (const text of ['左边是改前，右边是改后，三行之间有了呼吸感', 'e2e dispatch / session-meta / sidebar-projects', '/private/tmp/claude-501/scratchpad/rows-cmp.png'])
      expect(isShortCell(text)).toBe(false)
  })

  it('counts a CJK character as two cells: ten are short, eleven are not', () => {
    expect(isShortCell('一二三四五六七八九十')).toBe(true)
    expect(isShortCell('一二三四五六七八九十一')).toBe(false)
  })
})

describe('markShortCells', () => {
  it('marks short th and td, leaves long ones and other elements alone', () => {
    const cell = (tagName: string, value: string) => ({ type: 'element', tagName, properties: {}, children: [{ type: 'text', value }] })
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'table', properties: {}, children: [cell('th', '状态'), cell('td', '已验证'), cell('td', '左边是改前，右边是改后，三行之间有了呼吸感')] },
        cell('p', '短')
      ]
    }
    markShortCells(tree)
    const [table, p] = tree.children as unknown as [{ children: { properties: Record<string, unknown> }[] }, { properties: Record<string, unknown> }]
    expect(table.children.map((c) => 'dataShort' in c.properties)).toEqual([true, true, false])
    expect('dataShort' in p.properties).toBe(false)
  })
})
