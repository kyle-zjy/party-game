/**
 * 世界塔罗的更换与即时效果。
 *
 * 规则书："塔罗始终只有 1 张世界规则有效"。更换时：
 * 1. 写入新的 currentTarotId——各结算点下一次读取时自动使用新塔罗，
 *    旧塔罗的持续效果立即失效。
 * 2. tarotState 整体重置（恋人绑定随旧塔罗一起失效）。
 * 3. 即时效果在这一次纯函数调用里结算完，结果写进 lastTarotChange.summary。
 *    整个结果通过一次乐观锁写入落库：重复点击/刷新/轮询重试只会因为阶段或
 *    pendingDecision 已经变化而被拒绝，不会把即时效果结算两次。
 */
import { getTarotCard } from '../cards/tarotCards'
import { drawRandomTacticCardId, getTacticCard, TACTIC_HAND_LIMIT } from '../cards/tacticCards'
import type { GamePlayerState, GameState, PendingDecision, TarotEffectLine } from '../types'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { clonePlayers, pushDrinkAck, requirePlayer } from './stateHelpers'
import { payFromBank, TAROT_ID } from './tarotEffects'

export interface TarotRevealResult {
  state: GameState
  /** 恋人/正义需要后续选择，由调用方放进当前回合的 pendingDecision */
  followUp: PendingDecision | null
}

/**
 * 翻开一张新的世界塔罗并结算即时效果。
 * rng 只用于命运之轮的判定骰，测试时可注入固定值。
 */
export function revealTarot(
  state: GameState,
  newTarotId: string,
  triggeredByUid: string | null,
  now: number,
  rng: () => number = Math.random,
): TarotRevealResult {
  const card = getTarotCard(newTarotId)
  const previousTarotId = state.currentTarotId
  const players = clonePlayers(state)
  let pendingDrinkAcks = state.pendingDrinkAcks
  const pendingTarotDiscards: string[] = []
  const summary: TarotEffectLine[] = []
  let followUp: PendingDecision | null = null

  // 新塔罗立刻生效（即时效果里如果有"从银行得金币"，需要按新塔罗结算——恋人
  // 绑定此时还是空的，所以不会产生连带奖励）。
  const base: GameState = { ...state, currentTarotId: newTarotId, tarotState: { loversPair: null } }

  switch (newTarotId) {
    case TAROT_ID.WHEEL: {
      const judge = Math.floor(rng() * 6) + 1
      const direction = judge <= 2 ? 'clockwise' : judge <= 4 ? 'opposite' : 'counter'
      const lines = rotateHands(base, players, direction)
      summary.push({ uid: null, text: `判定骰掷出 ${judge}：${DIRECTION_LABEL[direction]}` }, ...lines)
      break
    }
    case TAROT_ID.DEATH: {
      for (const uid of state.turnOrder) {
        const p = players[uid]!
        if (p.tacticHand.length === 0) {
          pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, uid, 1, '死神：没有手牌可弃，罚 1 口', now)
          summary.push({ uid, text: '没有手牌，罚 1 口' })
        } else if (p.tacticHand.length === 1) {
          const discarded = p.tacticHand.splice(0, 1)[0]!
          summary.push({ uid, text: `只有 1 张手牌，自动弃掉「${getTacticCard(discarded).name}」` })
        } else {
          pendingTarotDiscards.push(uid)
          summary.push({ uid, text: '需要从手牌中选 1 张弃掉' })
        }
      }
      break
    }
    case TAROT_ID.JUDGEMENT: {
      for (const uid of state.turnOrder) {
        const p = players[uid]!
        if (p.tacticHand.length <= 1 && p.tacticHand.length < TACTIC_HAND_LIMIT) {
          p.tacticHand.push(drawRandomTacticCardId(rng))
          summary.push({ uid, text: '战术牌 ≤1 张，抽 1 张战术牌' })
        }
        if (p.coins <= 1) {
          payFromBank(base, players, uid, 1)
          summary.push({ uid, text: '金币 ≤1 枚，从银行得 1 金币' })
        }
      }
      if (summary.length === 0) summary.push({ uid: null, text: '没有玩家满足条件，本次无人获益' })
      break
    }
    case TAROT_ID.LOVERS: {
      followUp = { kind: 'CHOOSE_LOVERS' }
      summary.push({ uid: triggeredByUid, text: '翻牌者需要指定两名玩家"绑定"' })
      break
    }
    case TAROT_ID.JUSTICE: {
      followUp = { kind: 'TAROT_JUSTICE' }
      summary.push({ uid: null, text: '全桌线下依次剪刀石头布，由房主录入大众赢家和大众输家' })
      break
    }
    default:
      break
  }

  const changeEvent = {
    id: `tarot-change-${now}-${Math.random().toString(36).slice(2, 8)}`,
    tarotId: newTarotId,
    previousTarotId,
    triggeredByUid,
    at: now,
    summary,
  }

  const history = appendHistory(
    state.history,
    `世界塔罗更换为「${card.romanNumeral} ${card.name}」。${card.description}`,
    now,
    triggeredByUid ?? undefined,
  )

  return {
    state: {
      ...base,
      players,
      pendingDrinkAcks,
      pendingTarotDiscards,
      lastTarotChange: changeEvent,
      history,
    },
    followUp,
  }
}

