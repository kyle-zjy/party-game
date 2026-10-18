/**
 * createRoom：创建一个新房间，创建者自动成为房主，座位号为 0。
 *
 * 房间码唯一性说明（重要）：
 * 这里的做法是"生成随机码 -> 查询是否已被活跃房间占用 -> 冲突则重试"。
 * 这不是数据库级别的唯一约束，存在极低概率的竞态窗口
 * （两个并发请求前后脚查到"未冲突"，然后都写入了同一个房间码）。
 * Milestone 1 接受这个风险；后续正式版本应该换成更强的唯一性机制
 * （例如给 roomCode 建唯一索引，写入冲突时捕获错误重试，
 * 而不是"先查后写"）。见 docs/next-remote-steps.md。
 */
import { RoomError } from '../../../../shared/errors'
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../../shared/constants'
import type { RoomActionResult } from '../../../../shared/api'
import type { PublicPlayer } from '../../../../shared/types'
import { createRoomWithHost, getRoomByCode, type PlayerDoc, type RoomDoc } from '../lib/db'
import { generatePlayerId, generateRoomId } from '../lib/ids'
import { toRoom } from '../lib/mappers'
import { generateRoomCode, isRoomStale, validateNickname } from '../lib/rules'

const MAX_CODE_RETRY = 5

export async function createRoom(uid: string, rawNickname: string): Promise<RoomActionResult> {
  const nickname = validateNickname(rawNickname)

  const roomCode = await generateUniqueRoomCode()
  const now = Date.now()
  const roomId = generateRoomId()
  const playerId = generatePlayerId()

  const hostPublic: PublicPlayer = {
    playerId,
    nickname,
    seat: 0,
    isHost: true,
    online: true,
    joinedAt: now,
  }

  const roomDoc: RoomDoc = {
    _id: roomId,
    roomId,
    roomCode,
    status: 'WAITING',
    hostPlayerId: playerId,
    players: [hostPublic],
    playerCount: 1,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    version: 1,
    lastEvent: { type: 'PLAYER_JOINED', playerId, at: now },
    createdAt: now,
    updatedAt: now,
  }

  const playerDoc: PlayerDoc = {
    _id: `${roomId}_${uid}`,
    uid,
    roomId,
    playerId,
    nickname,
    seat: 0,
    isHost: true,
    online: true,
    joinedAt: now,
  }

  await createRoomWithHost(roomDoc, playerDoc)

  return { room: toRoom(roomDoc), playerId }
}

async function generateUniqueRoomCode(): Promise<string> {
  const now = Date.now()
  for (let attempt = 0; attempt < MAX_CODE_RETRY; attempt += 1) {
    const code = generateRoomCode()
    const existing = await getRoomByCode(code)
    // 过期的房间不算冲突：房间码可以被复用。
    if (!existing || isRoomStale(existing, now)) {
      return code
    }
  }
  throw new RoomError('INTERNAL_ERROR', '生成房间码失败，请重试')
}
