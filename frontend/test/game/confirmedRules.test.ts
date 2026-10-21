/**
 * 2026-10 规则确认后接入真实结算的规则：Q1 皇帝、Q2 力量、Q4 正义、Q10 德国心脏病、Q13 真心话大冒险拒绝。
 * 每条测试都断言共享游戏状态的实际变化。
 */
import { describe, expect, it } from 'vitest'
import { BOARD_CELLS, getPropertySetMembers, isEventCell, isPropertyCell } from '../../../shared/game/board'
import { buildLadyDeck, drawFromLadyDeck, heartAttackCheck, LADY_WINDOW_SIZE, seededRng } from '../../../shared/game/cards/ladyDeck'
import { initGameState } from '../../../shared/game/engine/initGame'
import { normalizeGameState } from '../../../shared/game/engine/normalize'
import { startCellIdForColor } from '../../../shared/game/engine/movement'
import { applyJusticeSwap, revealTarot } from '../../../shared/game/engine/tarotActions'
import { TAROT_ID } from '../../../shared/game/engine/tarotEffects'
import {
  applyResolveHeartAttack,
  applyResolveLanding,
  applyRevealLadyCard,
  applyRollDice,
  applyTruthOrDareChoice,
  applyTruthOrDareResult,
  GameActionError,
  truthOrDareRefusalPenalty,
} from '../../../shared/game/engine/turnEngine'
import type { GameRoomPlayer } from '../../../shared/gameRoomTypes'
import type { GameState } from '../../../shared/game/types'

const NOW = 7000
const HOST = 'u1'
const N = BOARD_CELLS.length

function players(n = 3): GameRoomPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ uid: `u${i + 1}`, nickname: `P${i + 1}`, seat: i, isHost: i === 0, joinedAt: 1 }))
}
function game(tarotId: string, n = 3): GameState {
  return initGameState(players(n), 1000, tarotId, () => 0)
}
function withPlayer(state: GameState, uid: string, patch: Partial<GameState['players'][string]>): GameState {
  return { ...state, players: { ...state.players, [uid]: { ...state.players[uid]!, ...patch } } }
}
function rollAndLand(state: GameState, uid: string, natural: number): GameState {
  return applyResolveLanding(applyRollDice(state, uid, natural, NOW), uid, NOW, () => 0).state
}
function atLadyCard(state: GameState, deck: string[], window: string[] = []): GameState {
  return { ...state, ladyDeck: deck, ladyDiscard: [...window], recentLadyCards: window, turn: { ...state.turn, phase: 'LADY_CARD' } }
}

