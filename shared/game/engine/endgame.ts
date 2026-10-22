/**
 * 终局与计分。
 *
 * 原稿（V1.5）：有玩家到达终点时完成当前回合；德州补齐公共牌结算；阵营按顺序继续发车后结算。
 * 得分 = 抵达终点 10 分 + 每金币 1 分 + 每地产 2 分 + 每完整同色套装额外 2 分，最高者获胜。
 * V1.6 补充：
 * - 抵达者结束自己的回合时进入终局，不再开启新的地图回合。
 * - 德州：补齐公共牌直接摊牌；预存底池回银行。
 * - 阿瓦隆：还没有阵营达到 3 次时进入"终局任务阶段"，由当前车主（抵达者开始，按行动顺序轮换）发车，直到决出或打满 5 轮。
 * - 平分：依次比较金币、地产数、有效完整套装数，仍相同则并列。
 * - 抵押地产计入地产数，不计入有效完整套装。
 * - 结束后状态固定：finished = true，所有动作被拒绝。
 */
import type { EndgameState, FinalScore, GameState } from '../types'
import { avalonOver, startAvalonMission } from './avalon'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { fullSetCount } from './properties'
import { clonePlayers } from './stateHelpers'
import { finishTexasForEndgame } from './texas'

export const FINISH_BONUS = 10
export const PROPERTY_POINTS = 2
export const SET_POINTS = 2

export function computeScores(state: GameState): FinalScore[] {
  const raw = state.turnOrder.map((uid) => {
    const p = state.players[uid]!
    const finishBonus = p.reachedFinish ? FINISH_BONUS : 0
    const sets = fullSetCount(p)
    const propertyPoints = p.properties.length * PROPERTY_POINTS
    const setPoints = sets * SET_POINTS
    return {
      uid,
      finishBonus,
      coins: p.coins,
      properties: p.properties.length,
      propertyPoints,
      fullSets: sets,
      setPoints,
      total: finishBonus + p.coins + propertyPoints + setPoints,
      rank: 0,
    }
  })
  const key = (s: FinalScore) => [s.total, s.coins, s.properties, s.fullSets]
  const sorted = [...raw].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i += 1) if (kb[i]! !== ka[i]!) return kb[i]! - ka[i]!
    return 0
  })
  let rank = 0
  let prev: number[] | null = null
  sorted.forEach((s, i) => {
    const k = key(s)
    if (!prev || k.some((v, j) => v !== prev![j])) rank = i + 1
    s.rank = rank
    prev = k
  })
  return sorted
}

/** 抵达者结束回合时调用：德州补齐摊牌，然后阿瓦隆收尾或直接计分 */
export function startEndgame(state: GameState, triggeredByUid: string, now: number): GameState {
  if (state.endgame) throw new GameActionError('INVALID_GAME_ACTION', '已经进入终局')
  let s: GameState = {
    ...state,
    history: appendHistory(state.history, '有人抵达终点！地图回合结束，正在完成德州和阵营结算。', now, triggeredByUid),
  }
  s = finishTexasForEndgame(s, now)
  const endgame: EndgameState = { triggeredByUid, triggeredAt: now, phase: 'AVALON', scores: null, winners: [], notes: [] }
  s = { ...s, endgame, turn: { ...s.turn, phase: 'TACTIC', pendingDecision: null } }
  if (avalonOver(s.avalon)) return finalize(s, now)
  // 阿瓦隆还没决出：进入终局任务阶段，抵达者先当车主
  if (!s.avalon.active) s = startAvalonMission(s, triggeredByUid, now)
  return s
}

/** 终局阿瓦隆阶段：一趟车结束后，按行动顺序换下一位车主继续发车，直到决出或打满 5 轮 */
export function continueEndgame(state: GameState, now: number): GameState {
  const eg = state.endgame
  if (!eg || eg.phase !== 'AVALON') return state
  if (avalonOver(state.avalon)) return finalize(state, now)
  if (state.avalon.active) return state
  // 车主从抵达者开始，按行动顺序每趟换下一位
  const order = state.turnOrder
  const idx = (order.indexOf(eg.triggeredByUid) + state.avalon.results.length) % order.length
  return startAvalonMission(state, order[idx]!, now)
}

/** 计分前把还没支付的金币惩罚按实际余额扣掉（不能靠拖着不付躲过终局计分）；吹牛中的按原惩罚处理 */
function settleOutstandingCoinPenalties(state: GameState, now: number): GameState {
  const pending = state.pendingDrinkAcks.filter((a) => a.coinPenalty)
  if (pending.length === 0) return state
  const players = clonePlayers(state)
  let history = state.history
  for (const a of pending) {
    const p = players[a.targetUid]!
    const paid = Math.min(a.coinPenalty!, p.coins)
    p.coins -= paid
    history = appendHistory(history, `终局：未处理的金币惩罚（${a.reason}）自动支付 ${paid} 金币。`, now, a.targetUid)
  }
  return { ...state, players, history, pendingDrinkAcks: state.pendingDrinkAcks.filter((a) => !a.coinPenalty) }
}

/** 结束前清掉不会再有人处理的非阻塞事项：未结算的心脏病（无人得奖）、死神弃牌、战术响应、梦幻挑战 */
function clearLeftovers(state: GameState, now: number): GameState {
  const notes: string[] = []
  if (state.pendingHeartAttack) notes.push('未结算的德国心脏病按"无人正确反应"处理')
  if (state.pendingTarotDiscards.length > 0) notes.push('未完成的死神弃牌不再执行')
  if (state.tacticStack) notes.push('未结算的战术牌响应取消')
  if (notes.length === 0 && !state.dream) return state
  let history = state.history
  for (const n of notes) history = appendHistory(history, `终局：${n}。`, now)
  return { ...state, pendingHeartAttack: null, pendingTarotDiscards: [], tacticStack: null, dream: null, history }
}

function finalize(state: GameState, now: number): GameState {
  state = clearLeftovers(state, now)
  state = settleOutstandingCoinPenalties(state, now)
  const scores = computeScores(state)
  const winners = scores.filter((s) => s.rank === 1).map((s) => s.uid)
  return {
    ...state,
    finished: true,
    endgame: { ...state.endgame!, phase: 'DONE', scores, winners },
    history: appendHistory(state.history, `游戏结束！${winners.length > 1 ? `${winners.length} 名玩家并列第一` : '冠军诞生'}，请查看最终排行榜。`, now),
  }
}

export function assertNotFinished(state: GameState): void {
  if (state.finished) throw new GameActionError('INVALID_GAME_ACTION', '游戏已经结束，结果已固定')
}
