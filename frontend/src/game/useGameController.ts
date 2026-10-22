/**
 * 游戏内动作控制器——包装 `frontend/src/lib/gameEngineDb.ts` 的每一个动作，统一处理：
 * - busy 状态（防止同一个按钮被连续点击触发重复请求）。
 * - 成功后用返回的最新房间文档立刻更新本地状态，不用等下一次 5 秒轮询。
 * - 失败时把异常转成中文提示，调用方只需要展示 `error`。
 */
import { useCallback, useState } from 'react'
import { useGameRoomContext } from '../gameRoom/GameRoomContext'
import {
  advanceAfterLandingAction,
  banCatchAction,
  buyPropertyAction,
  chooseDrinkTargetAction,
  chooseLoversAction,
  endTurnAction,
  hostRulingAckAction,
  justiceSwapAction,
  playTacticCardAction,
  resolveDrinkAckAction,
  resolveHeartAttackAction,
  resolveLandingAction,
  revealLadyCardAction,
  rollDiceAction,
  skipTacticAction,
  tarotDiscardAction,
  truthOrDareChoiceAction,
  truthOrDareResultAction,
  peachAction,
  ladyStartAction,
  ladyHostResultAction,
  ladyHostCancelAction,
  luckySevenRollAction,
  duelChooseTargetAction,
  duelRollAction,
  kingTaskResolveAction,
  kingWriteTaskAction,
  offerSubstituteAction,
  respondSubstituteAction,
  setAwayAction,
  crazyCatchAction,
  devStackLadyDeckAction,
  skipRollTurnAction,
  mortgageAction,
  respondTacticAction,
  passTacticAction,
  texasBetAction,
  texasCloseBettingAction,
  startBluffAction,
  respondBluffAction,
  dreamChallengeAction,
  dreamRespondAction,
  dreamDeclareAction,
  avalonPickAction,
  avalonVoteAction,
  avalonCancelAction,
  riverChoiceAction,
  enterGodsAction,
  redrawTruthOrDareAction,
} from '../lib/gameEngineDb'
import { describeUnknownError } from '../../../shared/errors'
import type { GameRoom } from '../../../shared/gameRoomTypes'
import type { DrinkAckChoice, LadyRank } from '../../../shared/game/types'
import type { TexasBetAction } from '../../../shared/game/engine/texas'

