import { describe, expect, it } from 'vitest'
import { BOARD_CELLS, getPropertySetMembers, isEventCell, isPropertyCell, isStartCell } from '../../../shared/game/board'
import { initGameState } from '../../../shared/game/engine/initGame'
import { startCellIdForColor } from '../../../shared/game/engine/movement'
import { normalizeGameState } from '../../../shared/game/engine/normalize'
import { applyChooseLovers, applyJusticeSwap, applyTarotDiscard, revealTarot } from '../../../shared/game/engine/tarotActions'
import { activeTarotImpacts, TAROT_ID } from '../../../shared/game/engine/tarotEffects'
import {
  applyAdvanceAfterLanding,
  applyEndTurn,
  applyPlayTacticCard,
  applyResolveDrinkAck,
  applyResolveHeartAttack,
  applyResolveLanding,
  applyRevealLadyCard,
  applyRollDice,
  applyTruthOrDareChoice,
  applyTruthOrDareResult,
  applyUsePeach,
  GameActionError,
} from '../../../shared/game/engine/turnEngine'
import { TAROT_CARDS } from '../../../shared/game/cards/tarotCards'
import type { GameRoomPlayer } from '../../../shared/gameRoomTypes'
import type { GameState } from '../../../shared/game/types'

const NOW = 5000
const HOST = 'u1'

function players(n = 3): GameRoomPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ uid: `u${i + 1}`, nickname: `P${i + 1}`, seat: i, isHost: i === 0, joinedAt: 1 }))
}

/** 固定开局塔罗的新游戏；rng 恒为 0 保证抽牌/判定可复现 */
function game(tarotId: string, n = 3): GameState {
  return initGameState(players(n), 1000, tarotId, () => 0)
}

/** 直接改共享状态里的某个字段，构造测试场景 */
function withPlayer(state: GameState, uid: string, patch: Partial<GameState['players'][string]>): GameState {
  return { ...state, players: { ...state.players, [uid]: { ...state.players[uid]!, ...patch } } }
}

function withTarot(state: GameState, tarotId: string): GameState {
  return { ...state, currentTarotId: tarotId, tarotState: { loversPair: null } }
}

function rollAndLand(state: GameState, uid: string, natural: number): GameState {
  return applyResolveLanding(applyRollDice(state, uid, natural, NOW), uid, NOW, () => 0).state
}

describe('tarot data integrity', () => {
  it('has all 22 cards from the V1.5 rulebook with impacts defined', () => {
    expect(TAROT_CARDS).toHaveLength(22)
    for (const card of TAROT_CARDS) {
      expect(activeTarotImpacts(card.id).length).toBeGreaterThan(0)
    }
  })
})

describe('0 愚者 The Fool', () => {
  it('natural 1 moves 6 cells', () => {
    const s = applyRollDice(game(TAROT_ID.FOOL), 'u1', 1, NOW)
    expect(s.turn.lastRoll).toMatchObject({ natural: 1, effective: 6, grantsExtraRoll: false })
  })
  it('natural 6 moves only 1 cell and grants no extra roll', () => {
    let s = applyRollDice(game(TAROT_ID.FOOL), 'u1', 6, NOW)
    expect(s.turn.lastRoll).toMatchObject({ natural: 6, effective: 1, grantsExtraRoll: false, isNaturalSix: true })
    s = applyResolveLanding(s, 'u1', NOW, () => 0).state
    s = { ...s, turn: { ...s.turn, pendingDecision: null } }
    s = applyAdvanceAfterLanding(s, 'u1', NOW)
    expect(s.turn.phase).toBe('LADY_CARD') // 没有回到 ROLLING
    expect(s.turn.extraRollPending).toBe(false)
  })
  it('stops applying as soon as the tarot is replaced', () => {
    const s = withTarot(game(TAROT_ID.FOOL), TAROT_ID.STAR)
    expect(applyRollDice(s, 'u1', 1, NOW).turn.lastRoll?.effective).toBe(1)
  })
})

