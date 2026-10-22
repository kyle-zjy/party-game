/**
 * Phase D.2 小姐牌事件框架：13 张牌的结算、K 国王传承、规则开关、重复提交保护、
 * 与塔罗/战术牌/喝酒提醒的联动、3–10 人行动顺序和旧存档兼容。
 * 每条测试都断言共享游戏状态的实际变化（不是只测文案）。
 */
import { describe, expect, it } from 'vitest'
import { LADY_CARDS } from '../../../shared/game/cards/ladyCards'
import { initGameState } from '../../../shared/game/engine/initGame'
import {
  applyCrazyCatch,
  applyDevStackLadyDeck,
  applyDuelChooseTarget,
  applyDuelRoll,
  applyKingTaskResolve,
  applyKingWriteTask,
  applyLadyHostCancel,
  applyLadyHostResult,
  applyLadyStart,
  applyLuckySevenRoll,
  applyMistressAccompany,
  applyOfferSubstitute,
  applyRespondSubstitute,
  applySetAway,
  finalizeGameAction,
  isLadyRuleActive,
  validateKingTaskContent,
} from '../../../shared/game/engine/ladyEvents'
import { normalizeGameState } from '../../../shared/game/engine/normalize'
import { applyJusticeSwap } from '../../../shared/game/engine/tarotActions'
import { TAROT_ID } from '../../../shared/game/engine/tarotEffects'
import {
  applyEndTurn,
  applyHostRulingAck,
  applyPlayTacticCard,
  applyResolveDrinkAck,
  applyRevealLadyCard,
  applyRollDice,
  applySkipTactic,
  applyUsePeach,
  GameActionError,
} from '../../../shared/game/engine/turnEngine'
import type { GameRoomPlayer } from '../../../shared/gameRoomTypes'
import type { GameState, LadyRuleset } from '../../../shared/game/types'

const NOW = 9000
const HOST = 'u1'

function players(n = 3): GameRoomPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ uid: `u${i + 1}`, nickname: `P${i + 1}`, seat: i, isHost: i === 0, joinedAt: 1 }))
}
/**
 * 'official' = Phase D.3 之前开局的 V1.5 旧房间（只有 K 自动结算，其余房主裁定）；
 * 'candidate-preview' = 自动结算全部 13 张（等同 V1.6 新房间的小姐牌行为）。
 */
function game(ruleset: LadyRuleset = 'candidate-preview', n = 3, tarotId: string = TAROT_ID.STAR): GameState {
  const s = initGameState(players(n), 1000, tarotId, () => 0, ruleset)
  return ruleset === 'official' ? { ...s, rulesVersion: 1 } : s
}
/** 把指定的牌放在牌堆顶，并让 uid 成为当前玩家、进入翻牌阶段 */
function atCard(state: GameState, cardId: string, uid = 'u1'): GameState {
  return {
    ...state,
    currentPlayerIndex: state.turnOrder.indexOf(uid),
    ladyDeck: [cardId, ...state.ladyDeck.filter((c) => c !== cardId)],
    recentLadyCards: [],
    turn: { ...state.turn, currentPlayerUid: uid, phase: 'LADY_CARD', revealedLadyCardId: null, pendingDecision: null },
  }
}
function reveal(state: GameState, cardId: string, uid = 'u1'): GameState {
  return applyRevealLadyCard(atCard(state, cardId, uid), uid, NOW).state
}
/** 模拟数据库层：每个动作写回前统一收尾（小姐陪喝） */
function act(prev: GameState, next: GameState): GameState {
  return finalizeGameAction(prev, next, NOW)
}
function acksFor(state: GameState, uid: string) {
  return state.pendingDrinkAcks.filter((a) => a.targetUid === uid)
}

