/**
 * V1.6 数字版补充规则（Phase D.3–D.6）。每条测试断言共享游戏状态的实际变化。
 */
import { describe, expect, it } from 'vitest'
import { BOARD_CELLS, getPropertySetMembers, isEventCell, isPropertyCell } from '../../../shared/game/board'
import { initGameState } from '../../../shared/game/engine/initGame'
import { normalizeGameState } from '../../../shared/game/engine/normalize'
import { revealTarot } from '../../../shared/game/engine/tarotActions'
import { applyBanCatch, applyChooseLovers } from '../../../shared/game/engine/tarotActions'
import { TAROT_ID, payFromBank } from '../../../shared/game/engine/tarotEffects'
import {
  applyAdvanceAfterLanding,
  applyEndTurn,
  applyResolveDrinkAck,
  applyResolveLanding,
  applyRevealLadyCard,
  applyRollDice,
  applySkipRollTurn,
  applyUsePeach,
  GameActionError,
} from '../../../shared/game/engine/turnEngine'
import { applyCrazyCatch, applyOfferSubstitute, isLadyRuleActive } from '../../../shared/game/engine/ladyEvents'
import { applyMortgage, applyPassTactic, applyPlayActiveTactic, applyRespondTactic, originEffective } from '../../../shared/game/engine/tacticStack'
import {
  applyCasino,
  applyDreamChallenge,
  applyDreamDeclare,
  applyDreamRespond,
  applyRespondBluff,
  applyStartBluff,
  applyTexasBet,
  bestOfSeven,
  compareScores,
  evaluate3,
  openDreamChallenge,
} from '../../../shared/game/engine/texas'
import { AVALON_CONFIG, applyAvalonHostCancel, applyAvalonPick, applyAvalonVote, startAvalonMission } from '../../../shared/game/engine/avalon'
import { applyEnterGods, applyRiverChoice, riverGodUid, riverVerdict } from '../../../shared/game/engine/zones'
import { computeScores, continueEndgame } from '../../../shared/game/engine/endgame'
import { LADY_CARDS } from '../../../shared/game/cards/ladyCards'
import { GODS_FINISH_NODE } from '../../../shared/game/godsPath'
import type { GameRoomPlayer } from '../../../shared/gameRoomTypes'
import type { GamePlayerState, GameState } from '../../../shared/game/types'

const NOW = 5000
const HOST = 'u1'
const N = BOARD_CELLS.length

function roomPlayers(n = 3): GameRoomPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ uid: `u${i + 1}`, nickname: `P${i + 1}`, seat: i, isHost: i === 0, joinedAt: 1 }))
}
function game(n = 3, tarotId: string = TAROT_ID.STAR): GameState {
  return initGameState(roomPlayers(n), 1000, tarotId, () => 0.3)
}
function withPlayer(s: GameState, uid: string, patch: Partial<GamePlayerState>): GameState {
  return { ...s, players: { ...s.players, [uid]: { ...s.players[uid]!, ...patch } } }
}
function atTactic(s: GameState, uid = 'u1'): GameState {
  return { ...s, currentPlayerIndex: s.turnOrder.indexOf(uid), turn: { ...s.turn, currentPlayerUid: uid, phase: 'TACTIC', pendingDecision: null } }
}
function rollAndLand(s: GameState, uid: string, natural: number): GameState {
  return applyResolveLanding(applyRollDice(s, uid, natural, NOW), uid, NOW, () => 0.3).state
}

