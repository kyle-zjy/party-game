/**
 * 阶段 B：前端直连数据库的房间模型，对应新集合 `game_rooms`。
 *
 * 和 `shared/types.ts` 的 `Room`/`PublicPlayer`（给 room 云函数用的旧模型）
 * 故意分开、不复用——这两套模型的信任边界完全不同：
 * - 旧模型：`rooms`/`players` 是 ADMINONLY，只有云函数能碰，`PublicPlayer`
 *   里特意不含 uid。
 * - 新模型：`game_rooms` 配置成"已登录用户可读写"，任何已认证用户都能直接
 *   读写这个集合——这是本阶段刻意做的简化（面向朋友聚会场景，不是陌生人
 *   对战），所以安全边界更松，但也意味着字段设计上没必要像旧模型那样严格
 *   区分"公开"和"私有"。
 *
 * 不删除、不修改 `shared/types.ts`，两套模型并存，互不影响。
 *
 * 阶段 C：`GameRoom` 新增可选字段 `game`，房主开局（status 从 WAITING 变为
 * PLAYING）时才会写入。所有游戏内的并发写入（掷骰、移动、买地产、出牌……）
 * 仍然复用这份文档顶层的 `version` 做乐观锁，不新增第二套版本号——
 * 原因：`game_rooms` 单文档本来就是"一个房间一份真相"的设计，游戏状态和
 * 大厅状态（谁在线、是否已关闭）本质上是同一份文档的一部分，拆成两份文档
 * 反而需要处理"两份文档各自乐观锁但逻辑上必须一起生效"的新问题，复杂度
 * 不值得——见 `frontend/src/lib/gameEngineDb.ts` 的详细说明。
 */
import type { GameState } from './game/types'

export type GameRoomStatus = 'WAITING' | 'PLAYING' | 'CLOSED'

export interface GameRoomPlayer {
  /** CloudBase 匿名登录的真实 uid，用于判断"这是不是我自己的座位"、房主转移等 */
  uid: string
  nickname: string
  seat: number
  isHost: boolean
  joinedAt: number
}

/** 对应 `game_rooms` 集合里的一条文档 */
export interface GameRoom {
  _id: string
  roomCode: string
  status: GameRoomStatus
  players: GameRoomPlayer[]
  playerCount: number
  minPlayers: number
  maxPlayers: number
  /** 乐观锁版本号；并发写入前必须用 where({_id, version}) 校验，不能假设读后写是原子的 */
  version: number
  createdAt: number
  updatedAt: number
  /** 游戏内状态，只在 status === 'PLAYING' 时存在。 */
  game?: GameState
}
