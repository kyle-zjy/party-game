import { createContext, useContext } from 'react'
import type { GameRoom } from '../../../shared/gameRoomTypes'

/**
 * 阶段 B 的房间状态机，供 GameRoomProvider 产出、GameRoomLobbyPage 消费。
 *
 * 和旧模型（RoomContext.tsx）的关键区别：这里的"身份"就是 CloudBase 匿名
 * 登录的 uid 本身，不需要额外生成/存储一个 playerId——所以刷新页面后的
 * 身份恢复只需要"同一个 uid 还在这个房间的 players 数组里"，不需要
 * localStorage 保存房间会话，URL 里的 roomCode 加上 SDK 自己维护的登录态
 * 就足够了。
 */
export type GameRoomPageState =
  | { phase: 'resolving' }
  | { phase: 'not-member'; roomCode: string }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      room: GameRoom
      uid: string
      /** 轮询连接状态，仅用于 UI 提示，不影响数据正确性 */
      connection: 'connected' | 'reconnecting'
    }

export interface GameRoomContextValue {
  state: GameRoomPageState
  /** 以新玩家身份加入当前房间（not-member 状态下的恢复路径） */
  joinAsNewPlayer: (nickname: string) => Promise<void>
  /** 离开房间，调用方负责之后的导航 */
  leaveRoom: () => Promise<void>
  /** 房主开始游戏：WAITING -> PLAYING，初始化共享 GameState */
  startGame: () => Promise<void>
  /**
   * 游戏内动作（掷骰、买地产……）成功后，用返回的最新房间文档立刻更新本地
   * 状态，不等下一次 5 秒轮询——否则自己做的每个操作都要等最多 5 秒才能看到
   * 反馈，核心回合会显得很卡。其他玩家仍然通过轮询看到这次更新，最多延迟
   * 一个轮询周期，这是本阶段接受的同步精度（见 docs 对轮询方案的说明）。
   */
  applyExternalRoomUpdate: (room: GameRoom) => void
}

export const GameRoomContext = createContext<GameRoomContextValue | null>(null)

export function useGameRoomContext(): GameRoomContextValue {
  const ctx = useContext(GameRoomContext)
  if (!ctx) {
    throw new Error('useGameRoomContext 必须在 GameRoomProvider 内部使用')
  }
  return ctx
}
