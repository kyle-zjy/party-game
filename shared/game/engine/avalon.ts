/**
 * V1.6 补充 Q11：3–10 人阿瓦隆。
 *
 * 原稿（V1.5）：发车任务触发者为车主，挑选乘客后匿名投票；好人只能投同意，坏人可以同意或不同意；
 * 1 张 FAIL 即失败；先到 3 次成功/失败结算，胜方每人 +1 金币，败方每人 1 口。
 * V1.6：人数配置表（3、4 人为数字版自定义）、最多 5 轮、乘客可以包括车主、同一时间只有一场任务。
 *
 * 好友聚会信任模式：身份和投票存在前端可读的共享文档里，普通界面只给本人看、揭示时只公开 FAIL 张数。
 * 这不是防作弊的服务端保密——有技术能力的玩家可以直接读取数据库文档。
 */
import { shuffle } from '../cards/ladyDeck'
import type { AvalonMission, AvalonSide, AvalonState, GameState } from '../types'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { clonePlayers, pushDrinkAck, requirePlayer } from './stateHelpers'
import { payFromBank } from './tarotEffects'

export const AVALON_CONFIG: Record<number, { good: number; evil: number; sizes: [number, number, number, number, number] }> = {
  3: { good: 2, evil: 1, sizes: [2, 2, 2, 2, 2] },
  4: { good: 3, evil: 1, sizes: [2, 2, 3, 3, 3] },
  5: { good: 3, evil: 2, sizes: [2, 3, 2, 3, 3] },
  6: { good: 4, evil: 2, sizes: [2, 3, 4, 3, 4] },
  7: { good: 4, evil: 3, sizes: [2, 3, 3, 4, 4] },
  8: { good: 5, evil: 3, sizes: [3, 4, 4, 5, 5] },
  9: { good: 6, evil: 3, sizes: [3, 4, 4, 5, 5] },
  10: { good: 6, evil: 4, sizes: [3, 4, 4, 5, 5] },
}
export const AVALON_ROUNDS = 5
export const AVALON_TARGET = 3

export function dealAvalonRoles(turnOrder: string[], rng: () => number): Record<string, AvalonSide> {
  const cfg = AVALON_CONFIG[turnOrder.length]
  if (!cfg) throw new Error(`阿瓦隆不支持 ${turnOrder.length} 人`)
  const sides: AvalonSide[] = shuffle([...Array<AvalonSide>(cfg.good).fill('GOOD'), ...Array<AvalonSide>(cfg.evil).fill('EVIL')], rng)
  return Object.fromEntries(turnOrder.map((uid, i) => [uid, sides[i]!]))
}

export function emptyAvalon(roles: Record<string, AvalonSide>): AvalonState {
  return { roles, round: 0, successes: 0, fails: 0, results: [], active: null, winner: null }
}

export function missionSize(playerCount: number, round: number): number {
  return AVALON_CONFIG[playerCount]?.sizes[round - 1] ?? 2
}

export function avalonOver(a: AvalonState): boolean {
  return a.winner !== null || a.results.length >= AVALON_ROUNDS
}

/** 发车任务格：触发者成为车主。已有任务进行中或阵营已决出时只记录，不开新任务 */
export function startAvalonMission(state: GameState, leaderUid: string, now: number): GameState {
  const a = state.avalon
  if (a.active) return { ...state, history: appendHistory(state.history, '发车任务：已经有一场阿瓦隆任务在进行，这次不再发车。', now, leaderUid) }
  if (avalonOver(a)) return { ...state, history: appendHistory(state.history, '发车任务：本局阿瓦隆阵营已经决出胜负，不再发车。', now, leaderUid) }
  const round = a.results.length + 1
  const size = missionSize(state.turnOrder.length, round)
  const mission: AvalonMission = { missionId: `avalon-${now}-${round}`, round, leaderUid, size, passengers: [], step: 'PICK', votes: {} }
  return {
    ...state,
    avalon: { ...a, round, active: mission },
    history: appendHistory(state.history, `阿瓦隆第 ${round} 轮发车！车主需要选择 ${size} 名乘客（可以选自己）。`, now, leaderUid),
  }
}

function requireMission(state: GameState, missionId: string, step: AvalonMission['step']): AvalonMission {
  const m = state.avalon.active
  if (!m || m.missionId !== missionId) throw new GameActionError('INVALID_GAME_ACTION', '这场阿瓦隆任务已经结束')
  if (m.step !== step) throw new GameActionError('INVALID_GAME_ACTION', '这一步已经处理过了')
  return m
}

