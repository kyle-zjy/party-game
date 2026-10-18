/**
 * 前端和云函数共用的数据类型。
 *
 * 这里只描述"公开"数据形状——会被客户端读到的字段。
 * 任何私密信息（手牌、底牌、身份等）未来都放在单独的 PrivatePlayerState，
 * 绝不能加进这里的 Room / PublicPlayer。
 */

export type RoomStatus = 'WAITING' | 'PLAYING' | 'CLOSED'

/** 客户端能看到的玩家信息（没有 uid，没有任何私密状态） */
export interface PublicPlayer {
  playerId: string
  nickname: string
  seat: number
  isHost: boolean
  online: boolean
  joinedAt: number
}

/** 房间的公开状态，对应 `rooms` 集合里的一条文档 */
export interface Room {
  roomId: string
  roomCode: string
  status: RoomStatus
  hostPlayerId: string
  players: PublicPlayer[]
  playerCount: number
  minPlayers: number
  maxPlayers: number
  /** 乐观锁版本号，每次写入 +1 */
  version: number
  /** 最近一次事件的简要描述，用于前端展示"xx 加入了房间"之类的提示 */
  lastEvent?: RoomEventSummary
  createdAt: number
  updatedAt: number
}

export interface RoomEventSummary {
  type: 'PLAYER_JOINED' | 'PLAYER_LEFT' | 'HOST_CHANGED' | 'GAME_STARTED'
  playerId: string | null
  at: number
}

/**
 * uid -> playerId 的映射记录，只有云函数可读写。
 * 对应 `players` 集合（注意和 PublicPlayer 是两回事）。
 */
export interface PlayerRecord {
  uid: string
  roomId: string
  playerId: string
  nickname: string
  seat: number
  isHost: boolean
  online: boolean
  joinedAt: number
  leftAt?: number
}

/**
 * 预留的游戏事件 schema。Milestone 1 只定义类型，不写入 `game_events` 集合。
 */
export interface GameEvent {
  roomId: string
  seq: number
  type: string
  actorPlayerId: string | null
  payload: unknown
  createdAt: number
}
