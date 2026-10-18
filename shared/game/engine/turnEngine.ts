/**
 * 回合引擎——纯函数，输入当前 `GameState` + 一个动作，输出新的 `GameState`。
 * 不碰数据库、不读时间之外的任何外部状态（随机数通过参数注入，方便单测
 * 固定骰子点数）。乐观锁重试、持久化都在 `frontend/src/lib/gameEngineDb.ts`。
 *
 * 回合流程（V1.5 规则书"2. 回合流程" + "4.2 单回合逐步引导"）：
 * ROLLING -(掷骰)-> LANDING -(落点效果结算完/确认完)-> LADY_CARD
 *   -(翻牌+心脏病判定)-> TACTIC -(出牌或跳过)-> 下一位玩家的 ROLLING
 *
 * 自然 6 的特殊路径：LANDING 阶段结算完之后，如果这一次掷骰 `isNaturalSix`
 * 且还没用过额外掷骰，不进入 LADY_CARD，而是回到 ROLLING 阶段、
 * `extraRollPending = true`；额外掷骰的落点只结算落点效果，结算完之后
 * 如果本回合已经因为额外骰子翻过一次"该不该继续翻牌"的判断，就正常进入
 * LADY_CARD（翻一次主牌，不因为额外骰子跳过）。
 *
 * 【待确认规则】额外骰子本身又摇出自然 6 要不要继续连锁——规则书"第五部分"
 * 明确列为待确认事项。本引擎在这种情况下产出 `NATURAL_SIX_CHAIN` 的
 * `PendingDecision`，由房主现场裁定"继续连锁"或"到此为止"，不擅自选择
 * 其中一种当作默认规则。
 */
import { BOARD_SIZE, PROPERTY_BUY_PRICE, computeRent, findPropertyCellByName, getCell, isPropertyCell } from '../board'
import { buildRollRecord } from './dice'
import { computeNewPosition } from './movement'
import { appendHistory } from './history'
import { checkHeartAttack, getLadyCard } from '../cards/ladyCards'
import { drawRandomTacticCardId, getTacticCard, TACTIC_HAND_LIMIT } from '../cards/tacticCards'
import type {
  DrinkAckChoice,
  GamePlayerState,
  GameState,
  PendingDecision,
  PendingDrinkAck,
} from '../types'

const DRINK_CHOICE_LABEL: Record<DrinkAckChoice, string> = {
  DONE: '已完成',
  WATER: '以水代替',
  SKIP: '跳过',
}

export class GameActionError extends Error {
  code: 'NOT_YOUR_TURN' | 'INVALID_GAME_ACTION'
  constructor(code: 'NOT_YOUR_TURN' | 'INVALID_GAME_ACTION', message: string) {
    super(message)
    this.code = code
    this.name = 'GameActionError'
  }
}

function clonePlayers(state: GameState): Record<string, GamePlayerState> {
  const copy: Record<string, GamePlayerState> = {}
  for (const [uid, p] of Object.entries(state.players)) {
    copy[uid] = { ...p, properties: [...p.properties], tacticHand: [...p.tacticHand] }
  }
  return copy
}

function requireCurrentPlayer(state: GameState, uid: string): void {
  if (state.turn.currentPlayerUid !== uid) {
    throw new GameActionError('NOT_YOUR_TURN', '还没轮到你操作')
  }
}

function getPlayer(state: GameState, uid: string): GamePlayerState {
  const p = state.players[uid]
  if (!p) throw new GameActionError('INVALID_GAME_ACTION', '找不到这名玩家的游戏状态')
  return p
}

function pushDrinkAck(acks: PendingDrinkAck[], targetUid: string, amount: number, reason: string, now: number): PendingDrinkAck[] {
  return [
    ...acks,
    { id: `drink-${now}-${Math.random().toString(36).slice(2, 8)}`, targetUid, amount, reason, createdAt: now },
  ]
}

function neighborUid(state: GameState, uid: string, direction: 1 | -1): string {
  const idx = state.turnOrder.indexOf(uid)
  const n = state.turnOrder.length
  const neighborIdx = ((idx + direction) % n + n) % n
  const neighbor = state.turnOrder[neighborIdx]
  if (!neighbor) throw new Error('找不到相邻玩家，不应该发生')
  return neighbor
}