export function applyAvalonPick(state: GameState, callerUid: string, missionId: string, passengers: string[], now: number): GameState {
  const m = requireMission(state, missionId, 'PICK')
  if (callerUid !== m.leaderUid) throw new GameActionError('INVALID_GAME_ACTION', '只有车主可以选乘客')
  const unique = [...new Set(passengers)]
  if (unique.length !== m.size || unique.length !== passengers.length) throw new GameActionError('INVALID_GAME_ACTION', `需要选择 ${m.size} 名不同的乘客`)
  for (const u of unique) requirePlayer(state, u)
  return {
    ...state,
    avalon: { ...state.avalon, active: { ...m, passengers: unique, step: 'VOTE' } },
    history: appendHistory(state.history, `车主选好了 ${m.size} 名乘客，乘客各自提交任务结果。`, now, callerUid),
  }
}

export function applyAvalonVote(state: GameState, callerUid: string, missionId: string, vote: 'SUCCESS' | 'FAIL', now: number): GameState {
  const m = requireMission(state, missionId, 'VOTE')
  if (!m.passengers.includes(callerUid)) throw new GameActionError('INVALID_GAME_ACTION', '你不在这趟车上')
  if (m.votes[callerUid]) throw new GameActionError('INVALID_GAME_ACTION', '你已经提交过了')
  if (vote === 'FAIL' && state.avalon.roles[callerUid] !== 'EVIL') throw new GameActionError('INVALID_GAME_ACTION', '好人只能提交 SUCCESS')
  const votes = { ...m.votes, [callerUid]: vote }
  // 历史里不写具体选择，只写"已提交"
  let s: GameState = {
    ...state,
    avalon: { ...state.avalon, active: { ...m, votes } },
    history: appendHistory(state.history, '提交了任务结果。', now, callerUid),
  }
  if (m.passengers.every((u) => votes[u])) s = revealMission(s, now)
  return s
}

function revealMission(state: GameState, now: number): GameState {
  const a = state.avalon
  const m = a.active!
  const failCount = Object.values(m.votes).filter((v) => v === 'FAIL').length
  const success = failCount === 0
  const successes = a.successes + (success ? 1 : 0)
  const fails = a.fails + (success ? 0 : 1)
  const results = [...a.results, { round: m.round, success, size: m.size }]
  let history = appendHistory(
    state.history,
    success ? `阿瓦隆第 ${m.round} 轮：任务成功！（成功 ${successes} / 失败 ${fails}）` : `阿瓦隆第 ${m.round} 轮：任务失败，出现了 ${failCount} 张 FAIL。（成功 ${successes} / 失败 ${fails}）`,
    now,
  )
  let winner: AvalonSide | null = null
  if (successes >= AVALON_TARGET) winner = 'GOOD'
  else if (fails >= AVALON_TARGET) winner = 'EVIL'
  // 投票揭示后清空，减少共享文档里留存的秘密数据
  let s: GameState = { ...state, avalon: { ...a, successes, fails, results, active: null, winner }, history }
  if (winner) s = settleAvalon(s, winner, now)
  else if (results.length >= AVALON_ROUNDS) {
    history = appendHistory(s.history, '阿瓦隆五轮任务全部结束，没有阵营达到 3 次，本局阿瓦隆不发奖励。', now)
    s = { ...s, history }
  }
  return s
}

/** 阵营结算：胜方每人从银行 +1 金币，败方每人 1 口。只结算一次（winner 写入后不会再进来） */
export function settleAvalon(state: GameState, winner: AvalonSide, now: number): GameState {
  const players = clonePlayers(state)
  let acks = state.pendingDrinkAcks
  for (const uid of state.turnOrder) {
    if (state.avalon.roles[uid] === winner) payFromBank(state, players, uid, 1)
    else acks = pushDrinkAck(acks, uid, 1, '阿瓦隆：阵营失败', now)
  }
  return {
    ...state,
    players,
    pendingDrinkAcks: acks,
    avalon: { ...state.avalon, winner },
    history: appendHistory(state.history, `阿瓦隆结束：${winner === 'GOOD' ? '好人' : '坏人'}阵营获胜！胜方每人从银行得 1 金币，败方每人 1 口。身份现在公开。`, now),
  }
}

/**
 * 有乘客离线、任务无法继续时，房主可以取消这一趟车：本轮不计入结果，已提交的票清空，
 * 不公开任何人的身份或选择。房主不能替任何人投票。
 */
export function applyAvalonHostCancel(state: GameState, callerUid: string, hostUid: string, missionId: string, now: number): GameState {
  if (callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以取消这趟车')
  const m = state.avalon.active
  if (!m || m.missionId !== missionId) throw new GameActionError('INVALID_GAME_ACTION', '这场阿瓦隆任务已经结束')
  return {
    ...state,
    avalon: { ...state.avalon, active: null, round: state.avalon.results.length },
    history: appendHistory(state.history, `房主取消了阿瓦隆第 ${m.round} 轮的这趟车（不计入结果），下次发车任务重新开始这一轮。`, now, callerUid),
  }
}
