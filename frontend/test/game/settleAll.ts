/**
 * 测试辅助：用真实的引擎动作把当前回合里所有"需要有人操作"的事情处理掉
 * （落点决定、小姐牌事件、战术响应栈、梦幻挑战……），给只关心回合推进的随机流程测试用。
 * 不绕过任何校验，每一步都走正式动作。
 */
import {
  applyBuyPropertyDecision,
  applyChooseDrinkTargetDecision,
  applyHostRulingAck,
  applyTruthOrDareChoice,
  applyTruthOrDareResult,
} from '../../../shared/game/engine/turnEngine'
import { applyChooseLovers, applyJusticeSwap } from '../../../shared/game/engine/tarotActions'
import {
  applyDuelChooseTarget,
  applyDuelRoll,
  applyKingTaskResolve,
  applyKingWriteTask,
  applyLadyHostResult,
  applyLadyStart,
  applyLuckySevenRoll,
} from '../../../shared/game/engine/ladyEvents'
import { applyEnterGods, applyRiverChoice } from '../../../shared/game/engine/zones'
import { applyPassTactic } from '../../../shared/game/engine/tacticStack'
import { applyAvalonPick, applyAvalonVote } from '../../../shared/game/engine/avalon'
import type { GameState } from '../../../shared/game/types'

export function settleDecision(state: GameState, uid: string, hostUid: string, now = 2000): GameState {
  const d = state.turn.pendingDecision
  if (!d) return state
  switch (d.kind) {
    case 'BUY_PROPERTY':
      return applyBuyPropertyDecision(state, uid, false, now)
    case 'CHOOSE_DRINK_TARGET':
      return applyChooseDrinkTargetDecision(state, uid, state.turnOrder.find((u) => u !== uid)!, now)
    case 'TRUTH_OR_DARE':
      return d.choice === null ? applyTruthOrDareChoice(state, uid, 'DARE', now) : applyTruthOrDareResult(state, uid, true, now)
    case 'CHOOSE_LOVERS':
      return applyChooseLovers(state, uid, state.turnOrder[0]!, state.turnOrder[1]!, now)
    case 'TAROT_JUSTICE':
      return applyJusticeSwap(state, hostUid, hostUid, null, null, now)
    case 'RIVER_CROSS':
      return applyRiverChoice(state, uid, 'BRIDGE', { player: 1, god: 1, oracle: 1 }, now)
    case 'ENTER_GODS':
      return applyEnterGods(state, uid, false, now)
    default:
      return applyHostRulingAck(state, hostUid, hostUid, now)
  }
}

export function settleDecisions(state: GameState, uid: string, hostUid: string, now = 2000): GameState {
  for (let i = 0; i < 8 && state.turn.pendingDecision; i += 1) state = settleDecision(state, uid, hostUid, now)
  return state
}

/** 小姐牌事件：按每张牌的步骤走完（房主录入"没人失败"、骰子固定点数） */
export function settleLadyEvent(state: GameState, hostUid: string, now = 2000): GameState {
  for (let i = 0; i < 12; i += 1) {
    const ev = state.ladyEvent
    if (!ev || ev.status !== 'ACTIVE') return state
    const id = ev.eventId
    switch (ev.step) {
      case 'START':
        state = applyLadyStart(state, ev.actingUid, hostUid, id, null, now)
        break
      case 'HOST_RESULT':
        state = applyLadyHostResult(state, hostUid, hostUid, id, null, now)
        break
      case 'LUCKY_ROLL':
        state = applyLuckySevenRoll(state, ev.actingUid, hostUid, id, 3, now)
        break
      case 'CHOOSE_TARGET':
        state = applyDuelChooseTarget(state, ev.actingUid, id, state.turnOrder.find((u) => u !== ev.actingUid)!, now)
        break
      case 'DUEL_ROLL': {
        const r = ev.duelRounds[ev.duelRounds.length - 1]!
        state =
          r.actorRoll === null
            ? applyDuelRoll(state, ev.actingUid, hostUid, id, 'actor', 5, now)
            : applyDuelRoll(state, ev.targetUid!, hostUid, id, 'target', 2, now)
        break
      }
      case 'KING_PERFORM':
        state = applyKingTaskResolve(state, hostUid, hostUid, id, true, now)
        break
      case 'KING_WRITE':
        state = applyKingWriteTask(state, ev.actingUid, hostUid, id, '模仿一种动物叫三声', now)
        break
      default:
        return state
    }
  }
  return state
}

/** 响应栈：所有人放弃；阿瓦隆：车主选前几位，全部 SUCCESS */
export function settleSideEvents(state: GameState, hostUid: string, now = 2000): GameState {
  for (let i = 0; i < 12; i += 1) {
    const stack = state.tacticStack
    if (stack) {
      state = applyPassTactic(state, stack.awaiting[0]!, hostUid, stack.stackId, stack.awaiting[0]!, now, 0)
      continue
    }
    const m = state.avalon.active
    if (m && m.step === 'PICK') {
      state = applyAvalonPick(state, m.leaderUid, m.missionId, state.turnOrder.slice(0, m.size), now)
      continue
    }
    if (m && m.step === 'VOTE') {
      const next = m.passengers.find((u) => !m.votes[u])!
      state = applyAvalonVote(state, next, m.missionId, 'SUCCESS', now)
      continue
    }
    return state
  }
  return state
}

export function settleEverything(state: GameState, uid: string, hostUid: string, now = 2000): GameState {
  state = settleDecisions(state, uid, hostUid, now)
  state = settleLadyEvent(state, hostUid, now)
  return settleSideEvents(state, hostUid, now)
}
