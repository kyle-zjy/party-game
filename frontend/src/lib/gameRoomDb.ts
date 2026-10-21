/**
 * 阶段 B：前端直连数据库的房间数据访问层，集合名 `game_rooms`。
 *
 * 不经过 room 云函数——这是本阶段刻意的简化方向（朋友聚会场景，优先把
 * "能玩"做出来，不是陌生人对战场景那种需要服务端权威的安全模型）。
 * `room` 云函数和 `rooms`/`players` 两个旧集合原样保留，不删除、不修改，
 * 留作以后需要更强安全性时的回滚路径。
 *
 * 并发安全：**不假装"读后写"天然是原子的**。所有修改 `game_rooms`
 * 文档的操作都用乐观锁——`where({_id, version}).update({..., version:
 * version+1})`，`updated` 字段为 0 表示版本冲突（文档在读取之后被别人
 * 改过了），调用方重新读取最新状态、重新校验业务规则、再重试，和
 * `functions/room/src/lib/db.ts` 里服务端用的是同一套模式，只是这次从
 * 浏览器直接发起，不经过云函数。
 *
 * 房间码唯一性：依赖在 `game_rooms.roomCode` 字段上创建的**唯一索引**
 * （需要你在 CloudBase 控制台手动创建，见 docs/next-remote-steps.md）。
 * 没有唯一索引的话，两个用户同时生成了一样的房间码、同时 `add()`，
 * 会产生两条房间码相同的文档，造成后续加入时行为不确定——所以唯一索引
 * 不是可选项，是这个方案能正确工作的前提。
 */
import { app } from './cloudbase'
import { describeUnknownError, RoomError } from '../../../shared/errors'
import {
  allocateSeat,
  assertCanStartGame,
  assertJoinable,
  generateRoomCode,
  isNicknameTaken,
  validateNickname,
  validateRoomCode,
} from '../../../shared/gameRoomRules'
import type { GameRoom, GameRoomPlayer } from '../../../shared/gameRoomTypes'
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/constants'
import { normalizeRoom } from './normalizeRoom'

const COLLECTION = 'game_rooms'
const MAX_ROOM_CODE_ATTEMPTS = 5
const MAX_CONFLICT_RETRY = 3

function db() {
  return app.database()
}

function now(): number {
  return Date.now()
}

/**
 * 把"数据库调用本身被拒绝"（`await ...get()/.update()/.add()` 抛出异常，
 * 不是 resolve 了一个带 `code` 字段的失败结果）统一包装成 `RoomError`。
 *
 * 为什么需要这一层：`@cloudbase/js-sdk@3.10.2` 的 database 模块在某些失败
 * 路径下 reject 的不是 `Error` 实例，而是形如 `{code, message}` 的纯对象
 * （源码 `utilities/dist/cjs/libs/util.js` 的 `errorToResult()`确认了
 * 这一点）。之前这里没有 try/catch，这类原始拒绝对象会原样向上抛出，
 * 最终在某个页面的 `catch (err)` 里被 `String(err)` 转成
 * `"[object Object]"` 展示给用户——这正是用户报告的 bug 的真实根因，
 * 不是猜测。现在统一在数据访问层（而不是每个 UI 调用点）就把它转换成
 * `RoomError`，上层的 `describeUnknownError()` 永远只会看到
 * `RoomError`/`Error`，不会再看到裸对象。
 */
function wrapDbCallError(error: unknown, action: string): RoomError {
  if (error instanceof RoomError) return error
  if (import.meta.env.DEV) {
    // 开发环境保留完整诊断信息，不因为"转成一句安全提示"而丢失排查线索。
    console.error(`[gameRoomDb] ${action} 失败，原始错误：`, error)
  }
  return new RoomError('INTERNAL_ERROR', `${action}失败：${describeUnknownError(error)}`)
}

async function getRoomById(roomId: string): Promise<GameRoom | null> {
  let res
  try {
    res = await db().collection(COLLECTION).doc(roomId).get()
  } catch (error) {
    throw wrapDbCallError(error, '读取房间')
  }
  if (res.code) {
    throw new RoomError('INTERNAL_ERROR', `读取房间失败：${res.code} ${res.message ?? ''}`)
  }
  const room = res.data[0] as GameRoom | undefined
  return room ? normalizeRoom(room) : null
}

