/**
 * 本地会话信息：刷新/断线恢复要用到。
 *
 * 只存不敏感的标识符，绝不存 uid（那是 CloudBase SDK 自己管理的）、
 * 更不存任何 Secret 或未来的私密游戏状态（手牌、身份等）。
 */

const SESSION_KEY = 'pg.session'
const NICKNAME_KEY = 'pg.nickname'

export interface StoredSession {
  roomId: string
  roomCode: string
  playerId: string
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isStoredSession(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.roomId === 'string' &&
    typeof v.roomCode === 'string' &&
    typeof v.playerId === 'string'
  )
}

export function saveNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname)
}

export function loadNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? ''
}