type Direction = 'clockwise' | 'opposite' | 'counter'

const DIRECTION_LABEL: Record<Direction, string> = {
  clockwise: '1、2：顺时针换手牌（每人把手牌交给下家）',
  opposite: '3、4：和对家换手牌',
  counter: '5、6：逆时针换手牌（每人把手牌交给上家）',
}

function rotateHands(state: GameState, players: Record<string, GamePlayerState>, direction: Direction): TarotEffectLine[] {
  const order = state.turnOrder
  const n = order.length
  const before = new Map(order.map((uid) => [uid, [...players[uid]!.tacticHand]]))
  const lines: TarotEffectLine[] = []

  if (direction === 'opposite') {
    // 对家 = 座位上正对面的玩家。人数为奇数时没有严格对面（正对面落在两人之间），
    // 规则书没有写明，这里固定取顺时针方向 floor(n/2) 位的玩家；
    // 两两交换时一人只换一次，落单的玩家手牌不变。已列入待确认清单。
    const half = Math.floor(n / 2)
    const swapped = new Set<string>()
    for (let i = 0; i < n; i += 1) {
      const a = order[i]!
      const b = order[(i + half) % n]!
      if (swapped.has(a) || swapped.has(b) || a === b) continue
      players[a]!.tacticHand = before.get(b)!
      players[b]!.tacticHand = before.get(a)!
      swapped.add(a)
      swapped.add(b)
      lines.push({ uid: a, text: '和对家交换了手牌' }, { uid: b, text: '和对家交换了手牌' })
    }
    for (const uid of order) {
      if (!swapped.has(uid)) lines.push({ uid, text: '人数为奇数，没有对家，手牌不变' })
    }
    return lines
  }

  for (let i = 0; i < n; i += 1) {
    const receiver = order[i]!
    // 顺时针：每人收到上家的手牌；逆时针：每人收到下家的手牌
    const giverIdx = direction === 'clockwise' ? (i - 1 + n) % n : (i + 1) % n
    players[receiver]!.tacticHand = before.get(order[giverIdx]!)!
    lines.push({ uid: receiver, text: `收到${direction === 'clockwise' ? '上家' : '下家'}的手牌` })
  }
  return lines
}

// ---------------------------------------------------------------------------
// 恋人：翻牌者指定两名玩家绑定
// ---------------------------------------------------------------------------

export function applyChooseLovers(state: GameState, callerUid: string, uidA: string, uidB: string, now: number): GameState {
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'CHOOSE_LOVERS') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有需要指定恋人的塔罗事件')
  }
  if (state.turn.currentPlayerUid !== callerUid) {
    throw new GameActionError('NOT_YOUR_TURN', '只有翻开恋人塔罗的玩家可以指定绑定对象')
  }
  if (state.currentTarotId !== TAROT_ID.LOVERS) {
    throw new GameActionError('INVALID_GAME_ACTION', '当前世界塔罗已经不是恋人')
  }
  if (uidA === uidB) throw new GameActionError('INVALID_GAME_ACTION', '需要指定两名不同的玩家')
  requirePlayer(state, uidA)
  requirePlayer(state, uidB)

  return {
    ...state,
    tarotState: { ...state.tarotState, loversPair: [uidA, uidB] },
    turn: { ...state.turn, pendingDecision: null },
    history: appendHistory(state.history, '恋人塔罗：指定了两名玩家绑定，此后其中一人从银行得金币时，另一人也得 1 金币。', now, callerUid),
  }
}

// ---------------------------------------------------------------------------
// 正义：大众赢家和大众输家交换座位
// ---------------------------------------------------------------------------

/**
 * 正义（Q4 补充方案）：房主确认现场剪刀石头布的大众赢家和大众输家后，一次性交换：
 * 棋盘位置、行动顺序位置、当前金币、三国杀手牌。
 * 不交换：uid/昵称/登录身份、地产所有权、德州底牌、身份牌（阿瓦隆阵营）、棋子颜色。
 * 交换前的快照写进 lastJusticeSwap，界面展示"交换前 → 交换后"。
 *
 * 没有唯一赢家/输家时由房主重新组织判定，程序不会随机指定；房主也可以选择
 * "本次不交换"（winnerUid/loserUid 为 null），这也是一次明确的人工裁定。
 */
