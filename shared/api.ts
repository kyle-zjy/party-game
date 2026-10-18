/**
 * `room` 云函数的请求/响应类型。前端和云函数都引用这份契约，
 * 避免两边的 action 名称、字段名慢慢漂移。
 */
import type { Room } from './types'

export type RoomAction =
  | 'createRoom'
  | 'joinRoom'
  | 'rejoinRoom'
  | 'leaveRoom'
  | 'setOnline'
  | 'startGame'
  | 'getRoomState'
  | 'devDbHealthCheck'

export interface CreateRoomRequest {
  action: 'createRoom'
  nickname: string
}

export interface JoinRoomRequest {
  action: 'joinRoom'
  roomCode: string
  nickname: string
}

export interface RejoinRoomRequest {
  action: 'rejoinRoom'
  roomCode: string
}

export interface LeaveRoomRequest {
  action: 'leaveRoom'
  roomId: string
}

export interface SetOnlineRequest {
  action: 'setOnline'
  roomId: string
  online: boolean
}

export interface StartGameRequest {
  action: 'startGame'
  roomId: string
}

/**
 * 轮询式获取房间公共状态，供等待大厅的低频同步使用
 * （`rooms`/`players` 都是 ADMINONLY，客户端不能直接 watch/get，
 * 只能通过这个 action 拿快照；详见 docs/architecture.md 的实时同步章节）。
 */
export interface GetRoomStateRequest {
  action: 'getRoomState'
  roomId: string
}

/**
 * 仅供开发诊断使用的数据库连通性检查。要求调用者已通过身份校验
 * （和其他 action 一样，由 getTrustedUid 在 dispatch 之前统一校验），
 * 只读、不创建真实房间、不返回任何私人数据或密钥，成功时只返回
 * 数据库连通状态。见 functions/room/src/handlers/devDbHealthCheck.ts。
 */
export interface DevDbHealthCheckRequest {
  action: 'devDbHealthCheck'
}

export type RoomRequest =
  | CreateRoomRequest
  | JoinRoomRequest
  | RejoinRoomRequest
  | LeaveRoomRequest
  | SetOnlineRequest
  | StartGameRequest
  | GetRoomStateRequest
  | DevDbHealthCheckRequest

/** 成功时返回的 room 快照 + 当前调用者的 playerId（部分 action 不需要 playerId） */
export interface RoomActionResult {
  room: Room
  playerId: string
}

/** `leaveRoom` 成功后房间可能已经没有玩家、被标为 CLOSED，这时也仍然返回 room 快照 */
export type LeaveRoomResult = Pick<RoomActionResult, 'room'>

/** `getRoomState` 的返回值和 `RoomActionResult` 形状一致（room 快照 + 调用者 playerId） */
export type GetRoomStateResult = RoomActionResult

/** `devDbHealthCheck` 的返回值：只有连通状态，没有任何房间/用户数据 */
export interface DevDbHealthCheckResult {
  dbConnected: boolean
}