describe('I 魔术师 The Magician', () => {
  it('refills 1 tactic card after the first card played this turn, but not the second', () => {
    let s = game(TAROT_ID.MAGICIAN)
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-sha', 'tactic-tao'] })
    s = { ...s, turn: { ...s.turn, phase: 'TACTIC' } }
    s = applyPlayTacticCard(s, 'u1', 'tactic-sha', 'u2', NOW, () => 0)
    expect(s.players.u1!.tacticHand).toHaveLength(2) // 打出 1 张，补 1 张
    expect(s.turn.playersWhoPlayedTacticThisTurn).toContain('u1')

    // 同一回合第二次出牌（响应牌桃）不再补抽
    s = { ...s, pendingDrinkAcks: [{ id: 'a1', targetUid: 'u2', amount: 1, reason: 'x', createdAt: 1 }] }
    const handBefore = s.players.u1!.tacticHand.filter((c) => c === 'tactic-tao').length
    expect(handBefore).toBeGreaterThan(0)
    const after = applyUsePeach(s, 'u1', 'a1', NOW, () => 0)
    expect(after.players.u1!.tacticHand).toHaveLength(s.players.u1!.tacticHand.length - 1)
  })
  it('without Magician, playing a card does not refill', () => {
    let s = withPlayer(game(TAROT_ID.STAR), 'u1', { tacticHand: ['tactic-sha'] })
    s = { ...s, turn: { ...s.turn, phase: 'TACTIC' } }
    expect(applyPlayTacticCard(s, 'u1', 'tactic-sha', 'u2', NOW).players.u1!.tacticHand).toHaveLength(0)
  })
})

describe('II 女祭司 / XII 倒吊人 / III 皇后 — truth or dare', () => {
  function atTruthOrDare(tarotId: string): GameState {
    let s = game(tarotId)
    const tod = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'truthOrDare')!
    s = withPlayer(s, 'u1', { position: (tod.id - 2 + BOARD_CELLS.length) % BOARD_CELLS.length })
    return rollAndLand(s, 'u1', 2)
  }

  it('High Priestess forces truth and pays 1 coin on completion', () => {
    let s = atTruthOrDare(TAROT_ID.HIGH_PRIESTESS)
    expect(s.turn.pendingDecision).toMatchObject({ kind: 'TRUTH_OR_DARE', choice: 'TRUTH' })
    const coins = s.players.u1!.coins
    s = applyTruthOrDareResult(s, 'u1', true, NOW)
    expect(s.players.u1!.coins).toBe(coins + 1)
  })
  it('Hanged Man forces dare and pays 1 coin on completion', () => {
    let s = atTruthOrDare(TAROT_ID.HANGED_MAN)
    expect(s.turn.pendingDecision).toMatchObject({ kind: 'TRUTH_OR_DARE', choice: 'DARE' })
    const coins = s.players.u1!.coins
    s = applyTruthOrDareResult(s, 'u1', true, NOW)
    expect(s.players.u1!.coins).toBe(coins + 1)
  })
  it('High Priestess rejects choosing dare', () => {
    const s = atTruthOrDare(TAROT_ID.STAR)
    const forced = withTarot(s, TAROT_ID.HIGH_PRIESTESS)
    expect(() => applyTruthOrDareChoice(forced, 'u1', 'DARE', NOW)).toThrow(GameActionError)
  })
  it('Empress pays 1 coin for either choice', () => {
    let s = atTruthOrDare(TAROT_ID.EMPRESS)
    expect(s.turn.pendingDecision).toMatchObject({ kind: 'TRUTH_OR_DARE', choice: null })
    s = applyTruthOrDareChoice(s, 'u1', 'DARE', NOW)
    const coins = s.players.u1!.coins
    expect(applyTruthOrDareResult(s, 'u1', true, NOW).players.u1!.coins).toBe(coins + 1)
  })
  it('without a truth-or-dare tarot there is no completion bonus; refusing costs half coins + half a cup', () => {
    let s = atTruthOrDare(TAROT_ID.STAR)
    s = applyTruthOrDareChoice(s, 'u1', 'TRUTH', NOW)
    const coins = s.players.u1!.coins
    expect(applyTruthOrDareResult(s, 'u1', true, NOW).players.u1!.coins).toBe(coins)
    const refused = applyTruthOrDareResult(s, 'u1', false, NOW)
    expect(refused.players.u1!.coins).toBe(coins - Math.floor(coins / 2))
    expect(refused.pendingDrinkAcks.at(-1)).toMatchObject({ targetUid: 'u1', amountText: '半杯' })
  })
})