// ---------------------------------------------------------------------------
// 规则开关
// ---------------------------------------------------------------------------
describe('规则开关：未确认的候选规则不会进入正式对局', () => {
  it('only K is confirmed; the other 12 stay pending with a candidate description', () => {
    for (const card of LADY_CARDS) {
      if (card.rank === 'K') expect(card.ruleStatus).toBe('confirmed')
      else {
        expect(card.ruleStatus).toBe('pending')
        expect(card.candidate).toBeDefined()
      }
    }
  })

  it('official game: every non-K card still produces the old HOST_RULING and no lady event', () => {
    for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q']) {
      const s = reveal(game('official'), `S-${rank}`)
      expect(s.ladyEvent).toBeNull()
      expect(s.turn.pendingDecision?.kind).toBe('HOST_RULING')
      expect(s.turn.phase).toBe('TACTIC')
      expect(s.pendingDrinkAcks).toEqual([])
      expect(s.ladyStatus.mistressUid).toBeNull()
      expect(s.ladyStatus.substitutePassUids).toEqual([])
    }
  })

  it('official game: K uses the confirmed king succession (no host ruling)', () => {
    const s = reveal(game('official'), 'H-K')
    expect(s.turn.pendingDecision).toBeNull()
    expect(s.ladyEvent?.step).toBe('KING_WRITE')
  })

  it('isLadyRuleActive gates candidates by ruleset', () => {
    const two = LADY_CARDS.find((c) => c.rank === '2')!
    const king = LADY_CARDS.find((c) => c.rank === 'K')!
    expect(isLadyRuleActive({ ladyRuleset: 'official', rulesVersion: 1 }, two)).toBe(false)
    expect(isLadyRuleActive({ ladyRuleset: 'candidate-preview', rulesVersion: 1 }, two)).toBe(true)
    expect(isLadyRuleActive({ ladyRuleset: 'official', rulesVersion: 1 }, king)).toBe(true)
    // V1.6 房间：13 张全部启用
    expect(isLadyRuleActive({ ladyRuleset: 'official', rulesVersion: 2 }, two)).toBe(true)
  })

  it('legacy rooms (no ladyRuleset field) normalize to official', () => {
    const legacy = { ...game('candidate-preview') } as Partial<GameState>
    delete legacy.rulesVersion
    delete legacy.ladyRuleset
    delete legacy.ladyEvent
    delete legacy.ladyStatus
    delete legacy.kingTask
    delete legacy.kingTaskHistory
    const s = normalizeGameState(legacy as GameState)
    expect(s.ladyRuleset).toBe('official')
    expect(s.ladyEvent).toBeNull()
    expect(s.kingTask).toBeNull()
    expect(s.kingTaskHistory).toEqual([])
    expect(s.ladyStatus).toEqual({ mistressUid: null, crazyUid: null, kingUid: null, substitutePassUids: [], awayPassUids: [], away: [] })
    // 旧房间翻到候选牌仍然是房主裁定
    expect(reveal(s, 'S-6').turn.pendingDecision?.kind).toBe('HOST_RULING')
  })

  it('dev deck stacking is refused in official games', () => {
    expect(() => applyDevStackLadyDeck(game('official'), '2')).toThrow(GameActionError)
    const s = applyDevStackLadyDeck(game('candidate-preview'), '9')
    expect(s.ladyDeck[0]!.endsWith('-9')).toBe(true)
    expect(s.ladyDeck).toHaveLength(52)
  })
})

