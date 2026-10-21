/**
 * 每次世界塔罗更换/正义交换结果只弹出一次：记住本设备已经看过的事件 id，
 * 刷新页面不会重复弹出同一次更换（游戏状态里的即时效果本来就只结算一次，
 * 这里只管"界面提示看过没有"）。
 */
const KEY = 'pg.tarot.revealSeen'
const LIMIT = 50

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function hasSeenTarotReveal(eventId: string): boolean {
  return read().includes(eventId)
}

export function markTarotRevealSeen(eventId: string): void {
  try {
    const next = [...read().filter((id) => id !== eventId), eventId].slice(-LIMIT)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 隐私模式下 localStorage 不可用：下次刷新会再弹一次，不影响结算
  }
}

