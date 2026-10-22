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
  applyEndTurn,
  applyHostRulingAck,
  applyPlayTacticCard,
  applyResolveDrinkAck,
  applyResolveHeartAttack,
  applyResolveLanding,
  applyRevealLadyCard,
  applyRollDice,
  applyRedrawTruthOrDare,
  applySkipRollTurn,
  applySkipTactic,
  applyTruthOrDareChoice,
  applyTruthOrDareResult,
  applyUsePeach,
  GameActionError,
} from '../../../shared/game/engine/turnEngine'
import { applyBanCatch, applyChooseLovers, applyJusticeSwap, applyTarotDiscard } from '../../../shared/game/engine/tarotActions'
import {
  applyCrazyCatch,
  applyDevStackLadyDeck,
  applyDuelChooseTarget,
  applyDuelRoll,
  applyKingTaskResolve,
  applyKingWriteTask,
  applyLadyHostCancel,
  applyLadyHostResult,
  applyLadyStart,
  applyLuckySevenRoll,
  applyOfferSubstitute,
  applyRespondSubstitute,
  applySetAway,
  finalizeGameAction,
} from '../../../shared/game/engine/ladyEvents'
import { applyMortgage, applyPassTactic, applyRespondTactic } from '../../../shared/game/engine/tacticStack'
import {
  applyDreamChallenge,
  applyDreamDeclare,
  applyDreamRespond,
  applyRespondBluff,
  applyStartBluff,
  applyTexasBet,
  closeBetting,
  type TexasBetAction,
} from '../../../shared/game/engine/texas'
import { applyAvalonHostCancel, applyAvalonPick, applyAvalonVote } from '../../../shared/game/engine/avalon'
import { applyEnterGods, applyRiverChoice } from '../../../shared/game/engine/zones'
import { assertNotFinished, continueEndgame } from '../../../shared/game/engine/endgame'
import { normalizeRoom } from './normalizeRoom'
import { seededRng } from '../../../shared/game/cards/ladyDeck'
import { rollD6 } from '../../../shared/game/engine/dice'
import type { DrinkAckChoice, GameState, LadyRank, LadyRuleset } from '../../../shared/game/types'

const COLLECTION = 'game_rooms'
const MAX_CONFLICT_RETRY = 5

function db() {
  return app.database()
}

function now(): number {
  return Date.now()
}

/**
 * 同一个动作的随机结果只能产生一次：在乐观锁重试循环外生成一个种子，每次重试都用同一个种子
 * 重新创建随机数序列。版本冲突重试时抽到的塔罗、补抽的手牌、德州洗牌顺序都和第一次完全相同，
 * 不会变成"重抽"。
 */
function actionSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
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
  const room = res.data[0] as GameRoom | undefined
  return room ? normalizeRoom(room) : null
}

/**
 * 真实踩到的运行时 bug，根因已经通过反编译 `@cloudbase/js-sdk@3.10.2` 的
 * database 模块源码确认（不是推测）：**`collection.where(...).update(data)`
 * 会把 `data` 里任何嵌套的普通对象字段，递归展开成 MongoDB 的点路径更新
 * （`encodeUpdateObject` -> `Gt()`），例如
 * `{ game: { turn: { lastRoll: {natural, effective, isNaturalSix} } } }`
 * 会被转换成
 * `{ "game.turn.lastRoll.natural": 3, "game.turn.lastRoll.effective": 3,
 *    "game.turn.lastRoll.isNaturalSix": false, ... }`
 * 这样的扁平化 `$set`。如果数据库里当前这份文档的 `game.turn.lastRoll`
 * 字段值正好是 `null`（开局 `initGameState()` 写的初始值，或者结束回合/
 * 自然 6 时被重置回的值），MongoDB 没办法在一个值为 `null` 的父字段下面
 * 创建子字段，会直接报错：
 * `DATABASE_REQUEST_FAILED: ... Cannot create field 'effective' in
 * element {lastRoll: null}`——第一次掷骰必然触发这个错误，因为开局之后
 * `lastRoll` 第一次从 `null` 变成一个真正的对象，正是这个点路径展开
 * 转换失败的场景。
 *
 * 修复：用 `db.command.set(value)` 包裹要写入的顶层字段值。`.set()`
 * 产出的是 SDK 内部的 `Command` 实例（反编译确认：`encodeUpdateObject`
 * 对 `Command` 实例的分支走 `encodeUpdateCommand` -> 直接生成
 * `{ $set: { fieldName: value } }`，完全跳过上面那个递归点路径展开的
 * 代码路径），所以不管 `value` 内部嵌套了多少层对象、不管数据库里这个
 * 字段当前是 `null` 还是不存在，都是一次原子的"整字段替换"，不会被拆成
 * 点路径子字段。这是 SDK 公开类型声明里有文档和示例的 API（`core.d.ts`
 * 的 `ICommand.set()`），不是绕过类型系统的技巧。
 *
 * 不止 `game` 这一个字段需要这样处理——`patch` 里任何值是对象/数组的
 * 顶层字段都统一用 `db.command.set()` 包一层，这样不需要逐个排查
 * `patch` 里到底哪些字段的哪些内部路径当前是 `null`（这个判断依赖运行时
 * 的历史数据，没办法仅从 TypeScript 类型推断出来，所以修复原则 3
 * 明确要求不能只改类型）。基本类型字段（number/string/boolean）本来就不会
 * 触发点路径展开，包一层 `.set()` 对它们是无副作用的等价写法，不需要
 * 为了"性能"而专门排除它们。
 */
