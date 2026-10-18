import { useEffect, useRef } from 'react'
import type { GameController } from './useGameController'
import type { GameState } from '../../../shared/game/types'

/**
 * LANDING 阶段的落点效果（移动、金币变化、买地产弹窗……）是服务端/引擎在
 * `resolveLandingAction` 这一次调用里就已经结算完的——用户需求里"逐格移动
 * 动画"只是前端的视觉效果，不能等动画播完才真正结算（那样会让"动画中途
 * 刷新页面"变成一个难处理的边界情况）。
 *
 * 所以这里的策略是：`applyRollDice` 之后立刻自动调用一次
 * `resolveLandingAction`（骰子动画播放的同时，真实结算已经在后台完成），
 * 等骰子动画结束、拿到最终结果后，前端只需要把棋子从旧位置"走"到
 * `game.players[uid].position`（已经是结算后的新位置）——这个hook
 * 只负责"进入 LANDING 阶段后自动触发一次结算"，不负责播放动画本身
 * （动画在 GameBoardPage 里用 CSS transition 做，天然支持中途刷新：
 * 刷新后直接显示最终位置，没有动画也完全正确）。
 */
export function useAutoResolveLanding(game: GameState | undefined, myUid: string, controller: GameController) {
  const resolvedForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!game) return
    if (game.turn.currentPlayerUid !== myUid) return
    if (game.turn.phase !== 'LANDING') return
    if (game.turn.landingResolved) return
    const key = `${game.turnNumber}-${game.turn.extraRollPending ? 'extra' : 'main'}`
    if (resolvedForRef.current === key) return
    resolvedForRef.current = key
    void controller.resolveLanding()
  }, [game, myUid, controller])
}