describe('IV 皇帝 The Emperor (Q1 confirmed)', () => {
  it('full-set rent rises from 3 to 4', () => {
    let s = game(TAROT_ID.EMPEROR)
    const set = getPropertySetMembers('R')
    s = withPlayer(s, 'u2', { properties: set })
    const target = BOARD_CELLS.find((c) => isPropertyCell(c) && c.propertyName === set[0])!
    s = withPlayer(s, 'u1', { position: (target.id - 1 + BOARD_CELLS.length) % BOARD_CELLS.length, coins: 10 })
    s = rollAndLand(s, 'u1', 1)
    expect(s.players.u1!.coins).toBe(6)
  })
})

describe('VI 恋人 The Lovers', () => {
  it('reveal asks the revealer to choose a pair; bank payouts then pay the partner 1 coin', () => {
    const base = game(TAROT_ID.STAR)
    const reveal = revealTarot(base, TAROT_ID.LOVERS, 'u1', NOW)
    expect(reveal.followUp).toEqual({ kind: 'CHOOSE_LOVERS' })
    let s: GameState = { ...reveal.state, turn: { ...reveal.state.turn, pendingDecision: reveal.followUp } }
    s = applyChooseLovers(s, 'u1', 'u2', 'u3', NOW)
    expect(s.tarotState.loversPair).toEqual(['u2', 'u3'])

    // u2 从银行得金币（心脏病第一名）→ u3 也得 1
    s = { ...s, pendingHeartAttack: { id: 'h', triggeredSuits: [{ suit: 'H' as const, count: 5 }], windowCardIds: [], revealedByUid: 'u1', createdAt: 1 } }
    const u3Before = s.players.u3!.coins
    s = applyResolveHeartAttack(s, HOST, HOST, 'u2', [], NOW)
    expect(s.players.u3!.coins).toBe(u3Before + 1)
  })
  it('pair is cleared when the tarot is replaced, so partner bonus stops', () => {
    let s = revealTarot(game(TAROT_ID.STAR), TAROT_ID.LOVERS, 'u1', NOW).state
    s = { ...s, turn: { ...s.turn, pendingDecision: { kind: 'CHOOSE_LOVERS' } } }
    s = applyChooseLovers(s, 'u1', 'u2', 'u3', NOW)
    s = revealTarot(s, TAROT_ID.SUN, 'u1', NOW).state
    expect(s.tarotState.loversPair).toBeNull()
  })
  it('rejects pairing a player with themselves', () => {
    const r = revealTarot(game(TAROT_ID.STAR), TAROT_ID.LOVERS, 'u1', NOW)
    const s = { ...r.state, turn: { ...r.state.turn, pendingDecision: r.followUp } }
    expect(() => applyChooseLovers(s, 'u1', 'u2', 'u2', NOW)).toThrow(GameActionError)
  })
})

describe('VII 战车 The Chariot', () => {
  it('adds 1 to movement, capped at 6; only natural 6 grants an extra roll', () => {
    const s = game(TAROT_ID.CHARIOT)
    expect(applyRollDice(s, 'u1', 3, NOW).turn.lastRoll).toMatchObject({ effective: 4, grantsExtraRoll: false })
    expect(applyRollDice(s, 'u1', 5, NOW).turn.lastRoll).toMatchObject({ effective: 6, grantsExtraRoll: false })
    expect(applyRollDice(s, 'u1', 6, NOW).turn.lastRoll).toMatchObject({ effective: 6, grantsExtraRoll: true })
  })
  it('the modified movement is actually applied to the board position', () => {
    let s = game(TAROT_ID.CHARIOT)
    // 从一个落点是普通空格的位置出发，避免格子效果再移动棋子
    const blank = BOARD_CELLS.find((c) => c.kind === 'blank' && c.id > 10)!
    s = withPlayer(s, 'u1', { position: blank.id - 3 })
    const landed = rollAndLand(s, 'u1', 2) // 2 + 1 = 3 格
    expect(landed.players.u1!.position).toBe(blank.id)
  })
})