// ---------------------------------------------------------------------------
// K 国王传承（正式规则）
// ---------------------------------------------------------------------------
describe('K 国王传承', () => {
  it('first K: drawer becomes first king, has nothing to perform, writes a task, reveal phase completes', () => {
    let s = reveal(game('official'), 'H-K', 'u1')
    expect(s.ladyStatus.kingUid).toBe('u1')
    expect(s.ladyEvent).toMatchObject({ step: 'KING_WRITE', actingUid: 'u1', status: 'ACTIVE' })
    expect(s.turn.phase).toBe('LADY_CARD')
    expect(() => applySkipTactic(s, 'u1', NOW)).toThrow(GameActionError)
    expect(() => applyEndTurn(s, 'u1', NOW)).toThrow(GameActionError)

    s = applyKingWriteTask(s, 'u1', HOST, s.ladyEvent!.eventId, '  用方言说一句祝酒词  ', NOW)
    expect(s.kingTask).toMatchObject({ content: '用方言说一句祝酒词', creatorUid: 'u1', status: 'PENDING', receiverUid: null, resolvedAtTurn: null, createdAtTurn: s.turnNumber })
    expect(s.ladyEvent?.status).toBe('RESOLVED')
    expect(s.turn.phase).toBe('TACTIC')
    expect(applyEndTurn(applySkipTactic(s, 'u1', NOW), 'u1', NOW).turn.currentPlayerUid).toBe('u2')
  })

  it('second king receives the previous task and who left it, host confirms, then leaves a new task', () => {
    let s = reveal(game('official'), 'H-K', 'u1')
    s = applyKingWriteTask(s, 'u1', HOST, s.ladyEvent!.eventId, '模仿一种动物叫三声', NOW)
    s = applyEndTurn(s, 'u1', NOW)
    const firstTaskId = s.kingTask!.taskId

    s = reveal(s, 'S-K', 'u2')
    expect(s.ladyStatus.kingUid).toBe('u2')
    expect(s.ladyEvent).toMatchObject({ step: 'KING_PERFORM', actingUid: 'u2', text: '模仿一种动物叫三声' })
    expect(s.kingTask).toMatchObject({ taskId: firstTaskId, status: 'IN_PROGRESS', receiverUid: 'u2', creatorUid: 'u1' })

    // 只有房主能确认完成；执行人自己不能确认完成
    expect(() => applyKingTaskResolve(s, 'u2', HOST, s.ladyEvent!.eventId, true, NOW)).toThrow(GameActionError)
    s = applyKingTaskResolve(s, HOST, HOST, s.ladyEvent!.eventId, true, NOW)
    expect(s.kingTask).toBeNull()
    expect(s.kingTaskHistory.at(-1)).toMatchObject({ taskId: firstTaskId, status: 'COMPLETED', receiverUid: 'u2', resolvedAtTurn: s.turnNumber })
    expect(s.ladyEvent?.step).toBe('KING_WRITE')

    s = applyKingWriteTask(s, 'u2', HOST, s.ladyEvent!.eventId, '给大家讲一个冷笑话', NOW)
    expect(s.kingTask).toMatchObject({ content: '给大家讲一个冷笑话', creatorUid: 'u2', status: 'PENDING' })
    expect(s.kingTask!.taskId).not.toBe(firstTaskId)
    expect(s.turn.phase).toBe('TACTIC')
  })

  it('the same player drawing K twice in a row still completes the handover', () => {
    let s = reveal(game('official'), 'H-K', 'u1')
    s = applyKingWriteTask(s, 'u1', HOST, s.ladyEvent!.eventId, '唱一句歌', NOW)
    // 下一轮又轮到 u1（直接构造），再次翻到 K
    s = reveal({ ...s, ladyEvent: null }, 'S-K', 'u1')
    expect(s.ladyEvent).toMatchObject({ step: 'KING_PERFORM', actingUid: 'u1' })
    expect(s.kingTask).toMatchObject({ creatorUid: 'u1', receiverUid: 'u1', status: 'IN_PROGRESS' })
    s = applyKingTaskResolve(s, HOST, HOST, s.ladyEvent!.eventId, true, NOW)
    s = applyKingWriteTask(s, 'u1', HOST, s.ladyEvent!.eventId, '做一个鬼脸', NOW)
    expect(s.kingTask).toMatchObject({ creatorUid: 'u1', content: '做一个鬼脸', status: 'PENDING' })
    expect(s.kingTaskHistory).toHaveLength(1)
  })

  it('skip / refuse: no coin or drink penalty and the turn continues; the king themself may skip', () => {
    let s = reveal(game('official'), 'H-K', 'u1')
    s = applyKingWriteTask(s, 'u1', HOST, s.ladyEvent!.eventId, '用三个词形容自己', NOW)
    s = applyEndTurn(s, 'u1', NOW)
    s = reveal(s, 'S-K', 'u2')
    const coins = Object.fromEntries(Object.values(s.players).map((p) => [p.uid, p.coins]))
    s = applyKingTaskResolve(s, 'u2', HOST, s.ladyEvent!.eventId, false, NOW)
    expect(s.kingTaskHistory.at(-1)?.status).toBe('SKIPPED')
    expect(s.pendingDrinkAcks).toEqual([])
    expect(Object.fromEntries(Object.values(s.players).map((p) => [p.uid, p.coins]))).toEqual(coins)
    // 不想留任务时，房主可以跳过留任务，回合照样继续
    s = applyKingWriteTask(s, HOST, HOST, s.ladyEvent!.eventId, null, NOW)
    expect(s.kingTask).toBeNull()
    expect(s.turn.phase).toBe('TACTIC')
    // 下一任国王因此成为"第一任"
    s = reveal(applyEndTurn(s, 'u2', NOW), 'C-K', 'u3')
    expect(s.ladyEvent?.step).toBe('KING_WRITE')
  })

  it('a task can only be received, processed and replaced once (duplicate submits are rejected)', () => {
    let s = reveal(game('official'), 'H-K', 'u1')
    const firstEvent = s.ladyEvent!.eventId
    s = applyKingWriteTask(s, 'u1', HOST, firstEvent, '学猫叫', NOW)
    expect(() => applyKingWriteTask(s, 'u1', HOST, firstEvent, '再写一条', NOW)).toThrow(GameActionError)
    s = applyEndTurn(s, 'u1', NOW)
    s = reveal(s, 'S-K', 'u2')
    const ev = s.ladyEvent!.eventId
    const resolved = applyKingTaskResolve(s, HOST, HOST, ev, true, NOW)
    expect(() => applyKingTaskResolve(resolved, HOST, HOST, ev, true, NOW)).toThrow(GameActionError)
    expect(() => applyKingTaskResolve(resolved, HOST, HOST, ev, false, NOW)).toThrow(GameActionError)
    expect(resolved.kingTaskHistory).toHaveLength(1)
    const written = applyKingWriteTask(resolved, 'u2', HOST, ev, '说一个绕口令', NOW)
    expect(() => applyKingWriteTask(written, 'u2', HOST, ev, '第二条', NOW)).toThrow(GameActionError)
    // 过期的事件 id（比如旧页面）也会被拒绝
    expect(() => applyKingWriteTask(written, 'u2', HOST, firstEvent, 'x', NOW)).toThrow(GameActionError)
  })

  it('only the king writes the task; host can only skip writing', () => {
    const s = reveal(game('official'), 'H-K', 'u2')
    expect(() => applyKingWriteTask(s, 'u3', HOST, s.ladyEvent!.eventId, '学猫叫', NOW)).toThrow(GameActionError)
    expect(() => applyKingWriteTask(s, HOST, HOST, s.ladyEvent!.eventId, '学猫叫', NOW)).toThrow(GameActionError)
    expect(() => applyKingWriteTask(s, 'u3', HOST, s.ladyEvent!.eventId, null, NOW)).toThrow(GameActionError)
  })

  it('task content limits: forced drinking, physical contact, privacy, danger and insults are refused', () => {
    expect(validateKingTaskContent('模仿一种动物叫三声').ok).toBe(true)
    for (const bad of ['喝光一整杯', '亲一下左边的人', '说出你的手机密码', '从窗户爬出去', '骂下家是废物', 'x', 'a'.repeat(81)]) {
      expect(validateKingTaskContent(bad).ok).toBe(false)
    }
    const s = reveal(game('official'), 'H-K', 'u1')
    expect(() => applyKingWriteTask(s, 'u1', HOST, s.ladyEvent!.eventId, '吹瓶', NOW)).toThrow(GameActionError)
  })

  it('task persists across a refresh (JSON round trip + normalize) and the receiver sees the same text', () => {
    let s = reveal(game('official'), 'H-K', 'u1')
    s = applyKingWriteTask(s, 'u1', HOST, s.ladyEvent!.eventId, '用方言说"干杯"', NOW)
    s = applyEndTurn(s, 'u1', NOW)
    const restored = normalizeGameState(JSON.parse(JSON.stringify(s)) as GameState)
    expect(restored.kingTask).toEqual(s.kingTask)
    const next = reveal(restored, 'S-K', 'u2')
    expect(next.ladyEvent?.text).toBe('用方言说"干杯"')
    // 刷新恢复进行中的事件：同一个 eventId、同一步
    const mid = normalizeGameState(JSON.parse(JSON.stringify(next)) as GameState)
    expect(mid.ladyEvent).toEqual(next.ladyEvent)
  })
})

