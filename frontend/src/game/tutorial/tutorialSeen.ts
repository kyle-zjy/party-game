/**
 * "是否已经看过"的本地记录——按事件类型（格子 effectKind）记一次，不是全局
 * 一次性开关。用户需求："第一次遇到某类事件时的详细解释"+"教学是否已看过的
 * 本地记录"，所以这里按 key 记录，不是只有一个"新手引导已完成"的布尔值。
 *
 * 只存在 localStorage，不是游戏共享状态的一部分——每个玩家自己的设备记录
 * 自己看过什么，不需要跨玩家/跨设备同步，也不需要写数据库。
 */
const STORAGE_KEY = 'pg.tutorial.seen'
const QUICK_START_KEY = 'pg.tutorial.quickStartDone'

function readSeenSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'))
    return new Set()
  } catch {
    return new Set()
  }
}

function writeSeenSet(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // localStorage 不可用（隐私模式等）时静默忽略——教学提示会每次都显示，不影响功能
  }
}

export function hasSeenTutorialFor(key: string): boolean {
  return readSeenSet().has(key)
}

export function markTutorialSeen(key: string): void {
  const set = readSeenSet()
  if (set.has(key)) return
  set.add(key)
  writeSeenSet(set)
}

export function hasCompletedQuickStart(): boolean {
  try {
    return localStorage.getItem(QUICK_START_KEY) === '1'
  } catch {
    return false
  }
}

export function markQuickStartCompleted(): void {
  try {
    localStorage.setItem(QUICK_START_KEY, '1')
  } catch {
    // 忽略——隐私模式下下次打开会再显示一次快速教学，不影响核心功能
  }
}
