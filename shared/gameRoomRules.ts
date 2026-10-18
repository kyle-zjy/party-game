/**
 * 阶段 B：`game_rooms` 模型的纯业务规则。
 *
 * 和 `functions/room/src/lib/rules.ts`（旧模型，给 room 云函数用）故意
 * 保持同样的思路——不碰数据库、不碰 SDK，只做输入校验和状态计算，
 * 方便直接单元测试。这里单独复制一份而不是改造旧文件导入，是因为两套
 * 模型的类型（`GameRoom`/`GameRoomPlayer` vs `Room`/`PublicPlayer`）
 * 字段不同（这套模型的玩家对象里有 `uid`），没必要为了复用牵扯在一起。
 */
import { RoomError } from './errors'
import { MAX_PLAYERS, MIN_PLAYERS, NICKNAME_MAX_LENGTH, ROOM_CODE_PATTERN, ROOM_STALE_MS } from './constants'
import type { GameRoom, GameRoomPlayer } from './gameRoomTypes'

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
export function isNicknameTaken(players: GameRoomPlayer[], nickname: string): boolean {
  const normalized = nickname.toLowerCase()
  return players.some((p) => p.nickname.toLowerCase() === normalized)
}

/** 分配最小可用座位号（从 0 开始） */
export function allocateSeat(players: GameRoomPlayer[]): number {
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
export function pickNextHost(remainingPlayers: GameRoomPlayer[]): GameRoomPlayer | null {
  if (remainingPlayers.length === 0) return null
  return remainingPlayers.reduce((min, p) => (p.seat < min.seat ? p : min))
}

/** 房间是否已经"过期"（WAITING/CLOSED 且 updatedAt 超过 24 小时未更新） */
export function isRoomStale(room: Pick<GameRoom, 'status' | 'updatedAt'>, now: number): boolean {
  if (room.status === 'PLAYING') return false
  return now - room.updatedAt > ROOM_STALE_MS
}

/** 加入房间的前置校验：房间必须 WAITING、未过期、未满、uid 不是已有成员 */
export function assertJoinable(room: GameRoom, uid: string, now: number): void {
  if (room.status !== 'WAITING') {
    throw new RoomError('ROOM_NOT_WAITING', '房间已经开始或已关闭')
  }
  if (isRoomStale(room, now)) {
    throw new RoomError('ROOM_STALE', '房间已过期')
  }
  if (room.players.some((p) => p.uid === uid)) {
    // 同一个 uid 不应该生成两条玩家记录——调用方应该走"恢复身份"的分支，
    // 不应该走到这里。这里只是防御性校验。
    throw new RoomError('CONFLICT', '你已经在这个房间里了')
  }
  if (room.players.length >= room.maxPlayers) {
    throw new RoomError('ROOM_FULL', '房间已满')
  }
}

/** 开始游戏的权限与门槛校验 */
export function assertCanStartGame(room: GameRoom, callerUid: string): void {
  const host = room.players.find((p) => p.isHost)
  if (!host || host.uid !== callerUid) {
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
    throw new RoomError('ROOM_FULL', '房间人数超出上限')
  }
}