// ---------------------------------------------------------------------------
// 候选规则
// ---------------------------------------------------------------------------
describe('A 替我喝', () => {
  function withPass(): GameState {
    let s = reveal(game(), 'S-A', 'u1')
    expect(s.ladyStatus.substitutePassUids).toEqual(['u1'])
    expect(s.turn.phase).toBe('TACTIC')
    s = { ...s, pendingDrinkAcks: [{ id: 'd1', targetUid: 'u1', amount: 1, reason: '测试', createdAt: 1 }] }
    return s
  }

  it('offer → accept moves the reminder and consumes the pass; it can only be used once', () => {
    let s = applyOfferSubstitute(withPass(), 'u1', 'd1', 'u2', NOW)
    expect(s.pendingDrinkAcks[0]!.substituteOffer).toEqual({ fromUid: 'u1', toUid: 'u2' })
    expect(() => applyRespondSubstitute(s, 'u3', HOST, 'd1', true, NOW)).toThrow(GameActionError)
    s = applyRespondSubstitute(s, 'u2', HOST, 'd1', true, NOW)
    expect(s.pendingDrinkAcks[0]).toMatchObject({ targetUid: 'u2', transferredFromUid: 'u1' })
    expect(s.pendingDrinkAcks[0]!.substituteOffer).toBeUndefined()
    expect(s.ladyStatus.substitutePassUids).toEqual([])
    // 再来一条提醒：已经没有替喝机会了
    s = { ...s, pendingDrinkAcks: [...s.pendingDrinkAcks, { id: 'd2', targetUid: 'u1', amount: 1, reason: 'x', createdAt: 1 }] }
    expect(() => applyOfferSubstitute(s, 'u1', 'd2', 'u3', NOW)).toThrow(GameActionError)
    // 重复接受同一个请求也被拒绝
    expect(() => applyRespondSubstitute(s, 'u2', HOST, 'd1', true, NOW)).toThrow(GameActionError)
  })

  it('the recipient can refuse; the pass is kept and the reminder stays with the holder', () => {
    let s = applyOfferSubstitute(withPass(), 'u1', 'd1', 'u2', NOW)
    s = applyRespondSubstitute(s, 'u2', HOST, 'd1', false, NOW)
    expect(s.pendingDrinkAcks[0]).toMatchObject({ targetUid: 'u1' })
    expect(s.pendingDrinkAcks[0]!.substituteOffer).toBeUndefined()
    expect(s.ladyStatus.substitutePassUids).toEqual(['u1'])
  })

  it('no loops: a transferred reminder cannot be transferred again, even by another pass holder', () => {
    let s = applyOfferSubstitute(withPass(), 'u1', 'd1', 'u2', NOW)
    s = applyRespondSubstitute(s, 'u2', HOST, 'd1', true, NOW)
    s = { ...s, ladyStatus: { ...s.ladyStatus, substitutePassUids: ['u2'] } }
    expect(() => applyOfferSubstitute(s, 'u2', 'd1', 'u1', NOW)).toThrow(/不能再转/)
  })

  it('at most one pass per player; half-cup and Temperance are excluded', () => {
    let s = reveal(game(), 'S-A', 'u1')
    s = reveal({ ...s, ladyEvent: null }, 'H-A', 'u1')
    expect(s.ladyStatus.substitutePassUids).toEqual(['u1'])
    const half = { ...s, pendingDrinkAcks: [{ id: 'h', targetUid: 'u1', amount: 0, amountText: '半杯', reason: 'x', createdAt: 1 }] }
    expect(() => applyOfferSubstitute(half, 'u1', 'h', 'u2', NOW)).toThrow(/半杯/)
    const temperance = { ...withPass(), currentTarotId: TAROT_ID.TEMPERANCE }
    expect(() => applyOfferSubstitute(temperance, 'u1', 'd1', 'u2', NOW)).toThrow(/节制/)
  })

  it('accepting a substitute does not trigger the mistress (it is a transfer, not a new punishment)', () => {
    let s: GameState = { ...withPass(), ladyStatus: { ...withPass().ladyStatus, mistressUid: 'u3' } }
    s = act(s, applyOfferSubstitute(s, 'u1', 'd1', 'u2', NOW))
    s = act(s, applyRespondSubstitute(s, 'u2', HOST, 'd1', true, NOW))
    expect(acksFor(s, 'u3')).toEqual([])
  })
})

