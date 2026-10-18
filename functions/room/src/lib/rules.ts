/**
 * 纯业务规则：不碰数据库、不碰云函数上下文，只做输入校验和状态计算。
 *
 * 故意和 handler/db 分开放在这里，是为了能在 functions/room/test 里
 * 直接单元测试，不需要 mock 任何 CloudBase SDK。
 */
import { RoomError } from '../../../../shared/errors'
import { MAX_PLAYERS, MIN_PLAYERS, NICKNAME_MAX_LENGTH, ROOM_CODE_PATTERN, ROOM_STALE_MS } from '../../../../shared/constants'
import type { PublicPlayer, Room } from '../../../../shared/types'

/** 校验并归一化昵称（trim），不合法则抛 RoomError('INVALID_NICKNAME') */
export function validateNickname(raw: string): string {
  const nickname = raw.trim()
  if (nickname.length < 1 || nickname.length > NICKNAME_MAX_LENGTH) {
    throw new RoomError('INVALID_NICKNAME', `昵称长度必须在 1-${NICKNAME_MAX_LENGTH} 个字符之间`)
  }
  return nickname
}

/** 校验房间码格式（必须是 6 位数字），不合法则抛 RoomError('INVALID_ROOM_CODE') */
export function validateRoomCode(roomCode: string): void {
  if (!ROOM_CODE_PATTERN.test(roomCode)) {
    throw new RoomError('INVALID_ROOM_CODE', '房间码必须是 6 位数字')
  }
}

/** 生成一个随机的 6 位数字房间码（允许前导 0） */
export function generateRoomCode(): string {
  const n = Math.floor(Math.random() * 1_000_000)
  return n.toString().padStart(6, '0')
}

/** 英文字母大小写不敏感的昵称查重；其他字符（含中文）按原样比较 */
export function isNicknameTaken(players: PublicPlayer[], nickname: string): boolean {
  const normalized = nickname.toLowerCase()
  return players.some((p) => p.nickname.toLowerCase() === normalized)
}

/** 分配最小可用座位号（从 0 开始） */
export function allocateSeat(players: PublicPlayer[]): number {
  const used = new Set(players.map((p) => p.seat))
  let seat = 0
  while (used.has(seat)) {
    seat += 1
  }
  return seat
}

/**
 * 房主离开后，在剩余玩家中选出新房主（seat 最小者）。
 * 没有剩余玩家时返回 null（调用方应该把房间置为 CLOSED）。
 */
export function pickNextHost(remainingPlayers: PublicPlayer[]): PublicPlayer | null {
  if (remainingPlayers.length === 0) return null
  return remainingPlayers.reduce((min, p) => (p.seat < min.seat ? p : min))
}

/** 房间是否已经"过期"（WAITING/CLOSED 且 updatedAt 超过 24 小时未更新） */
export function isRoomStale(room: Pick<Room, 'status' | 'updatedAt'>, now: number): boolean {
  if (room.status === 'PLAYING') return false
  return now - room.updatedAt > ROOM_STALE_MS
}

/** joinRoom 的前置校验：房间必须存在、WAITING、未过期、未满 */
export function assertJoinable(room: Room, now: number): void {
  if (room.status !== 'WAITING') {
    throw new RoomError('ROOM_NOT_WAITING', '房间已经开始或已关闭')
  }
  if (isRoomStale(room, now)) {
    throw new RoomError('ROOM_STALE', '房间已过期')
  }
  if (room.players.length >= room.maxPlayers) {
    throw new RoomError('ROOM_FULL', '房间已满')
  }
}

/** startGame 的权限与门槛校验 */
export function assertCanStartGame(room: Room, callerPlayerId: string): void {
  if (room.hostPlayerId !== callerPlayerId) {
    throw new RoomError('NOT_HOST', '只有房主可以开始游戏')
  }
  if (room.status !== 'WAITING') {
    throw new RoomError('ROOM_NOT_WAITING', '房间已经开始或已关闭')
  }
  const count = room.players.length
  if (count < MIN_PLAYERS) {
    throw new RoomError('NOT_ENOUGH_PLAYERS', `至少需要 ${MIN_PLAYERS} 名玩家`)
  }
  if (count > MAX_PLAYERS) {
    // 正常流程下不会发生（加入时已经拦住了），这里是防御性校验。
    throw new RoomError('ROOM_FULL', '房间人数超出上限')
  }
}