async function getRoomByCode(roomCode: string): Promise<GameRoom | null> {
  let res
  try {
    res = await db().collection(COLLECTION).where({ roomCode }).limit(1).get()
  } catch (error) {
    throw wrapDbCallError(error, '按房间码查询')
  }
  if (res.code) {
    throw new RoomError('INTERNAL_ERROR', `按房间码查询失败：${res.code} ${res.message ?? ''}`)
  }
  const doc = (res.data as GameRoom[])[0]
  return doc ? normalizeRoom(doc) : null
}

/**
 * 用 `db.command.set(value)` 包一层每个顶层字段再提交更新。
 *
 * 真实踩到的运行时 bug（完整分析见 `frontend/src/lib/gameEngineDb.ts` 的
 * `wrapPatchFieldsAsSet` 注释，这里只记录结论，避免重复整段反编译证据）：
 * CloudBase `collection.where(...).update(data)` 会把 `data` 里任何嵌套的
 * 普通对象字段递归展开成 MongoDB 点路径更新，如果数据库里对应的父字段
 * 当前是 `null`，点路径展开会失败并报
 * `DATABASE_REQUEST_FAILED: Cannot create field '...' in element
 * {xxx: null}`。`db.command.set()` 产出的 `Command` 实例会让 SDK 整字段
 * 原子替换，不会被递归展开，不管这个字段当前是 `null` 还是不存在。
 * 这个集合里虽然当前只有 `players`（数组）可能受影响，但统一在
 * `updateRoomWithVersion` 这一个地方处理，比逐个排查"现在哪些字段不会有
 * 嵌套 null"更可靠——以后这个集合的文档结构长出新的可能为 null 的嵌套
 * 字段，不需要再回来重新审查这个函数。
 *
 * 返回 true 表示写入成功，false 表示版本冲突（需要重新读取后重试）。
 */
function wrapPatchFieldsAsSet(patch: Record<string, unknown>): Record<string, unknown> {
  const command = db().command
  const wrapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    wrapped[key] = command.set(value)
  }
  return wrapped
}

async function updateRoomWithVersion(
  roomId: string,
  expectedVersion: number,
  patch: Partial<Omit<GameRoom, '_id' | 'version'>>,
): Promise<boolean> {
  let res
  try {
    res = await db()
      .collection(COLLECTION)
      .where({ _id: roomId, version: expectedVersion })
      .update(wrapPatchFieldsAsSet({ ...patch, version: expectedVersion + 1, updatedAt: now() }))
  } catch (error) {
    throw wrapDbCallError(error, '更新房间')
  }
  if (res.code) {
    throw new RoomError('INTERNAL_ERROR', `更新房间失败：${res.code} ${res.message ?? ''}`)
  }
  return (res.updated ?? 0) > 0
}

export interface JoinResult {
  room: GameRoom
  uid: string
}

/** 创建一个新房间，调用者自动成为房主（seat 0） */
export async function createGameRoom(nickname: string, uid: string): Promise<JoinResult> {
  const cleanNickname = validateNickname(nickname)

  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
    const roomCode = generateRoomCode()
    const createdAt = now()
    const hostPlayer: GameRoomPlayer = {
      uid,
      nickname: cleanNickname,
      seat: 0,
      isHost: true,
      joinedAt: createdAt,
    }
    const roomDoc: Omit<GameRoom, '_id'> = {
      roomCode,
      status: 'WAITING',
      players: [hostPlayer],
      playerCount: 1,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    }

    try {
      const res = await db().collection(COLLECTION).add(roomDoc)
      if (res.code) {
        // 不假设这个 code 一定是"房间码重复"——任何失败都当作"这次没成功"，
        // 换一个房间码重试，不去猜测/依赖具体的错误码文本
        // （唯一索引冲突在不同 SDK/版本下的具体错误码形状未经验证）。
        continue
      }
      if (!res.id) {
        throw new RoomError('INTERNAL_ERROR', '创建房间成功但没有返回文档 ID')
      }
      return { room: { ...roomDoc, _id: res.id }, uid }
    } catch (error) {
      if (error instanceof RoomError) throw error
      // 真实抛出的异常也当作"这次没成功，换个房间码重试"——
      // 唯一索引冲突、网络抖动都走同一条重试路径，不深挖具体错误形状。
      if (import.meta.env.DEV) {
        console.error('[gameRoomDb] createGameRoom 单次尝试失败，原始错误：', error)
      }
      if (attempt === MAX_ROOM_CODE_ATTEMPTS - 1) {
        throw new RoomError('INTERNAL_ERROR', `创建房间失败：${describeUnknownError(error)}`)
      }
    }
  }
  throw new RoomError('INTERNAL_ERROR', '多次尝试后仍无法生成不冲突的房间码，请重试')
}