describe('VIII 力量 Strength + collision', () => {
  function setupCollision(tarotId: string): { s: GameState; victimStart: number; target: number } {
    let s = game(tarotId)
    // 找一个非起点、非事件、非地产的普通空格作为碰撞点，避免格子效果干扰
    const target = BOARD_CELLS.find((c) => c.kind === 'blank' && c.id > 3)!.id
    s = withPlayer(s, 'u2', { position: target })
    s = withPlayer(s, 'u1', { position: target - 2 })
    return { s, victimStart: startCellIdForColor(s.players.u2!.color), target }
  }
  it('default: victim drinks 1 and goes back to their own start', () => {
    const { s, victimStart } = setupCollision(TAROT_ID.STAR)
    const after = rollAndLand(s, 'u1', 2)
    expect(after.players.u2!.position).toBe(victimStart)
    expect(after.pendingDrinkAcks.at(-1)).toMatchObject({ targetUid: 'u2', amount: 1, reason: '被撞' })
  })
  it('Strength: victim goes back 3 cells instead of to start', () => {
    const { s, target } = setupCollision(TAROT_ID.STRENGTH)
    const after = rollAndLand(s, 'u1', 2)
    expect(after.players.u2!.position).toBe(target - 3)
  })
  it('Strength: "back 3" cells move only 1', () => {
    let s = game(TAROT_ID.STRENGTH)
    const back = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'back')!
    s = withPlayer(s, 'u1', { position: back.id - 1 })
    const after = rollAndLand(s, 'u1', 1)
    expect(after.history.some((h) => h.message.includes('后退 1 格'))).toBe(true)
  })
})

describe('IX 隐者 The Hermit', () => {
  it('next player alone on their cell at turn start gets 1 coin', () => {
    let s = game(TAROT_ID.HERMIT)
    s = withPlayer(s, 'u2', { position: 30 })
    s = { ...s, turn: { ...s.turn, phase: 'TACTIC' } }
    const before = s.players.u2!.coins
    expect(applyEndTurn(s, 'u1', NOW).players.u2!.coins).toBe(before + 1)
  })
  it('no coin if sharing the cell', () => {
    let s = game(TAROT_ID.HERMIT)
    s = withPlayer(s, 'u2', { position: 30 })
    s = withPlayer(s, 'u3', { position: 30 })
    s = { ...s, turn: { ...s.turn, phase: 'TACTIC' } }
    const before = s.players.u2!.coins
    expect(applyEndTurn(s, 'u1', NOW).players.u2!.coins).toBe(before)
  })
})

describe('X 命运之轮 Wheel of Fortune', () => {
  function seeded(): GameState {
    let s = game(TAROT_ID.STAR, 4)
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-sha'] })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-tao'] })
    s = withPlayer(s, 'u3', { tacticHand: ['tactic-shan'] })
    s = withPlayer(s, 'u4', { tacticHand: ['tactic-wuxie'] })
    return s
  }
  it('judge 1-2: clockwise — each player receives the previous player\'s hand', () => {
    const s = revealTarot(seeded(), TAROT_ID.WHEEL, 'u1', NOW, () => 0).state // judge = 1
    expect(s.players.u2!.tacticHand).toEqual(['tactic-sha'])
    expect(s.players.u1!.tacticHand).toEqual(['tactic-wuxie'])
  })
  it('judge 3-4: swap with the opposite player', () => {
    const s = revealTarot(seeded(), TAROT_ID.WHEEL, 'u1', NOW, () => 0.4).state // judge = 3
    expect(s.players.u1!.tacticHand).toEqual(['tactic-shan'])
    expect(s.players.u3!.tacticHand).toEqual(['tactic-sha'])
  })
  it('judge 5-6: counter-clockwise — each player receives the next player\'s hand', () => {
    const s = revealTarot(seeded(), TAROT_ID.WHEEL, 'u1', NOW, () => 0.9).state // judge = 6
    expect(s.players.u1!.tacticHand).toEqual(['tactic-tao'])
  })
})

