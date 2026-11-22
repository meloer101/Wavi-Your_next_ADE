/* The board's loop as data (PRD v1.227 ②): four hand-offs, then a reset back to the first picture, so the board never
   drifts. Pure — no DOM: `Board.astro`'s script applies a state to the DOM and FLIPs the cards between columns;
   `board-cycle.test.ts` checks the script against the real copy. A card's status is the column it sits in: the column
   decides its glyph, its status line and whether it draws in brand. */

/** A column of the board, in the page's order: needs you, error, to review, running, idle. */
export type Column = 0 | 1 | 2 | 3 | 4
/** A status: the glyph of a column, and the only one drawn in brand is `needs`. */
export type Status = 'needs' | 'error' | 'review' | 'running' | 'idle'

/** The status each column carries, in the page's order. */
export const COLUMNS: readonly Status[] = ['needs', 'error', 'review', 'running', 'idle']

/** How long one step is held; the script also holds the first picture and the reset for it. */
export const STEP_MS = 2500

export interface Move {
  /** The card that moves, by its id in `copy[lang].board.cards`. */
  card: string
  /** The column it lands in; its glyph, status line and colour become that column's. */
  to: Column
  /** The macOS notification in the corner drops again, carrying this card's title and status. */
  notify?: boolean
}

/** a. a Running card → To review; b. Idle `main` → Running; c. a Running card → Needs you; d. it → Running (answered). */
export const MOVES: readonly Move[] = [
  { card: 'checkout', to: 2 },
  { card: 'main', to: 3 },
  { card: 'refresh', to: 0, notify: true },
  { card: 'refresh', to: 3 }
]

/** The steps a loop has: the first picture, one per move, then one that puts every card back where it started. */
export const STEP_COUNT = MOVES.length + 2

export interface BoardState {
  /** Card ids per column, in the order the cards are drawn. */
  columns: string[][]
  /** The notification: whose title it carries, and whether it lands again on this step. */
  notice: { card: string; kind: Status; drop: boolean }
}

/** The board after `step` steps: `MOVES[0]` has landed at step 1, every move at step `MOVES.length`, and the last
    step, `STEP_COUNT - 1`, is the first picture again. */
export function stateAt(step: number, initial: readonly (readonly string[])[]): BoardState {
  if (initial.length !== COLUMNS.length) {
    throw new Error(`the board has ${COLUMNS.length} columns, the layout ${initial.length}`)
  }
  const columns = initial.map((ids) => [...ids])
  const seen = new Set<string>()
  for (const ids of columns) {
    for (const id of ids) {
      if (seen.has(id)) throw new Error(`card ${id} is in the layout twice`)
      seen.add(id)
    }
  }
  const first = columns[0][0]
  if (first === undefined) throw new Error('the needs-you column has no card to notify about')

  // The reset step is the first picture again: it applies no move at all.
  const at = ((step % STEP_COUNT) + STEP_COUNT) % STEP_COUNT
  let applied = 0
  let notice = { card: first, kind: COLUMNS[0], drop: false }
  for (; applied < (at > MOVES.length ? 0 : at); applied++) {
    const move = MOVES[applied]
    const from = columns.findIndex((ids) => ids.includes(move.card))
    if (from < 0) throw new Error(`card ${move.card} is not on the board`)
    if (move.to < 0 || move.to >= COLUMNS.length) throw new Error(`column ${move.to} does not exist`)
    columns[from].splice(columns[from].indexOf(move.card), 1)
    columns[move.to].push(move.card)
    if (move.notify) {
      notice = { card: move.card, kind: COLUMNS[move.to], drop: applied === at - 1 }
    }
  }
  return { columns, notice }
}
