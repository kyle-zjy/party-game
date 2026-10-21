import { useEffect, useState } from 'react'
import { hasSeenTarotReveal, markTarotRevealSeen } from './tarotRevealSeen'

/**
 * 翻牌动画每张牌每台设备只播一次：轮询刷新、阶段切换（翻牌 → 事件 → 战术）
 * 或者刷新页面都不会重复播放。复用塔罗揭示的"看过没有"记录。
 */
export function useAnimateOnce(key: string): boolean {
  const [animate] = useState(() => !hasSeenTarotReveal(key))
  useEffect(() => {
    markTarotRevealSeen(key)
  }, [key])
  return animate
}