describe('XI 正义 Justice', () => {
  it('host records winner/loser; they swap seat, position, coins and hand, keeping properties and hole cards', () => {
    let s = game(TAROT_ID.STAR)
    s = withPlayer(s, 'u2', { coins: 9, tacticHand: ['tactic-sha'], properties: ['命宫'], position: 10 })
    s = withPlayer(s, 'u3', { coins: 1, tacticHand: [], properties: ['财帛宫'], position: 20 })
    const r = revealTarot(s, TAROT_ID.JUSTICE, 'u1', NOW)
    s = { ...r.state, turn: { ...r.state.turn, pendingDecision: r.followUp } }
    const holeU2 = s.players.u2!.texasHoleCards
    s = applyJusticeSwap(s, HOST, HOST, 'u2', 'u3', NOW)
    expect(s.turnOrder).toEqual(['u1', 'u3', 'u2'])
    expect(s.players.u2).toMatchObject({ coins: 1, tacticHand: [], position: 20, properties: ['命宫'] })
    expect(s.players.u3).toMatchObject({ coins: 9, tacticHand: ['tactic-sha'], position: 10, properties: ['财帛宫'] })
    expect(s.players.u2!.texasHoleCards).toEqual(holeU2)
  })
  it('only the host can record the result', () => {
    const r = revealTarot(game(TAROT_ID.STAR), TAROT_ID.JUSTICE, 'u1', NOW)
    const s = { ...r.state, turn: { ...r.state.turn, pendingDecision: r.followUp } }
    expect(() => applyJusticeSwap(s, 'u2', HOST, 'u2', 'u3', NOW)).toThrow(GameActionError)
  })
})

describe('XIII 死神 Death', () => {
  it('no hand → drink 1; one card → auto discard; several → player chooses', () => {
    let s = game(TAROT_ID.STAR)
    s = withPlayer(s, 'u1', { tacticHand: [] })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-sha'] })
    s = withPlayer(s, 'u3', { tacticHand: ['tactic-sha', 'tactic-tao'] })
    s = revealTarot(s, TAROT_ID.DEATH, 'u1', NOW).state
    expect(s.pendingDrinkAcks.some((a) => a.targetUid === 'u1' && a.amount === 1)).toBe(true)
    expect(s.players.u2!.tacticHand).toEqual([])
    expect(s.pendingTarotDiscards).toEqual(['u3'])
    s = applyTarotDiscard(s, 'u3', HOST, 'u3', 'tactic-tao', NOW)
    expect(s.players.u3!.tacticHand).toEqual(['tactic-sha'])
    expect(s.pendingTarotDiscards).toEqual([])
  })
  it('a discard cannot be applied twice', () => {
    let s = withPlayer(game(TAROT_ID.STAR), 'u3', { tacticHand: ['tactic-sha', 'tactic-tao'] })
    s = revealTarot(s, TAROT_ID.DEATH, 'u1', NOW).state
    s = applyTarotDiscard(s, 'u3', HOST, 'u3', 'tactic-tao', NOW)
    expect(() => applyTarotDiscard(s, 'u3', HOST, 'u3', 'tactic-sha', NOW)).toThrow(GameActionError)
  })
})

describe('XIV 节制 Temperance', () => {
  it('blocks peach (Q5: a game-mechanic exemption) but still allows water instead and skip', () => {
    let s = game(TAROT_ID.TEMPERANCE)
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-tao'] })
    s = { ...s, pendingDrinkAcks: [{ id: 'a', targetUid: 'u2', amount: 1, reason: 'x', createdAt: 1 }] }
    expect(applyResolveDrinkAck(s, 'u2', HOST, 'a', 'WATER', NOW).pendingDrinkAcks).toHaveLength(0)
    expect(() => applyUsePeach(s, 'u1', 'a', NOW)).toThrow(GameActionError)
    expect(applyResolveDrinkAck(s, 'u2', HOST, 'a', 'DONE', NOW).pendingDrinkAcks).toHaveLength(0)
  })
})