export interface GameController {
  busy: boolean
  error: string | null
  clearError: () => void
  rollDice: () => Promise<void>
  resolveLanding: () => Promise<void>
  advanceAfterLanding: () => Promise<void>
  buyProperty: (buy: boolean) => Promise<void>
  chooseDrinkTarget: (targetUid: string) => Promise<void>
  truthOrDareChoice: (choice: 'TRUTH' | 'DARE') => Promise<void>
  truthOrDareResult: (completed: boolean) => Promise<void>
  hostRulingAck: () => Promise<void>
  resolveHeartAttack: (firstUid: string | null, falseStartUids: string[]) => Promise<void>
  resolveDrinkAck: (ackId: string, choice: DrinkAckChoice, devilTargetUid?: string | null) => Promise<void>
  usePeach: (ackId: string) => Promise<void>
  chooseLovers: (uidA: string, uidB: string) => Promise<void>
  justiceSwap: (winnerUid: string | null, loserUid: string | null) => Promise<void>
  tarotDiscard: (targetUid: string, cardId: string) => Promise<void>
  banCatch: (catcherUid: string, violatorUid: string, correct: boolean, incidentId: string) => Promise<void>
  revealLadyCard: () => Promise<void>
  playTacticCard: (cardId: string, targetUid: string | null) => Promise<void>
  skipTactic: () => Promise<void>
  endTurn: () => Promise<void>
  ladyStart: (eventId: string, text: string | null) => Promise<void>
  ladyHostResult: (eventId: string, loserUid: string | null) => Promise<void>
  ladyHostCancel: (eventId: string) => Promise<void>
  luckySevenRoll: (eventId: string) => Promise<void>
  duelChooseTarget: (eventId: string, targetUid: string) => Promise<void>
  duelRoll: (eventId: string, side: 'actor' | 'target') => Promise<void>
  kingTaskResolve: (eventId: string, completed: boolean) => Promise<void>
  /** 返回是否成功，方便输入框只在成功后清空 */
  kingWriteTask: (eventId: string, content: string | null) => Promise<boolean>
  offerSubstitute: (ackId: string, toUid: string) => Promise<void>
  respondSubstitute: (ackId: string, accept: boolean) => Promise<void>
  setAway: (targetUid: string, away: boolean, usePass: boolean) => Promise<void>
  crazyCatch: (violatorUid: string, incidentId: string) => Promise<void>
  devStackLadyDeck: (rank: LadyRank) => Promise<void>
  skipRollTurn: () => Promise<void>
  mortgage: (propertyName: string, mortgage: boolean) => Promise<void>
  respondTactic: (stackId: string, cardId: string) => Promise<void>
  passTactic: (stackId: string, forUid: string) => Promise<void>
  texasBet: (action: TexasBetAction) => Promise<void>
  texasCloseBetting: () => Promise<void>
  startBluff: (ackId: string, claim: string) => Promise<void>
  respondBluff: (ackId: string, challenge: boolean, closeAll?: boolean) => Promise<void>
  dreamChallenge: (eventId: string, targetUid: string) => Promise<void>
  dreamRespond: (eventId: string, accept: boolean) => Promise<void>
  dreamDeclare: (eventId: string, card: string) => Promise<void>
  avalonPick: (missionId: string, passengers: string[]) => Promise<void>
  avalonVote: (missionId: string, vote: 'SUCCESS' | 'FAIL') => Promise<void>
  avalonCancel: (missionId: string) => Promise<void>
  riverChoice: (choice: 'BRIDGE' | 'FORD') => Promise<void>
  enterGods: (enter: boolean) => Promise<void>
  redrawTruthOrDare: () => Promise<void>
}