describe('2 小姐牌', () => {
  it('starts, transfers to the next 2, and the old mistress stops accompanying', () => {
    let s = reveal(game(), 'S-2', 'u1')
    expect(s.ladyStatus.mistressUid).toBe('u1')
    let after = act(s, applyPlayTacticCard({ ...s, players: { ...s.players, u1: { ...s.players.u1!, tacticHand: ['tactic-sha'] } } }, 'u1', 'tactic-sha', 'u2', NOW))
    expect(acksFor(after, 'u1')).toHaveLength(1)
    expect(acksFor(after, 'u1')[0]!.accompany).toBe(true)

    s = applyEndTurn(after, 'u1', NOW)
    s = reveal(s, 'H-2', 'u2')
    expect(s.ladyStatus.mistressUid).toBe('u2')
    const beforeIds = new Set(s.pendingDrinkAcks.map((a) => a.id))
    after = act(s, applyCrazyCatch({ ...s, ladyStatus: { ...s.ladyStatus, crazyUid: 'u1' } }, HOST, HOST, 'u3', NOW))
    // u3 被罚，新小姐 u2 陪喝；旧小姐 u1 不再陪
    const added = after.pendingDrinkAcks.filter((a) => !beforeIds.has(a.id))
    expect(added.map((a) => [a.targetUid, a.accompany === true])).toEqual([
      ['u3', false],
      ['u2', true],
    ])
  })

  it('the mistress is not doubly penalised when she herself is punished', () => {
    const s = { ...game(), ladyStatus: { ...game().ladyStatus, mistressUid: 'u2' } }
    const after = act(s, applyCrazyCatch({ ...s, ladyStatus: { ...s.ladyStatus, crazyUid: 'u1' } }, HOST, HOST, 'u2', NOW))
    expect(acksFor(after, 'u2')).toHaveLength(1)
    expect(acksFor(after, 'u2')[0]!.accompany).toBeUndefined()
  })

  it('accompany reminders never trigger another accompany (no recursion)', () => {
    const s = { ...game(), ladyStatus: { ...game().ladyStatus, mistressUid: 'u2' } }
    const once = applyMistressAccompany(s, { ...s, pendingDrinkAcks: [{ id: 'x', targetUid: 'u3', amount: 1, reason: 'r', createdAt: 1 }] }, NOW)
    expect(once.pendingDrinkAcks).toHaveLength(2)
    // 同一次动作重复收尾也不会再加（幂等）
    const twice = applyMistressAccompany(s, once, NOW)
    expect(twice.pendingDrinkAcks).toHaveLength(2)
    expect(applyMistressAccompany(once, once, NOW).pendingDrinkAcks).toHaveLength(2)
  })

  it('2 + 6: one 干杯 reminder per player and no extra accompany (the mistress already drinks)', () => {
    let s = reveal(game('candidate-preview', 4), 'S-2', 'u1')
    s = applyEndTurn(s, 'u1', NOW)
    const prev = atCard(s, 'H-6', 'u2')
    const after = act(prev, applyRevealLadyCard(prev, 'u2', NOW).state)
    const cheers = after.pendingDrinkAcks.filter((a) => a.reason.includes('干杯'))
    expect(cheers.map((a) => a.targetUid).sort()).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(after.pendingDrinkAcks.filter((a) => a.accompany)).toHaveLength(0)
  })

  it('resolving a drink reminder (any choice) never creates new reminders', () => {
    const s = { ...game(), ladyStatus: { ...game().ladyStatus, mistressUid: 'u2' }, pendingDrinkAcks: [{ id: 'z', targetUid: 'u3', amount: 1, reason: 'r', createdAt: 1 }] }
    const after = act(s, applyResolveDrinkAck(s, 'u3', HOST, 'z', 'WATER', NOW))
    expect(after.pendingDrinkAcks).toEqual([])
  })
})

describe('3 / 4 / 5 房主确认结果', () => {
  for (const rank of ['3', '4', '5'] as const) {
    it(`${rank}: start → host picks loser → 1 sip, then TACTIC`, () => {
      let s = reveal(game(), `C-${rank}`, 'u1')
      expect(s.ladyEvent).toMatchObject({ step: 'START', status: 'ACTIVE' })
      expect(s.turn.phase).toBe('LADY_CARD')
      const id = s.ladyEvent!.eventId
      expect(() => applyLadyStart(s, 'u3', HOST, id, null, NOW)).toThrow(GameActionError)
      s = applyLadyStart(s, 'u1', HOST, id, rank === '3' ? '动物园' : null, NOW)
      expect(s.ladyEvent?.step).toBe('HOST_RESULT')
      if (rank === '3') expect(s.ladyEvent?.text).toBe('动物园')
      expect(() => applyLadyHostResult(s, 'u2', HOST, id, 'u3', NOW)).toThrow(GameActionError)
      s = applyLadyHostResult(s, HOST, HOST, id, 'u3', NOW)
      expect(acksFor(s, 'u3')).toHaveLength(1)
      expect(s.ladyEvent).toMatchObject({ status: 'RESOLVED', result: { loserUids: ['u3'] } })
      expect(s.turn.phase).toBe('TACTIC')
      // 重复确认被拒绝，不会重复罚
      expect(() => applyLadyHostResult(s, HOST, HOST, id, 'u3', NOW)).toThrow(GameActionError)
    })
  }

  it('4: nobody moved → no one punished; the drawer is not a participant', () => {
    let s = reveal(game(), 'C-4', 'u2')
    expect(s.ladyEvent!.participants).not.toContain('u2')
    s = applyLadyStart(s, 'u2', HOST, s.ladyEvent!.eventId, null, NOW)
    expect(s.ladyEvent!.startedAt).toBe(NOW)
    expect(() => applyLadyHostResult(s, HOST, HOST, s.ladyEvent!.eventId, 'u2', NOW)).toThrow(GameActionError)
    s = applyLadyHostResult(s, HOST, HOST, s.ladyEvent!.eventId, null, NOW)
    expect(s.pendingDrinkAcks).toEqual([])
    expect(s.turn.phase).toBe('TACTIC')
  })

  it('5: reaching 30 with no mistakes means everyone succeeds', () => {
    let s = reveal(game(), 'C-5', 'u1')
    s = applyLadyStart(s, 'u1', HOST, s.ladyEvent!.eventId, null, NOW)
    s = applyLadyHostResult(s, HOST, HOST, s.ladyEvent!.eventId, null, NOW)
    expect(s.ladyEvent!.result!.summary).toContain('全员成功')
  })

  it('host can cancel a stuck event without punishing anyone', () => {
    const s = reveal(game(), 'C-3', 'u2')
    expect(() => applyLadyHostCancel(s, 'u2', HOST, s.ladyEvent!.eventId, NOW)).toThrow(GameActionError)
    const after = applyLadyHostCancel(s, HOST, HOST, s.ladyEvent!.eventId, NOW)
    expect(after.turn.phase).toBe('TACTIC')
    expect(after.pendingDrinkAcks).toEqual([])
  })
})