// ---------------------------------------------------------------------------
// 动作 1：掷骰（ROLLING -> LANDING）
// ---------------------------------------------------------------------------

export function applyRollDice(state: GameState, uid: string, natural: number): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'ROLLING') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是掷骰阶段')
  }
  const roll = buildRollRecord(natural)
  const player = getPlayer(state, uid)

  const oldPos = player.position
  const newPos = computeNewPosition(oldPos, roll.effective)

  return {
    ...state,
    turn: {
      ...state.turn,
      phase: 'LANDING',
      lastRoll: roll,
      pendingDecision: null,
      landingResolved: false,
    },
    players: { ...state.players, [uid]: { ...player, position: oldPos } }, // 位置先不变，移动动画由前端处理，落点结算时才真正写入新位置
    history: appendHistory(state.history, `掷出 ${roll.natural} 点${roll.isNaturalSix ? '（自然 6！）' : ''}，准备移动到第 ${newPos + 1} 格。`, Date.now()),
  }
}

/** 掷骰后的"最终落点"，前端用这个值驱动逐格移动动画，动画结束后调用 applyResolveLanding */
export function computePendingDestination(state: GameState, uid: string): number {
  const player = getPlayer(state, uid)
  const roll = state.turn.lastRoll
  if (!roll) throw new GameActionError('INVALID_GAME_ACTION', '还没有掷骰结果')
  return computeNewPosition(player.position, roll.effective)
}

// ---------------------------------------------------------------------------
// 动作 2：结算落点（LANDING 阶段，移动 + 格子效果）
// ---------------------------------------------------------------------------

export interface LandingOutcome {
  state: GameState
  /** 本次落点是否还需要当前玩家处理一个 pendingDecision 才能继续 */
  needsDecision: boolean
}

export function applyResolveLanding(state: GameState, uid: string, now: number): LandingOutcome {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'LANDING') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是落点结算阶段')
  }
  if (state.turn.landingResolved) {
    // 幂等保护：落点效果已经结算过（通常是因为还卡在一个 pendingDecision 上，
    // 重复点击或轮询重试再次调用了这个 action）。不重新移动棋子、不重新触发
    // 金币/事件效果，只把当前已有状态原样返回，调用方据此继续等待玩家处理
    // pendingDecision，而不是让"喝酒""获得金币"这类效果被重复结算。
    throw new GameActionError('INVALID_GAME_ACTION', '这一次落点已经结算过了')
  }

  const roll = state.turn.lastRoll
  if (!roll) throw new GameActionError('INVALID_GAME_ACTION', '还没有掷骰结果，无法结算落点')

  let players = clonePlayers(state)
  let history = state.history
  let pendingDrinkAcks = state.pendingDrinkAcks
  let pendingDecision: PendingDecision | null = null

  const player = players[uid]!
  const oldPos = player.position
  const newPos = computeNewPosition(oldPos, roll.effective)

  // 自然骰（非额外骰）移动时，判断是否经过/停在起点：规则书"经过/停在起点：+2 金币并抽1手牌"
  if (!state.turn.extraRollPending) {
    const passedStart = crossedStart(oldPos, roll.effective)
    if (passedStart) {
      player.coins += 2
      if (player.tacticHand.length < TACTIC_HAND_LIMIT) {
        player.tacticHand.push(drawTacticPlaceholder())
      }
      history = appendHistory(history, `经过/停在起点，获得 2 金币和 1 张战术手牌。`, now)
    }
  }

  player.position = newPos
  const cell = getCell(newPos)

  if (isPropertyCell(cell)) {
    const owner = Object.values(players).find((p) => p.properties.includes(cell.propertyName))
    if (!owner) {
      pendingDecision = { kind: 'BUY_PROPERTY', cellId: cell.id, propertyName: cell.propertyName, price: PROPERTY_BUY_PRICE }
      history = appendHistory(history, `来到了「${cell.propertyName}」，这是一块无主地产，可以花 ${PROPERTY_BUY_PRICE} 金币买下。`, now)
    } else if (owner.uid === uid) {
      history = appendHistory(history, `来到了自己的地产「${cell.propertyName}」，不需要支付租金。`, now)
    } else {
      const rent = computeRent(owner.properties, cell.propertyName)
      const paid = Math.min(rent, player.coins)
      player.coins -= paid
      owner.coins += paid
      history = appendHistory(
        history,
        `来到了「${cell.propertyName}」，向地产主人支付租金 ${paid} 金币${paid < rent ? '（金币不够，按实际持有支付）' : ''}。`,
        now,
      )
    }
  } else if (cell.kind === 'event') {
    const result = applyBoardEvent(cell.effectKind, cell.effectN, { state, players, uid, now })
    history = [...history, ...result.historyEntries]
    pendingDrinkAcks = result.pendingDrinkAcks ?? pendingDrinkAcks
    pendingDecision = result.pendingDecision ?? pendingDecision
  } else if (cell.kind === 'start') {
    // 停在起点格本身：规则书"经过/停在起点"已经按上面 crossedStart 处理过经过的情况；
    // 如果 effective 步数恰好让玩家停在自己或别人的起点格上，这里不重复发放（crossedStart 包含终点格判断）。
  }

  const nextState: GameState = {
    ...state,
    players,
    pendingDrinkAcks,
    turn: { ...state.turn, pendingDecision, landingResolved: true },
    history,
  }

  return { state: nextState, needsDecision: pendingDecision !== null }
}

