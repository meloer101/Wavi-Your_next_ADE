// Markdown tables in a GUI chat (PRD v1.237): a cell whose text is short stays on one line, the rest get a minimum
// width (Chat.module.css). Without it a short CJK cell (「已验证」, a 「状态」 header) is squeezed to one character a
// line, since CJK may break between any two characters. As Claude's desktop app marks cells of 20 characters or fewer
// `data-short`; here counted in display cells (CJK 2), so ten Chinese characters are short, not twenty. Pure.
import { cellWidth } from '../settings/preview-sample'

/** Display cells (CJK 2) at or under which a cell's text stays on one line. */
export const SHORT_CELL = 20

export const isShortCell = (text: string): boolean => cellWidth(text.trim()) <= SHORT_CELL

interface HastNode {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const textOf = (node: HastNode): string => (node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join(''))

/** Marks every short `th` / `td` with `data-short`, in place. */
export function markShortCells(node: HastNode): void {
  if (node.type === 'element' && (node.tagName === 'th' || node.tagName === 'td') && isShortCell(textOf(node))) {
    node.properties = { ...node.properties, dataShort: '' }
  }
  for (const child of node.children ?? []) markShortCells(child)
}

/** The rehype plugin: after sanitizing, so the mark is Wavi's, not the text's. */
export const rehypeShortCells = () => markShortCells