function wrapPatchFieldsAsSet(
  patch: Record<string, unknown>,
): Record<string, unknown> {
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
      const at = now()
      // 游戏结束后结果固定，任何动作都不再修改
      assertNotFinished(room.game)
      // 统一收尾：小姐牌 2 的陪喝在这里检查一次，所有动作产生的喝酒提醒都覆盖到
      nextGame = finalizeGameAction(room.game, transform(room.game, room), at)
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
export async function startGameWithEngine(roomId: string, hostUid: string, ladyRuleset: LadyRuleset = 'official'): Promise<GameRoom> {
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

    // 候选规则只允许在开发环境开局；生产构建里这个分支恒为 official，线上房间不会意外启用
    const ruleset: LadyRuleset = import.meta.env.DEV ? ladyRuleset : 'official'
    const game = initGameState(room.players, now(), undefined, Math.random, ruleset)
    const success = await updateRoomWithVersion(roomId, room.version, { status: 'PLAYING', game })
    if (success) {
      return { ...room, status: 'PLAYING', game, version: room.version + 1 }
    }
    // 版本冲突：可能另一个人也在点开局，或者有人在这期间加入/离开了房间，重新读取后重试。
  }
  throw new RoomError('CONFLICT', '操作冲突，请重试')
}

export async function rollDiceAction(roomId: string, uid: string): Promise<GameRoom> {
  // 骰子点数在重试循环外只掷一次：版本冲突重试时沿用同一个点数，不会变成"重掷"。
  const natural = rollD6()
  return runGameAction(roomId, (game) => applyRollDice(game, uid, natural, now()))
}

export async function resolveLandingAction(roomId: string, uid: string): Promise<GameRoom> {
  // 落点可能抽塔罗、补抽手牌、触发 CASINO 洗牌：同一个种子，重试结果不变
  const seed = actionSeed()
  return runGameAction(roomId, (game) => applyResolveLanding(game, uid, now(), seededRng(seed)).state)
}

export async function advanceAfterLandingAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyAdvanceAfterLanding(game, uid, now()))
}

export async function buyPropertyAction(roomId: string, uid: string, buy: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyBuyPropertyDecision(game, uid, buy, now()))
}

export async function chooseDrinkTargetAction(roomId: string, uid: string, targetUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyChooseDrinkTargetDecision(game, uid, targetUid, now()))
}

export async function truthOrDareChoiceAction(roomId: string, uid: string, choice: 'TRUTH' | 'DARE'): Promise<GameRoom> {
  const seed = actionSeed()
  return runGameAction(roomId, (game) => applyTruthOrDareChoice(game, uid, choice, now(), seededRng(seed)))
}

export async function redrawTruthOrDareAction(roomId: string, uid: string): Promise<GameRoom> {
  const seed = actionSeed()
  return runGameAction(roomId, (game, room) => applyRedrawTruthOrDare(game, uid, hostUidOf(room), now(), seededRng(seed)))
}

export async function truthOrDareResultAction(roomId: string, uid: string, completed: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyTruthOrDareResult(game, uid, completed, now()))
}

export async function hostRulingAckAction(roomId: string, callerUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyHostRulingAck(game, callerUid, hostUidOf(room), now()))
}

export async function resolveHeartAttackAction(
  roomId: string,
  callerUid: string,
  firstUid: string | null,
  falseStartUids: string[],
): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) =>
    applyResolveHeartAttack(game, callerUid, hostUidOf(room), firstUid, falseStartUids, now()),
  )
}

export async function resolveDrinkAckAction(
  roomId: string,
  callerUid: string,
  ackId: string,
  choice: DrinkAckChoice,
  devilTargetUid: string | null = null,
): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) =>
    applyResolveDrinkAck(game, callerUid, hostUidOf(room), ackId, choice, now(), devilTargetUid),
  )
}

