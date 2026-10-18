/**
 * rejoinRoom：用可信 uid 找到已有的玩家记录，标记 online=true。
 *
 * 这个 handler 被两个场景复用：
 * 1. 客户端显式调用 action=rejoinRoom（刷新页面后的恢复流程）。
 * 2. joinRoom 发现调用者其实已经是房间成员时，内部转发到这里。
 */
import { RoomError } from '../../../../shared/errors'
import type { RoomActionResult } from '../../../../shared/api'
import { getPlayerByUidAndRoom, getRoomById, updatePlayerRecord, updateRoomWithVersion } from '../lib/db'
import { toRoom } from '../lib/mappers'
import { retryOnConflict } from '../lib/retry'

const MAX_RETRY = 3

export async function rejoinRoom(uid: string, roomId: string): Promise<RoomActionResult> {
  const playerRecord = await getPlayerByUidAndRoom(roomId, uid)
  if (!playerRecord || playerRecord.leftAt) {
    throw new RoomError('NOT_MEMBER', '你还不是这个房间的成员')
  }

  return retryOnConflict(MAX_RETRY, async () => {
    const room = await getRoomById(roomId)
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    }

    const players = room.players.map((p) =>
      p.playerId === playerRecord.playerId ? { ...p, online: true } : p,
    )

    const success = await updateRoomWithVersion(roomId, room.version, { players })
    if (!success) return null // 版本冲突，重新读取后重试。

    await updatePlayerRecord(roomId, uid, { online: true })
    return {
      room: toRoom({ ...room, players, version: room.version + 1 }),
      playerId: playerRecord.playerId,
    }
  })
}