describe('6 干杯', () => {
  it('every player including the drawer gets exactly one reminder; turn continues at once', () => {
    const s = reveal(game('candidate-preview', 5), 'D-6', 'u3')
    expect(s.pendingDrinkAcks.map((a) => a.targetUid).sort()).toEqual(['u1', 'u2', 'u3', 'u4', 'u5'])
    expect(s.turn.phase).toBe('TACTIC')
  })
})

describe('7 幸运七：事件骰与移动骰隔离', () => {
  it('natural 6 pays 2 coins via the bank and does not grant an extra roll or move anyone', () => {
    let s = reveal(game('candidate-preview', 3, TAROT_ID.FOOL), 'S-7', 'u1')
    const pos = s.players.u1!.position
    const coins = s.players.u1!.coins
    const turnBefore = s.turn
    s = applyLuckySevenRoll(s, 'u1', HOST, s.ladyEvent!.eventId, 6, NOW)
    expect(s.players.u1!.coins).toBe(coins + 2) // 愚者不修正事件骰
    expect(s.players.u1!.position).toBe(pos)
    expect(s.turn.lastRoll).toEqual(turnBefore.lastRoll)
    expect(s.turn.extraRollPending).toBe(false)
    expect(s.turn.phase).toBe('TACTIC')
    expect(s.ladyEvent!.rolls).toEqual([6])
  })

  it('natural 1 gives a drink reminder; others nothing; Lovers partner gets +1 on the bank payout', () => {
    const one = reveal(game(), 'S-7', 'u1')
    expect(acksFor(applyLuckySevenRoll(one, 'u1', HOST, one.ladyEvent!.eventId, 1, NOW), 'u1')).toHaveLength(1)
    const three = applyLuckySevenRoll(one, 'u1', HOST, one.ladyEvent!.eventId, 3, NOW)
    expect(three.pendingDrinkAcks).toEqual([])
    expect(three.players.u1!.coins).toBe(one.players.u1!.coins)

    let lovers = game('candidate-preview', 3, TAROT_ID.STAR)
    lovers = { ...lovers, currentTarotId: TAROT_ID.LOVERS, tarotState: { loversPair: ['u1', 'u3'] } }
    const l = reveal(lovers, 'S-7', 'u1')
    const paid = applyLuckySevenRoll(l, 'u1', HOST, l.ladyEvent!.eventId, 6, NOW)
    expect(paid.players.u3!.coins).toBe(l.players.u3!.coins + 1)
  })

  it('cannot roll twice; other players cannot roll; movement dice are blocked during the event', () => {
    const s = reveal(game(), 'S-7', 'u1')
    expect(() => applyLuckySevenRoll(s, 'u2', HOST, s.ladyEvent!.eventId, 6, NOW)).toThrow(GameActionError)
    expect(() => applyRollDice(s, 'u1', 6, NOW)).toThrow(GameActionError)
    const done = applyLuckySevenRoll(s, 'u1', HOST, s.ladyEvent!.eventId, 6, NOW)
    expect(() => applyLuckySevenRoll(done, 'u1', HOST, s.ladyEvent!.eventId, 6, NOW)).toThrow(GameActionError)
  })
})