describe('XV 恶魔 The Devil', () => {
  it('a 1-sip penalty can be converted: pay 1 coin, another player drinks 2', () => {
    let s = game(TAROT_ID.DEVIL)
    s = { ...s, pendingDrinkAcks: [{ id: 'a', targetUid: 'u2', amount: 1, reason: 'x', createdAt: 1 }] }
    const before = s.players.u2!.coins
    s = applyResolveDrinkAck(s, 'u2', HOST, 'a', 'DEVIL', NOW, 'u3')
    expect(s.players.u2!.coins).toBe(before - 1)
    expect(s.pendingDrinkAcks).toEqual([expect.objectContaining({ targetUid: 'u3', amount: 2 })])
  })
  it('not allowed for 2-sip penalties or without Devil', () => {
    const two = { ...game(TAROT_ID.DEVIL), pendingDrinkAcks: [{ id: 'a', targetUid: 'u2', amount: 2, reason: 'x', createdAt: 1 }] }
    expect(() => applyResolveDrinkAck(two, 'u2', HOST, 'a', 'DEVIL', NOW, 'u3')).toThrow(GameActionError)
    const noDevil = { ...game(TAROT_ID.STAR), pendingDrinkAcks: [{ id: 'a', targetUid: 'u2', amount: 1, reason: 'x', createdAt: 1 }] }
    expect(() => applyResolveDrinkAck(noDevil, 'u2', HOST, 'a', 'DEVIL', NOW, 'u3')).toThrow(GameActionError)
  })
})

describe('XVI 高塔 The Tower', () => {
  it('suspends rent while active, and rent resumes after replacement', () => {
    let s = game(TAROT_ID.TOWER)
    const prop = BOARD_CELLS.find(isPropertyCell)!
    s = withPlayer(s, 'u2', { properties: [prop.propertyName] })
    s = withPlayer(s, 'u1', { position: (prop.id - 1 + BOARD_CELLS.length) % BOARD_CELLS.length, coins: 5 })
    expect(rollAndLand(s, 'u1', 1).players.u1!.coins).toBe(5)
    expect(rollAndLand(withTarot(s, TAROT_ID.STAR), 'u1', 1).players.u1!.coins).toBe(4)
  })
})

describe('XVII 星星 The Star', () => {
  it('heart attack first responder gets 2 coins instead of 1; false starters drink 1', () => {
    const pending = { id: 'h', triggeredSuits: [{ suit: 'H' as const, count: 5 }], windowCardIds: [], revealedByUid: 'u1', createdAt: 1 }
    const star = { ...game(TAROT_ID.STAR), pendingHeartAttack: pending }
    const plain = { ...game(TAROT_ID.SUN), pendingHeartAttack: pending }
    const before = star.players.u2!.coins
    const s = applyResolveHeartAttack(star, HOST, HOST, 'u2', ['u3'], NOW)
    expect(s.players.u2!.coins).toBe(before + 2)
    expect(s.pendingDrinkAcks.at(-1)).toMatchObject({ targetUid: 'u3', amount: 1 })
    expect(applyResolveHeartAttack(plain, HOST, HOST, 'u2', [], NOW).players.u2!.coins).toBe(before + 1)
  })
})

describe('XIX 太阳 The Sun + own-colour start bonus', () => {
  function nearOwnStart(tarotId: string): GameState {
    const s = game(tarotId)
    const start = startCellIdForColor(s.players.u1!.color)
    return withPlayer(s, 'u1', { position: (start - 1 + BOARD_CELLS.length) % BOARD_CELLS.length, coins: 5 })
  }
  it('passing your own start pays 2 coins by default, 3 with the Sun', () => {
    expect(rollAndLand(nearOwnStart(TAROT_ID.STAR), 'u1', 1).players.u1!.coins).toBe(7)
    expect(rollAndLand(nearOwnStart(TAROT_ID.SUN), 'u1', 1).players.u1!.coins).toBe(8)
  })
  it("passing another colour's start pays nothing", () => {
    let s = game(TAROT_ID.SUN)
    const otherStart = BOARD_CELLS.find((c) => isStartCell(c) && c.color !== s.players.u1!.color)!
    s = withPlayer(s, 'u1', { position: otherStart.id - 1, coins: 5 })
    const after = rollAndLand(s, 'u1', 1)
    expect(after.history.some((h) => h.message.includes('经过自己的起点'))).toBe(false)
  })
})

