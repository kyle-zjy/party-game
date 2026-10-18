/**
 * 阶段 B：`game_rooms` 的轮询封装，直接查数据库（不经过云函数）。
 * 轮询机制本身（固定间隔、后台暂停、避免叠加请求）复用 `./polling.ts`，
 * 和旧模型的 `roomPolling.ts` 共用同一套轮询逻辑，只是查询函数不同。
 */
import { getGameRoomState } from './gameRoomDb'
import { startPolling, type PollingHandle } from './polling'
import type { GameRoom } from '../../../shared/gameRoomTypes'

export interface GameRoomPollingCallbacks {
  onChange: (room: GameRoom) => void
  onError: (error: unknown) => void
}

/** 默认 5 秒一次，暂不折腾实时监听（见 shared/gameRoomRules.ts 等文件的注释） */
const DEFAULT_INTERVAL_MS = 5000

export function pollGameRoomState(
  roomId: string,
  callbacks: GameRoomPollingCallbacks,
  intervalMs = DEFAULT_INTERVAL_MS,
): PollingHandle {
  return startPolling(
    async () => {
      const room = await getGameRoomState(roomId)
      if (!room) {
        throw new Error('房间不存在或已被删除')
      }
      return room
    },
    callbacks,
    intervalMs,
  )
}