function crossedStart(oldPos: number, steps: number): boolean {
  if (steps <= 0) return false
  for (let s = 1; s <= steps; s += 1) {
    if (getCell(computeNewPosition(oldPos, s)).kind === 'start') return true
  }
  return false
}

function drawTacticPlaceholder(): string {
  return drawRandomTacticCardId()
}

interface BoardEventContext {
  state: GameState
  players: Record<string, GamePlayerState>
  uid: string
  now: number
}

interface BoardEventResult {
  historyEntries: ReturnType<typeof appendHistory>
  pendingDrinkAcks?: PendingDrinkAck[]
  pendingDecision?: PendingDecision | null
}

function applyBoardEvent(
  kind: string,
  n: number | string | null,
  ctx: BoardEventContext,
): BoardEventResult {
  const { state, players, uid, now } = ctx
  const player = players[uid]!

  switch (kind) {
    case 'coin': {
      const amount = typeof n === 'number' ? n : 0
      player.coins += amount
      return { historyEntries: appendHistory(state.history, `触发格子效果：获得 ${amount} 金币。`, now) }
    }
    case 'forward': {
      const steps = typeof n === 'number' ? n : 0
      player.position = computeNewPosition(player.position, steps)
      return { historyEntries: appendHistory(state.history, `触发格子效果：额外前进 ${steps} 格。`, now) }
    }
    case 'back': {
      const steps = typeof n === 'number' ? n : 0
      player.position = computeNewPosition(player.position, -steps)
      return { historyEntries: appendHistory(state.history, `触发格子效果：后退 ${steps} 格。`, now) }
    }
    case 'drinkSelf': {
      const amount = typeof n === 'number' ? n : 1
      return {
        historyEntries: appendHistory(state.history, `触发格子效果：需要喝 ${amount} 口。`, now),
        pendingDecision: { kind: 'DRINK_ACK', amount, reason: '踩中喝酒格子' },
      }
    }
    case 'drinkPrev': {
      const amount = typeof n === 'number' ? n : 1
      const prevUid = neighborUid(state, uid, -1)
      return {
        historyEntries: appendHistory(state.history, `触发格子效果：上家需要喝 ${amount} 口。`, now),
        pendingDrinkAcks: pushDrinkAck(state.pendingDrinkAcks, prevUid, amount, '下家踩中「上家喝酒」格子', now),
      }
    }
    case 'drinkNext': {
      const amount = typeof n === 'number' ? n : 1
      const nextUid = neighborUid(state, uid, 1)
      return {
        historyEntries: appendHistory(state.history, `触发格子效果：下家需要喝 ${amount} 口。`, now),
        pendingDrinkAcks: pushDrinkAck(state.pendingDrinkAcks, nextUid, amount, '上家踩中「下家喝酒」格子', now),
      }
    }
    case 'drinkTarget': {
      const amount = typeof n === 'number' ? n : 1
      return {
        historyEntries: appendHistory(state.history, `触发格子效果：可以指定一名玩家喝 ${amount} 口。`, now),
        pendingDecision: { kind: 'CHOOSE_DRINK_TARGET', amount, reason: '踩中「指定喝酒」格子' },
      }
    }
    case 'truthOrDare': {
      return {
        historyEntries: appendHistory(state.history, `触发格子效果：真心话大冒险，二选一。`, now),
        pendingDecision: { kind: 'TRUTH_OR_DARE' },
      }
    }
    case 'changeTarot': {
      return {
        historyEntries: appendHistory(state.history, `触发格子效果：更换世界塔罗（由房主在格子详情里抽取新塔罗）。`, now),
        pendingDecision: { kind: 'HOST_RULING', description: '更换世界塔罗：请房主抽取并公布新的世界塔罗规则' },
      }
    }
    case 'drawTacticCard': {
      if (player.tacticHand.length < TACTIC_HAND_LIMIT) {
        player.tacticHand.push(drawTacticPlaceholder())
        return { historyEntries: appendHistory(state.history, `触发格子效果：抽了 1 张战术手牌。`, now) }
      }
      return { historyEntries: appendHistory(state.history, `触发格子效果：想抽 1 张战术手牌，但手牌已满（上限 ${TACTIC_HAND_LIMIT} 张），未能抽牌。`, now) }
    }
    case 'pendingRuling': {
      const description = typeof n === 'string' ? n : '这个格子的规则尚未在规则书中写明具体结算方式'
      return {
        historyEntries: appendHistory(state.history, `触发格子效果：${description}`, now),
        pendingDecision: { kind: 'HOST_RULING', description },
      }
    }
    default:
      return { historyEntries: appendHistory(state.history, `触发了未知格子效果（${kind}），已跳过。`, now) }
  }
}

