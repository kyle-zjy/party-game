/**
 * 全流程模拟（D.6）：3 / 6 / 10 人从开局一路玩到终局排行榜，只调用正式引擎动作，
 * 每一步都经过和数据库层相同的收尾（小姐陪喝），并且每回合做一次 JSON 往返 + normalize
 * 模拟刷新恢复。验证：回合轮转正确、金币永不为负、终局只结算一次、结束后状态固定。
 */
import { describe, expect, it } from 'vitest'
import { initGameState } from '../../../shared/game/engine/initGame'
import { normalizeGameState } from '../../../shared/game/engine/normalize'
import { seededRng } from '../../../shared/game/cards/ladyDeck'
import { finalizeGameAction } from '../../../shared/game/engine/ladyEvents'
import { continueEndgame } from '../../../shared/game/engine/endgame'
import {
  applyAdvanceAfterLanding,
  applyEndTurn,
  applyResolveDrinkAck,
  applyResolveHeartAttack,
  applyResolveLanding,
  applyRevealLadyCard,
  applyRollDice,
  applySkipRollTurn,
  applySkipTactic,
} from '../../../shared/game/engine/turnEngine'
import { applyTarotDiscard } from '../../../shared/game/engine/tarotActions'
import { applyTexasBet } from '../../../shared/game/engine/texas'
import { GODS_FINISH_NODE } from '../../../shared/game/godsPath'
import { settleEverything } from './settleAll'
import type { GameRoomPlayer } from '../../../shared/gameRoomTypes'
import type { GameState } from '../../../shared/game/types'

const HOST = 'u1'

function roomPlayers(n: number): GameRoomPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ uid: `u${i + 1}`, nickname: `P${i + 1}`, seat: i, isHost: i === 0, joinedAt: 1 }))
}

/** 每个动作像数据库层一样收尾，再像刷新一样做 JSON 往返 */
function step(prev: GameState, next: GameState, now: number): GameState {
  const finalized = finalizeGameAction(prev, next, now)
  return normalizeGameState(JSON.parse(JSON.stringify(finalized)) as GameState)
}

/** 非阻塞的公共事项：心脏病、喝酒提醒、死神弃牌、德州下注——由房主/本人处理 */
function clearSideQueues(s: GameState, now: number): GameState {
  if (s.pendingHeartAttack) s = step(s, applyResolveHeartAttack(s, HOST, HOST, null, [], now), now)
  for (const uid of [...s.pendingTarotDiscards]) {
    const card = s.players[uid]!.tacticHand[0]
    if (card) s = step(s, applyTarotDiscard(s, HOST, HOST, uid, card, now), now)
  }
  for (let i = 0; i < 6 && s.texas.betting && s.texas.betting.awaiting.length > 0; i += 1) {
    s = step(s, applyTexasBet(s, s.texas.betting.awaiting[0]!, s.texas.betting.betUid ? 'FOLD' : 'CHECK', now), now)
  }
  for (const ack of [...s.pendingDrinkAcks]) {
    if (ack.bluff || ack.substituteOffer) continue
    s = step(s, applyResolveDrinkAck(s, HOST, HOST, ack.id, 'WATER', now), now)
  }
  return s
}

function playTurn(s: GameState, rng: () => number, now: number): GameState {
  const uid = s.turn.currentPlayerUid
  s = settleEverything(s, uid, HOST, now)
  if (s.players[uid]!.skipNextRoll) {
    s = step(s, applySkipRollTurn(s, uid, now), now)
  } else {
    for (let rolls = 0; rolls < 2 && s.turn.phase === 'ROLLING'; rolls += 1) {
      const natural = Math.floor(rng() * 6) + 1
      s = step(s, applyRollDice(s, uid, natural, now), now)
      s = step(s, applyResolveLanding(s, uid, now, rng).state, now)
      s = step(s, settleEverything(s, uid, HOST, now), now)
      s = step(s, applyAdvanceAfterLanding(s, uid, now), now)
    }
  }
  s = clearSideQueues(s, now)
  s = step(s, applyRevealLadyCard(s, uid, now, rng).state, now)
  s = step(s, settleEverything(s, uid, HOST, now), now)
  s = clearSideQueues(s, now)
  s = step(s, applySkipTactic(s, uid, now), now)
  s = step(s, continueEndgame(applyEndTurn(s, uid, now), now), now)
  return s
}

