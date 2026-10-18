/**
 * startGame：只有房主能触发，WAITING 状态，人数需在 [MIN_PLAYERS, MAX_PLAYERS] 内。
 *
 * 重要：门槛判断只看 room.players（全体成员），不看 online 字段——
 * online 只是 UI 提示，不能用来决定游戏能不能开始。
 *
 * 也不会读取任何前端环境变量来降低人数门槛：服务端门槛永远是
 * shared/constants.ts 里的 MIN_PLAYERS（当前是 3）。如果未来需要本地
 * 单人调试，应该是服务端自己的 dev-only 开关，而不是信任前端传来的配置，
 * 这件事 Milestone 1 不实现，只在文档里提出。见 docs/next-remote-steps.md。
 */
import { RoomError } from '../../../../shared/errors'
import type { RoomActionResult } from '../../../../shared/api'
import { getPlayerByUidAndRoom, getRoomById, updateRoomWithVersion } from '../lib/db'
import { toRoom } from '../lib/mappers'
import { retryOnConflict } from '../lib/retry'
import { assertCanStartGame } from '../lib/rules'

const MAX_RETRY = 3

export async function startGame(uid: string, roomId: string): Promise<RoomActionResult> {
  const playerRecord = await getPlayerByUidAndRoom(roomId, uid)
  if (!playerRecord || playerRecord.leftAt) {
    throw new RoomError('NOT_MEMBER', '你还不是这个房间的成员')
  }

  return retryOnConflict(MAX_RETRY, async () => {
    const room = await getRoomById(roomId)
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    }

    // 权限/人数校验用每次重试时最新读到的状态重新判断。
    assertCanStartGame(room, playerRecord.playerId)

    const now = Date.now()
    const success = await updateRoomWithVersion(roomId, room.version, {
      status: 'PLAYING',
      lastEvent: { type: 'GAME_STARTED', playerId: playerRecord.playerId, at: now },
    })
    if (!success) return null // 版本冲突，重新读取后重试。

    return {
      room: toRoom({ ...room, status: 'PLAYING', version: room.version + 1 }),
      playerId: playerRecord.playerId,
    }
  })
}