// ---------------------------------------------------------------------------
// 动作 3：处理待确认事项（买地产 / 喝酒确认 / 指定喝酒目标 / 真心话大冒险 / 房主裁定）
// ---------------------------------------------------------------------------

export function applyBuyPropertyDecision(state: GameState, uid: string, buy: boolean, now: number): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'BUY_PROPERTY') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的购买地产决定')
  }
  const players = clonePlayers(state)
  const player = players[uid]!
  let history = state.history

  if (buy) {
    if (player.coins < decision.price) {
      throw new GameActionError('INVALID_GAME_ACTION', '金币不足，无法购买地产')
    }
    player.coins -= decision.price
    player.properties.push(decision.propertyName)
    history = appendHistory(history, `花费 ${decision.price} 金币买下了「${decision.propertyName}」。`, now)
  } else {
    history = appendHistory(history, `放弃购买「${decision.propertyName}」。`, now)
  }

  return { ...state, players, history, turn: { ...state.turn, pendingDecision: null } }
}

export function applyDrinkAckDecision(state: GameState, uid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'DRINK_ACK') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的喝酒确认')
  }
  const history = appendHistory(state.history, `确认已完成「${decision.reason}」（${decision.amount} 口）。`, now)
  return { ...state, history, turn: { ...state.turn, pendingDecision: null } }
}

export function applyChooseDrinkTargetDecision(
  state: GameState,
  uid: string,
  targetUid: string,
  now: number,
): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'CHOOSE_DRINK_TARGET') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的指定喝酒目标')
  }
  if (!state.players[targetUid]) {
    throw new GameActionError('INVALID_GAME_ACTION', '目标玩家不存在')
  }
  const pendingDrinkAcks = pushDrinkAck(state.pendingDrinkAcks, targetUid, decision.amount, decision.reason, now)
  const history = appendHistory(state.history, `指定了一名玩家喝 ${decision.amount} 口。`, now)
  return { ...state, pendingDrinkAcks, history, turn: { ...state.turn, pendingDecision: null } }
}

export function applyTruthOrDareDecision(state: GameState, uid: string, choice: 'TRUTH' | 'DARE', now: number): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'TRUTH_OR_DARE') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的真心话大冒险')
  }
  const history = appendHistory(state.history, `选择了「${choice === 'TRUTH' ? '真心话' : '大冒险'}」。`, now)
  return { ...state, history, turn: { ...state.turn, pendingDecision: null } }
}

export function applyHostRulingAck(state: GameState, callerUid: string, hostUid: string, now: number): GameState {
  if (callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以确认现场裁定结果')
  }
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'HOST_RULING') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待房主裁定的事项')
  }
  const history = appendHistory(state.history, `房主已对「${decision.description}」现场裁定完毕。`, now)
  return { ...state, history, turn: { ...state.turn, pendingDecision: null } }
}

