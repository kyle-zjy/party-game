import { useEffect, useRef, useState } from 'react'
import { BOARD_SIZE } from '../../../shared/game/board'
import type { GamePlayerState } from '../../../shared/game/types'

const STEP_MS = 180

/**
 * 纯视觉的"逐格移动"动画——真实的位置结算已经由引擎同步完成（见
 * `useLandingAdvance.ts` 的说明），这里只是把"棋子从旧格子跳到新格子"这件事
 * 在界面上播放成一步步走过去的样子，不影响任何数据正确性：动画播放中途
 * 刷新页面，下一次渲染会直接显示引擎已经算好的最终位置，不会播放动画，
 * 但位置依然是对的。
 *
 * 方向判断：比较顺时针/逆时针两个方向的步数，取较短的一边——骰子移动
 * （1-6 格）和"后退 N 格"事件（N 很小）都远小于半圈（37 格），这个启发式
 * 在本游戏的格数规模下能正确识别出"这次移动实际朝哪个方向走"。
 */
export function useTokenAnimation(players: GamePlayerState[]): Map<string, number> {
  const lastPositionsRef = useRef<Map<string, number>>(new Map())
  const [displayPositions, setDisplayPositions] = useState<Map<string, number>>(new Map())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    for (const p of players) {
      const prev = lastPositionsRef.current.get(p.uid)
      lastPositionsRef.current.set(p.uid, p.position)

      if (prev === undefined || prev === p.position) continue

      const existingTimer = timersRef.current.get(p.uid)
      if (existingTimer) clearTimeout(existingTimer)

      // 所有 setState 都放进 setTimeout（哪怕延迟是 0）而不是在 effect 函数体里
      // 直接同步调用——这是 react-hooks/set-state-in-effect 规则要求的写法，
      // 也顺便保证了"多个玩家同一帧都在移动"时不会互相打断彼此的渲染。
      if (prefersReducedMotion) {
        const uid = p.uid
        const target = p.position
        const t = setTimeout(() => setDisplayPositions((m) => new Map(m).set(uid, target)), 0)
        timersRef.current.set(uid, t)
        continue
      }

      const forwardSteps = ((p.position - prev) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE
      const backwardSteps = BOARD_SIZE - forwardSteps
      const direction = forwardSteps <= backwardSteps ? 1 : -1
      const steps = direction === 1 ? forwardSteps : backwardSteps

      let current = prev
      let tick = 0
      const uid = p.uid
      const runStep = () => {
        tick += 1
        current = ((current + direction) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE
        setDisplayPositions((m) => new Map(m).set(uid, current))
        if (tick < steps) {
          const t = setTimeout(runStep, STEP_MS)
          timersRef.current.set(uid, t)
        } else {
          timersRef.current.delete(uid)
        }
      }
      if (steps > 0 && steps <= BOARD_SIZE) {
        const t = setTimeout(runStep, STEP_MS)
        timersRef.current.set(uid, t)
      } else {
        const target = p.position
        const t = setTimeout(() => setDisplayPositions((m) => new Map(m).set(uid, target)), 0)
        timersRef.current.set(uid, t)
      }
    }
  }, [players])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
    }
  }, [])

  return displayPositions
}
