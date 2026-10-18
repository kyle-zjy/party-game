/**
 * setOnline：仅仅是 UI 提示用的 best-effort presence 状态。
 *
 * 明确不做的事情（重要，避免未来有人往这里加逻辑）：
 * - 不能用来判断 startGame 的权限
 * - 不能用来自动移除玩家
 * - 不能用来自动转移房主
 * - 不能当作真实的在线状态来源（客户端随时可能在页面关闭前来不及上报）
 */
import { RoomError } from '../../../../shared/errors'
import type { LeaveRoomResult } from '../../../../shared/api'
import { getPlayerByUidAndRoom, getRoomById, updatePlayerRecord, updateRoomWithVersion } from '../lib/db'
import { toRoom } from '../lib/mappers'
import { retryOnConflict } from '../lib/retry'

const MAX_RETRY = 3

export async function setOnline(
  uid: string,
  roomId: string,
  online: boolean,
): Promise<LeaveRoomResult> {
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
      p.playerId === playerRecord.playerId ? { ...p, online } : p,
    )
    const success = await updateRoomWithVersion(roomId, room.version, { players })
    if (!success) return null // 版本冲突，重新读取后重试。

    await updatePlayerRecord(roomId, uid, { online })
    return { room: toRoom({ ...room, players, version: room.version + 1 }) }
  })
}
