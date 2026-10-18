/**
 * leaveRoom：
 * - WAITING 阶段：真正移除玩家。如果离开的是房主，把房主转给剩余玩家中
 *   seat 最小的那个；如果没有剩余玩家，房间变为 CLOSED。
 * - PLAYING 阶段：Milestone 1 暂时只标记 online=false，不移出玩家
 *   （真正的"退出游戏中的对局"是以后游戏逻辑要处理的事）。
 */
import { RoomError } from '../../../../shared/errors'
import type { LeaveRoomResult } from '../../../../shared/api'
import { getPlayerByUidAndRoom, getRoomById, updatePlayerRecord, updateRoomWithVersion } from '../lib/db'
import { toRoom } from '../lib/mappers'
import { retryOnConflict } from '../lib/retry'
import { pickNextHost } from '../lib/rules'

const MAX_RETRY = 3

export async function leaveRoom(uid: string, roomId: string): Promise<LeaveRoomResult> {
  const playerRecord = await getPlayerByUidAndRoom(roomId, uid)
  if (!playerRecord || playerRecord.leftAt) {
    throw new RoomError('NOT_MEMBER', '你还不是这个房间的成员')
  }

  return retryOnConflict(MAX_RETRY, async () => {
    const room = await getRoomById(roomId)
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    }

    const now = Date.now()

    if (room.status !== 'WAITING') {
      // PLAYING（或 CLOSED）：只标记离线，不移出玩家。
      const players = room.players.map((p) =>
        p.playerId === playerRecord.playerId ? { ...p, online: false } : p,
      )
      const success = await updateRoomWithVersion(roomId, room.version, { players })
      if (!success) return null

      await updatePlayerRecord(roomId, uid, { online: false })
      return { room: toRoom({ ...room, players, version: room.version + 1 }) }
    }

    // WAITING：真正移除。
    const remainingPlayers = room.players.filter((p) => p.playerId !== playerRecord.playerId)
    const wasHost = room.hostPlayerId === playerRecord.playerId

    if (remainingPlayers.length === 0) {
      const success = await updateRoomWithVersion(roomId, room.version, {
        players: [],
        playerCount: 0,
        status: 'CLOSED',
        lastEvent: { type: 'PLAYER_LEFT', playerId: playerRecord.playerId, at: now },
      })
      if (!success) return null

      await updatePlayerRecord(roomId, uid, { leftAt: now })
      return {
        room: toRoom({
          ...room,
          players: [],
          playerCount: 0,
          status: 'CLOSED',
          version: room.version + 1,
        }),
      }
    }

    let nextHostPlayerId = room.hostPlayerId
    let finalPlayers = remainingPlayers
    if (wasHost) {
      const nextHost = pickNextHost(remainingPlayers)
      // remainingPlayers.length > 0，所以这里一定非空。
      nextHostPlayerId = nextHost!.playerId
      finalPlayers = remainingPlayers.map((p) => ({
        ...p,
        isHost: p.playerId === nextHostPlayerId,
      }))
    }

    const success = await updateRoomWithVersion(roomId, room.version, {
      players: finalPlayers,
      playerCount: finalPlayers.length,
      hostPlayerId: nextHostPlayerId,
      lastEvent: {
        type: wasHost ? 'HOST_CHANGED' : 'PLAYER_LEFT',
        playerId: wasHost ? nextHostPlayerId : playerRecord.playerId,
        at: now,
      },
    })
    if (!success) return null

    await updatePlayerRecord(roomId, uid, { leftAt: now })
    return {
      room: toRoom({
        ...room,
        players: finalPlayers,
        playerCount: finalPlayers.length,
        hostPlayerId: nextHostPlayerId,
        version: room.version + 1,
      }),
    }
  })
}
