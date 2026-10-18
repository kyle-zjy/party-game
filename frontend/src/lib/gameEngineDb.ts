/**
 * Phase C：把 `shared/game/engine/turnEngine.ts` 的纯函数接到 `game_rooms`
 * 文档数据库上——每一次游戏内动作都是"读最新 GameRoom -> 用引擎算出新
 * GameState -> 用 `where({_id, version}).update(...)` 乐观锁写回"，版本冲突
 * 就重新读取、重新跑一遍引擎再重试，不假设"读后写"天然原子。
 *
 * 复用阶段 B 已经验证过的乐观锁集合（不新建集合、不新建第二套版本号），
 * 详见 `shared/gameRoomTypes.ts` 文件头关于 `game` 字段的说明。
 *
 * 所有函数的签名都是 `(roomId, callerUid, ...) => Promise<GameRoom>`——
 * 返回更新后的完整房间文档，调用方（React 组件）直接用返回值更新本地状态，
 * 不需要等下一次轮询才能看到自己刚做的操作生效。
 */
import { app } from './cloudbase'
import { describeUnknownError, RoomError } from '../../../shared/errors'
import type { GameRoom } from '../../../shared/gameRoomTypes'
import { initGameState } from '../../../shared/game/engine/initGame'
import {
  applyAdvanceAfterLanding,
  applyBuyPropertyDecision,
  applyChooseDrinkTargetDecision,
  applyDismissHeartAttack,
  applyDrinkAckDecision,
  applyEndTurn,
  applyHostRulingAck,
  applyPlayTacticCard,
  applyResolveDrinkAck,
  applyResolveLanding,
  applyRevealLadyCard,
  applyRollDice,
  applySkipTactic,
  applyTruthOrDareDecision,
  GameActionError,
} from '../../../shared/game/engine/turnEngine'
import { rollD6 } from '../../../shared/game/engine/dice'
import { LADY_CARDS } from '../../../shared/game/cards/ladyCards'
import type { DrinkAckChoice, GameState } from '../../../shared/game/types'

const COLLECTION = 'game_rooms'
const MAX_CONFLICT_RETRY = 5

function db() {
  return app.database()
}

function now(): number {
  return Date.now()
}

/**
 * 把任何未知形状的异常（包括 `GameActionError`、`RoomError`，也包括
 * CloudBase SDK 可能 reject 出来的裸 `{code, message}` 对象）统一转换成
 * `RoomError`。用 `describeUnknownError`（见 shared/errors.ts）而不是
 * `String(error)`——后者对非 `Error` 对象会产出 `"[object Object]"`，
 * 这正是本轮修复的 `[object Object]` bug 的真实根因之一。
 */
function toRoomError(error: unknown): RoomError {
  if (error instanceof RoomError) return error
  if (error instanceof GameActionError) {
    return new RoomError(error.code, error.message)
  }
  return new RoomError('INTERNAL_ERROR', describeUnknownError(error))
}

/** 数据库调用（而不是引擎计算）本身失败时的包装——同样不能用 String(error) */
function wrapDbCallError(error: unknown, action: string): RoomError {
  if (error instanceof RoomError) return error
  if (import.meta.env.DEV) {
    console.error(`[gameEngineDb] ${action} 失败，原始错误：`, error)
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
  return (res.data[0] as GameRoom | undefined) ?? null
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
      .update({ ...patch, version: expectedVersion + 1, updatedAt: now() })
  } catch (error) {
    throw wrapDbCallError(error, '更新房间')
  }
  if (res.code) {
    throw new RoomError('INTERNAL_ERROR', `更新房间失败：${res.code} ${res.message ?? ''}`)
  }
  return (res.updated ?? 0) > 0
}

/**
 * 读最新房间 -> 校验游戏已开始 -> 用 `transform` 算出新的 GameState ->
 * 乐观锁写回 -> 冲突则重试。所有游戏内动作都通过这一个辅助函数实现，
 * 保证"同一个动作不会因为重复点击、刷新或轮询重试而重复结算"这件事只需要
 * 在一个地方正确处理一次（引擎内部的阶段/状态机校验 + 这里的乐观锁重试）。
 */
async function runGameAction(
  roomId: string,
  transform: (game: GameState, room: GameRoom) => GameState,
): Promise<GameRoom> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRY; attempt += 1) {
    const room = await getRoomById(roomId)
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    if (room.status !== 'PLAYING' || !room.game) {
      throw new RoomError('GAME_NOT_STARTED', '游戏还没有开始')
    }

    let nextGame: GameState
    try {
      nextGame = transform(room.game, room)
    } catch (error) {
      throw toRoomError(error)
    }

    const success = await updateRoomWithVersion(roomId, room.version, { game: nextGame })
    if (success) {
      return { ...room, game: nextGame, version: room.version + 1 }
    }
    // 版本冲突：游戏状态在读取之后被别的玩家的操作改过了，重新读取最新状态后重试。
  }
  throw new RoomError('CONFLICT', '操作冲突，请重试')
}

