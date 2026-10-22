/**
 * V1.6 补充：三国杀战术牌的统一响应窗口。
 *
 * 1. 当前玩家打出主动牌（杀 / 顺手牵羊 / 过河拆桥）→ 生成响应栈，原始牌在栈底。
 * 2. 针对当前栈顶，有资格响应的玩家依次表态：出牌（闪 / 无懈可击）或放弃。
 *    - 闪：只有杀的目标、只能直接响应栈底的杀（栈只有杀一张时）。
 *    - 无懈可击：任何持有的玩家，对栈顶的任意一张牌（包括另一张无懈可击）。
 * 3. 有人出牌 → 新牌成为栈顶，所有人重新获得表态机会（出牌者本人除外）。
 * 4. 所有有资格的人都放弃 → 从栈顶往下结算：每张生效的牌否定它下面那张。
 * 5. 栈底的原始牌生效才结算效果；然后回到战术阶段。
 *
 * 不用 5 秒轮询判断"谁先响应"：表态是逐人记录的，顺序以写入数据库的先后为准。
 * 玩家离线时，房主可以明确记录"代为放弃"，但不能替任何人出牌。
 */
import { getTacticCard, TACTIC_HAND_LIMIT, drawRandomTacticCardId } from '../cards/tacticCards'
import type { GamePlayerState, GameState, TacticOriginKind, TacticStack, TacticStackEntry } from '../types'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { clonePlayers, neighborUid, pushDrinkAck, requirePlayer } from './stateHelpers'
import { magicianRefill } from './tarotEffects'

const RESPONSE_CARDS = ['tactic-shan', 'tactic-wuxie'] as const

function holdsResponse(state: GameState, uid: string, stack: Pick<TacticStack, 'entries' | 'originKind' | 'targetUid'>): boolean {
  const hand = state.players[uid]?.tacticHand ?? []
  if (hand.includes('tactic-wuxie')) return true
  return canPlayShan(stack, uid) && hand.includes('tactic-shan')
}

function canPlayShan(stack: Pick<TacticStack, 'entries' | 'originKind' | 'targetUid'>, uid: string): boolean {
  return stack.originKind === 'tactic-sha' && stack.entries.length === 1 && uid === stack.targetUid
}

/**
 * 针对当前栈顶，还需要表态的玩家：手里有可用响应牌、不是栈顶出牌者、还没放弃。
 * 没有可用响应牌的人不用等，避免每张杀都要全桌点一次"放弃"。
 */
function computeAwaiting(state: GameState, stack: Pick<TacticStack, 'entries' | 'originKind' | 'targetUid' | 'passed'>): string[] {
  const top = stack.entries[stack.entries.length - 1]!
  return state.turnOrder.filter((u) => u !== top.playerUid && !stack.passed.includes(u) && holdsResponse(state, u, stack))
}

function originLabel(kind: TacticOriginKind): string {
  return getTacticCard(kind).name
}

function takeCard(players: Record<string, GamePlayerState>, uid: string, cardId: string): void {
  const hand = players[uid]!.tacticHand
  const idx = hand.indexOf(cardId)
  if (idx === -1) throw new GameActionError('INVALID_GAME_ACTION', `手牌中没有「${getTacticCard(cardId).name}」`)
  hand.splice(idx, 1)
}

/** 魔术师：每名玩家每回合第一次打出战术牌后补抽 1 张。返回需要追加的说明 */
function magicianAfterPlay(state: GameState, players: Record<string, GamePlayerState>, uid: string, rng: () => number): string | null {
  const already = state.turn.playersWhoPlayedTacticThisTurn.includes(uid)
  if (!magicianRefill(state.currentTarotId, already)) return null
  const p = players[uid]!
  if (p.tacticHand.length >= TACTIC_HAND_LIMIT) return '魔术师：手牌已满，未补抽'
  p.tacticHand.push(drawRandomTacticCardId(rng))
  return '魔术师：出牌后补抽 1 张'
}

function markPlayed(state: GameState, uid: string, note: string | null): GameState['turn'] {
  return {
    ...state.turn,
    playersWhoPlayedTacticThisTurn: [...new Set([...state.turn.playersWhoPlayedTacticThisTurn, uid])],
    tarotNotes: note ? [...state.turn.tarotNotes, note] : state.turn.tarotNotes,
  }
}

/**
 * 当前玩家打出主动牌（V1.6 房间）。打出后不立即结算，进入响应窗口；没有人能响应时直接结算。
 * randomPick：过河拆桥的随机弃牌结果，由数据库层在重试循环外生成一次，保证重试不会换牌。
 */
