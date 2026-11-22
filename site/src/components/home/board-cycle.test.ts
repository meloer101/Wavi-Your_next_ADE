// The board's looping script (PRD v1.227 ②), checked against the real copy: every card the script moves exists on the
// board in both languages, the columns it moves them to exist, the counts add up on every step, and the reset step is
// the first picture again so the board cannot drift. Run with `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copy } from '../../i18n.ts'
import { COLUMNS, MOVES, STEP_COUNT, STEP_MS, stateAt, type BoardState } from './board-cycle.ts'

const layout = (lang: 'en' | 'zh'): string[][] => copy[lang].board.cards.map((cards) => cards.map((card) => card.id))
const ids = (state: BoardState): string[] => state.columns.flat()
const count = (state: BoardState): number[] => state.columns.map((cards) => cards.length)

test('the ids the script moves are on the board, in both languages', () => {
  const en = layout('en')
  assert.deepEqual(layout('zh'), en, 'both languages lay the board out the same way')
  for (const move of MOVES) {
    assert.ok(
      en.flat().includes(move.card),
      `card ${move.card} is not on the board (${en.flat().join(', ')})`
    )
    assert.ok(Number.isInteger(move.to) && move.to >= 0 && move.to < COLUMNS.length, `column ${move.to}`)
    if (move.notify) assert.equal(move.to, 0, 'only a needs-you card notifies')
  }
})

test('every step is a board: each card once, one card moved per step', () => {
  const initial = layout('en')
  let previous = stateAt(0, initial)
  assert.deepEqual(previous.columns, initial, 'step 0 is the board as served')
  for (let step = 1; step < STEP_COUNT; step++) {
    const state = stateAt(step, initial)
    assert.deepEqual([...ids(state)].sort(), [...ids(previous)].sort(), `step ${step} keeps every card and no more`)
    assert.equal(new Set(ids(state)).size, ids(state).length, `step ${step} repeats a card`)
    const totals = count(state).reduce((a, b) => a + b, 0)
    assert.equal(totals, count(stateAt(0, initial)).reduce((a, b) => a + b, 0), `step ${step} count`)
    if (step < MOVES.length) {
      const moved = MOVES[step - 1]
      assert.ok(state.columns[moved.to].includes(moved.card), `step ${step} lands ${moved.card}`)
    }
    previous = state
  }
})

test('the script runs its four moves in order, then comes back to the first picture', () => {
  const initial = layout('en')
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((step) => count(stateAt(step, initial))),
    [
      [2, 1, 1, 2, 1], // as served
      [2, 1, 2, 1, 1], // a Running card → To review
      [2, 1, 2, 2, 0], // Idle main → Running
      [3, 1, 2, 1, 0], // a Running card → Needs you
      [2, 1, 2, 2, 0], // answered → Running
      [2, 1, 1, 2, 1] // the reset
    ]
  )
  assert.deepEqual(stateAt(STEP_COUNT, initial), stateAt(0, initial), 'the reset step is the first picture')
  assert.deepEqual(stateAt(MOVES.length, initial).columns[3], ['main', 'refresh'], 'all four moves landed')
  assert.deepEqual(stateAt(STEP_COUNT + 1, initial), stateAt(1, initial), 'the loop continues after the reset')
  assert.deepEqual(stateAt(-1, initial), stateAt(STEP_COUNT - 1, initial), 'a negative step wraps')
})

test('the notification lands again only when a card asks for you', () => {
  const initial = layout('en')
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((step) => stateAt(step, initial).notice),
    [
      { card: 'cookie', kind: 'needs', drop: false },
      { card: 'cookie', kind: 'needs', drop: false },
      { card: 'cookie', kind: 'needs', drop: false },
      { card: 'refresh', kind: 'needs', drop: true },
      // After it is answered the notification stays up with the words it landed with, then the reset restores it.
      { card: 'refresh', kind: 'needs', drop: false },
      { card: 'cookie', kind: 'needs', drop: false }
    ]
  )
})

test('the cards that move end in a column whose status they take', () => {
  const initial = layout('en')
  const at = (step: number) => {
    const state = stateAt(step, initial)
    return (id: string) => COLUMNS[state.columns.findIndex((cards) => cards.includes(id))]
  }
  assert.equal(at(0)('checkout'), 'running')
  assert.equal(at(1)('checkout'), 'review')
  assert.equal(at(2)('main'), 'running')
  assert.equal(at(3)('refresh'), 'needs')
  assert.equal(at(4)('refresh'), 'running', 'answered')
  assert.equal(at(STEP_COUNT)('checkout'), 'running', 'the reset puts the statuses back too')
})

test('the step is held long enough to read', () => {
  assert.ok(STEP_MS >= 2000 && STEP_MS <= 3000, `${STEP_MS}ms per step`)
})