/**
 * 房主开始游戏：WAITING -> PLAYING，同时写入初始化的 GameState。
 * 用乐观锁保证"重复点击开局按钮或刷新页面不会重复发牌"——一旦
 * `status` 从 WAITING 变成 PLAYING，后续的重复调用会在读到最新房间时发现
 * `room.status !== 'WAITING'` 而直接拒绝，不会再跑一次 `initGameState`。
 */
export async function startGameWithEngine(roomId: string, hostUid: string): Promise<GameRoom> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRY; attempt += 1) {
    const room = await getRoomById(roomId)
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
    if (room.status === 'PLAYING' && room.game) {
      // 已经开过局了（重复点击/刷新后再次触发）：直接返回当前状态，不重新发牌。
      return room
    }
    if (room.status !== 'WAITING') {
      throw new RoomError('ROOM_NOT_WAITING', '房间已经开始或已关闭')
    }
    const host = room.players.find((p) => p.isHost)
    if (!host || host.uid !== hostUid) {
      throw new RoomError('NOT_HOST', '只有房主可以开始游戏')
    }
    if (room.players.length < room.minPlayers) {
      throw new RoomError('NOT_ENOUGH_PLAYERS', `至少需要 ${room.minPlayers} 名玩家`)
    }

    const game = initGameState(room.players, now())
    const success = await updateRoomWithVersion(roomId, room.version, { status: 'PLAYING', game })
    if (success) {
      return { ...room, status: 'PLAYING', game, version: room.version + 1 }
    }
    // 版本冲突：可能另一个人也在点开局，或者有人在这期间加入/离开了房间，重新读取后重试。
  }
  throw new RoomError('CONFLICT', '操作冲突，请重试')
}

export async function rollDiceAction(roomId: string, uid: string): Promise<GameRoom> {
  const natural = rollD6()
  return runGameAction(roomId, (game) => applyRollDice(game, uid, natural))
}

export async function resolveLandingAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyResolveLanding(game, uid, now()).state)
}

export async function advanceAfterLandingAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyAdvanceAfterLanding(game, uid, now()))
}

export async function buyPropertyAction(roomId: string, uid: string, buy: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyBuyPropertyDecision(game, uid, buy, now()))
}

export async function ackDrinkDecisionAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyDrinkAckDecision(game, uid, now()))
}

export async function chooseDrinkTargetAction(roomId: string, uid: string, targetUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyChooseDrinkTargetDecision(game, uid, targetUid, now()))
}

export async function truthOrDareAction(roomId: string, uid: string, choice: 'TRUTH' | 'DARE'): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyTruthOrDareDecision(game, uid, choice, now()))
}

export async function hostRulingAckAction(roomId: string, callerUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyHostRulingAck(game, callerUid, hostUidOf(room), now()))
}

export async function dismissHeartAttackAction(roomId: string, callerUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyDismissHeartAttack(game, callerUid, hostUidOf(room), now()))
}

export async function resolveDrinkAckAction(
  roomId: string,
  callerUid: string,
  ackId: string,
  choice: DrinkAckChoice,
): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyResolveDrinkAck(game, callerUid, hostUidOf(room), ackId, choice, now()))
}

export async function revealLadyCardAction(roomId: string, uid: string, cardId: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyRevealLadyCard(game, uid, cardId, now()).state)
}

export async function playTacticCardAction(
  roomId: string,
  uid: string,
  cardInstanceId: string,
  targetUid: string | null,
): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyPlayTacticCard(game, uid, cardInstanceId, targetUid, now()))
}

export async function skipTacticAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applySkipTactic(game, uid, now()))
}

export async function endTurnAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyEndTurn(game, uid, now()))
}

/**
 * 翻主牌用的小姐牌需要一个"看起来随机"的 id——房主裁定类格子之外，
 * 这是本轮唯一一处前端生成随机结果再提交给引擎的地方。之所以不放在引擎
 * 内部生成（像 `rollDiceAction` 对骰子那样），是因为翻牌这个动作的"随机性"
 * 和"揭示哪张牌"是同一件事——调用方（UI）需要先知道结果才能播放翻牌动画，
 * 而骰子点数可以先提交掷骰动作、服务端/引擎算好之后再回传给前端播放动画。
 * 两种写法都不依赖"客户端能伪造对自己有利的结果"这件事成立与否——聚会场景
 * 本来就接受这种信任模型，见 docs/next-remote-steps.md 对 game_rooms
 * 权限的说明。
 */
export function drawRandomLadyCardId(): string {
  const idx = Math.floor(Math.random() * LADY_CARDS.length)
  const card = LADY_CARDS[idx]
  if (!card) throw new Error('小姐主牌堆为空，不应该发生')
  return card.id
}

/** 房主身份属于大厅模型（`GameRoomPlayer.isHost`），不属于 GameState——从房间文档取，不是从游戏状态猜 */
function hostUidOf(room: GameRoom): string {
  const host = room.players.find((p) => p.isHost)
  if (!host) throw new RoomError('INTERNAL_ERROR', '房间没有房主，数据异常')
  return host.uid
}