export function applyPlayActiveTactic(
  state: GameState,
  uid: string,
  cardId: string,
  targetUid: string,
  now: number,
  rng: () => number,
  randomPick: number,
): GameState {
  if (state.turn.currentPlayerUid !== uid) throw new GameActionError('NOT_YOUR_TURN', '还没轮到你操作')
  if (state.turn.phase !== 'TACTIC') throw new GameActionError('INVALID_GAME_ACTION', '现在不是战术出牌阶段')
  if (state.turn.activeTacticUsed) throw new GameActionError('INVALID_GAME_ACTION', '本回合已经主动出过 1 张战术牌了')
  if (state.tacticStack) throw new GameActionError('INVALID_GAME_ACTION', '还有一张战术牌在等待响应')
  if (cardId !== 'tactic-sha' && cardId !== 'tactic-shunshou' && cardId !== 'tactic-guohe') {
    const def = getTacticCard(cardId)
    throw new GameActionError('INVALID_GAME_ACTION', def.playMode === 'response' ? `「${def.name}」是响应牌，不能主动打出` : `「${def.name}」不能主动打出`)
  }
  requirePlayer(state, targetUid)
  if (targetUid === uid) throw new GameActionError('INVALID_GAME_ACTION', '需要指定另一名玩家')
  if (cardId === 'tactic-shunshou' && ![neighborUid(state, uid, -1), neighborUid(state, uid, 1)].includes(targetUid)) {
    throw new GameActionError('INVALID_GAME_ACTION', '顺手牵羊只能拿左边或右边相邻玩家的金币')
  }

  const players = clonePlayers(state)
  takeCard(players, uid, cardId)
  const note = magicianAfterPlay(state, players, uid, rng)
  const base: GameState = {
    ...state,
    players,
    turn: { ...markPlayed(state, uid, note), activeTacticUsed: true },
    history: appendHistory(state.history, `打出「${getTacticCard(cardId).name}」，目标已选定，等待其他人是否响应。`, now, uid),
  }
  const stack: TacticStack = {
    stackId: `stack-${now}-${state.turnNumber}`,
    originKind: cardId,
    sourceUid: uid,
    targetUid,
    entries: [{ entryId: `e-${now}-0`, cardId, playerUid: uid }],
    awaiting: [],
    passed: [],
    createdAt: now,
  }
  stack.awaiting = computeAwaiting(base, stack)
  const withStack: GameState = { ...base, tacticStack: stack }
  return stack.awaiting.length === 0 ? resolveStack(withStack, now, randomPick) : withStack
}

/** 针对栈顶出一张响应牌（闪 / 无懈可击） */
export function applyRespondTactic(state: GameState, uid: string, stackId: string, cardId: string, now: number, rng: () => number): GameState {
  const stack = state.tacticStack
  if (!stack || stack.stackId !== stackId) throw new GameActionError('INVALID_GAME_ACTION', '这次出牌已经结算完了')
  if (!(RESPONSE_CARDS as readonly string[]).includes(cardId)) throw new GameActionError('INVALID_GAME_ACTION', '这张牌不能用来响应')
  if (!stack.awaiting.includes(uid)) throw new GameActionError('INVALID_GAME_ACTION', '现在不需要你响应')
  if (cardId === 'tactic-shan' && !canPlayShan(stack, uid)) throw new GameActionError('INVALID_GAME_ACTION', '闪只能直接响应针对你的杀')

  const players = clonePlayers(state)
  takeCard(players, uid, cardId)
  const note = magicianAfterPlay(state, players, uid, rng)
  const entry: TacticStackEntry = { entryId: `e-${now}-${stack.entries.length}`, cardId, playerUid: uid }
  const next: TacticStack = { ...stack, entries: [...stack.entries, entry], passed: [], awaiting: [] }
  const s: GameState = {
    ...state,
    players,
    turn: markPlayed(state, uid, note),
    history: appendHistory(state.history, `打出「${getTacticCard(cardId).name}」响应。`, now, uid),
  }
  next.awaiting = computeAwaiting(s, next)
  const withStack: GameState = { ...s, tacticStack: next }
  return next.awaiting.length === 0 ? resolveStack(withStack, now, 0) : withStack
}

/** 放弃响应；房主可以代替离线玩家明确记录"放弃"（不能替人出牌） */
export function applyPassTactic(
  state: GameState,
  callerUid: string,
  hostUid: string,
  stackId: string,
  forUid: string,
  now: number,
  randomPick: number,
): GameState {
  const stack = state.tacticStack
  if (!stack || stack.stackId !== stackId) throw new GameActionError('INVALID_GAME_ACTION', '这次出牌已经结算完了')
  if (callerUid !== forUid && callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只能替自己选择放弃')
  if (!stack.awaiting.includes(forUid)) throw new GameActionError('INVALID_GAME_ACTION', '这名玩家现在不需要表态')
  const next: TacticStack = { ...stack, passed: [...stack.passed, forUid], awaiting: stack.awaiting.filter((u) => u !== forUid) }
  const s: GameState = {
    ...state,
    tacticStack: next,
    history: appendHistory(state.history, callerUid === forUid ? '选择不响应。' : '房主记录：该玩家离线，代为放弃响应。', now, forUid),
  }
  return next.awaiting.length === 0 ? resolveStack(s, now, randomPick) : s
}

/**
 * 从栈顶往下结算（后进先出）：栈顶一定生效；一张牌生效就否定它正下方那张，被否定的牌不否定任何牌。
 * 结果是：栈里只有原始牌 → 生效；1 张响应 → 被抵消；2 张（无懈对无懈）→ 生效……按层数奇偶交替。
 */
export function originEffective(entries: TacticStackEntry[]): boolean {
  let aboveEffective = false
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const effective: boolean = !aboveEffective
    if (i === 0) return effective
    aboveEffective = effective
  }
  return true
}