// ---------------------------------------------------------------------------
describe('规则版本：新规则只进新房间', () => {
  it('new games are V1.6; legacy rooms normalize to V1.5 and keep the old behaviour', () => {
    const s = game()
    expect(s.rulesVersion).toBe(2)
    const legacy = { ...s } as Partial<GameState>
    delete legacy.rulesVersion
    const old = normalizeGameState(legacy as GameState)
    expect(old.rulesVersion).toBe(1)
    // 旧房间：候选小姐牌仍是房主裁定
    const two = LADY_CARDS.find((c) => c.rank === '2')!
    expect(isLadyRuleActive(old, two)).toBe(false)
    expect(isLadyRuleActive(s, two)).toBe(true)
  })

  it('legacy room landing on 停骰一次 still gets a host ruling (no V1.6 effect)', () => {
    const cell = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'skipRoll')!
    let s: GameState = { ...game(), rulesVersion: 1 }
    s = withPlayer(s, 'u1', { position: (cell.id - 2 + N) % N })
    const after = rollAndLand(s, 'u1', 2)
    expect(after.turn.pendingDecision?.kind).toBe('HOST_RULING')
    expect(after.players.u1!.skipNextRoll).toBe(false)
  })

  it('all 3–10 player counts start with Avalon roles matching the table and unique Texas cards', () => {
    for (let n = 3; n <= 10; n += 1) {
      const s = game(n)
      const roles = Object.values(s.avalon.roles)
      expect(roles.filter((r) => r === 'GOOD')).toHaveLength(AVALON_CONFIG[n]!.good)
      expect(roles.filter((r) => r === 'EVIL')).toHaveLength(AVALON_CONFIG[n]!.evil)
      const holes = s.turnOrder.flatMap((u) => s.players[u]!.texasHoleCards)
      const all = [...holes, ...s.texas.deck]
      expect(new Set(all).size).toBe(52)
      expect(all).toHaveLength(52)
      expect(s.turnOrder.every((u) => s.players[u]!.identityCardId === `avalon-${s.avalon.roles[u]}`)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
describe('Q3 命运之轮奇数人数', () => {
  it('5 players: two swaps, one keeps the hand, nobody swaps twice', () => {
    let s = game(5)
    s.turnOrder.forEach((u, i) => (s = withPlayer(s, u, { tacticHand: [`h${i}`] })))
    const after = revealTarot(s, TAROT_ID.WHEEL, 'u1', NOW, () => 0.4).state // 判定骰 3 → 对家
    const hands = s.turnOrder.map((u) => after.players[u]!.tacticHand[0])
    // 隔 floor(5/2)=2 位：u1↔u3、u2↔u4，u5 不换
    expect(hands).toEqual(['h2', 'h3', 'h0', 'h1', 'h4'])
    expect(after.players.u1!.coins).toBe(s.players.u1!.coins)
  })
})

describe('Q5 节制', () => {
  const s0 = { ...game(), currentTarotId: TAROT_ID.TEMPERANCE, pendingDrinkAcks: [{ id: 'd', targetUid: 'u2', amount: 1, reason: 'r', createdAt: 1 }] }
  it('non-alcoholic substitute and skip stay available; peach and 替喝 are blocked', () => {
    expect(applyResolveDrinkAck(s0, 'u2', HOST, 'd', 'WATER', NOW).pendingDrinkAcks).toEqual([])
    expect(applyResolveDrinkAck(s0, 'u2', HOST, 'd', 'SKIP', NOW).pendingDrinkAcks).toEqual([])
    const peach = withPlayer(s0, 'u3', { tacticHand: ['tactic-tao'] })
    expect(() => applyUsePeach(peach, 'u3', 'd', NOW)).toThrow(/节制/)
    const sub = { ...s0, ladyStatus: { ...s0.ladyStatus, substitutePassUids: ['u2'] } }
    expect(() => applyOfferSubstitute(sub, 'u2', 'd', 'u3', NOW)).toThrow(/节制/)
  })
  it('choosing water costs no coins', () => {
    const after = applyResolveDrinkAck(s0, 'u2', HOST, 'd', 'WATER', NOW)
    expect(after.players.u2!.coins).toBe(s0.players.u2!.coins)
  })
})

describe('Q7 自然 6', () => {
  it('extra roll that is also a natural 6 does not grant a third roll', () => {
    let s = withPlayer(game(), 'u1', { position: 3 })
    s = rollAndLand(s, 'u1', 6)
    if (s.turn.pendingDecision) s = { ...s, turn: { ...s.turn, pendingDecision: null } }
    s = applyAdvanceAfterLanding(s, 'u1', NOW)
    expect(s.turn.phase).toBe('ROLLING')
    s = rollAndLand(s, 'u1', 6)
    if (s.turn.pendingDecision) s = { ...s, turn: { ...s.turn, pendingDecision: null } }
    s = applyAdvanceAfterLanding(s, 'u1', NOW)
    expect(s.turn.phase).toBe('LADY_CARD')
  })
  it('Fool natural 6 moves 1 and cancels the extra roll', () => {
    let s = withPlayer(game(3, TAROT_ID.FOOL), 'u1', { position: 3 })
    s = applyRollDice(s, 'u1', 6, NOW)
    expect(s.turn.lastRoll).toMatchObject({ effective: 1, grantsExtraRoll: false })
  })
})

describe('Q8 禁令 / 神经病不重复提交', () => {
  it('the same incident id can only be recorded once; Hierophant replaces the reward', () => {
    const s = game()
    const once = applyBanCatch(s, HOST, HOST, 'u2', 'u3', true, NOW, 'inc-1')
    expect(once.players.u2!.coins).toBe(s.players.u2!.coins + 1)
    expect(() => applyBanCatch(once, HOST, HOST, 'u2', 'u3', true, NOW, 'inc-1')).toThrow(/已经录入/)
    const hiero = applyBanCatch({ ...s, currentTarotId: TAROT_ID.HIEROPHANT }, HOST, HOST, 'u2', 'u3', true, NOW)
    expect(hiero.players.u2!.coins).toBe(s.players.u2!.coins + 2)
    const crazy = { ...s, ladyStatus: { ...s.ladyStatus, crazyUid: 'u1' } }
    const c1 = applyCrazyCatch(crazy, HOST, HOST, 'u2', NOW, 'inc-2')
    expect(() => applyCrazyCatch(c1, HOST, HOST, 'u2', NOW, 'inc-2')).toThrow(/已经录入/)
  })
})

describe('Q9 恋人', () => {
  it('can bind the revealer; partner bonus does not recurse', () => {
    let s = revealTarot(game(), TAROT_ID.LOVERS, 'u1', NOW).state
    s = { ...s, turn: { ...s.turn, pendingDecision: { kind: 'CHOOSE_LOVERS' } } }
    expect(() => applyChooseLovers(s, 'u1', 'u1', 'u1', NOW)).toThrow(GameActionError)
    s = applyChooseLovers(s, 'u1', 'u1', 'u2', NOW)
    const players = JSON.parse(JSON.stringify(s.players)) as GameState['players']
    payFromBank(s, players, 'u1', 2)
    expect(players.u1!.coins).toBe(s.players.u1!.coins + 2)
    expect(players.u2!.coins).toBe(s.players.u2!.coins + 1)
  })
})

describe('Q14 停骰 / 禁骰 / 德州+1', () => {
  const skip = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'skipRoll')!
  const next = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'nextSkipRoll')!
  const pot = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'texasPot')!

  it('停骰一次: next own turn skips roll and movement, still reveals a lady card, then clears', () => {
    let s = withPlayer(game(), 'u1', { position: (skip.id - 2 + N) % N })
    s = rollAndLand(s, 'u1', 2)
    expect(s.players.u1!.skipNextRoll).toBe(true)
    // 下一次 u1 的回合（直接构造）
    s = { ...s, turn: { ...s.turn, phase: 'ROLLING', lastRoll: null, landingResolved: false, pendingDecision: null } }
    expect(() => applyRollDice(s, 'u1', 3, NOW)).toThrow(/停骰/)
    const pos = s.players.u1!.position
    s = applySkipRollTurn(s, 'u1', NOW)
    expect(s.turn.phase).toBe('LADY_CARD')
    expect(s.players.u1!.position).toBe(pos)
    expect(s.players.u1!.skipNextRoll).toBe(false)
    expect(() => applyRollDice(s, 'u1', 3, NOW)).toThrow()
    s = applyRevealLadyCard(s, 'u1', NOW).state
    expect(s.turn.revealedLadyCardId).not.toBeNull()
  })

  it('下家禁骰 hits the next player in turn order and never stacks beyond one', () => {
    let s = withPlayer(game(), 'u1', { position: (next.id - 2 + N) % N })
    s = withPlayer(s, 'u2', { skipNextRoll: true })
    s = rollAndLand(s, 'u1', 2)
    expect(s.players.u2!.skipNextRoll).toBe(true)
    expect(s.players.u1!.skipNextRoll).toBe(false)
  })

  it('德州+1: bank adds 1 to the pot without charging the player, and counts as a CASINO', () => {
    let s = withPlayer(game(), 'u1', { position: (pot.id - 2 + N) % N })
    const coins = s.players.u1!.coins
    s = rollAndLand(s, 'u1', 2)
    expect(s.players.u1!.coins).toBe(coins)
    expect(s.texas.pot).toBe(1)
    expect(s.texas.stage).toBe('FLOP')
    expect(s.texas.community).toHaveLength(3)
  })
})

describe('Q15 / Q16', () => {
  it('Strength: victim backs 3, still drinks 1, no chain; without Strength victim returns to own start', () => {
    const blank = BOARD_CELLS.find((c) => c.kind === 'blank' && c.id > 3 && c.id < 20)!.id
    let s = withPlayer(game(3, TAROT_ID.STRENGTH), 'u2', { position: blank })
    s = withPlayer(s, 'u1', { position: blank - 2 })
    const after = rollAndLand(s, 'u1', 2)
    expect(after.players.u2!.position).toBe(blank - 3)
    expect(after.pendingDrinkAcks.filter((a) => a.reason === '被撞')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('地产抵押 / 赎回', () => {
  const set = getPropertySetMembers('R')
  const cell = BOARD_CELLS.find((c) => isPropertyCell(c) && c.propertyName === set[0])!

  it('mortgage pays 3, stops rent, breaks the full set; redeem costs 4 and restores rent', () => {
    let s = withPlayer(game(3, TAROT_ID.EMPEROR), 'u2', { properties: set, coins: 0 })
    expect(() => applyMortgage(s, 'u3', set[0]!, true, NOW)).toThrow(GameActionError)
    s = applyMortgage(s, 'u2', set[1]!, true, NOW)
    expect(s.players.u2!.coins).toBe(3)
    expect(() => applyMortgage(s, 'u2', set[1]!, true, NOW)).toThrow(/已经抵押/)
    // 落在未抵押的同色地产：套装不完整，皇帝 4 金不生效，只按同色 2 金
    let land = withPlayer(s, 'u1', { position: (cell.id - 1 + N) % N, coins: 10 })
    land = rollAndLand(land, 'u1', 1)
    expect(land.players.u1!.coins).toBe(8)
    // 赎回需要 4 金
    expect(() => applyMortgage(s, 'u2', set[1]!, false, NOW)).toThrow(/金币不足/)
    s = withPlayer(s, 'u2', { coins: 4 })
    s = applyMortgage(s, 'u2', set[1]!, false, NOW)
    expect(s.players.u2!.coins).toBe(0)
    land = rollAndLand(withPlayer(s, 'u1', { position: (cell.id - 1 + N) % N, coins: 10 }), 'u1', 1)
    expect(land.players.u1!.coins).toBe(6) // 皇帝：集齐 4 金
  })

  it('a mortgaged property itself collects no rent', () => {
    let s = withPlayer(game(), 'u2', { properties: [set[0]!] })
    s = applyMortgage(s, 'u2', set[0]!, true, NOW)
    const land = rollAndLand(withPlayer(s, 'u1', { position: (cell.id - 1 + N) % N, coins: 5 }), 'u1', 1)
    expect(land.players.u1!.coins).toBe(5)
  })
})

// ---------------------------------------------------------------------------
describe('战术牌响应栈', () => {
  it('stack resolution alternates: 1 card effective, +1 response cancelled, +2 effective', () => {
    const e = (n: number) => Array.from({ length: n }, (_, i) => ({ entryId: `${i}`, cardId: 'x', playerUid: 'u' }))
    expect(originEffective(e(1))).toBe(true)
    expect(originEffective(e(2))).toBe(false)
    expect(originEffective(e(3))).toBe(true)
    expect(originEffective(e(4))).toBe(false)
  })

  it('杀 with no one holding responses resolves immediately into a 1-sip reminder', () => {
    let s = atTactic(game())
    for (const u of s.turnOrder) s = withPlayer(s, u, { tacticHand: [] })
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-sha'] })
    s = applyPlayActiveTactic(s, 'u1', 'tactic-sha', 'u2', NOW, () => 0, 0)
    expect(s.tacticStack).toBeNull()
    expect(s.pendingDrinkAcks.filter((a) => a.targetUid === 'u2')).toHaveLength(1)
    expect(s.lastTacticResult?.effective).toBe(true)
  })

  it('杀 → 闪 cancels; 闪 is only for the target; one shan for one sha', () => {
    let s = atTactic(game())
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-sha'] })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-shan'] })
    s = withPlayer(s, 'u3', { tacticHand: ['tactic-shan'] })
    s = applyPlayActiveTactic(s, 'u1', 'tactic-sha', 'u2', NOW, () => 0, 0)
    expect(s.tacticStack?.awaiting).toEqual(['u2'])
    expect(() => applyRespondTactic(s, 'u3', s.tacticStack!.stackId, 'tactic-shan', NOW, () => 0)).toThrow()
    s = applyRespondTactic(s, 'u2', s.tacticStack!.stackId, 'tactic-shan', NOW, () => 0)
    expect(s.tacticStack).toBeNull()
    expect(s.lastTacticResult).toMatchObject({ effective: false })
    expect(s.pendingDrinkAcks).toEqual([])
    expect(s.players.u2!.tacticHand).toEqual([])
  })

  it('multi-layer: 杀 → 闪 → 无懈(cancel shan) → 无懈(cancel that) resolves LIFO', () => {
    let s = atTactic(game())
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-sha', 'tactic-wuxie'] })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-shan', 'tactic-wuxie'] })
    s = withPlayer(s, 'u3', { tacticHand: [] })
    s = applyPlayActiveTactic(s, 'u1', 'tactic-sha', 'u2', NOW, () => 0, 0)
    const id = s.tacticStack!.stackId
    s = applyRespondTactic(s, 'u2', id, 'tactic-shan', NOW, () => 0)
    expect(s.tacticStack!.awaiting).toEqual(['u1']) // u1 有无懈
    s = applyRespondTactic(s, 'u1', id, 'tactic-wuxie', NOW, () => 0)
    expect(s.tacticStack!.awaiting).toEqual(['u2'])
    s = applyRespondTactic(s, 'u2', id, 'tactic-wuxie', NOW, () => 0)
    // 4 层：杀 闪 无懈 无懈 → 杀被抵消
    expect(s.tacticStack).toBeNull()
    expect(s.lastTacticResult!.entries).toHaveLength(4)
    expect(s.lastTacticResult!.effective).toBe(false)
    // 同一张牌不能重复打出
    expect(s.players.u1!.tacticHand).toEqual([])
  })

  it('pass resolves; host can record a pass for an offline player but cannot play for them', () => {
    let s = atTactic(game())
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-sha'] })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-shan'] })
    s = withPlayer(s, 'u3', { tacticHand: [] })
    s = applyPlayActiveTactic(s, 'u1', 'tactic-sha', 'u2', NOW, () => 0, 0)
    expect(() => applyRespondTactic(s, HOST, s.tacticStack!.stackId, 'tactic-shan', NOW, () => 0)).toThrow()
    expect(() => applyPassTactic(s, 'u3', HOST, s.tacticStack!.stackId, 'u2', NOW, 0)).toThrow()
    s = applyPassTactic(s, HOST, HOST, s.tacticStack!.stackId, 'u2', NOW, 0)
    expect(s.pendingDrinkAcks.filter((a) => a.targetUid === 'u2')).toHaveLength(1)
    expect(() => applyEndTurn({ ...s, tacticStack: { ...s.lastTacticResult!, awaiting: ['u2'], passed: [], createdAt: 1 } }, 'u1', NOW)).toThrow()
  })

  it('过河拆桥 discards using the shared random pick; 顺手牵羊 never makes coins negative', () => {
    let s = atTactic(game())
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-guohe'] })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-sha', 'tactic-tao', 'tactic-shan'] })
    s = withPlayer(s, 'u3', { tacticHand: [] })
    // u2 有闪但闪不能响应过河拆桥 → 没有可响应的人，直接结算；randomPick 0.5 → 第 2 张
    const after = applyPlayActiveTactic(s, 'u1', 'tactic-guohe', 'u2', NOW, () => 0, 0.5)
    expect(after.players.u2!.tacticHand).toEqual(['tactic-sha', 'tactic-shan'])
    // 同一个 randomPick 重放结果相同
    expect(applyPlayActiveTactic(s, 'u1', 'tactic-guohe', 'u2', NOW, () => 0, 0.5).players.u2!.tacticHand).toEqual(['tactic-sha', 'tactic-shan'])

    let t = atTactic(game())
    for (const u of t.turnOrder) t = withPlayer(t, u, { tacticHand: [] })
    t = withPlayer(t, 'u1', { tacticHand: ['tactic-shunshou'] })
    t = withPlayer(t, 'u2', { coins: 0 })
    t = applyPlayActiveTactic(t, 'u1', 'tactic-shunshou', 'u2', NOW, () => 0, 0)
    expect(t.players.u2!.coins).toBe(0)
  })

  it('responses do not use the active-card allowance; peach rescue pays only once', () => {
    let s = atTactic(game())
    s = withPlayer(s, 'u3', { tacticHand: ['tactic-tao'] })
    s = { ...s, pendingDrinkAcks: [{ id: 'd', targetUid: 'u2', amount: 1, reason: 'r', createdAt: 1 }] }
    const saved = applyUsePeach(s, 'u3', 'd', NOW)
    expect(saved.players.u3!.coins).toBe(s.players.u3!.coins + 1)
    expect(saved.turn.activeTacticUsed).toBe(false)
    expect(() => applyUsePeach(withPlayer(saved, 'u3', { tacticHand: ['tactic-tao'] }), 'u3', 'd', NOW)).toThrow(/不存在/)
  })
})