// ---------------------------------------------------------------------------
// Q1 皇帝
// ---------------------------------------------------------------------------
describe('Q1 皇帝：集齐同色三处租金 3 → 4', () => {
  const set = getPropertySetMembers('R')
  const target = BOARD_CELLS.find((c) => isPropertyCell(c) && c.propertyName === set[0])!
  function landOn(tarotId: string, ownerProps: string[]): GameState {
    let s = withPlayer(game(tarotId), 'u2', { properties: ownerProps })
    s = withPlayer(s, 'u1', { position: (target.id - 1 + N) % N, coins: 10 })
    return rollAndLand(s, 'u1', 1)
  }

  it('full set under Emperor: payer −4, owner +4, and the settlement note shows the bonus', () => {
    const before = game(TAROT_ID.EMPEROR).players.u2!.coins
    const s = landOn(TAROT_ID.EMPEROR, set)
    expect(s.players.u1!.coins).toBe(6)
    expect(s.players.u2!.coins).toBe(before + 4)
    expect(s.turn.tarotNotes).toContain('皇帝：集齐同色三处，租金 3 → 4 金')
  })
  it('incomplete set under Emperor keeps the base rent (2 for two same-colour properties)', () => {
    expect(landOn(TAROT_ID.EMPEROR, set.slice(0, 2)).players.u1!.coins).toBe(8)
  })
  it('after Emperor is replaced, the full set goes back to 3', () => {
    expect(landOn(TAROT_ID.STAR, set).players.u1!.coins).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// Q2 力量
// ---------------------------------------------------------------------------
describe('Q2 力量：碰撞退 3 格、后退格退 1 格，两项独立不叠加', () => {
  const blank = BOARD_CELLS.find((c) => c.kind === 'blank' && c.id > 3)!.id

  it('collision victim moves back exactly 3 (not 1)', () => {
    let s = withPlayer(game(TAROT_ID.STRENGTH), 'u2', { position: blank })
    s = withPlayer(s, 'u1', { position: blank - 2 })
    expect(rollAndLand(s, 'u1', 2).players.u2!.position).toBe(blank - 3)
  })
  it('pushed-back victim does not chain into a new collision or trigger their new cell', () => {
    // u3 正好站在 u2 被撞后的落点上：不会因此再结算一次碰撞
    let s = withPlayer(game(TAROT_ID.STRENGTH), 'u2', { position: blank })
    s = withPlayer(s, 'u3', { position: blank - 3 })
    s = withPlayer(s, 'u1', { position: blank - 2 })
    const after = rollAndLand(s, 'u1', 2)
    expect(after.players.u3!.position).toBe(blank - 3)
    expect(after.pendingDrinkAcks.filter((a) => a.reason === '被撞')).toHaveLength(1)
  })
  it('Q15 (current behaviour, pending ruling): landing on an occupied start cell causes no collision', () => {
    const start = BOARD_CELLS.find((c) => c.kind === 'start' && c.id > 3)!.id
    let s = withPlayer(game(TAROT_ID.STAR), 'u2', { position: start })
    s = withPlayer(s, 'u1', { position: start - 2 })
    const after = rollAndLand(s, 'u1', 2)
    expect(after.players.u1!.position).toBe(start)
    expect(after.players.u2!.position).toBe(start)
    expect(after.pendingDrinkAcks.filter((a) => a.reason === '被撞')).toHaveLength(0)
  })
  it('"back 3" cell moves 1 under Strength and 3 without it', () => {
    const back = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'back')!
    const from = (back.id - 1 + N) % N
    const strength = rollAndLand(withPlayer(game(TAROT_ID.STRENGTH), 'u1', { position: from }), 'u1', 1)
    const plain = rollAndLand(withPlayer(game(TAROT_ID.STAR), 'u1', { position: from }), 'u1', 1)
    expect(strength.history.some((h) => h.message.includes('后退 1 格'))).toBe(true)
    expect(plain.history.some((h) => h.message.includes('后退 3 格'))).toBe(true)
  })
  it('without Strength, the victim returns to their own start', () => {
    let s = withPlayer(game(TAROT_ID.STAR), 'u2', { position: blank })
    s = withPlayer(s, 'u1', { position: blank - 2 })
    const after = rollAndLand(s, 'u1', 2)
    expect(after.players.u2!.position).toBe(startCellIdForColor(after.players.u2!.color))
  })
})

// ---------------------------------------------------------------------------
// Q4 正义
// ---------------------------------------------------------------------------
describe('Q4 正义：交换位置/顺序/金币/手牌，保留身份/地产/底牌/身份牌', () => {
  function justiceGame(): GameState {
    let s = game(TAROT_ID.STAR)
    s = withPlayer(s, 'u2', { coins: 9, tacticHand: ['tactic-sha', 'tactic-tao'], properties: ['命宫'], position: 10, identityCardId: 'id-u2' })
    s = withPlayer(s, 'u3', { coins: 1, tacticHand: [], properties: ['财帛宫'], position: 20, identityCardId: 'id-u3' })
    const r = revealTarot(s, TAROT_ID.JUSTICE, 'u1', NOW)
    return { ...r.state, turn: { ...r.state.turn, pendingDecision: r.followUp } }
  }

  it('swaps all four in one action and keeps everything else with the person', () => {
    const s = justiceGame()
    const holeU2 = s.players.u2!.texasHoleCards
    const colorU2 = s.players.u2!.color
    const after = applyJusticeSwap(s, HOST, HOST, 'u2', 'u3', NOW)
    expect(after.turnOrder).toEqual(['u1', 'u3', 'u2'])
    expect(after.players.u2).toMatchObject({ uid: 'u2', position: 20, coins: 1, tacticHand: [], properties: ['命宫'], identityCardId: 'id-u2', color: colorU2 })
    expect(after.players.u3).toMatchObject({ uid: 'u3', position: 10, coins: 9, tacticHand: ['tactic-sha', 'tactic-tao'], properties: ['财帛宫'], identityCardId: 'id-u3' })
    expect(after.players.u2!.texasHoleCards).toEqual(holeU2)
  })
  it('records a before snapshot for the UI', () => {
    const after = applyJusticeSwap(justiceGame(), HOST, HOST, 'u2', 'u3', NOW)
    expect(after.lastJusticeSwap).toMatchObject({
      winnerUid: 'u2',
      loserUid: 'u3',
      before: { u2: { position: 10, seatIndex: 1, coins: 9 }, u3: { position: 20, seatIndex: 2, coins: 1 } },
    })
  })
  it('cannot be applied twice (pending decision is consumed)', () => {
    const after = applyJusticeSwap(justiceGame(), HOST, HOST, 'u2', 'u3', NOW)
    expect(() => applyJusticeSwap(after, HOST, HOST, 'u3', 'u2', NOW)).toThrow(GameActionError)
  })
  it('host can record "no swap" when there is no unique winner/loser; nothing changes and no snapshot is written', () => {
    const s = justiceGame()
    const after = applyJusticeSwap(s, HOST, HOST, null, null, NOW)
    expect(after.players).toEqual(s.players)
    expect(after.lastJusticeSwap).toBeNull()
  })
  it('survives a refresh round trip', () => {
    const after = applyJusticeSwap(justiceGame(), HOST, HOST, 'u2', 'u3', NOW)
    const restored = normalizeGameState(JSON.parse(JSON.stringify(after)) as GameState)
    expect(restored.turnOrder).toEqual(after.turnOrder)
    expect(restored.lastJusticeSwap).toEqual(after.lastJusticeSwap)
  })
})

// ---------------------------------------------------------------------------
// Q10 德国心脏病（四花色 52 张）
// ---------------------------------------------------------------------------
describe('Q10 主牌牌堆', () => {
  it('has 52 unique cards: 4 suits × A–K', () => {
    const deck = buildLadyDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck).size).toBe(52)
    for (const suit of ['S', 'H', 'D', 'C']) expect(deck.filter((id) => id.startsWith(`${suit}-`))).toHaveLength(13)
  })
  it('a new game deals a shuffled full deck into shared state', () => {
    const s = game(TAROT_ID.STAR)
    expect(s.ladyDeck).toHaveLength(52)
    expect(new Set(s.ladyDeck)).toEqual(new Set(buildLadyDeck()))
    expect(s.recentLadyCards).toEqual([])
  })
  it('reveal draws the top card of the shared deck, not a client-side random card', () => {
    const s = atLadyCard(game(TAROT_ID.STAR), ['D-9', 'S-A'])
    const after = applyRevealLadyCard(s, 'u1', NOW).state
    expect(after.turn.revealedLadyCardId).toBe('D-9')
    expect(after.ladyDeck).toEqual(['S-A'])
    expect(after.ladyDiscard).toContain('D-9')
    expect(after.recentLadyCards).toEqual(['D-9'])
  })
  it('cannot reveal twice in a turn (no double draw on retry/refresh)', () => {
    const after = applyRevealLadyCard(atLadyCard(game(TAROT_ID.STAR), ['D-9', 'S-A']), 'u1', NOW).state
    expect(() => applyRevealLadyCard(after, 'u1', NOW)).toThrow(GameActionError)
  })
  it('window keeps only the latest 5 cards', () => {
    const s = atLadyCard(game(TAROT_ID.STAR), ['C-K'], ['S-A', 'S-2', 'S-3', 'S-4', 'S-5'])
    const after = applyRevealLadyCard(s, 'u1', NOW).state
    expect(after.recentLadyCards).toEqual(['S-2', 'S-3', 'S-4', 'S-5', 'C-K'])
    expect(after.recentLadyCards).toHaveLength(LADY_WINDOW_SIZE)
  })
  it('when the deck runs out, discarded cards not on the table are reshuffled back in', () => {
    const window = ['S-A', 'S-2', 'S-3', 'S-4', 'S-5']
    const draw = drawFromLadyDeck([], [...window, 'H-K', 'D-Q'], window, () => 0)
    expect(['H-K', 'D-Q']).toContain(draw.cardId)
    expect(draw.reshuffled).toBe(true)
    for (const id of window) expect(draw.deck).not.toContain(id)
  })
  it('legacy games get the same deck on every client (seeded by startedAt) and drop the suitless window', () => {
    const legacy = JSON.parse(JSON.stringify(game(TAROT_ID.STAR))) as Record<string, unknown>
    delete legacy.ladyDeck
    delete legacy.ladyDiscard
    legacy.recentLadyCards = ['lady-A', 'lady-2']
    const a = normalizeGameState(JSON.parse(JSON.stringify(legacy)) as GameState)
    const b = normalizeGameState(JSON.parse(JSON.stringify(legacy)) as GameState)
    expect(a.ladyDeck).toHaveLength(52)
    expect(a.ladyDeck).toEqual(b.ladyDeck)
    expect(a.recentLadyCards).toEqual([])
    expect(seededRng(1)()).toBe(seededRng(1)())
  })
})

describe('Q10 德国心脏病：按花色分别求和', () => {
  it('one suit totalling 5 triggers (H-A=1 + H-4=4)', () => {
    expect(heartAttackCheck(['H-A', 'H-4']).triggeredSuits).toEqual([{ suit: 'H', count: 5 }])
  })
  it('a multiple of 5 triggers (S-5=5 + S-10=5 → 10)', () => {
    expect(heartAttackCheck(['S-5', 'S-10']).triggeredSuits).toEqual([{ suit: 'S', count: 10 }])
  })
  it('different suits are never added together: H-A + S-4 is 5 in total but does NOT trigger', () => {
    const check = heartAttackCheck(['H-A', 'S-4'])
    expect(check.triggeredSuits).toEqual([])
    expect(check.suitTotals).toEqual([
      { suit: 'S', count: 4 },
      { suit: 'H', count: 1 },
      { suit: 'D', count: 0 },
      { suit: 'C', count: 0 },
    ])
  })
  it('the old rule (5-card total is a multiple of 5) would have triggered here; the new rule does not', () => {
    // 5 张合计 1+2+3+4+5 = 15，但每种花色都不是 5 的倍数
    const window = ['S-A', 'H-2', 'D-3', 'C-4', 'S-5']
    expect(heartAttackCheck(window).triggeredSuits).toEqual([])
  })
  it('several suits can trigger at once', () => {
    expect(heartAttackCheck(['H-5', 'D-5']).triggeredSuits.map((t) => t.suit)).toEqual(['H', 'D'])
  })
  it('a suit with zero cards never triggers (0 is not a positive multiple of 5)', () => {
    expect(heartAttackCheck([]).triggeredSuits).toEqual([])
  })
  it('only cards inside the 5-card window count: an early card that slides out stops contributing', () => {
    // 如果 H-A(1) 还在窗口里，红桃会是 1 + H-4(4) = 5 并触发；它被挤出后红桃只有 4。
    // 其余三种花色各只有一张 2，都不是 5 的倍数。
    const s = atLadyCard(game(TAROT_ID.STAR), ['H-4'], ['H-A', 'S-2', 'C-2', 'D-2', 'S-A'])
    const after = applyRevealLadyCard(s, 'u1', NOW).state
    expect(after.recentLadyCards).toEqual(['S-2', 'C-2', 'D-2', 'S-A', 'H-4'])
    expect(heartAttackCheck(after.recentLadyCards).suitTotals.find((t) => t.suit === 'H')!.count).toBe(4)
    expect(after.pendingHeartAttack).toBeNull()
  })
  it('revealing the card that completes a suit total records the trigger and the shared window', () => {
    const s = atLadyCard(game(TAROT_ID.STAR), ['H-4'], ['H-A', 'S-2'])
    const after = applyRevealLadyCard(s, 'u1', NOW).state
    expect(after.pendingHeartAttack).toMatchObject({
      triggeredSuits: [{ suit: 'H', count: 5 }],
      windowCardIds: ['H-A', 'S-2', 'H-4'],
      revealedByUid: 'u1',
    })
  })
  it('settlement: first responder +1 (Star +2), false starters 1 sip each, event cleared', () => {
    const s = atLadyCard(game(TAROT_ID.STAR), ['H-4'], ['H-A'])
    const triggered = applyRevealLadyCard(s, 'u1', NOW).state
    const before = triggered.players.u2!.coins
    const settled = applyResolveHeartAttack(triggered, HOST, HOST, 'u2', ['u3'], NOW)
    expect(settled.players.u2!.coins).toBe(before + 2) // 本局开局塔罗是星星
    expect(settled.pendingDrinkAcks.at(-1)).toMatchObject({ targetUid: 'u3', amount: 1 })
    expect(settled.pendingHeartAttack).toBeNull()
    expect(() => applyResolveHeartAttack(settled, HOST, HOST, 'u2', [], NOW)).toThrow(GameActionError)
  })
})

// ---------------------------------------------------------------------------
// Q13 真心话大冒险拒绝
// ---------------------------------------------------------------------------
describe('Q13 拒绝真心话大冒险：上缴 floor(金币/2) 给银行 + 半杯', () => {
  it.each([
    [5, 2],
    [4, 2],
    [1, 0],
    [0, 0],
  ])('%i coins → pays %i', (coins, expected) => {
    expect(truthOrDareRefusalPenalty(coins)).toBe(expected)
  })

  function atTruthOrDare(coins: number): GameState {
    let s = game(TAROT_ID.STAR)
    const tod = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'truthOrDare')!
    s = withPlayer(s, 'u1', { position: (tod.id - 2 + N) % N, coins, properties: ['命宫'], tacticHand: ['tactic-sha'] })
    s = rollAndLand(s, 'u1', 2)
    s = withPlayer(s, 'u1', { coins }) // 落点途中可能经过起点，固定测试金币
    return applyTruthOrDareChoice(s, 'u1', 'TRUTH', NOW)
  }

  it('deducts exactly floor(coins/2), keeps properties and hand, coins go to the bank not to other players', () => {
    const s = atTruthOrDare(5)
    const othersBefore = s.players.u2!.coins + s.players.u3!.coins
    const after = applyTruthOrDareResult(s, 'u1', false, NOW)
    expect(after.players.u1!.coins).toBe(3)
    expect(after.players.u1!.properties).toEqual(['命宫'])
    expect(after.players.u1!.tacticHand).toEqual(['tactic-sha'])
    expect(after.players.u2!.coins + after.players.u3!.coins).toBe(othersBefore)
    expect(after.pendingDrinkAcks.at(-1)).toMatchObject({ targetUid: 'u1', amountText: '半杯' })
  })
  it('with 0 coins only the half-cup confirmation remains', () => {
    const after = applyTruthOrDareResult(atTruthOrDare(0), 'u1', false, NOW)
    expect(after.players.u1!.coins).toBe(0)
    expect(after.pendingDrinkAcks.at(-1)).toMatchObject({ amountText: '半杯' })
  })
  it('cannot be charged twice', () => {
    const after = applyTruthOrDareResult(atTruthOrDare(4), 'u1', false, NOW)
    expect(() => applyTruthOrDareResult(after, 'u1', false, NOW)).toThrow(GameActionError)
    expect(after.players.u1!.coins).toBe(2)
  })
})