/** 用房间码 + 昵称加入一个 WAITING 中的房间 */
export async function joinGameRoom(roomCode: string, nickname: string, uid: string): Promise<JoinResult> {
  validateRoomCode(roomCode)
  const cleanNickname = validateNickname(nickname)

  for (let attempt = 0; attempt < MAX_CONFLICT_RETRY; attempt += 1) {
    const room = await getRoomByCode(roomCode)
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    }

    // 同一个 uid 已经是成员：直接返回当前房间状态，不生成新的座位
    // （刷新页面/重复点击加入时会走到这里）。
    const existing = room.players.find((p) => p.uid === uid)
    if (existing) {
      return { room, uid }
    }

    assertJoinable(room, uid, now())
    if (isNicknameTaken(room.players, cleanNickname)) {
      throw new RoomError('NICKNAME_TAKEN', '昵称已被使用')
    }

    const seat = allocateSeat(room.players)
    const newPlayer: GameRoomPlayer = {
      uid,
      nickname: cleanNickname,
      seat,
      isHost: false,
      joinedAt: now(),
    }
    const updatedPlayers = [...room.players, newPlayer]

    const success = await updateRoomWithVersion(room._id, room.version, {
      players: updatedPlayers,
      playerCount: updatedPlayers.length,
    })
    if (success) {
      return {
        room: { ...room, players: updatedPlayers, playerCount: updatedPlayers.length, version: room.version + 1 },
        uid,
      }
    }
    // 版本冲突（可能座位/人数在读取后已经变化），重新读取后重试。
  }
  throw new RoomError('CONFLICT', '操作冲突，请重试')
}

/** 用可信 uid 恢复已有的房间成员身份（刷新页面场景） */
export async function rejoinGameRoom(roomCode: string, uid: string): Promise<JoinResult> {
  validateRoomCode(roomCode)
  const room = await getRoomByCode(roomCode)
  if (!room) {
    throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
  }
  const existing = room.players.find((p) => p.uid === uid)
  if (!existing) {
    throw new RoomError('NOT_MEMBER', '你还不是这个房间的成员')
  }
  return { room, uid }
}

/** 轮询用：直接按房间 ID 获取最新快照 */
export async function getGameRoomState(roomId: string): Promise<GameRoom | null> {
  return getRoomById(roomId)
}

/** 离开房间：WAITING 阶段真正移除，房主离开时转移给 seat 最小的剩余玩家 */
export async function leaveGameRoom(roomId: string, uid: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRY; attempt += 1) {
    const room = await getRoomById(roomId)
    if (!room) return // 房间已经不存在，视为已经离开
    const player = room.players.find((p) => p.uid === uid)
    if (!player) return // 本来就不是成员

    const remaining = room.players.filter((p) => p.uid !== uid)

    if (remaining.length === 0) {
      const success = await updateRoomWithVersion(roomId, room.version, {
        players: [],
        playerCount: 0,
        status: 'CLOSED',
      })
      if (success) return
      continue
    }

    let finalPlayers = remaining
    if (player.isHost) {
      const nextHost = remaining.reduce((min, p) => (p.seat < min.seat ? p : min))
      finalPlayers = remaining.map((p) => ({ ...p, isHost: p.uid === nextHost.uid }))
    }

    const success = await updateRoomWithVersion(roomId, room.version, {
      players: finalPlayers,
      playerCount: finalPlayers.length,
    })
    if (success) return
    // 版本冲突，重新读取后重试。
  }
  throw new RoomError('CONFLICT', '离开房间时发生冲突，请重试')
}

/** 房主开始游戏 */
export async function startGameRoom(roomId: string, uid: string): Promise<GameRoom> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRY; attempt += 1) {
    const room = await getRoomById(roomId)
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    }
    assertCanStartGame(room, uid)

    const success = await updateRoomWithVersion(roomId, room.version, { status: 'PLAYING' })
    if (success) {
      return { ...room, status: 'PLAYING', version: room.version + 1 }
    }
    // 版本冲突，重新读取后重试（重试会用最新状态重新校验权限/人数）。
  }
  throw new RoomError('CONFLICT', '操作冲突，请重试')
}