// ---------------------------------------------------------------------------
describe('德州扑克', () => {
  it('7-card evaluator ranks hands and ignores suits on ties', () => {
    expect(bestOfSeven(['SA', 'SK', 'SQ', 'SJ', 'S10', 'H2', 'D3']).name).toBe('皇家同花顺')
    expect(bestOfSeven(['SA', 'HA', 'DA', 'CA', 'S2', 'H3', 'D4']).name).toBe('四条')
    expect(bestOfSeven(['SA', 'H2', 'D3', 'C4', 'S5', 'HK', 'DQ']).name).toBe('顺子')
    const a = bestOfSeven(['SA', 'HK', 'D2', 'C3', 'S7', 'H8', 'D9']).score
    const b = bestOfSeven(['HA', 'SK', 'C2', 'D3', 'H7', 'S8', 'C9']).score
    expect(compareScores(a, b)).toBe(0)
  })

  it('3 CASINOs: flop, turn, river; one bet per stage max; fold; showdown splits and remainder returns', () => {
    let s = game(3)
    s = { ...s, texas: { ...s.texas, pot: 1 } }
    s = applyCasino(s, NOW, () => 0, 'u1')
    expect(s.texas.community).toHaveLength(3)
    s = applyTexasBet(s, 'u1', 'BET', NOW)
    expect(() => applyTexasBet(s, 'u2', 'BET', NOW)).toThrow(/不能再加注/)
    s = applyTexasBet(s, 'u2', 'CALL', NOW)
    s = applyTexasBet(s, 'u3', 'FOLD', NOW)
    expect(s.texas.betting).toBeNull()
    expect(s.texas.pot).toBe(3)
    s = applyCasino(s, NOW, () => 0, 'u1')
    s = applyTexasBet(applyTexasBet(s, 'u1', 'CHECK', NOW), 'u2', 'CHECK', NOW)
    s = applyCasino(s, NOW, () => 0, 'u1')
    // 让 u1、u2 公共牌主导、底牌相同点数 → 平分
    s = {
      ...s,
      texas: { ...s.texas, community: ['SA', 'SK', 'SQ', 'SJ', 'S10'] },
      players: { ...s.players, u1: { ...s.players.u1!, texasHoleCards: ['H2', 'D3'] }, u2: { ...s.players.u2!, texasHoleCards: ['C2', 'H3'] } },
    }
    const c1 = s.players.u1!.coins
    const c2 = s.players.u2!.coins
    s = applyTexasBet(applyTexasBet(s, 'u1', 'CHECK', NOW), 'u2', 'CHECK', NOW)
    expect(s.texas.stage).toBe('DONE')
    expect(s.texas.lastShowdown).toMatchObject({ pot: 3, share: 1, returnedToBank: 1 })
    expect(s.players.u1!.coins).toBe(c1 + 1)
    expect(s.players.u2!.coins).toBe(c2 + 1)
    expect(s.texas.pot).toBe(0)
  })

  it('a player who cannot pay must fold; last player standing takes the pot', () => {
    let s = applyCasino(game(3), NOW, () => 0, 'u1')
    s = withPlayer(s, 'u2', { coins: 0 })
    s = applyTexasBet(s, 'u1', 'BET', NOW)
    expect(() => applyTexasBet(s, 'u2', 'CALL', NOW)).toThrow(/金币不足/)
    s = applyTexasBet(s, 'u2', 'FOLD', NOW)
    const c1 = s.players.u1!.coins
    s = applyTexasBet(s, 'u3', 'FOLD', NOW)
    expect(s.texas.lastShowdown?.reason).toBe('LAST_STANDING')
    expect(s.players.u1!.coins).toBe(c1 + 1)
  })

  it('after a cycle ends, the next CASINO starts a fresh cycle with new unique hole cards and carry pot', () => {
    let s = game(4)
    s = { ...s, texas: { ...s.texas, stage: 'DONE', carryPot: 2 } }
    s = applyCasino(s, NOW, () => 0.7, 'u1')
    expect(s.texas.cycle).toBe(2)
    expect(s.texas.pot).toBe(2)
    expect(s.texas.bluffUsed).toEqual([])
    const all = [...s.turnOrder.flatMap((u) => s.players[u]!.texasHoleCards), ...s.texas.deck]
    expect(new Set(all).size).toBe(52)
  })
})