// ---------------------------------------------------------------------------
// 动作 4：从 LANDING 推进到下一阶段（翻主牌 / 额外掷骰）
// ---------------------------------------------------------------------------

export function applyAdvanceAfterLanding(state: GameState, uid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'LANDING') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是落点结算阶段')
  }
  if (state.turn.pendingDecision) {
    throw new GameActionError('INVALID_GAME_ACTION', '还有未处理的事项，不能继续')
  }
  const roll = state.turn.lastRoll
  if (!roll) throw new GameActionError('INVALID_GAME_ACTION', '没有掷骰记录')

  // 自然 6 且还没用过额外掷骰：回到 ROLLING，标记额外掷骰待处理，不翻主牌。
  if (roll.isNaturalSix && !state.turn.extraRollPending && !state.turn.extraRollUsed) {
    return {
      ...state,
      turn: {
        ...state.turn,
        phase: 'ROLLING',
        extraRollPending: true,
        lastRoll: null,
        landingResolved: false,
      },
      history: appendHistory(state.history, `今晚手气爆棚！掷出自然 6，可以额外掷一次骰子（只结算落点，不再翻主牌）。`, now),
    }
  }

  // 额外掷骰的落点结算完：标记额外掷骰已使用，正常进入翻主牌阶段。
  if (state.turn.extraRollPending) {
    return {
      ...state,
      turn: { ...state.turn, phase: 'LADY_CARD', extraRollPending: false, extraRollUsed: true },
    }
  }

  return { ...state, turn: { ...state.turn, phase: 'LADY_CARD' } }
}

// ---------------------------------------------------------------------------
// 动作 5：翻小姐主牌（LADY_CARD -> TACTIC）
// ---------------------------------------------------------------------------

export interface RevealLadyCardOutcome {
  state: GameState
  heartAttackTriggered: boolean
}

export function applyRevealLadyCard(state: GameState, uid: string, cardId: string, now: number): RevealLadyCardOutcome {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'LADY_CARD') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是翻主牌阶段')
  }
  if (state.turn.revealedLadyCardId) {
    throw new GameActionError('INVALID_GAME_ACTION', '本回合已经翻过主牌了')
  }

  const card = getLadyCard(cardId)
  const recentLadyCards = [...state.recentLadyCards, cardId]
  const heartCheck = checkHeartAttack(recentLadyCards)

  let history = appendHistory(state.history, `翻到主牌「${card.name}」。${card.ruleStatus === 'pending' ? '具体牌义待房主现场裁定。' : card.description}`, now)
  let pendingHeartAttack = state.pendingHeartAttack
  let pendingDecision = state.turn.pendingDecision

  if (heartCheck.triggered) {
    pendingHeartAttack = {
      id: `heart-${now}`,
      suitLabel: '最近 5 张',
      count: heartCheck.count,
      revealedByUid: uid,
      createdAt: now,
    }
    history = appendHistory(history, `德国心脏病触发！最近 5 张主牌数量和为 ${heartCheck.count}，请房主现场确认第一反应者。`, now)
  }

  if (card.ruleStatus === 'pending') {
    pendingDecision = { kind: 'HOST_RULING', description: `小姐主牌「${card.name}」的具体牌义规则书未写明，请房主现场裁定` }
  }

  return {
    state: {
      ...state,
      recentLadyCards,
      pendingHeartAttack,
      turn: { ...state.turn, revealedLadyCardId: cardId, phase: 'TACTIC', pendingDecision },
      history,
    },
    heartAttackTriggered: heartCheck.triggered,
  }
}

// ---------------------------------------------------------------------------
// 非阻塞喝酒确认队列：目标玩家自己或房主代为处理，不要求是当前回合玩家，
// 不卡住正在进行的回合（见 shared/game/types.ts 的 PendingDrinkAck 注释）。
// ---------------------------------------------------------------------------

export function applyResolveDrinkAck(
  state: GameState,
  callerUid: string,
  hostUid: string,
  ackId: string,
  choice: DrinkAckChoice,
  now: number,
): GameState {
  const ack = state.pendingDrinkAcks.find((a) => a.id === ackId)
  if (!ack) {
    throw new GameActionError('INVALID_GAME_ACTION', '这条待确认的喝酒记录不存在或已经处理过了')
  }
  if (callerUid !== ack.targetUid && callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有本人或房主可以确认这条喝酒记录')
  }
  const pendingDrinkAcks = state.pendingDrinkAcks.filter((a) => a.id !== ackId)
  const history = appendHistory(state.history, `${ack.reason}：${DRINK_CHOICE_LABEL[choice]}。`, now)
  return { ...state, pendingDrinkAcks, history }
}