export function useGameController(roomId: string | null, uid: string | null): GameController {
  const { applyExternalRoomUpdate } = useGameRoomContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runOk = useCallback(
    async (action: (roomId: string, uid: string) => Promise<GameRoom>) => {
      if (!roomId || !uid || busy) return false
      setBusy(true)
      setError(null)
      try {
        applyExternalRoomUpdate(await action(roomId, uid))
        return true
      } catch (err) {
        if (import.meta.env.DEV) console.error('[useGameController] 游戏内动作失败，原始错误：', err)
        setError(describeUnknownError(err))
        return false
      } finally {
        setBusy(false)
      }
    },
    [roomId, uid, busy, applyExternalRoomUpdate],
  )

  const run = useCallback(
    async (action: (roomId: string, uid: string) => Promise<GameRoom>): Promise<void> => {
      await runOk(action)
    },
    [runOk],
  )

  const clearError = useCallback(() => setError(null), [])

  return {
    busy,
    error,
    clearError,
    rollDice: () => run(rollDiceAction),
    resolveLanding: () => run(resolveLandingAction),
    advanceAfterLanding: () => run(advanceAfterLandingAction),
    buyProperty: (buy) => run((r, u) => buyPropertyAction(r, u, buy)),
    chooseDrinkTarget: (targetUid) => run((r, u) => chooseDrinkTargetAction(r, u, targetUid)),
    truthOrDareChoice: (choice) => run((r, u) => truthOrDareChoiceAction(r, u, choice)),
    truthOrDareResult: (completed) => run((r, u) => truthOrDareResultAction(r, u, completed)),
    hostRulingAck: () => run(hostRulingAckAction),
    resolveHeartAttack: (firstUid, falseStartUids) => run((r, u) => resolveHeartAttackAction(r, u, firstUid, falseStartUids)),
    resolveDrinkAck: (ackId, choice, devilTargetUid = null) =>
      run((r, u) => resolveDrinkAckAction(r, u, ackId, choice, devilTargetUid)),
    usePeach: (ackId) => run((r, u) => peachAction(r, u, ackId)),
    chooseLovers: (uidA, uidB) => run((r, u) => chooseLoversAction(r, u, uidA, uidB)),
    justiceSwap: (winnerUid, loserUid) => run((r, u) => justiceSwapAction(r, u, winnerUid, loserUid)),
    tarotDiscard: (targetUid, cardId) => run((r, u) => tarotDiscardAction(r, u, targetUid, cardId)),
    banCatch: (catcherUid, violatorUid, correct, incidentId) => run((r, u) => banCatchAction(r, u, catcherUid, violatorUid, correct, incidentId)),
    revealLadyCard: () => run(revealLadyCardAction),
    playTacticCard: (cardId, targetUid) => run((r, u) => playTacticCardAction(r, u, cardId, targetUid)),
    skipTactic: () => run(skipTacticAction),
    endTurn: () => run(endTurnAction),
    ladyStart: (eventId, text) => run((r, u) => ladyStartAction(r, u, eventId, text)),
    ladyHostResult: (eventId, loserUid) => run((r, u) => ladyHostResultAction(r, u, eventId, loserUid)),
    ladyHostCancel: (eventId) => run((r, u) => ladyHostCancelAction(r, u, eventId)),
    luckySevenRoll: (eventId) => run((r, u) => luckySevenRollAction(r, u, eventId)),
    duelChooseTarget: (eventId, targetUid) => run((r, u) => duelChooseTargetAction(r, u, eventId, targetUid)),
    duelRoll: (eventId, side) => run((r, u) => duelRollAction(r, u, eventId, side)),
    kingTaskResolve: (eventId, completed) => run((r, u) => kingTaskResolveAction(r, u, eventId, completed)),
    kingWriteTask: (eventId, content) => runOk((r, u) => kingWriteTaskAction(r, u, eventId, content)),
    offerSubstitute: (ackId, toUid) => run((r, u) => offerSubstituteAction(r, u, ackId, toUid)),
    respondSubstitute: (ackId, accept) => run((r, u) => respondSubstituteAction(r, u, ackId, accept)),
    setAway: (targetUid, away, usePass) => run((r, u) => setAwayAction(r, u, targetUid, away, usePass)),
    crazyCatch: (violatorUid, incidentId) => run((r, u) => crazyCatchAction(r, u, violatorUid, incidentId)),
    devStackLadyDeck: (rank) => run((r, u) => devStackLadyDeckAction(r, u, rank)),
    skipRollTurn: () => run(skipRollTurnAction),
    mortgage: (propertyName, mortgage) => run((r, u) => mortgageAction(r, u, propertyName, mortgage)),
    respondTactic: (stackId, cardId) => run((r, u) => respondTacticAction(r, u, stackId, cardId)),
    passTactic: (stackId, forUid) => run((r, u) => passTacticAction(r, u, stackId, forUid)),
    texasBet: (action) => run((r, u) => texasBetAction(r, u, action)),
    texasCloseBetting: () => run(texasCloseBettingAction),
    startBluff: (ackId, claim) => run((r, u) => startBluffAction(r, u, ackId, claim)),
    respondBluff: (ackId, challenge, closeAll = false) => run((r, u) => respondBluffAction(r, u, ackId, challenge, closeAll)),
    dreamChallenge: (eventId, targetUid) => run((r, u) => dreamChallengeAction(r, u, eventId, targetUid)),
    dreamRespond: (eventId, accept) => run((r, u) => dreamRespondAction(r, u, eventId, accept)),
    dreamDeclare: (eventId, card) => run((r, u) => dreamDeclareAction(r, u, eventId, card)),
    avalonPick: (missionId, passengers) => run((r, u) => avalonPickAction(r, u, missionId, passengers)),
    avalonVote: (missionId, vote) => run((r, u) => avalonVoteAction(r, u, missionId, vote)),
    avalonCancel: (missionId) => run((r, u) => avalonCancelAction(r, u, missionId)),
    riverChoice: (choice) => run((r, u) => riverChoiceAction(r, u, choice)),
    enterGods: (enter) => run((r, u) => enterGodsAction(r, u, enter)),
    redrawTruthOrDare: () => run(redrawTruthOrDareAction),
  }
}