function runFullGame(n: number, seed: number): { s: GameState; turns: number } {
  const rng = seededRng(seed)
  let s = initGameState(roomPlayers(n), 1000, 'tarot-17', rng)
  let now = 2000
  let turns = 0
  for (; turns < 400 && !s.endgame; turns += 1) {
    const expected = s.turnOrder[s.currentPlayerIndex]
    expect(s.turn.currentPlayerUid).toBe(expected)
    s = playTurn(s, rng, (now += 10))
    for (const p of Object.values(s.players)) expect(p.coins).toBeGreaterThanOrEqual(0)
    // 让对局在合理的回合数内结束：60 回合后把下一位玩家放到终点前一格（仍然走正式移动）
    if (turns === 60 && !s.endgame) {
      const next = s.turn.currentPlayerUid
      s = { ...s, godsPathOpen: true, players: { ...s.players, [next]: { ...s.players[next]!, zone: { kind: 'gods', node: GODS_FINISH_NODE - 1, dir: 1 }, skipNextRoll: false } } }
      s = { ...s, turn: { ...s.turn, phase: 'ROLLING' } }
      s = step(s, applyRollDice(s, next, 1, now), now)
      s = step(s, applyResolveLanding(s, next, now, rng).state, now)
      s = step(s, settleEverything(s, next, HOST, now), now)
      s = step(s, applyAdvanceAfterLanding(s, next, now), now)
      s = step(s, applyRevealLadyCard(s, next, now, rng).state, now)
      s = step(s, settleEverything(s, next, HOST, now), now)
      s = clearSideQueues(s, now)
      s = step(s, continueEndgame(applyEndTurn(s, next, now), now), now)
    }
  }
  // 终局阿瓦隆收尾
  for (let i = 0; i < 12 && s.endgame && s.endgame.phase !== 'DONE'; i += 1) {
    s = step(s, continueEndgame(settleEverything(s, s.turn.currentPlayerUid, HOST, now), now), now)
  }
  return { s, turns }
}

describe('全流程：开局 → 地图 → 小姐牌 → 战术 → 德州 → 阿瓦隆 → 终局排行榜', () => {
  for (const [n, seed] of [
    [3, 11],
    [6, 22],
    [10, 33],
  ] as const) {
    it(`${n} 人完整对局可以打到正式终局，并且只结算一次`, () => {
      const { s, turns } = runFullGame(n, seed)
      expect(turns).toBeGreaterThan(n)
      expect(s.endgame?.phase).toBe('DONE')
      expect(s.finished).toBe(true)
      expect(s.endgame!.scores).toHaveLength(n)
      expect(s.endgame!.winners.length).toBeGreaterThanOrEqual(1)
      // 抵达终点奖励只给抵达者
      const finishers = s.endgame!.scores!.filter((x) => x.finishBonus === 10).map((x) => x.uid)
      expect(finishers).toEqual(s.turnOrder.filter((u) => s.players[u]!.reachedFinish))
      // 德州周期已经收尾，阿瓦隆已经决出或打满 5 轮
      expect(s.texas.stage).toBe('DONE')
      expect(s.avalon.winner !== null || s.avalon.results.length === 5).toBe(true)
      // 再调用一次收尾不会改变结果
      expect(continueEndgame(s, 999999)).toBe(s)
      // 排名单调
      const totals = s.endgame!.scores!.map((x) => x.total)
      expect([...totals].sort((a, b) => b - a)).toEqual(totals)
    })
  }
})