export async function peachAction(roomId: string, callerUid: string, ackId: string): Promise<GameRoom> {
  const seed = actionSeed()
  return runGameAction(roomId, (game) => applyUsePeach(game, callerUid, ackId, now(), seededRng(seed)))
}

export async function chooseLoversAction(roomId: string, callerUid: string, uidA: string, uidB: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyChooseLovers(game, callerUid, uidA, uidB, now()))
}

export async function justiceSwapAction(
  roomId: string,
  callerUid: string,
  winnerUid: string | null,
  loserUid: string | null,
): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyJusticeSwap(game, callerUid, hostUidOf(room), winnerUid, loserUid, now()))
}

export async function tarotDiscardAction(roomId: string, callerUid: string, targetUid: string, cardId: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyTarotDiscard(game, callerUid, hostUidOf(room), targetUid, cardId, now()))
}

export async function banCatchAction(
  roomId: string,
  callerUid: string,
  catcherUid: string,
  violatorUid: string,
  correct: boolean,
  incidentId: string,
): Promise<GameRoom> {
  // incidentId 由录入面板打开时生成一次：重复点击、重试都带同一个 id，引擎只结算一次
  return runGameAction(roomId, (game, room) => applyBanCatch(game, callerUid, hostUidOf(room), catcherUid, violatorUid, correct, now(), incidentId))
}

export async function revealLadyCardAction(roomId: string, uid: string): Promise<GameRoom> {
  // 从共享牌堆顶抽牌，抽牌结果和窗口变化在同一次乐观锁写入里落库
  const seed = actionSeed()
  return runGameAction(roomId, (game) => applyRevealLadyCard(game, uid, now(), seededRng(seed)).state)
}

export async function playTacticCardAction(
  roomId: string,
  uid: string,
  cardInstanceId: string,
  targetUid: string | null,
): Promise<GameRoom> {
  // 过河拆桥的随机弃牌、魔术师补抽：在重试循环外决定一次
  const seed = actionSeed()
  const randomPick = Math.random()
  return runGameAction(roomId, (game) => applyPlayTacticCard(game, uid, cardInstanceId, targetUid, now(), seededRng(seed), randomPick))
}

export async function skipTacticAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applySkipTactic(game, uid, now()))
}

export async function endTurnAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => continueEndgame(applyEndTurn(game, uid, now()), now()))
}

// ---------------------------------------------------------------------------
// 小姐牌事件（Phase D.2）：每个动作都带 eventId，事件已结束/被替换时引擎会拒绝
// ---------------------------------------------------------------------------

export async function ladyStartAction(roomId: string, uid: string, eventId: string, text: string | null): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyLadyStart(game, uid, hostUidOf(room), eventId, text, now()))
}

export async function ladyHostResultAction(roomId: string, uid: string, eventId: string, loserUid: string | null): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyLadyHostResult(game, uid, hostUidOf(room), eventId, loserUid, now()))
}

export async function ladyHostCancelAction(roomId: string, uid: string, eventId: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyLadyHostCancel(game, uid, hostUidOf(room), eventId, now()))
}

export async function luckySevenRollAction(roomId: string, uid: string, eventId: string): Promise<GameRoom> {
  // 事件骰和移动骰一样在重试循环外只掷一次
  const natural = rollD6()
  return runGameAction(roomId, (game, room) => applyLuckySevenRoll(game, uid, hostUidOf(room), eventId, natural, now()))
}

export async function duelChooseTargetAction(roomId: string, uid: string, eventId: string, targetUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyDuelChooseTarget(game, uid, eventId, targetUid, now()))
}

export async function duelRollAction(roomId: string, uid: string, eventId: string, side: 'actor' | 'target'): Promise<GameRoom> {
  const natural = rollD6()
  return runGameAction(roomId, (game, room) => applyDuelRoll(game, uid, hostUidOf(room), eventId, side, natural, now()))
}

export async function kingTaskResolveAction(roomId: string, uid: string, eventId: string, completed: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyKingTaskResolve(game, uid, hostUidOf(room), eventId, completed, now()))
}

export async function kingWriteTaskAction(roomId: string, uid: string, eventId: string, content: string | null): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyKingWriteTask(game, uid, hostUidOf(room), eventId, content, now()))
}

export async function offerSubstituteAction(roomId: string, uid: string, ackId: string, toUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyOfferSubstitute(game, uid, ackId, toUid, now()))
}

export async function respondSubstituteAction(roomId: string, uid: string, ackId: string, accept: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyRespondSubstitute(game, uid, hostUidOf(room), ackId, accept, now()))
}

