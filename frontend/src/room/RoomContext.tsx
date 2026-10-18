import { createContext, useContext } from 'react'
import type { Room } from '../../../shared/types'

/**
 * RoomProvider 暴露的状态机。只有一个地方（RoomProvider）会创建 watch，
 * RoomPage / GamePage 都只是这个 context 的消费者。
 */
export type RoomState =
  | { phase: 'resolving' }
  | { phase: 'not-member'; roomCode: string }
  | { phase: 'error'; code: string; message: string }
  | {
      phase: 'ready'
      room: Room
      playerId: string
      /** watch 连接状态，仅用于 UI 提示，不影响数据正确性 */
      connection: 'connected' | 'reconnecting'
    }

export interface RoomContextValue {
  state: RoomState
  /** 以新玩家身份加入当前房间（NOT_MEMBER 状态下的恢复路径） */
  joinAsNewPlayer: (nickname: string) => Promise<void>
  /** 离开房间，调用方负责之后的导航（通常是回首页） */
  leaveRoom: () => Promise<void>
  /** 房主开始游戏 */
  startGame: () => Promise<void>
  /** best-effort 上报在线状态，不保证送达，不能依赖它做权威判断 */
  reportOnline: (online: boolean) => void
}

export const RoomContext = createContext<RoomContextValue | null>(null)

export function useRoomContext(): RoomContextValue {
  const ctx = useContext(RoomContext)
  if (!ctx) {
    throw new Error('useRoomContext 必须在 RoomProvider 内部使用')
  }
  return ctx
}