describe('骗子酒馆', () => {
  function bluffGame(hole: [string, string]): GameState {
    let s = withPlayer(game(3), 'u2', { texasHoleCards: hole })
    s = { ...s, pendingDrinkAcks: [{ id: 'd', targetUid: 'u2', amount: 1, reason: 'r', createdAt: 1 }] }
    return applyStartBluff(s, 'u2', 'd', 'SA', NOW)
  }
  it('nobody challenges → penalty waived; once per cycle', () => {
    let s = bluffGame(['H2', 'D3'])
    s = applyRespondBluff(s, 'u1', HOST, 'd', false, NOW)
    s = applyRespondBluff(s, 'u3', HOST, 'd', false, NOW)
    expect(s.pendingDrinkAcks).toEqual([])
    s = { ...s, pendingDrinkAcks: [{ id: 'e', targetUid: 'u2', amount: 1, reason: 'r', createdAt: 1 }] }
    expect(() => applyStartBluff(s, 'u2', 'e', 'SA', NOW)).toThrow(/吹过牛/)
  })
  it('challenge on a true claim → challenger drinks 1, penalty waived; Moon pays the winner', () => {
    const s = { ...bluffGame(['SA', 'D3']), currentTarotId: TAROT_ID.MOON }
    const after = applyRespondBluff(s, 'u3', HOST, 'd', true, NOW)
    expect(after.pendingDrinkAcks.map((a) => a.targetUid)).toEqual(['u3'])
    expect(after.players.u2!.coins).toBe(s.players.u2!.coins + 1)
  })
  it('challenge on a false claim → original penalty + 1 extra; first challenger settles once', () => {
    const s = bluffGame(['H2', 'D3'])
    const after = applyRespondBluff(s, 'u1', HOST, 'd', true, NOW)
    expect(after.pendingDrinkAcks.filter((a) => a.targetUid === 'u2')).toHaveLength(2)
    expect(() => applyRespondBluff(after, 'u3', HOST, 'd', true, NOW)).toThrow()
  })
})

describe('梦幻拖拉机', () => {
  it('3-card ranking: 豹子 > 同花顺 > 同花 > 顺子 > 对子 > 单张; A-2-3 is a straight', () => {
    const names = [['SA', 'HA', 'DA'], ['S5', 'S6', 'S7'], ['S2', 'S9', 'SK'], ['SA', 'H2', 'D3'], ['S9', 'H9', 'D2'], ['S2', 'H7', 'DK']].map((c) => evaluate3(c).name)
    expect(names).toEqual(['豹子', '同花顺', '同花', '顺子', '对子', '单张'])
  })
  it('challenge → accept → declare: winner gets 1 bank coin; refusal is free; only one challenge per event', () => {
    let s = withPlayer(game(), 'u1', { texasHoleCards: ['SA', 'HA'] })
    s = withPlayer(s, 'u2', { texasHoleCards: ['S2', 'H7'] })
    s = { ...s, dream: openDreamChallenge(s, 'u1', ['u2'], NOW) }
    const id = s.dream!.eventId
    expect(() => applyDreamChallenge(s, 'u1', id, 'u3', NOW)).toThrow()
    s = applyDreamChallenge(s, 'u1', id, 'u2', NOW)
    expect(() => applyDreamChallenge(s, 'u1', id, 'u2', NOW)).toThrow()
    const refused = applyDreamRespond(s, 'u2', id, false, NOW)
    expect(refused.players.u2!.coins).toBe(s.players.u2!.coins)
    s = applyDreamRespond(s, 'u2', id, true, NOW)
    s = applyDreamDeclare(s, 'u1', id, 'DA', NOW)
    const c1 = s.players.u1!.coins
    s = applyDreamDeclare(s, 'u2', id, 'DK', NOW)
    expect(s.dream!.result!.winners).toEqual(['u1'])
    expect(s.players.u1!.coins).toBe(c1 + 1)
    expect(() => applyDreamDeclare(s, 'u2', id, 'DQ', NOW)).toThrow()
  })
})