export async function setAwayAction(roomId: string, uid: string, targetUid: string, away: boolean, usePass: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applySetAway(game, uid, hostUidOf(room), targetUid, away, usePass, now()))
}

export async function crazyCatchAction(roomId: string, uid: string, violatorUid: string, incidentId: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyCrazyCatch(game, uid, hostUidOf(room), violatorUid, now(), incidentId))
}

/** 开发测试入口：把指定点数放到牌堆顶。引擎只允许候选规则预览房间使用，并且只有房主可以调用 */
export async function devStackLadyDeckAction(roomId: string, uid: string, rank: LadyRank): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => {
    if (uid !== hostUidOf(room)) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以使用开发测试入口')
    return applyDevStackLadyDeck(game, rank)
  })
}

// ---------------------------------------------------------------------------
// V1.6：停骰、抵押、战术响应、德州/吹牛/梦幻、阿瓦隆、神鬼道与河道、终局
// ---------------------------------------------------------------------------

export async function skipRollTurnAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applySkipRollTurn(game, uid, now()))
}

export async function mortgageAction(roomId: string, uid: string, propertyName: string, mortgage: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyMortgage(game, uid, propertyName, mortgage, now()))
}

export async function respondTacticAction(roomId: string, uid: string, stackId: string, cardId: string): Promise<GameRoom> {
  const seed = actionSeed()
  return runGameAction(roomId, (game) => applyRespondTactic(game, uid, stackId, cardId, now(), seededRng(seed)))
}

export async function passTacticAction(roomId: string, uid: string, stackId: string, forUid: string): Promise<GameRoom> {
  const randomPick = Math.random()
  return runGameAction(roomId, (game, room) => applyPassTactic(game, uid, hostUidOf(room), stackId, forUid, now(), randomPick))
}

export async function texasBetAction(roomId: string, uid: string, action: TexasBetAction): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyTexasBet(game, uid, action, now()))
}

/** 房主结束本阶段下注：未表态的人按过牌/弃牌处理（有人离线时用） */
export async function texasCloseBettingAction(roomId: string, uid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => {
    if (uid !== hostUidOf(room)) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以结束本阶段下注')
    return closeBetting(game, now(), true)
  })
}

export async function startBluffAction(roomId: string, uid: string, ackId: string, claim: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyStartBluff(game, uid, ackId, claim, now()))
}

export async function respondBluffAction(roomId: string, uid: string, ackId: string, challenge: boolean, closeAll = false): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => applyRespondBluff(game, uid, hostUidOf(room), ackId, challenge, now(), closeAll))
}

export async function dreamChallengeAction(roomId: string, uid: string, eventId: string, targetUid: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyDreamChallenge(game, uid, eventId, targetUid, now()))
}

export async function dreamRespondAction(roomId: string, uid: string, eventId: string, accept: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyDreamRespond(game, uid, eventId, accept, now()))
}

export async function dreamDeclareAction(roomId: string, uid: string, eventId: string, card: string): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyDreamDeclare(game, uid, eventId, card, now()))
}

export async function avalonPickAction(roomId: string, uid: string, missionId: string, passengers: string[]): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyAvalonPick(game, uid, missionId, passengers, now()))
}

export async function avalonVoteAction(roomId: string, uid: string, missionId: string, vote: 'SUCCESS' | 'FAIL'): Promise<GameRoom> {
  return runGameAction(roomId, (game) => continueEndgame(applyAvalonVote(game, uid, missionId, vote, now()), now()))
}

export async function avalonCancelAction(roomId: string, uid: string, missionId: string): Promise<GameRoom> {
  return runGameAction(roomId, (game, room) => continueEndgame(applyAvalonHostCancel(game, uid, hostUidOf(room), missionId, now()), now()))
}

export async function riverChoiceAction(roomId: string, uid: string, choice: 'BRIDGE' | 'FORD'): Promise<GameRoom> {
  // 渡河三颗独立骰（玩家、河神、神谕）在重试循环外各掷一次
  const dice = { player: rollD6(), god: rollD6(), oracle: rollD6() }
  return runGameAction(roomId, (game) => applyRiverChoice(game, uid, choice, dice, now()))
}

export async function enterGodsAction(roomId: string, uid: string, enter: boolean): Promise<GameRoom> {
  return runGameAction(roomId, (game) => applyEnterGods(game, uid, enter, now()))
}

/** 房主身份属于大厅模型（`GameRoomPlayer.isHost`），不属于 GameState——从房间文档取，不是从游戏状态猜 */
function hostUidOf(room: GameRoom): string {
  const host = room.players.find((p) => p.isHost)
  if (!host) throw new RoomError('INTERNAL_ERROR', '房间没有房主，数据异常')
  return host.uid
}
