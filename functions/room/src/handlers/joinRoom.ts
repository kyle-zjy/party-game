/**
 * joinRoom：加入一个 WAITING 中的房间。
 *
 * - 如果调用者的 uid 已经是该房间成员，转发到 rejoinRoom（不允许
 *   同一个 uid 在同一房间里生成两个 playerId）。
 * - 否则：校验昵称、校验房间状态、查重昵称、分配座位、写入。
 */
import { RoomError } from '../../../../shared/errors'
import type { RoomActionResult } from '../../../../shared/api'
import type { PlayerDoc } from '../lib/db'
import { getPlayerByUidAndRoom, getRoomByCode, joinRoomWithPlayer } from '../lib/db'
import { generatePlayerId } from '../lib/ids'
import { toRoom } from '../lib/mappers'
import { retryOnConflict } from '../lib/retry'
import { allocateSeat, assertJoinable, isNicknameTaken, validateNickname, validateRoomCode } from '../lib/rules'
import { rejoinRoom } from './rejoinRoom'

const MAX_RETRY = 3

export async function joinRoom(
  uid: string,
  roomCode: string,
  rawNickname: string,
): Promise<RoomActionResult> {
  validateRoomCode(roomCode)
  const nickname = validateNickname(rawNickname)

  const room = await getRoomByCode(roomCode)
  if (!room) {
    throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
  }

  const existingPlayer = await getPlayerByUidAndRoom(room._id, uid)
  if (existingPlayer && !existingPlayer.leftAt) {
    // 同一 uid 已经是成员：走 rejoin，而不是生成第二个玩家。
    return rejoinRoom(uid, room._id)
  }

  return retryOnConflict(MAX_RETRY, async () => {
    const current = await getRoomByCode(roomCode)
    if (!current) {
      throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    }
    // 座位/人数/昵称查重都用每次重试时最新读到的状态重新判断。
    assertJoinable(current, Date.now())
    if (isNicknameTaken(current.players, nickname)) {
      throw new RoomError('NICKNAME_TAKEN', '昵称已被使用')
    }

    const seat = allocateSeat(current.players)
    const playerId = generatePlayerId()
    const now = Date.now()

    const newPublicPlayer = {
      playerId,
      nickname,
      seat,
      isHost: false,
      online: true,
      joinedAt: now,
    }

    const playerDoc: PlayerDoc = {
      _id: `${current._id}_${uid}`,
      uid,
      roomId: current._id,
      playerId,
      nickname,
      seat,
      isHost: false,
      online: true,
      joinedAt: now,
    }

    const updatedPlayers = [...current.players, newPublicPlayer]
    const success = await joinRoomWithPlayer(
      current._id,
      current.version,
      {
        players: updatedPlayers,
        playerCount: updatedPlayers.length,
        lastEvent: { type: 'PLAYER_JOINED', playerId, at: now },
      },
      playerDoc,
    )
    if (!success) return null // 版本冲突（座位/人数可能已变化），重新读取后重试。

    return {
      room: toRoom({
        ...current,
        players: updatedPlayers,
        playerCount: updatedPlayers.length,
        version: current.version + 1,
        updatedAt: now,
      }),
      playerId,
    }
  })
}
