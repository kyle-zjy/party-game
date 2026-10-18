/**
 * Phase C 的游戏内动作控制器——包装 `frontend/src/lib/gameEngineDb.ts` 的
 * 每一个动作，统一处理：
 * - loading 状态（防止同一个按钮被连续点击触发重复请求）。
 * - 成功后用返回的最新房间文档立刻更新 `GameRoomContext`（见
 *   `applyExternalRoomUpdate` 的说明），不用等下一次轮询。
 * - 失败时把 `RoomError`/其他异常转成中文提示，调用方只需要展示 `error`。
 *
 * 这个 hook 不包含任何 UI，纯状态 + 动作封装，方便 GameBoardPage 和它的
 * 子组件共用同一份"当前能不能点"的判断逻辑。
 */
import { useCallback, useState } from 'react'
import { useGameRoomContext } from '../gameRoom/GameRoomContext'
import {
  ackDrinkDecisionAction,
  advanceAfterLandingAction,
  buyPropertyAction,
  chooseDrinkTargetAction,
  dismissHeartAttackAction,
  drawRandomLadyCardId,
  endTurnAction,
  hostRulingAckAction,
  playTacticCardAction,
  resolveDrinkAckAction,
  resolveLandingAction,
  revealLadyCardAction,
  rollDiceAction,
  skipTacticAction,
  truthOrDareAction,
} from '../lib/gameEngineDb'
import { describeUnknownError } from '../../../shared/errors'
import type { DrinkAckChoice } from '../../../shared/game/types'

export interface GameController {
  busy: boolean
  error: string | null
  clearError: () => void
  rollDice: () => Promise<void>
  resolveLanding: () => Promise<void>
  advanceAfterLanding: () => Promise<void>
  buyProperty: (buy: boolean) => Promise<void>
  ackDrink: () => Promise<void>
  chooseDrinkTarget: (targetUid: string) => Promise<void>
  truthOrDare: (choice: 'TRUTH' | 'DARE') => Promise<void>
  hostRulingAck: () => Promise<void>
  dismissHeartAttack: () => Promise<void>
  resolveDrinkAck: (ackId: string, choice: DrinkAckChoice) => Promise<void>
  revealLadyCard: () => Promise<void>
  playTacticCard: (cardInstanceId: string, targetUid: string | null) => Promise<void>
  skipTactic: () => Promise<void>
  endTurn: () => Promise<void>
}

export function useGameController(roomId: string | null, uid: string | null): GameController {
  const { applyExternalRoomUpdate } = useGameRoomContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (action: () => Promise<Parameters<typeof applyExternalRoomUpdate>[0]>) => {
      if (!roomId || !uid || busy) return
      setBusy(true)
      setError(null)
      try {
        const room = await action()
        applyExternalRoomUpdate(room)
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[useGameController] 游戏内动作失败，原始错误：', err)
        }
        setError(describeUnknownError(err))
      } finally {
        setBusy(false)
      }
    },
    [roomId, uid, busy, applyExternalRoomUpdate],
  )

  const clearError = useCallback(() => setError(null), [])

  return {
    busy,
    error,
    clearError,
    rollDice: useCallback(() => run(() => rollDiceAction(roomId!, uid!)), [run, roomId, uid]),
    resolveLanding: useCallback(() => run(() => resolveLandingAction(roomId!, uid!)), [run, roomId, uid]),
    advanceAfterLanding: useCallback(() => run(() => advanceAfterLandingAction(roomId!, uid!)), [run, roomId, uid]),
    buyProperty: useCallback((buy: boolean) => run(() => buyPropertyAction(roomId!, uid!, buy)), [run, roomId, uid]),
    ackDrink: useCallback(() => run(() => ackDrinkDecisionAction(roomId!, uid!)), [run, roomId, uid]),
    chooseDrinkTarget: useCallback(
      (targetUid: string) => run(() => chooseDrinkTargetAction(roomId!, uid!, targetUid)),
      [run, roomId, uid],
    ),
    truthOrDare: useCallback(
      (choice: 'TRUTH' | 'DARE') => run(() => truthOrDareAction(roomId!, uid!, choice)),
      [run, roomId, uid],
    ),
    hostRulingAck: useCallback(() => run(() => hostRulingAckAction(roomId!, uid!)), [run, roomId, uid]),
    dismissHeartAttack: useCallback(() => run(() => dismissHeartAttackAction(roomId!, uid!)), [run, roomId, uid]),
    resolveDrinkAck: useCallback(
      (ackId: string, choice: DrinkAckChoice) => run(() => resolveDrinkAckAction(roomId!, uid!, ackId, choice)),
      [run, roomId, uid],
    ),
    revealLadyCard: useCallback(
      () => run(() => revealLadyCardAction(roomId!, uid!, drawRandomLadyCardId())),
      [run, roomId, uid],
    ),
    playTacticCard: useCallback(
      (cardInstanceId: string, targetUid: string | null) =>
        run(() => playTacticCardAction(roomId!, uid!, cardInstanceId, targetUid)),
      [run, roomId, uid],
    ),
    skipTactic: useCallback(() => run(() => skipTacticAction(roomId!, uid!)), [run, roomId, uid]),
    endTurn: useCallback(() => run(() => endTurnAction(roomId!, uid!)), [run, roomId, uid]),
  }
}