describe('XX 审判 Judgement', () => {
  it('players with ≤1 tactic card draw 1; players with ≤1 coin get 1 from the bank', () => {
    let s = game(TAROT_ID.STAR)
    s = withPlayer(s, 'u1', { tacticHand: [], coins: 0 })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-sha', 'tactic-sha'], coins: 5 })
    s = withPlayer(s, 'u3', { tacticHand: ['tactic-sha'], coins: 1 })
    s = revealTarot(s, TAROT_ID.JUDGEMENT, 'u1', NOW, () => 0).state
    expect(s.players.u1).toMatchObject({ coins: 1 })
    expect(s.players.u1!.tacticHand).toHaveLength(1)
    expect(s.players.u2).toMatchObject({ coins: 5, tacticHand: ['tactic-sha', 'tactic-sha'] })
    expect(s.players.u3!.coins).toBe(2)
    expect(s.players.u3!.tacticHand).toHaveLength(2)
  })
})

describe('XXI 世界 The World', () => {
  it('"forward 4" cells move 6 instead', () => {
    let s = game(TAROT_ID.WORLD)
    const fwd = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'forward')!
    s = withPlayer(s, 'u1', { position: fwd.id - 1 })
    const after = rollAndLand(s, 'u1', 1)
    expect(after.history.some((h) => h.message.includes('前进 6 格'))).toBe(true)
  })
})

describe('tarot change via the board cell, refresh and idempotency', () => {
  function atChangeTarot(tarotId: string): GameState {
    const s = game(tarotId)
    const cell = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'changeTarot')!
    return withPlayer(s, 'u1', { position: (cell.id - 1 + BOARD_CELLS.length) % BOARD_CELLS.length })
  }
  it('landing on 更换塔罗 replaces the tarot, records a change event, and old continuous effects stop', () => {
    const before = atChangeTarot(TAROT_ID.SUN)
    const after = rollAndLand(before, 'u1', 1)
    expect(after.currentTarotId).not.toBe(TAROT_ID.SUN)
    expect(after.lastTarotChange).toMatchObject({ previousTarotId: TAROT_ID.SUN, triggeredByUid: 'u1' })
  })
  it('instant effects cannot be applied twice: resolving the same landing again is rejected', () => {
    const after = rollAndLand(atChangeTarot(TAROT_ID.SUN), 'u1', 1)
    expect(() => applyResolveLanding(after, 'u1', NOW, () => 0)).toThrow(GameActionError)
  })
  it('state survives a JSON round trip (refresh) including tarot state', () => {
    let s = revealTarot(game(TAROT_ID.STAR), TAROT_ID.LOVERS, 'u1', NOW).state
    s = { ...s, turn: { ...s.turn, pendingDecision: { kind: 'CHOOSE_LOVERS' } } }
    s = applyChooseLovers(s, 'u1', 'u2', 'u3', NOW)
    const restored = normalizeGameState(JSON.parse(JSON.stringify(s)) as GameState)
    expect(restored.currentTarotId).toBe(TAROT_ID.LOVERS)
    expect(restored.tarotState.loversPair).toEqual(['u2', 'u3'])
  })
  it('legacy documents without tarot fields are normalized so old games keep working', () => {
    const legacy = JSON.parse(JSON.stringify(game(TAROT_ID.STAR))) as Record<string, unknown>
    delete legacy.tarotState
    delete legacy.lastTarotChange
    delete legacy.pendingTarotDiscards
    const restored = normalizeGameState(legacy as unknown as GameState)
    expect(restored.tarotState).toEqual({ loversPair: null })
    expect(() => applyRollDice(restored, 'u1', 3, NOW)).not.toThrow()
  })
  it('opening with Lovers requires the first player to bind a pair before rolling', () => {
    const s = game(TAROT_ID.LOVERS)
    expect(s.turn.pendingDecision).toEqual({ kind: 'CHOOSE_LOVERS' })
    expect(() => applyRollDice(s, 'u1', 3, NOW)).toThrow(GameActionError)
    expect(() => applyRollDice(applyChooseLovers(s, 'u1', 'u2', 'u3', NOW), 'u1', 3, NOW)).not.toThrow()
  })
})