describe('8 暂离通行证', () => {
  it('gives a pass (max 1); away status never blocks or skips turns', () => {
    let s = reveal(game(), 'S-8', 'u1')
    s = reveal({ ...s, ladyEvent: null }, 'H-8', 'u1')
    expect(s.ladyStatus.awayPassUids).toEqual(['u1'])
    s = applySetAway(s, 'u2', HOST, 'u2', true, false, NOW) // 没有通行证也可以离席，不受罚
    expect(s.pendingDrinkAcks).toEqual([])
    s = applySetAway(s, 'u1', HOST, 'u1', true, true, NOW)
    expect(s.ladyStatus.awayPassUids).toEqual([])
    s = applyEndTurn(applySkipTactic(s, 'u1', NOW), 'u1', NOW)
    expect(s.turn.currentPlayerUid).toBe('u2') // 暂离的人依然按顺序轮到，不被跳过
    expect(s.turn.phase).toBe('ROLLING')
    s = applySetAway(s, 'u2', HOST, 'u2', false, false, NOW)
    expect(s.ladyStatus.away.map((a) => a.uid)).toEqual(['u1'])
    // 房主可以把别人标记为已回来，但不能替别人使用通行证
    expect(() => applySetAway(s, HOST, HOST, 'u3', true, true, NOW)).toThrow(GameActionError)
    expect(() => applySetAway(s, 'u3', HOST, 'u2', true, false, NOW)).toThrow(GameActionError)
  })

  it('a player away with a pass cannot be picked as duel opponent or mini-game loser', () => {
    let s = applySetAway({ ...game(), ladyStatus: { ...game().ladyStatus, awayPassUids: ['u3'] } }, 'u3', HOST, 'u3', true, true, NOW)
    const duel = reveal(s, 'S-9', 'u1')
    expect(() => applyDuelChooseTarget(duel, 'u1', duel.ladyEvent!.eventId, 'u3', NOW)).toThrow(/暂离/)
    s = reveal(s, 'S-3', 'u1')
    expect(s.ladyEvent!.participants).not.toContain('u3')
  })
})

describe('9 决斗', () => {
  function duel(): GameState {
    let s = reveal(game('candidate-preview', 3, TAROT_ID.CHARIOT), 'S-9', 'u1')
    s = applyDuelChooseTarget(s, 'u1', s.ladyEvent!.eventId, 'u2', NOW)
    expect(s.ladyEvent).toMatchObject({ step: 'DUEL_ROLL', targetUid: 'u2' })
    return s
  }

  it('lower roll loses and gets a reminder (Chariot does not modify duel dice)', () => {
    let s = duel()
    const id = s.ladyEvent!.eventId
    s = applyDuelRoll(s, 'u1', HOST, id, 'actor', 5, NOW)
    expect(() => applyDuelRoll(s, 'u1', HOST, id, 'actor', 2, NOW)).toThrow(GameActionError)
    expect(() => applyDuelRoll(s, 'u3', HOST, id, 'target', 2, NOW)).toThrow(GameActionError)
    s = applyDuelRoll(s, 'u2', HOST, id, 'target', 4, NOW)
    expect(s.ladyEvent).toMatchObject({ status: 'RESOLVED', result: { loserUids: ['u2'] } })
    expect(s.ladyEvent!.duelRounds).toEqual([{ actorRoll: 5, targetRoll: 4 }])
    expect(acksFor(s, 'u2')).toHaveLength(1)
    expect(s.turn.phase).toBe('TACTIC')
  })

  it('ties reroll; three ties means nobody loses', () => {
    let s = duel()
    const id = s.ladyEvent!.eventId
    for (let round = 1; round <= 3; round += 1) {
      s = applyDuelRoll(s, 'u1', HOST, id, 'actor', 3, NOW)
      s = applyDuelRoll(s, HOST, HOST, id, 'target', 3, NOW) // 房主代掷也可以
      if (round < 3) expect(s.ladyEvent!.duelRounds).toHaveLength(round + 1)
    }
    expect(s.ladyEvent).toMatchObject({ status: 'RESOLVED', result: { loserUids: [] } })
    expect(s.pendingDrinkAcks).toEqual([])
  })

  it('tie then a decisive second round', () => {
    let s = duel()
    const id = s.ladyEvent!.eventId
    s = applyDuelRoll(applyDuelRoll(s, 'u1', HOST, id, 'actor', 2, NOW), 'u2', HOST, id, 'target', 2, NOW)
    s = applyDuelRoll(applyDuelRoll(s, 'u2', HOST, id, 'target', 6, NOW), 'u1', HOST, id, 'actor', 1, NOW)
    expect(s.ladyEvent!.result!.loserUids).toEqual(['u1'])
    expect(s.ladyEvent!.duelRounds).toHaveLength(2)
  })

  it('cannot duel yourself; only the drawer chooses', () => {
    const s = reveal(game(), 'S-9', 'u1')
    expect(() => applyDuelChooseTarget(s, 'u1', s.ladyEvent!.eventId, 'u1', NOW)).toThrow(GameActionError)
    expect(() => applyDuelChooseTarget(s, 'u2', s.ladyEvent!.eventId, 'u3', NOW)).toThrow(GameActionError)
  })
})

describe('10 神经病', () => {
  it('persists across turns, host records violators, and the next 10 replaces it', () => {
    let s = reveal(game(), 'S-10', 'u1')
    expect(s.ladyStatus.crazyUid).toBe('u1')
    s = applyEndTurn(s, 'u1', NOW)
    expect(s.ladyStatus.crazyUid).toBe('u1')
    expect(() => applyCrazyCatch(s, 'u2', HOST, 'u3', NOW)).toThrow(GameActionError)
    expect(() => applyCrazyCatch(s, HOST, HOST, 'u1', NOW)).toThrow(GameActionError)
    s = applyCrazyCatch(s, HOST, HOST, 'u3', NOW)
    expect(acksFor(s, 'u3')).toHaveLength(1)
    s = reveal(s, 'H-10', 'u2')
    expect(s.ladyStatus.crazyUid).toBe('u2')
  })

  it('without a crazy player the host cannot record anything', () => {
    expect(() => applyCrazyCatch(game(), HOST, HOST, 'u2', NOW)).toThrow(GameActionError)
  })
})

