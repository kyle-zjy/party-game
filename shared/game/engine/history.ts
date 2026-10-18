import type { GameHistoryEntry } from '../types'

/**
 * 事件历史记录上限——只保留最近 N 条，避免 `GameRoom` 文档随着回合数增多
 * 无限增长（CloudBase 单文档有大小限制，聚会场景下几十条足够回看"最近发生
 * 了什么"）。
 */
const HISTORY_LIMIT = 60

export function appendHistory(
  history: GameHistoryEntry[],
  message: string,
  now: number,
): GameHistoryEntry[] {
  const entry: GameHistoryEntry = {
    id: `h-${now}-${Math.random().toString(36).slice(2, 8)}`,
    at: now,
    message,
  }
  const next = [...history, entry]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}