describe('tactic card rule fixes', () => {
  it('顺手牵羊 only targets left/right neighbours', () => {
    let s = withPlayer(game(TAROT_ID.STAR, 4), 'u1', { tacticHand: ['tactic-shunshou'] })
    s = { ...s, turn: { ...s.turn, phase: 'TACTIC' } }
    expect(() => applyPlayTacticCard(s, 'u1', 'tactic-shunshou', 'u3', NOW)).toThrow(GameActionError) // 对家
    expect(applyPlayTacticCard(s, 'u1', 'tactic-shunshou', 'u2', NOW).players.u1!.coins).toBe(6)
  })
  it('only one active tactic card per turn', () => {
    let s = withPlayer(game(TAROT_ID.STAR), 'u1', { tacticHand: ['tactic-sha', 'tactic-sha'] })
    s = { ...s, turn: { ...s.turn, phase: 'TACTIC' } }
    s = applyPlayTacticCard(s, 'u1', 'tactic-sha', 'u2', NOW)
    expect(() => applyPlayTacticCard(s, 'u1', 'tactic-sha', 'u2', NOW)).toThrow(GameActionError)
  })
  it('桃 on someone else saves 1 sip and pays the saver 1 coin', () => {
    let s = withPlayer(game(TAROT_ID.STAR), 'u1', { tacticHand: ['tactic-tao'] })
    s = { ...s, pendingDrinkAcks: [{ id: 'a', targetUid: 'u2', amount: 2, reason: 'x', createdAt: 1 }] }
    const after = applyUsePeach(s, 'u1', 'a', NOW)
    expect(after.pendingDrinkAcks[0]!.amount).toBe(1)
    expect(after.players.u1!.coins).toBe(6)
  })
  it('lady card reveal keeps only the last 5 cards in the heart-attack window', () => {
    let s = game(TAROT_ID.STAR)
    s = { ...s, recentLadyCards: ['S-A', 'S-2', 'S-3', 'S-4', 'S-5'], turn: { ...s.turn, phase: 'LADY_CARD' } }
    expect(applyRevealLadyCard(s, 'u1', NOW).state.recentLadyCards).toHaveLength(5)
  })
})

describe('V 教皇 The Hierophant + global ban', () => {
  it('correct catch pays 1 coin normally and 2 with the Hierophant; violator drinks 1', async () => {
    const { applyBanCatch } = await import('../../../shared/game/engine/tarotActions')
    const plain = applyBanCatch(game(TAROT_ID.STAR), HOST, HOST, 'u2', 'u3', true, NOW)
    expect(plain.players.u2!.coins).toBe(6)
    expect(plain.pendingDrinkAcks.at(-1)).toMatchObject({ targetUid: 'u3', amount: 1 })
    const hiero = applyBanCatch(game(TAROT_ID.HIEROPHANT), HOST, HOST, 'u2', 'u3', true, NOW)
    expect(hiero.players.u2!.coins).toBe(7)
  })
  it('wrong catch fines the catcher 1 coin; only the host can record it', async () => {
    const { applyBanCatch } = await import('../../../shared/game/engine/tarotActions')
    // V1.6：罚款先进入待处理（可以吹牛），支付后才扣
    const fined = applyBanCatch(game(TAROT_ID.STAR), HOST, HOST, 'u2', 'u3', false, NOW)
    expect(fined.players.u2!.coins).toBe(5)
    const ack = fined.pendingDrinkAcks.find((a) => a.coinPenalty)!
    expect(applyResolveDrinkAck(fined, 'u2', HOST, ack.id, 'PAY', NOW).players.u2!.coins).toBe(4)
    expect(() => applyBanCatch(game(TAROT_ID.STAR), 'u2', HOST, 'u2', 'u3', true, NOW)).toThrow(GameActionError)
  })
})