describe('J / Q 左边喝 / 右边喝', () => {
  it('J → previous player in turn order, Q → next player (wrapping)', () => {
    expect(acksFor(reveal(game('candidate-preview', 4), 'S-J', 'u1'), 'u4')).toHaveLength(1)
    expect(acksFor(reveal(game('candidate-preview', 4), 'S-Q', 'u1'), 'u2')).toHaveLength(1)
    expect(acksFor(reveal(game('candidate-preview', 4), 'S-Q', 'u4'), 'u1')).toHaveLength(1)
  })

  it('after a Justice swap the neighbours follow the swapped seats (turn order), not the lobby seat numbers', () => {
    let s = game('candidate-preview', 4, TAROT_ID.JUSTICE)
    expect(s.turn.pendingDecision?.kind).toBe('TAROT_JUSTICE')
    s = applyJusticeSwap(s, HOST, HOST, 'u1', 'u3', NOW) // 交换座位：u1 ↔ u3
    expect(s.turnOrder).toEqual(['u3', 'u2', 'u1', 'u4'])
    const j = reveal(s, 'S-J', 'u1')
    expect(j.ladyEvent!.targetUid).toBe('u2')
    const q = reveal(s, 'S-Q', 'u1')
    expect(q.ladyEvent!.targetUid).toBe('u4')
  })
})

// ---------------------------------------------------------------------------
// 联动与通用保护
// ---------------------------------------------------------------------------
describe('联动：塔罗、战术牌、喝酒提醒', () => {
  it('桃 can cancel a lady-card reminder; Temperance still blocks water and peach on it', () => {
    let s = reveal(game(), 'S-Q', 'u1')
    const ack = acksFor(s, 'u2')[0]!
    s = { ...s, players: { ...s.players, u3: { ...s.players.u3!, tacticHand: ['tactic-tao'] } } }
    const saved = applyUsePeach(s, 'u3', ack.id, NOW)
    expect(acksFor(saved, 'u2')).toEqual([])
    const temperance = { ...s, currentTarotId: TAROT_ID.TEMPERANCE }
    expect(() => applyUsePeach(temperance, 'u3', ack.id, NOW)).toThrow(GameActionError)
    // V1.6 Q5：以水代替不受节制影响
    expect(applyResolveDrinkAck(temperance, 'u2', HOST, ack.id, 'WATER', NOW).pendingDrinkAcks).toEqual([])
    // 跳过始终可以
    expect(applyResolveDrinkAck(temperance, 'u2', HOST, ack.id, 'SKIP', NOW).pendingDrinkAcks).toEqual([])
  })

  it('tactic phase still works after a lady event (one active card)', () => {
    let s = reveal(game(), 'S-J', 'u1')
    s = { ...s, players: { ...s.players, u1: { ...s.players.u1!, tacticHand: ['tactic-sha', 'tactic-sha'] } } }
    s = applyPlayTacticCard(s, 'u1', 'tactic-sha', 'u2', NOW)
    expect(() => applyPlayTacticCard(s, 'u1', 'tactic-sha', 'u2', NOW)).toThrow(GameActionError)
    expect(applyEndTurn(s, 'u1', NOW).ladyEvent).toBeNull()
  })

  it('a heart attack triggered by the same reveal is recorded alongside the lady event', () => {
    const s = atCard(game(), 'H-K')
    const after = applyRevealLadyCard({ ...s, recentLadyCards: ['H-2'] }, 'u1', NOW).state
    expect(after.pendingHeartAttack).not.toBeNull()
    expect(after.ladyEvent?.rank).toBe('K')
  })

  it('end turn clears the finished event but keeps persistent status and the king task', () => {
    let s = reveal(game(), 'S-2', 'u1')
    s = applyEndTurn(s, 'u1', NOW)
    expect(s.ladyEvent).toBeNull()
    expect(s.ladyStatus.mistressUid).toBe('u1')
  })

  it('host-ruling cards in official games still go through the old ack and then end turn', () => {
    let s = reveal(game('official'), 'S-6', 'u1')
    s = applyHostRulingAck(s, HOST, HOST, NOW)
    expect(applyEndTurn(s, 'u1', NOW).turn.currentPlayerUid).toBe('u2')
  })
})

describe('3–10 人行动顺序', () => {
  for (let n = 3; n <= 10; n += 1) {
    it(`${n} players: J/Q neighbours and turn rotation are correct`, () => {
      const s = game('candidate-preview', n)
      expect(s.turnOrder).toEqual(Array.from({ length: n }, (_, i) => `u${i + 1}`))
      for (let i = 0; i < n; i += 1) {
        const uid = `u${i + 1}`
        const prev = `u${((i - 1 + n) % n) + 1}`
        const next = `u${((i + 1) % n) + 1}`
        expect(reveal(s, 'S-J', uid).ladyEvent!.targetUid).toBe(prev)
        expect(reveal(s, 'S-Q', uid).ladyEvent!.targetUid).toBe(next)
      }
      let t = s
      for (let k = 0; k < n; k += 1) {
        const uid = t.turn.currentPlayerUid
        t = applyEndTurn(applySkipTactic(reveal(t, 'S-6', uid), uid, NOW), uid, NOW)
      }
      expect(t.turn.currentPlayerUid).toBe('u1')
    })
  }
})