export function applyJusticeSwap(
  state: GameState,
  callerUid: string,
  hostUid: string,
  winnerUid: string | null,
  loserUid: string | null,
  now: number,
): GameState {
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'TAROT_JUSTICE') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的正义塔罗事件')
  }
  if (callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以录入剪刀石头布的结果')
  }

  const cleared = { ...state, turn: { ...state.turn, pendingDecision: null } }

  if (!winnerUid || !loserUid) {
    return { ...cleared, history: appendHistory(state.history, '正义塔罗：房主裁定本次没有人交换座位。', now, callerUid) }
  }
  if (winnerUid === loserUid) throw new GameActionError('INVALID_GAME_ACTION', '赢家和输家必须是两名不同的玩家')

  const players = clonePlayers(state)
  const w = requirePlayer({ ...state, players }, winnerUid)
  const l = requirePlayer({ ...state, players }, loserUid)

  const wSeat = { position: w.position, coins: w.coins, tacticHand: w.tacticHand }
  players[winnerUid] = { ...w, position: l.position, coins: l.coins, tacticHand: l.tacticHand }
  players[loserUid] = { ...l, position: wSeat.position, coins: wSeat.coins, tacticHand: wSeat.tacticHand }

  const turnOrder = state.turnOrder.map((uid) => (uid === winnerUid ? loserUid : uid === loserUid ? winnerUid : uid))
  // 当前行动的仍然是同一个人，只是 TA 在顺序里的下标可能变了
  const currentPlayerIndex = turnOrder.indexOf(state.turn.currentPlayerUid)

  const snapshot = (p: GamePlayerState) => ({
    position: p.position,
    seatIndex: state.turnOrder.indexOf(p.uid),
    coins: p.coins,
    tacticHand: [...p.tacticHand],
  })

  return {
    ...cleared,
    players,
    turnOrder,
    currentPlayerIndex,
    lastJusticeSwap: {
      id: `justice-${now}-${Math.random().toString(36).slice(2, 8)}`,
      winnerUid,
      loserUid,
      before: { [winnerUid]: snapshot(w), [loserUid]: snapshot(l) },
      at: now,
    },
    history: appendHistory(
      state.history,
      '正义塔罗：大众赢家和大众输家交换了棋盘位置、行动顺序、金币和手牌；地产、德州底牌和身份牌保留。',
      now,
      callerUid,
    ),
  }
}

// ---------------------------------------------------------------------------
// 死神：需要弃牌的玩家选择弃哪一张（非阻塞）
// ---------------------------------------------------------------------------

export function applyTarotDiscard(
  state: GameState,
  callerUid: string,
  hostUid: string,
  targetUid: string,
  cardId: string,
  now: number,
): GameState {
  if (!state.pendingTarotDiscards.includes(targetUid)) {
    throw new GameActionError('INVALID_GAME_ACTION', '这名玩家没有待弃的手牌')
  }
  if (callerUid !== targetUid && callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有本人或房主可以选择弃哪张牌')
  }
  const players = clonePlayers(state)
  const p = players[targetUid]!
  const idx = p.tacticHand.indexOf(cardId)
  if (idx === -1) throw new GameActionError('INVALID_GAME_ACTION', '手牌中没有这张牌')
  p.tacticHand.splice(idx, 1)

  return {
    ...state,
    players,
    pendingTarotDiscards: state.pendingTarotDiscards.filter((u) => u !== targetUid),
    history: appendHistory(state.history, `死神：弃掉了「${getTacticCard(cardId).name}」。`, now, targetUid),
  }
}

// ---------------------------------------------------------------------------
// 全局禁令（规则书"8. 禁令"）：全桌唯一禁令是不能说"为什么"。
// 正确指出别人应当罚酒者 +1 金币（教皇塔罗为 +2）；错误的罚 1 金币。
// 是否违规由线下判断，房主录入结果。被抓到的人"应当罚酒"——规则书没写罚几口，
// 按游戏通用惩罚单位记为 1 口，已列入待确认清单。
// ---------------------------------------------------------------------------

export function applyBanCatch(
  state: GameState,
  callerUid: string,
  hostUid: string,
  catcherUid: string,
  violatorUid: string,
  correct: boolean,
  now: number,
): GameState {
  if (callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以录入禁令的判定结果')
  }
  if (catcherUid === violatorUid) throw new GameActionError('INVALID_GAME_ACTION', '不能抓自己')
  requirePlayer(state, catcherUid)
  requirePlayer(state, violatorUid)

  const players = clonePlayers(state)
  let pendingDrinkAcks = state.pendingDrinkAcks
  let history = state.history

  if (correct) {
    const reward = state.currentTarotId === TAROT_ID.HIEROPHANT ? 2 : 1
    payFromBank(state, players, catcherUid, reward)
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, violatorUid, 1, '违反禁令：说了"为什么"', now)
    history = appendHistory(
      history,
      `抓到违反禁令的玩家，从银行得 ${reward} 金币${reward === 2 ? '（教皇生效中）' : ''}；违规者罚 1 口。`,
      now,
      catcherUid,
    )
  } else {
    const catcher = players[catcherUid]!
    const fine = Math.min(1, catcher.coins)
    catcher.coins -= fine
    history = appendHistory(history, `错误指认违反禁令，罚 ${fine} 金币。`, now, catcherUid)
  }

  return { ...state, players, pendingDrinkAcks, history }
}