export function applyDismissHeartAttack(state: GameState, callerUid: string, hostUid: string, now: number): GameState {
  if (callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以确认德国心脏病的处理结果')
  }
  if (!state.pendingHeartAttack) {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的德国心脏病事件')
  }
  const history = appendHistory(state.history, `房主已确认德国心脏病事件处理完毕。`, now)
  return { ...state, pendingHeartAttack: null, history }
}

// ---------------------------------------------------------------------------
// 动作 6：打出/跳过战术牌（TACTIC -> 下一位玩家）
// ---------------------------------------------------------------------------

export function applyPlayTacticCard(
  state: GameState,
  uid: string,
  cardInstanceId: string,
  targetUid: string | null,
  now: number,
): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'TACTIC') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是战术出牌阶段')
  }
  const players = clonePlayers(state)
  const player = players[uid]!
  const handIdx = player.tacticHand.indexOf(cardInstanceId)
  if (handIdx === -1) {
    throw new GameActionError('INVALID_GAME_ACTION', '手牌中没有这张牌')
  }
  const def = getTacticCard(cardInstanceId)
  if (def.ruleStatus === 'pending') {
    throw new GameActionError('INVALID_GAME_ACTION', `「${def.name}」的具体效果规则书未写明，暂不支持主动打出`)
  }
  if (def.requiresTarget && !targetUid) {
    throw new GameActionError('INVALID_GAME_ACTION', `「${def.name}」需要指定目标玩家`)
  }

  player.tacticHand.splice(handIdx, 1)
  let history = appendHistory(state.history, `打出了「${def.name}」。`, now)
  let pendingDrinkAcks = state.pendingDrinkAcks

  switch (def.id) {
    case 'tactic-sha': {
      if (!targetUid || !players[targetUid]) throw new GameActionError('INVALID_GAME_ACTION', '目标玩家不存在')
      pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, targetUid, 1, '被「杀」指定', now)
      break
    }
    case 'tactic-tao': {
      if (!targetUid || !players[targetUid]) throw new GameActionError('INVALID_GAME_ACTION', '目标玩家不存在')
      players[targetUid]!.coins += 1
      history = appendHistory(history, `「桃」救了目标玩家，对方获得 1 金币。`, now)
      break
    }
    case 'tactic-shunshou': {
      if (!targetUid || !players[targetUid]) throw new GameActionError('INVALID_GAME_ACTION', '目标玩家不存在')
      const target = players[targetUid]!
      const taken = Math.min(1, target.coins)
      target.coins -= taken
      player.coins += taken
      history = appendHistory(history, `「顺手牵羊」拿走了目标玩家 ${taken} 金币。`, now)
      break
    }
    default:
      break
  }

  return { ...state, players, pendingDrinkAcks, history, turn: { ...state.turn, pendingDecision: null } }
}

export function applySkipTactic(state: GameState, uid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'TACTIC') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是战术出牌阶段')
  }
  return { ...state, history: appendHistory(state.history, `跳过了战术出牌。`, now) }
}

// ---------------------------------------------------------------------------
// 动作 7：结束回合（TACTIC -> 下一位玩家的 ROLLING）
// ---------------------------------------------------------------------------

export function applyEndTurn(state: GameState, uid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'TACTIC') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是可以结束回合的阶段')
  }
  const nextIndex = (state.currentPlayerIndex + 1) % state.turnOrder.length
  const nextUid = state.turnOrder[nextIndex]
  if (!nextUid) throw new Error('找不到下一位玩家，不应该发生')

  return {
    ...state,
    currentPlayerIndex: nextIndex,
    turnNumber: state.turnNumber + 1,
    turn: {
      phase: 'ROLLING',
      currentPlayerUid: nextUid,
      lastRoll: null,
      extraRollPending: false,
      extraRollUsed: false,
      pendingDecision: null,
      revealedLadyCardId: null,
      landingResolved: false,
    },
    history: appendHistory(state.history, `回合结束，轮到下一位玩家。`, now),
  }
}

export { BOARD_SIZE, findPropertyCellByName }