function resolveStack(state: GameState, now: number, randomPick: number): GameState {
  const stack = state.tacticStack!
  const effective = originEffective(stack.entries)
  const players = clonePlayers(state)
  let acks = state.pendingDrinkAcks
  let summary: string
  const label = originLabel(stack.originKind)

  if (!effective) {
    const blocker = stack.entries[1]!.cardId === 'tactic-shan' && stack.entries.length === 2 ? '闪' : '无懈可击'
    summary = `「${label}」被${blocker}抵消，没有效果`
  } else if (stack.originKind === 'tactic-sha') {
    acks = pushDrinkAck(acks, stack.targetUid, 1, '被「杀」指定', now)
    summary = '「杀」生效，目标喝 1 口'
  } else if (stack.originKind === 'tactic-shunshou') {
    const target = players[stack.targetUid]!
    const taken = Math.min(1, target.coins)
    target.coins -= taken
    players[stack.sourceUid]!.coins += taken
    summary = taken > 0 ? '「顺手牵羊」生效，拿走 1 金币' : '「顺手牵羊」生效，但对方没有金币'
  } else {
    const hand = players[stack.targetUid]!.tacticHand
    if (hand.length === 0) summary = '「过河拆桥」生效，但对方没有手牌'
    else {
      const idx = Math.min(hand.length - 1, Math.floor(randomPick * hand.length))
      const [discarded] = hand.splice(idx, 1)
      summary = `「过河拆桥」生效，随机弃掉对方 1 张手牌（${getTacticCard(discarded!).name}）`
    }
  }
  return {
    ...state,
    players,
    pendingDrinkAcks: acks,
    tacticStack: null,
    lastTacticResult: {
      stackId: stack.stackId,
      originKind: stack.originKind,
      sourceUid: stack.sourceUid,
      targetUid: stack.targetUid,
      entries: stack.entries,
      effective,
      summary,
      at: now,
    },
    history: appendHistory(state.history, `${summary}。`, now, stack.sourceUid),
  }
}

// ---------------------------------------------------------------------------
// 地产抵押 / 赎回（原稿：抵押得 3 金，赎回 4 金；V1.6 补充约定见文档）
// ---------------------------------------------------------------------------

export const MORTGAGE_VALUE = 3
export const REDEEM_COST = 4

export function applyMortgage(state: GameState, uid: string, propertyName: string, mortgage: boolean, now: number): GameState {
  if (state.rulesVersion !== 2) throw new GameActionError('INVALID_GAME_ACTION', '旧房间按 V1.5 规则，暂不支持抵押')
  if (state.endgame) throw new GameActionError('INVALID_GAME_ACTION', '游戏已经进入终局')
  const players = clonePlayers(state)
  const p = players[uid]
  if (!p) throw new GameActionError('INVALID_GAME_ACTION', '找不到你的游戏状态')
  if (!p.properties.includes(propertyName)) throw new GameActionError('INVALID_GAME_ACTION', '只有地产主人可以抵押或赎回')
  const isMortgaged = p.mortgaged.includes(propertyName)
  if (mortgage) {
    if (isMortgaged) throw new GameActionError('INVALID_GAME_ACTION', '这块地产已经抵押了')
    p.mortgaged.push(propertyName)
    p.coins += MORTGAGE_VALUE
  } else {
    if (!isMortgaged) throw new GameActionError('INVALID_GAME_ACTION', '这块地产没有抵押')
    if (p.coins < REDEEM_COST) throw new GameActionError('INVALID_GAME_ACTION', `金币不足，赎回需要 ${REDEEM_COST} 金币`)
    p.coins -= REDEEM_COST
    p.mortgaged = p.mortgaged.filter((n) => n !== propertyName)
  }
  return {
    ...state,
    players,
    history: appendHistory(
      state.history,
      mortgage ? `把「${propertyName}」抵押给银行，得到 ${MORTGAGE_VALUE} 金币（抵押期间不收租）。` : `支付 ${REDEEM_COST} 金币赎回「${propertyName}」，恢复收租。`,
      now,
      uid,
    ),
  }
}