// ---------------------------------------------------------------------------
describe('阿瓦隆', () => {
  function evilOf(s: GameState): string {
    return s.turnOrder.find((u) => s.avalon.roles[u] === 'EVIL')!
  }
  function runMission(s: GameState, fail: boolean): GameState {
    s = startAvalonMission(s, 'u1', NOW)
    const m = s.avalon.active!
    const evil = evilOf(s)
    const passengers = [evil, ...s.turnOrder.filter((u) => u !== evil)].slice(0, m.size)
    s = applyAvalonPick(s, 'u1', m.missionId, passengers, NOW)
    for (const u of passengers) s = applyAvalonVote(s, u, m.missionId, u === evil && fail ? 'FAIL' : 'SUCCESS', NOW)
    return s
  }

  it('good players can only submit SUCCESS; mission fails on one FAIL; votes are cleared on reveal', () => {
    let s = startAvalonMission(game(5), 'u1', NOW)
    const m = s.avalon.active!
    expect(m.size).toBe(2)
    const good = s.turnOrder.find((u) => s.avalon.roles[u] === 'GOOD')!
    expect(() => applyAvalonPick(s, 'u1', m.missionId, [good, good], NOW)).toThrow()
    s = applyAvalonPick(s, 'u1', m.missionId, [good, evilOf(s)], NOW)
    expect(() => applyAvalonVote(s, good, m.missionId, 'FAIL', NOW)).toThrow(/好人/)
    s = applyAvalonVote(s, good, m.missionId, 'SUCCESS', NOW)
    expect(() => applyAvalonVote(s, good, m.missionId, 'SUCCESS', NOW)).toThrow()
    s = applyAvalonVote(s, evilOf(s), m.missionId, 'FAIL', NOW)
    expect(s.avalon.active).toBeNull()
    expect(s.avalon.fails).toBe(1)
    expect(JSON.stringify(s.avalon)).not.toContain('"votes"')
  })

  it('three successes: good wins, each good +1 coin, each evil 1 sip, settled once', () => {
    let s = game(5)
    const coins = Object.fromEntries(s.turnOrder.map((u) => [u, s.players[u]!.coins]))
    for (let i = 0; i < 3; i += 1) s = runMission(s, false)
    expect(s.avalon.winner).toBe('GOOD')
    for (const u of s.turnOrder) {
      if (s.avalon.roles[u] === 'GOOD') expect(s.players[u]!.coins).toBe(coins[u]! + 1)
      else expect(s.pendingDrinkAcks.filter((a) => a.targetUid === u)).toHaveLength(1)
    }
    const after = startAvalonMission(s, 'u2', NOW)
    expect(after.avalon.active).toBeNull()
  })

  it('three failures: evil wins', () => {
    let s = game(6)
    for (let i = 0; i < 3; i += 1) s = runMission(s, true)
    expect(s.avalon.winner).toBe('EVIL')
  })

  it('only one mission at a time; host cancel does not reveal roles or count the round', () => {
    let s = startAvalonMission(game(), 'u1', NOW)
    const again = startAvalonMission(s, 'u2', NOW)
    expect(again.avalon.active!.missionId).toBe(s.avalon.active!.missionId)
    s = applyAvalonHostCancel(s, HOST, HOST, s.avalon.active!.missionId, NOW)
    expect(s.avalon.active).toBeNull()
    expect(s.avalon.results).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('神鬼道 / 河神 / 天堂地狱', () => {
  it('river verdict: every combination', () => {
    // 玩家成功 + 河神同意 → 成功
    expect(riverVerdict(4, 6, 1, 'FINISH').success).toBe(true)
    // 玩家失败 + 河神反对 → 失败
    expect(riverVerdict(1, 2, 6, 'FINISH').success).toBe(false)
    // 玩家成功 + 河神反对 → 神谕
    expect(riverVerdict(5, 2, 4, 'FINISH')).toMatchObject({ needOracle: true, success: true })
    expect(riverVerdict(5, 2, 3, 'FINISH')).toMatchObject({ needOracle: true, success: false })
    // 玩家失败 + 河神同意 → 神谕
    expect(riverVerdict(2, 5, 6, 'FINISH')).toMatchObject({ needOracle: true, success: true })
    // 天堂河神固定同意，地狱河神固定反对
    expect(riverVerdict(4, 1, 1, 'HEAVEN').success).toBe(true)
    expect(riverVerdict(1, 6, 1, 'HELL').success).toBe(false)
  })

  it('river god = closest to the finish, tie broken by turn order; none when nobody is on the path', () => {
    let s = game(4)
    expect(riverGodUid(s)).toBeNull()
    s = withPlayer(s, 'u3', { zone: { kind: 'gods', node: GODS_FINISH_NODE - 2, dir: 1 } })
    s = withPlayer(s, 'u2', { zone: { kind: 'gods', node: GODS_FINISH_NODE + 2, dir: -1 } })
    expect(riverGodUid(s)).toBe('u2')
    s = withPlayer(s, 'u4', { zone: { kind: 'gods', node: GODS_FINISH_NODE + 1, dir: -1 } })
    expect(riverGodUid(s)).toBe('u4')
  })

  it('crossing the river gap stops at the bank; without a god only the bridge is allowed', () => {
    let s = withPlayer(game(), 'u1', { position: 26 })
    s = rollAndLand(s, 'u1', 4)
    expect(s.turn.pendingDecision).toMatchObject({ kind: 'RIVER_CROSS', side: 'R', bankCell: 28, farCell: 29 })
    expect(s.players.u1!.position).toBe(28)
    expect(() => applyRiverChoice(s, 'u1', 'FORD', { player: 6, god: 6, oracle: 6 }, NOW)).toThrow(/河神/)
    const coins = s.players.u1!.coins
    s = applyRiverChoice(s, 'u1', 'BRIDGE', { player: 1, god: 1, oracle: 1 }, NOW)
    expect(s.players.u1!.coins).toBe(coins - 1)
    expect(s.players.u1!.zone).toMatchObject({ kind: 'bridge', step: 0 })
    // 桥上掷骰：2 口，不移动外圈
    s = { ...s, turn: { ...s.turn, phase: 'ROLLING', lastRoll: null, landingResolved: false } }
    s = rollAndLand(s, 'u1', 5)
    expect(s.players.u1!.zone).toMatchObject({ kind: 'bridge', step: 5 })
    expect(s.pendingDrinkAcks.filter((a) => a.amount === 2)).toHaveLength(1)
  })

  it('bridge toll with no coins is waived, never negative', () => {
    let s = withPlayer(game(), 'u1', { position: 26, coins: 0 })
    s = rollAndLand(s, 'u1', 4)
    s = applyRiverChoice(s, 'u1', 'BRIDGE', { player: 1, god: 1, oracle: 1 }, NOW)
    expect(s.players.u1!.coins).toBe(0)
  })

  it('fording with a god: success moves to the far bank; dice are independent of Fool/Chariot', () => {
    let s = withPlayer(game(3, TAROT_ID.CHARIOT), 'u1', { position: 26 })
    s = withPlayer(s, 'u3', { zone: { kind: 'gods', node: 5, dir: 1 } }) // 天堂河神：固定同意
    s = rollAndLand(s, 'u1', 4)
    s = applyRiverChoice(s, 'u1', 'FORD', { player: 4, god: 1, oracle: 1 }, NOW)
    expect(s.players.u1!.position).toBe(29)
    let f = withPlayer(game(), 'u1', { position: 26 })
    f = withPlayer(f, 'u3', { zone: { kind: 'gods', node: 25, dir: -1 } }) // 地狱河神：固定反对
    f = rollAndLand(f, 'u1', 4)
    f = applyRiverChoice(f, 'u1', 'FORD', { player: 3, god: 6, oracle: 6 }, NOW)
    expect(f.players.u1!.position).toBe(28)
  })

  it('gods path opens after the first lap; entering, heaven pays on map rolls only, exact finish ends the path', () => {
    let s = withPlayer(game(), 'u1', { position: 70 }) // u1 蓝色起点 0
    s = rollAndLand(s, 'u1', 4)
    expect(s.godsPathOpen).toBe(true)
    expect(s.players.u1!.laps).toBe(1)
    // 停在上端入口格（第 10 格）
    s = withPlayer(s, 'u1', { position: 8 })
    s = { ...s, turn: { ...s.turn, phase: 'ROLLING', lastRoll: null, landingResolved: false, pendingDecision: null } }
    s = rollAndLand(s, 'u1', 2)
    expect(s.turn.pendingDecision).toMatchObject({ kind: 'ENTER_GODS', entranceNode: 0 })
    s = applyEnterGods(s, 'u1', true, NOW)
    expect(s.players.u1!.zone).toMatchObject({ kind: 'gods', node: 0 })
    // 天堂：每次地图掷骰 +1
    const coins = s.players.u1!.coins
    s = { ...s, turn: { ...s.turn, phase: 'ROLLING', lastRoll: null, landingResolved: false } }
    s = rollAndLand(s, 'u1', 6)
    expect(s.players.u1!.coins).toBe(coins + 1)
    expect(s.players.u1!.zone).toMatchObject({ kind: 'gods', node: 6 })
    // 恰好走到终点
    s = withPlayer(s, 'u1', { zone: { kind: 'gods', node: GODS_FINISH_NODE - 3, dir: 1 } })
    s = { ...s, turn: { ...s.turn, phase: 'ROLLING', lastRoll: null, landingResolved: false } }
    s = rollAndLand(s, 'u1', 3)
    expect(s.players.u1!.reachedFinish).toBe(true)
  })

  it('overshooting the finish passes to the other side; hell charges up to 1 coin', () => {
    let s = withPlayer(game(), 'u1', { zone: { kind: 'gods', node: GODS_FINISH_NODE - 1, dir: 1 } })
    s = rollAndLand(s, 'u1', 3)
    expect(s.players.u1!.zone).toMatchObject({ kind: 'gods', node: GODS_FINISH_NODE + 2 })
    expect(s.players.u1!.reachedFinish).toBe(false)
    s = withPlayer(s, 'u1', { coins: 0 })
    s = { ...s, turn: { ...s.turn, phase: 'ROLLING', lastRoll: null, landingResolved: false } }
    s = rollAndLand(s, 'u1', 1)
    expect(s.players.u1!.coins).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('终局与计分', () => {
  it('score = finish 10 + coins + 2/property + 2/valid full set; mortgaged property counts but breaks the set', () => {
    const set = getPropertySetMembers('R')
    let s = withPlayer(game(), 'u1', { reachedFinish: true, coins: 3, properties: set, mortgaged: [] })
    s = withPlayer(s, 'u2', { coins: 3, properties: set.slice(0, 2), mortgaged: [] })
    s = withPlayer(s, 'u3', { coins: 3, properties: [], mortgaged: [] })
    let scores = computeScores(s)
    expect(scores.find((x) => x.uid === 'u1')!.total).toBe(10 + 3 + 6 + 2)
    s = withPlayer(s, 'u1', { mortgaged: [set[0]!] })
    scores = computeScores(s)
    expect(scores.find((x) => x.uid === 'u1')!).toMatchObject({ properties: 3, fullSets: 0, total: 19 })
  })

  it('tie-breaks: coins, then property count, then sets; still equal → shared rank', () => {
    let s = withPlayer(game(), 'u1', { coins: 4, properties: [] })
    s = withPlayer(s, 'u2', { coins: 2, properties: [getPropertySetMembers('G')[0]!] })
    s = withPlayer(s, 'u3', { coins: 4, properties: [] })
    const scores = computeScores(s)
    // u2 总分 4，u1/u3 总分 4：先比金币 → u1、u3 并列第一，u2 第三
    expect(scores.map((x) => [x.uid, x.rank])).toEqual([
      ['u1', 1],
      ['u3', 1],
      ['u2', 3],
    ])
  })

  it('reaching the finish ends map turns at end of turn, runs Avalon to completion, scores once and freezes', () => {
    let s = withPlayer(game(3), 'u1', { reachedFinish: true })
    s = atTactic(s)
    s = applyEndTurn(s, 'u1', NOW)
    expect(s.endgame?.phase).toBe('AVALON')
    expect(s.avalon.active).not.toBeNull()
    expect(() => applyRollDice({ ...s, turn: { ...s.turn, phase: 'ROLLING' } }, s.turn.currentPlayerUid, 3, NOW)).toThrow(/终点/)
    // 跑完阿瓦隆：好人全过
    for (let i = 0; i < 5 && s.endgame!.phase === 'AVALON'; i += 1) {
      const m = s.avalon.active!
      const passengers = s.turnOrder.slice(0, m.size)
      s = applyAvalonPick(s, m.leaderUid, m.missionId, passengers, NOW)
      for (const u of passengers) s = applyAvalonVote(s, u, m.missionId, 'SUCCESS', NOW)
      s = continueEndgame(s, NOW)
    }
    expect(s.endgame!.phase).toBe('DONE')
    expect(s.finished).toBe(true)
    expect(s.endgame!.scores).toHaveLength(3)
    const frozen = continueEndgame(s, NOW)
    expect(frozen).toBe(s)
  })

  it('endgame finishes an open Texas cycle by dealing the rest of the board and settling', () => {
    let s = applyCasino(withPlayer(game(3), 'u1', { reachedFinish: true }), NOW, () => 0, 'u2')
    // Flop 下注全部过牌，周期仍在进行（Turn、River 还没翻）
    for (const u of ['u1', 'u2', 'u3']) s = applyTexasBet(s, u, 'CHECK', NOW)
    s = { ...atTactic(s), texas: { ...s.texas, pot: 2 } }
    s = applyEndTurn(s, 'u1', NOW)
    expect(s.texas.stage).toBe('DONE')
    expect(s.texas.lastShowdown?.community).toHaveLength(5)
  })
})

describe('真心话大冒险题库', () => {
  it('choosing draws a shared prompt, avoids repeats, host can redraw; refusal still costs floor(coins/2) once', async () => {
    const { applyTruthOrDareChoice, applyRedrawTruthOrDare, applyTruthOrDareResult } = await import('../../../shared/game/engine/turnEngine')
    const { getPrompt, TRUTH_PROMPTS, DARE_PROMPTS } = await import('../../../shared/game/cards/truthOrDareBank')
    for (const p of [...TRUTH_PROMPTS, ...DARE_PROMPTS]) expect(p.text).not.toMatch(/喝光|干杯必须|亲|密码|住址/)
    let s: GameState = { ...game(), turn: { ...game().turn, pendingDecision: { kind: 'TRUTH_OR_DARE', choice: null } } }
    s = applyTruthOrDareChoice(s, 'u1', 'DARE', NOW, () => 0)
    const d = s.turn.pendingDecision as { promptId?: string | null }
    expect(getPrompt(d.promptId!)?.kind).toBe('DARE')
    expect(s.usedPromptIds).toEqual([d.promptId])
    s = applyRedrawTruthOrDare(s, HOST, HOST, NOW, () => 0)
    const d2 = s.turn.pendingDecision as { promptId?: string | null }
    expect(d2.promptId).not.toBe(d.promptId)
    expect(() => applyRedrawTruthOrDare(s, 'u3', HOST, NOW)).toThrow()
    const coins = s.players.u1!.coins
    s = applyTruthOrDareResult(s, 'u1', false, NOW)
    expect(s.players.u1!.coins).toBe(coins - Math.floor(coins / 2))
    expect(() => applyTruthOrDareResult(s, 'u1', false, NOW)).toThrow()
  })
})

describe('骗子酒馆：1 金币惩罚（禁令错误指认）', () => {
  function wrongAccusation(): { s: GameState; ackId: string } {
    const s = applyBanCatch(game(), HOST, HOST, 'u2', 'u3', false, NOW, 'inc-w')
    const ack = s.pendingDrinkAcks.find((a) => a.coinPenalty)!
    return { s, ackId: ack.id }
  }

  it('the fine is deferred, not charged immediately; paying deducts once and never goes negative', () => {
    const before = game().players.u2!.coins
    const { s, ackId } = wrongAccusation()
    expect(s.players.u2!.coins).toBe(before)
    expect(s.pendingDrinkAcks.find((a) => a.id === ackId)).toMatchObject({ targetUid: 'u2', coinPenalty: 1, amount: 0 })
    const paid = applyResolveDrinkAck(s, 'u2', HOST, ackId, 'PAY', NOW)
    expect(paid.players.u2!.coins).toBe(before - 1)
    expect(() => applyResolveDrinkAck(paid, 'u2', HOST, ackId, 'PAY', NOW)).toThrow(/不存在/)
    const broke = applyResolveDrinkAck(withPlayer(s, 'u2', { coins: 0 }), 'u2', HOST, ackId, 'PAY', NOW)
    expect(broke.players.u2!.coins).toBe(0)
  })

  it('coin penalties cannot be skipped, watered, peached, devil-converted or substituted', () => {
    const { s, ackId } = wrongAccusation()
    for (const c of ['WATER', 'SKIP', 'DONE'] as const) expect(() => applyResolveDrinkAck(s, 'u2', HOST, ackId, c, NOW)).toThrow(/金币惩罚/)
    expect(() => applyUsePeach(withPlayer(s, 'u1', { tacticHand: ['tactic-tao'] }), 'u1', ackId, NOW)).toThrow()
    const sub = { ...s, ladyStatus: { ...s.ladyStatus, substitutePassUids: ['u2'] } }
    expect(() => applyOfferSubstitute(sub, 'u2', ackId, 'u3', NOW)).toThrow(/金币惩罚/)
  })

  it('bluff on a coin penalty: nobody challenges → fine waived', () => {
    const { s, ackId } = wrongAccusation()
    let b = applyStartBluff(s, 'u2', ackId, 'SA', NOW)
    expect(() => applyResolveDrinkAck(b, 'u2', HOST, ackId, 'PAY', NOW)).toThrow(/吹牛/)
    b = applyRespondBluff(b, 'u1', HOST, ackId, false, NOW)
    b = applyRespondBluff(b, 'u3', HOST, ackId, false, NOW)
    expect(b.players.u2!.coins).toBe(s.players.u2!.coins)
    expect(b.pendingDrinkAcks).toEqual([])
  })

  it('false claim challenged → coin deducted once + 1 sip; true claim → fine cancelled, challenger 1 sip; Moon pays the winner once', () => {
    const { s, ackId } = wrongAccusation()
    const liar = applyStartBluff(withPlayer(s, 'u2', { texasHoleCards: ['H2', 'D3'] }), 'u2', ackId, 'SA', NOW)
    const caught = applyRespondBluff({ ...liar, currentTarotId: TAROT_ID.MOON }, 'u3', HOST, ackId, true, NOW)
    expect(caught.players.u2!.coins).toBe(s.players.u2!.coins - 1)
    expect(caught.players.u3!.coins).toBe(s.players.u3!.coins + 1) // 月亮：质疑胜者
    expect(caught.pendingDrinkAcks.filter((a) => a.targetUid === 'u2' && !a.coinPenalty)).toHaveLength(1)
    expect(caught.pendingDrinkAcks.some((a) => a.coinPenalty)).toBe(false)
    expect(() => applyRespondBluff(caught, 'u1', HOST, ackId, true, NOW)).toThrow()

    const honest = applyStartBluff(withPlayer(s, 'u2', { texasHoleCards: ['SA', 'D3'] }), 'u2', ackId, 'SA', NOW)
    const wrong = applyRespondBluff(honest, 'u3', HOST, ackId, true, NOW)
    expect(wrong.players.u2!.coins).toBe(s.players.u2!.coins)
    expect(wrong.pendingDrinkAcks.map((a) => a.targetUid)).toEqual(['u3'])
  })

  it('normal payments are never bluffable: rent, purchase, bet, redeem, bridge toll are charged directly', () => {
    // 这些支付都不进入待处理队列：只有 coinPenalty 记录可以吹牛
    const s = game()
    expect(s.pendingDrinkAcks.some((a) => a.coinPenalty)).toBe(false)
    const ack = { id: 'x', targetUid: 'u2', amount: 2, reason: 'r', createdAt: 1 }
    expect(() => applyStartBluff({ ...s, pendingDrinkAcks: [ack] }, 'u2', 'x', 'SA', NOW)).toThrow(/1 口/)
  })

  it('an unpaid coin penalty is charged before final scoring', () => {
    const { s } = wrongAccusation()
    let e = withPlayer(s, 'u1', { reachedFinish: true })
    e = { ...atTactic(e), avalon: { ...e.avalon, winner: 'GOOD' } }
    const coins = e.players.u2!.coins
    e = applyEndTurn(e, 'u1', NOW)
    expect(e.endgame?.phase).toBe('DONE')
    expect(e.players.u2!.coins).toBe(coins - 1)
    expect(e.endgame!.scores!.find((x) => x.uid === 'u2')!.coins).toBe(coins - 1)
  })

  it('legacy V1.5 rooms keep charging the wrong-accusation fine immediately', () => {
    const old: GameState = { ...game(), rulesVersion: 1 }
    const after = applyBanCatch(old, HOST, HOST, 'u2', 'u3', false, NOW)
    expect(after.players.u2!.coins).toBe(old.players.u2!.coins - 1)
    expect(after.pendingDrinkAcks).toEqual([])
  })
})

describe('CASINO 映射审计', () => {
  it('a CASINO while betting is still open does not advance or force-fold anyone; the pot +1 still counts', () => {
    let s = applyCasino(game(3), NOW, () => 0, 'u1')
    s = applyTexasBet(s, 'u1', 'BET', NOW)
    const before = s.texas
    const again = applyCasino({ ...s, texas: { ...s.texas, pot: s.texas.pot + 1 } }, NOW, () => 0, 'u2')
    expect(again.texas.stage).toBe('FLOP')
    expect(again.texas.community).toEqual(before.community)
    expect(again.texas.folded).toEqual([])
    expect(again.texas.pot).toBe(before.pot + 1)
    expect(again.texas.betting).toEqual(before.betting)
  })

  it('德州+1 during a finished cycle: the +1 goes to the next cycle and that CASINO opens it with the carry pot', () => {
    const cell = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'texasPot')!
    let s = withPlayer(game(), 'u1', { position: (cell.id - 2 + N) % N })
    s = { ...s, texas: { ...s.texas, stage: 'DONE', carryPot: 0 } }
    s = rollAndLand(s, 'u1', 2)
    expect(s.texas.cycle).toBe(2)
    expect(s.texas.stage).toBe('PREFLOP')
    expect(s.texas.pot).toBe(1)
    expect(s.texas.carryPot).toBe(0)
  })

  it('each landing settles the pot and the CASINO exactly once (landing cannot be resolved twice)', () => {
    const cell = BOARD_CELLS.find((c) => isEventCell(c) && c.effectKind === 'texasPot')!
    let s = withPlayer(game(), 'u1', { position: (cell.id - 2 + N) % N })
    s = rollAndLand(s, 'u1', 2)
    expect(() => applyResolveLanding(s, 'u1', NOW, () => 0)).toThrow(/已经结算/)
    expect(s.texas.casinoCount).toBe(1)
  })
})

describe('联机状态审计', () => {
  it('endgame is blocked until score-affecting open events are resolved (heart attack, Texas betting, bluff)', () => {
    let s = atTactic(withPlayer(game(), 'u1', { reachedFinish: true }))
    const ha = { ...s, pendingHeartAttack: { id: 'h', triggeredSuits: [{ suit: 'H' as const, count: 5 }], windowCardIds: [], revealedByUid: 'u1', createdAt: 1 } }
    expect(() => applyEndTurn(ha, 'u1', NOW)).toThrow(/心脏病/)
    const bet = applyCasino(s, NOW, () => 0, 'u1')
    expect(() => applyEndTurn(bet, 'u1', NOW)).toThrow(/下注/)
    s = { ...s, avalon: { ...s.avalon, winner: 'GOOD' } }
    expect(applyEndTurn(s, 'u1', NOW).endgame?.phase).toBe('DONE')
  })

  it('stale page after the game finished: continuing or ending again changes nothing', () => {
    let s = atTactic(withPlayer(game(), 'u1', { reachedFinish: true }))
    s = { ...s, avalon: { ...s.avalon, winner: 'EVIL' } }
    s = applyEndTurn(s, 'u1', NOW)
    expect(s.finished).toBe(true)
    expect(() => applyEndTurn(s, 'u1', NOW)).toThrow()
    expect(continueEndgame(s, NOW)).toBe(s)
  })

  it('4-layer wuxie chain where a passer gets a fresh chance after each new card', () => {
    let s = atTactic(game())
    s = withPlayer(s, 'u1', { tacticHand: ['tactic-shunshou', 'tactic-wuxie'] })
    s = withPlayer(s, 'u2', { tacticHand: ['tactic-wuxie'] })
    s = withPlayer(s, 'u3', { tacticHand: ['tactic-wuxie'] })
    s = applyPlayActiveTactic(s, 'u1', 'tactic-shunshou', 'u2', NOW, () => 0, 0)
    const id = s.tacticStack!.stackId
    expect(s.tacticStack!.awaiting).toEqual(['u2', 'u3'])
    s = applyPassTactic(s, 'u3', HOST, id, 'u3', NOW, 0) // u3 先放弃
    s = applyRespondTactic(s, 'u2', id, 'tactic-wuxie', NOW, () => 0) // u2 无懈
    expect(s.tacticStack!.awaiting).toEqual(['u1', 'u3']) // 新牌后 u3 重新获得机会
    s = applyRespondTactic(s, 'u3', id, 'tactic-wuxie', NOW, () => 0)
    s = applyRespondTactic(s, 'u1', id, 'tactic-wuxie', NOW, () => 0)
    // 顺手 + 3 张无懈 = 4 层 → 顺手被抵消
    expect(s.lastTacticResult!.effective).toBe(false)
    expect(s.players.u2!.coins).toBe(game().players.u2!.coins)
  })

  it('walking out of the gods path continues on the outer ring with the leftover steps', () => {
    let s = withPlayer(game(), 'u1', { zone: { kind: 'gods', node: 31, dir: 1 } })
    s = rollAndLand(s, 'u1', 4) // 31→32→33→出口(47)→再走 1 格到 48
    expect(s.players.u1!.zone.kind).toBe('ring')
    expect(s.players.u1!.position).toBe(48)
  })

  it('V1.5 room never gets V1.6 modules on landing (no CASINO, no river stop, no avalon)', () => {
    let s: GameState = withPlayer({ ...game(), rulesVersion: 1 }, 'u1', { position: 26 })
    s = rollAndLand(s, 'u1', 4)
    expect(s.turn.pendingDecision?.kind).not.toBe('RIVER_CROSS')
    expect(s.players.u1!.position).toBe(30)
    expect(s.texas.casinoCount).toBe(0)
    expect(s.avalon.active).toBeNull()
  })
})

describe('桥与神鬼道节点（P0 审计）', () => {
  it('walking off the end of the bridge lands on the far-bank ring cell and continues with leftover steps', () => {
    let s = withPlayer(game(), 'u1', { zone: { kind: 'bridge', side: 'R', step: 10, dir: 1 } })
    s = rollAndLand(s, 'u1', 5) // 10 + 5 = 15 → 走完 13 格到 id 29，余 2 格 → id 31
    expect(s.players.u1!.zone.kind).toBe('ring')
    expect(s.players.u1!.position).toBe(31)
    let l = withPlayer(game(), 'u1', { zone: { kind: 'bridge', side: 'L', step: 12, dir: 1 } })
    l = rollAndLand(l, 'u1', 1) // 恰好走完 → id 66
    expect(l.players.u1!.position).toBe(66)
  })

  it('gods path has 16 upper cells, a finish and 17 lower cells, matching the PPTX measurements', async () => {
    const { GODS_NODE_COUNT, GODS_FINISH_NODE, godsNodePosition, godsRegion } = await import('../../../shared/game/godsPath')
    expect(GODS_NODE_COUNT).toBe(34)
    expect(GODS_FINISH_NODE).toBe(16)
    expect(Array.from({ length: 34 }, (_, i) => godsRegion(i)).filter((r) => r === 'HEAVEN')).toHaveLength(16)
    expect(Array.from({ length: 34 }, (_, i) => godsRegion(i)).filter((r) => r === 'HELL')).toHaveLength(17)
    const ys = Array.from({ length: 34 }, (_, i) => godsNodePosition(i).y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    expect(godsNodePosition(16).y).toBeCloseTo(50, 0)
  })
})
