/**
 * V1.6 数字版：德州扑克周期、下注、摊牌、骗子酒馆吹牛、梦幻拖拉机。
 *
 * 原稿（V1.5）：每人 2 张底牌；CASINO 第 1 次翻 Flop、第 2 次 Turn、第 3 次 River 并摊牌；每阶段最多一次 1 金币加注；
 * 每个德州手牌周期每人可以吹牛一次；梦幻比三张牌型：豹子 > 同花顺 > 同花 > 顺子 > 对子 > 单张。
 *
 * V1.6 补充：
 * - 棋盘上没有名为 CASINO 的格子；"德州+1 / 德扑+1"格子既向底池投入 1 金币（Q14），也视为一次 CASINO。
 * - 独立 52 张德州牌堆，底牌和公共牌都从这里发，不和小姐牌混用。
 * - 每阶段一轮下注：过牌 / 下注 1 / 跟注 1 / 弃牌；每人每阶段最多投入 1 金币，不能反复加注。
 * - 七选五标准牌型比大小，不比花色；平局平分，除不尽的金币回银行。
 * - 好友聚会信任模式：底牌存在共享文档里，普通界面只给本人看，不是防作弊的保密机制。
 */
import { shuffle } from '../cards/ladyDeck'
import { buildDeck } from '../cards/texasCards'
import type { BluffState, DreamChallenge, GamePlayerState, GameState, PendingDrinkAck, TexasBetting, TexasShowdownResult, TexasState } from '../types'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { clonePlayers, pushDrinkAck, requirePlayer } from './stateHelpers'
import { drinkExemptionsDisabled, payFromBank, TAROT_ID } from './tarotEffects'

// ---------------------------------------------------------------------------
// 牌面工具
// ---------------------------------------------------------------------------

const RANK_VALUE: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }
const SUIT_LABEL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

export function parseTexasCard(id: string): { suit: string; rank: string; value: number } {
  const suit = id[0] ?? ''
  const rank = id.slice(1)
  const value = RANK_VALUE[rank]
  if (!value || !SUIT_LABEL[suit]) throw new GameActionError('INVALID_GAME_ACTION', `无效的扑克牌：${id}`)
  return { suit, rank, value }
}

export function isValidTexasCard(id: string): boolean {
  try {
    parseTexasCard(id)
    return true
  } catch {
    return false
  }
}

export function texasCardLabel(id: string): string {
  const c = parseTexasCard(id)
  return `${SUIT_LABEL[c.suit]}${c.rank}`
}

export function freshTexasDeck(rng: () => number): string[] {
  return shuffle(
    buildDeck().map((c) => c.id),
    rng,
  )
}

// ---------------------------------------------------------------------------
// 七选五（标准德州）
// ---------------------------------------------------------------------------

const HAND5_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'] as const

/** 返回 [牌型等级, ...比较点数]，数组字典序越大越强 */
export function evaluate5(cards: string[]): number[] {
  const parsed = cards.map(parseTexasCard)
  const values = parsed.map((c) => c.value).sort((a, b) => b - a)
  const flush = parsed.every((c) => c.suit === parsed[0]!.suit)
  const unique = [...new Set(values)]
  let straightHigh = 0
  if (unique.length === 5) {
    if (values[0]! - values[4]! === 4) straightHigh = values[0]!
    else if (values.join(',') === '14,5,4,3,2') straightHigh = 5
  }
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const byGroup = groups.map(([v]) => v)

  if (straightHigh && flush) return [8, straightHigh]
  if (groups[0]![1] === 4) return [7, ...byGroup]
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return [6, ...byGroup]
  if (flush) return [5, ...values]
  if (straightHigh) return [4, straightHigh]
  if (groups[0]![1] === 3) return [3, ...byGroup]
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return [2, ...byGroup]
  if (groups[0]![1] === 2) return [1, ...byGroup]
  return [0, ...values]
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function bestOfSeven(cards: string[]): { score: number[]; best: string[]; name: string } {
  let best: { score: number[]; best: string[] } | null = null
  const n = cards.length
  for (let a = 0; a < n; a += 1)
    for (let b = a + 1; b < n; b += 1) {
      const five = cards.filter((_, i) => i !== a && i !== b)
      if (five.length !== 5) continue
      const score = evaluate5(five)
      if (!best || compareScores(score, best.score) > 0) best = { score, best: five }
    }
  if (!best) {
    // 少于 7 张（只会在测试里出现）：直接评估
    const score = evaluate5(cards.slice(0, 5))
    best = { score, best: cards.slice(0, 5) }
  }
  const name = best.score[0] === 8 && best.score[1] === 14 ? '皇家同花顺' : HAND5_NAMES[best.score[0]!]!
  return { ...best, name }
}

// ---------------------------------------------------------------------------
// 梦幻拖拉机：三张牌型
// ---------------------------------------------------------------------------

const HAND3_NAMES = ['单张', '对子', '顺子', '同花', '同花顺', '豹子'] as const

export function evaluate3(cards: string[]): { score: number[]; name: string } {
  const parsed = cards.map(parseTexasCard)
  const values = parsed.map((c) => c.value).sort((a, b) => b - a)
  const flush = parsed.every((c) => c.suit === parsed[0]!.suit)
  let straightHigh = 0
  if (new Set(values).size === 3) {
    if (values[0]! - values[2]! === 2) straightHigh = values[0]!
    else if (values.join(',') === '14,3,2') straightHigh = 3
  }
  let score: number[]
  if (values[0] === values[2]) score = [5, values[0]!]
  else if (straightHigh && flush) score = [4, straightHigh]
  else if (flush) score = [3, ...values]
  else if (straightHigh) score = [2, straightHigh]
  else if (values[0] === values[1] || values[1] === values[2]) {
    const pair = values[1]!
    const kicker = values[0] === values[1] ? values[2]! : values[0]!
    score = [1, pair, kicker]
  } else score = [0, ...values]
  return { score, name: HAND3_NAMES[score[0]!]! }
}

// ---------------------------------------------------------------------------
// 德州周期
// ---------------------------------------------------------------------------

export function initialTexasState(players: GamePlayerState[], rng: () => number): { texas: TexasState; holes: Record<string, [string, string]> } {
  const deck = freshTexasDeck(rng)
  const holes: Record<string, [string, string]> = {}
  for (const p of players) holes[p.uid] = [deck.shift()!, deck.shift()!]
  return {
    texas: {
      cycle: 1,
      stage: 'PREFLOP',
      deck,
      community: [],
      pot: 0,
      carryPot: 0,
      folded: [],
      betting: null,
      bluffUsed: [],
      lastShowdown: null,
      casinoCount: 0,
    },
    holes,
  }
}

/** 旧房间补齐：用已经发出的底牌推出剩余牌堆（确定性，所有客户端一致） */
export function legacyTexasState(players: GamePlayerState[], rng: () => number): TexasState {
  const dealt = new Set(players.flatMap((p) => p.texasHoleCards))
  return {
    cycle: 1,
    stage: 'PREFLOP',
    deck: freshTexasDeck(rng).filter((c) => !dealt.has(c)),
    community: [],
    pot: 0,
    carryPot: 0,
    folded: [],
    betting: null,
    bluffUsed: [],
    lastShowdown: null,
    casinoCount: 0,
  }
}

/** 德州+1 / 德扑+1：银行向底池投入 amount 金币；周期已结束时计入下一周期 */
export function addTexasPotFromBank(state: GameState, amount: number): Pick<GameState, 'texas'> {
  const t = state.texas
  return { texas: t.stage === 'DONE' ? { ...t, carryPot: t.carryPot + amount } : { ...t, pot: t.pot + amount } }
}

function activeUids(state: GameState, texas: TexasState): string[] {
  return state.turnOrder.filter((u) => !texas.folded.includes(u))
}

function openBetting(state: GameState, texas: TexasState, stage: TexasBetting['stage']): TexasState {
  const awaiting = activeUids(state, texas)
  return { ...texas, betting: { stage, betUid: null, contributed: [], awaiting } }
}

/**
 * 一次 CASINO：按当前阶段推进。周期结束（DONE）时开启新周期并重新发底牌。
 * 上一阶段的下注还没结束时不推进（见函数内说明）；房主可以用"结束本阶段下注"收尾。
 */
export function applyCasino(state: GameState, now: number, rng: () => number, actorUid: string): GameState {
  // 上一阶段的下注还没结束：这次 CASINO 不推进公共牌（底池 +1 已经在格子效果里加过），
  // 避免一名玩家落格就替其他人强制过牌/弃牌。等下注结束后，下一次 CASINO 再翻牌。
  if (state.texas.betting) {
    return {
      ...state,
      history: appendHistory(state.history, `CASINO：${state.texas.betting.stage} 下注还没结束，本次不翻新的公共牌（底池照常 +1）。请还没表态的玩家先表态。`, now, actorUid),
    }
  }
  const s: GameState = { ...state, texas: { ...state.texas, casinoCount: state.texas.casinoCount + 1 } }
  const t = s.texas
  let history = s.history

  if (t.stage === 'DONE') {
    const deck = freshTexasDeck(rng)
    const players = clonePlayers(s)
    for (const uid of s.turnOrder) players[uid]!.texasHoleCards = [deck.shift()!, deck.shift()!]
    history = appendHistory(history, `CASINO！开启第 ${t.cycle + 1} 个德州周期：重新洗牌，每人发 2 张新底牌（只有自己能看到）。`, now, actorUid)
    return {
      ...s,
      players,
      history,
      texas: { ...t, cycle: t.cycle + 1, stage: 'PREFLOP', deck, community: [], pot: t.carryPot, carryPot: 0, folded: [], betting: null, bluffUsed: [] },
    }
  }

  const deck = [...t.deck]
  if (t.stage === 'PREFLOP') {
    const flop = [deck.shift()!, deck.shift()!, deck.shift()!]
    history = appendHistory(history, `CASINO！第 1 次：翻开 Flop 三张公共牌 ${flop.map(texasCardLabel).join(' ')}。每人可以过牌、下注 1 金币、跟注或弃牌。`, now, actorUid)
    return { ...s, history, texas: openBetting(s, { ...t, deck, community: flop, stage: 'FLOP' }, 'FLOP') }
  }
  if (t.stage === 'FLOP') {
    const turn = deck.shift()!
    history = appendHistory(history, `CASINO！第 2 次：翻开 Turn 公共牌 ${texasCardLabel(turn)}。`, now, actorUid)
    return { ...s, history, texas: openBetting(s, { ...t, deck, community: [...t.community, turn], stage: 'TURN' }, 'TURN') }
  }
  // TURN → RIVER
  const river = deck.shift()!
  history = appendHistory(history, `CASINO！第 3 次：翻开 River 公共牌 ${texasCardLabel(river)}。这一轮下注结束后摊牌。`, now, actorUid)
  return { ...s, history, texas: openBetting(s, { ...t, deck, community: [...t.community, river], stage: 'RIVER' }, 'RIVER') }
}

export type TexasBetAction = 'CHECK' | 'BET' | 'CALL' | 'FOLD'

export function applyTexasBet(state: GameState, callerUid: string, action: TexasBetAction, now: number): GameState {
  const t = state.texas
  const b = t.betting
  if (!b) throw new GameActionError('INVALID_GAME_ACTION', '现在没有进行中的德州下注')
  if (!b.awaiting.includes(callerUid)) throw new GameActionError('INVALID_GAME_ACTION', '这一轮你已经表态过了，或者你已经弃牌')
  const players = clonePlayers(state)
  const me = players[callerUid]!
  let betting: TexasBetting = { ...b, awaiting: b.awaiting.filter((u) => u !== callerUid), contributed: [...b.contributed] }
  let texas: TexasState = { ...t }
  let message: string

  switch (action) {
    case 'CHECK':
      if (b.betUid) throw new GameActionError('INVALID_GAME_ACTION', '已经有人下注了，只能跟注或弃牌')
      message = '德州：过牌。'
      break
    case 'BET':
      if (b.betUid) throw new GameActionError('INVALID_GAME_ACTION', '本阶段已经有人下注，不能再加注')
      if (me.coins < 1) throw new GameActionError('INVALID_GAME_ACTION', '金币不足，不能下注')
      me.coins -= 1
      texas.pot += 1
      betting = {
        ...betting,
        betUid: callerUid,
        contributed: [callerUid],
        // 之前过牌的人需要重新表态（跟注或弃牌）
        awaiting: activeUids(state, t).filter((u) => u !== callerUid),
      }
      message = '德州：下注 1 金币。其他人需要跟注或弃牌。'
      break
    case 'CALL':
      if (!b.betUid) throw new GameActionError('INVALID_GAME_ACTION', '还没有人下注，可以过牌或下注')
      if (me.coins < 1) throw new GameActionError('INVALID_GAME_ACTION', '金币不足，不能跟注，只能弃牌')
      me.coins -= 1
      texas.pot += 1
      betting.contributed.push(callerUid)
      message = '德州：跟注 1 金币。'
      break
    case 'FOLD':
      texas.folded = [...t.folded, callerUid]
      message = '德州：弃牌，本周期不再参加摊牌。'
      break
  }

  let next: GameState = { ...state, players, texas: { ...texas, betting }, history: appendHistory(state.history, message, now, callerUid) }
  if (activeUids(next, next.texas).length <= 1 || betting.awaiting.length === 0) next = closeBetting(next, now, false)
  return next
}

/** 结束本阶段下注。force：未表态的人按过牌（无人下注）或弃牌（有人下注）处理 */
export function closeBetting(state: GameState, now: number, force: boolean): GameState {
  const t = state.texas
  const b = t.betting
  if (!b) return state
  let folded = t.folded
  let history = state.history
  if (force && b.awaiting.length > 0) {
    if (b.betUid) {
      folded = [...folded, ...b.awaiting]
      history = appendHistory(history, '德州：本阶段还没表态的玩家面对下注，按弃牌处理。', now)
    } else {
      history = appendHistory(history, '德州：本阶段还没表态的玩家按过牌处理。', now)
    }
  }
  let s: GameState = { ...state, history, texas: { ...t, folded, betting: null } }
  const alive = activeUids(s, s.texas)
  if (alive.length <= 1) return settlePot(s, alive, now, 'LAST_STANDING')
  if (b.stage === 'RIVER') return showdown(s, now)
  return s
}

/** 摊牌：未弃牌的人比七选五，平分底池，除不尽回银行 */
export function showdown(state: GameState, now: number): GameState {
  const alive = activeUids(state, state.texas)
  if (alive.length <= 1) return settlePot(state, alive, now, 'LAST_STANDING')
  return settlePot(state, alive, now, 'SHOWDOWN')
}

function settlePot(state: GameState, alive: string[], now: number, reason: TexasShowdownResult['reason']): GameState {
  const t = state.texas
  const players = clonePlayers(state)
  const community = t.community
  const hands = alive.map((uid) => {
    const hole = players[uid]!.texasHoleCards
    const r = community.length >= 3 ? bestOfSeven([...hole, ...community]) : { score: [0], best: [...hole], name: '未完成公共牌' }
    return { uid, holeCards: hole, handName: r.name, best: r.best, score: r.score }
  })
  let winners: string[]
  if (reason === 'LAST_STANDING') winners = alive
  else {
    const top = hands.reduce((acc, h) => (compareScores(h.score, acc) > 0 ? h.score : acc), hands[0]!.score)
    winners = hands.filter((h) => compareScores(h.score, top) === 0).map((h) => h.uid)
  }
  const pot = t.pot
  const share = winners.length > 0 ? Math.floor(pot / winners.length) : 0
  const returned = pot - share * winners.length
  // 底池是玩家投入和格子投入的金币，派发给赢家属于"底池结算"，不是银行奖励，不触发恋人
  for (const w of winners) players[w]!.coins += share

  const result: TexasShowdownResult = {
    cycle: t.cycle,
    community,
    hands: reason === 'SHOWDOWN' ? hands.map(({ uid, holeCards, handName, best }) => ({ uid, holeCards, handName, best })) : [],
    winners,
    pot,
    share,
    returnedToBank: returned,
    reason,
    at: now,
  }
  const winnerNote = winners.length === 0 ? '没有玩家' : winners.length === 1 ? '一名玩家' : `${winners.length} 名玩家平分`
  const message =
    reason === 'LAST_STANDING'
      ? `德州第 ${t.cycle} 周期结束：只剩一名玩家没有弃牌，直接赢得底池 ${pot} 金币。`
      : `德州第 ${t.cycle} 周期摊牌：${winnerNote}赢得底池 ${pot} 金币${share > 0 ? `（每人 ${share}）` : ''}${returned > 0 ? `，除不尽的 ${returned} 金币回到银行` : ''}${pot === 0 ? '（底池为 0，只展示牌型）' : ''}。`
  return {
    ...state,
    players,
    history: appendHistory(state.history, message, now),
    texas: { ...t, stage: 'DONE', betting: null, pot: 0, lastShowdown: result },
  }
}

/** 终局：补齐公共牌并直接摊牌（不再下注）；已结束的周期把预存底池退回银行 */
export function finishTexasForEndgame(state: GameState, now: number): GameState {
  const t = state.texas
  if (t.stage === 'DONE') {
    if (t.carryPot === 0) return state
    return { ...state, texas: { ...t, carryPot: 0 }, history: appendHistory(state.history, `终局：下一周期预存的 ${t.carryPot} 金币回到银行。`, now) }
  }
  const deck = [...t.deck]
  const community = [...t.community]
  while (community.length < 5) community.push(deck.shift()!)
  const s: GameState = {
    ...state,
    history: appendHistory(state.history, `终局：补齐德州公共牌 ${community.map(texasCardLabel).join(' ')}，直接摊牌。`, now),
    texas: { ...t, deck, community, betting: null },
  }
  return showdown(s, now)
}

// ---------------------------------------------------------------------------
// 骗子酒馆：在一条 1 口提醒上吹牛
// ---------------------------------------------------------------------------

export function bluffEligibility(state: GameState, ack: PendingDrinkAck, uid: string): string | null {
  if (state.rulesVersion !== 2) return '旧房间按 V1.5 规则，不能吹牛'
  if (ack.targetUid !== uid) return '只能在自己的惩罚上吹牛'
  const oneSip = ack.amount === 1 && !ack.amountText && !ack.coinPenalty
  const oneCoin = ack.coinPenalty === 1
  if (!oneSip && !oneCoin) return '只能对"1 口"或"1 金币"惩罚吹牛'
  if (ack.accompany) return '陪喝提醒不能吹牛'
  if (ack.transferredFromUid) return '替喝转来的提醒不能吹牛'
  if (ack.bluff || ack.substituteOffer) return '这条提醒正在处理中'
  if (state.texas.bluffUsed.includes(uid)) return '本德州周期你已经吹过牛了'
  if (drinkExemptionsDisabled(state.currentTarotId)) return '节制塔罗生效中：吹牛免罚属于免罚效果，暂时不能使用'
  return null
}

export function applyStartBluff(state: GameState, callerUid: string, ackId: string, claim: string, now: number): GameState {
  const ack = state.pendingDrinkAcks.find((a) => a.id === ackId)
  if (!ack) throw new GameActionError('INVALID_GAME_ACTION', '这条喝酒提醒不存在或已经处理过了')
  const reason = bluffEligibility(state, ack, callerUid)
  if (reason) throw new GameActionError('INVALID_GAME_ACTION', reason)
  if (!isValidTexasCard(claim)) throw new GameActionError('INVALID_GAME_ACTION', '请声明一张具体的牌，例如黑桃 A')
  const bluff: BluffState = { claimerUid: callerUid, claim, awaiting: state.turnOrder.filter((u) => u !== callerUid) }
  return {
    ...state,
    pendingDrinkAcks: state.pendingDrinkAcks.map((a) => (a.id === ackId ? { ...a, bluff } : a)),
    texas: { ...state.texas, bluffUsed: [...state.texas.bluffUsed, callerUid] },
    history: appendHistory(state.history, `骗子酒馆：声称自己有 ${texasCardLabel(claim)}，其他人可以质疑。`, now, callerUid),
  }
}

/**
 * 其他玩家表态：质疑 / 不质疑。第一位质疑者立刻结算；所有人都不质疑则原惩罚免除。
 * 房主可以 closeAll：把还没表态的人记为不质疑（有人离线时用）。
 */
export function applyRespondBluff(
  state: GameState,
  callerUid: string,
  hostUid: string,
  ackId: string,
  challenge: boolean,
  now: number,
  closeAll = false,
): GameState {
  const ack = state.pendingDrinkAcks.find((a) => a.id === ackId)
  const bluff = ack?.bluff
  if (!ack || !bluff) throw new GameActionError('INVALID_GAME_ACTION', '这次吹牛已经结算过了')
  if (closeAll) {
    if (callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以代为记录"不质疑"')
  } else if (!bluff.awaiting.includes(callerUid)) throw new GameActionError('INVALID_GAME_ACTION', '你已经表过态了')

  if (!challenge || closeAll) {
    const awaiting = closeAll ? [] : bluff.awaiting.filter((u) => u !== callerUid)
    if (awaiting.length > 0) {
      return {
        ...state,
        pendingDrinkAcks: state.pendingDrinkAcks.map((a) => (a.id === ackId ? { ...a, bluff: { ...bluff, awaiting } } : a)),
        history: appendHistory(state.history, '骗子酒馆：选择不质疑。', now, callerUid),
      }
    }
    return {
      ...state,
      pendingDrinkAcks: state.pendingDrinkAcks.filter((a) => a.id !== ackId),
      history: appendHistory(state.history, '骗子酒馆：没有人质疑，原惩罚免除。', now, bluff.claimerUid),
    }
  }

  const truthful = state.players[bluff.claimerUid]!.texasHoleCards.includes(bluff.claim)
  const players = clonePlayers(state)
  let acks = state.pendingDrinkAcks.filter((a) => a.id !== ackId)
  const winnerUid = truthful ? bluff.claimerUid : callerUid
  let message: string
  if (truthful) {
    acks = pushDrinkAck(acks, callerUid, 1, '骗子酒馆：质疑失败', now)
    message = `骗子酒馆：质疑！对方真的有 ${texasCardLabel(bluff.claim)}，质疑者喝 1 口，原${ack.coinPenalty ? '金币' : ''}惩罚免除。`
  } else if (ack.coinPenalty) {
    // 金币惩罚：吹牛被拆穿时直接按原金额扣款（不足按实际余额），再加 1 口
    const claimer = players[bluff.claimerUid]!
    const paid = Math.min(ack.coinPenalty, claimer.coins)
    claimer.coins -= paid
    acks = pushDrinkAck(acks, bluff.claimerUid, 1, '骗子酒馆：吹牛被拆穿', now)
    message = `骗子酒馆：质疑成功！对方没有 ${texasCardLabel(bluff.claim)}，原惩罚照扣 ${paid} 金币，再加 1 口。`
  } else {
    const restored = { ...ack }
    delete restored.bluff
    acks = [...acks, restored]
    acks = pushDrinkAck(acks, bluff.claimerUid, 1, '骗子酒馆：吹牛被拆穿', now)
    message = `骗子酒馆：质疑成功！对方没有 ${texasCardLabel(bluff.claim)}，原惩罚照旧，再加 1 口。`
  }
  let history = appendHistory(state.history, message, now, callerUid)
  if (state.currentTarotId === TAROT_ID.MOON) {
    payFromBank(state, players, winnerUid, 1)
    history = appendHistory(history, '月亮：质疑胜者额外从银行得 1 金币。', now, winnerUid)
  }
  return { ...state, players, pendingDrinkAcks: acks, history }
}

// ---------------------------------------------------------------------------
// 梦幻拖拉机
// ---------------------------------------------------------------------------

export function openDreamChallenge(state: GameState, initiatorUid: string, candidates: string[], now: number): DreamChallenge | null {
  const list = [...new Set(candidates)].filter((u) => u !== initiatorUid && state.players[u])
  if (list.length === 0) return null
  return { eventId: `dream-${now}-${state.turnNumber}`, initiatorUid, candidates: list, targetUid: null, step: 'OPEN', fantasy: {}, result: null }
}

function requireDream(state: GameState, eventId: string, steps: DreamChallenge['step'][]): DreamChallenge {
  const d = state.dream
  if (!d || d.eventId !== eventId) throw new GameActionError('INVALID_GAME_ACTION', '这次梦幻挑战已经结束')
  if (!steps.includes(d.step)) throw new GameActionError('INVALID_GAME_ACTION', '这一步已经处理过了')
  return d
}

export function applyDreamChallenge(state: GameState, callerUid: string, eventId: string, targetUid: string, now: number): GameState {
  const d = requireDream(state, eventId, ['OPEN'])
  if (callerUid !== d.initiatorUid) throw new GameActionError('INVALID_GAME_ACTION', '只有本事件的发起人可以提出梦幻挑战')
  if (!d.candidates.includes(targetUid)) throw new GameActionError('INVALID_GAME_ACTION', '只能挑战本次地产或碰撞事件涉及的玩家')
  return {
    ...state,
    dream: { ...d, targetUid, step: 'AWAIT_ACCEPT' },
    history: appendHistory(state.history, '提出梦幻拖拉机挑战，等待对方接受或拒绝。', now, callerUid),
  }
}

export function applyDreamRespond(state: GameState, callerUid: string, eventId: string, accept: boolean, now: number): GameState {
  const d = requireDream(state, eventId, ['AWAIT_ACCEPT'])
  if (callerUid !== d.targetUid) throw new GameActionError('INVALID_GAME_ACTION', '只有被挑战的人可以回应')
  if (!accept) {
    return {
      ...state,
      dream: { ...d, step: 'DONE', result: { winners: [], hands: [], summary: '对方拒绝了梦幻挑战，无事发生' } },
      history: appendHistory(state.history, '拒绝了梦幻拖拉机挑战（不受罚）。', now, callerUid),
    }
  }
  return { ...state, dream: { ...d, step: 'DECLARE' }, history: appendHistory(state.history, '接受了梦幻拖拉机挑战！双方亮底牌并声明幻想牌。', now, callerUid) }
}

export function applyDreamDeclare(state: GameState, callerUid: string, eventId: string, fantasyCard: string, now: number): GameState {
  const d = requireDream(state, eventId, ['DECLARE'])
  if (callerUid !== d.initiatorUid && callerUid !== d.targetUid) throw new GameActionError('INVALID_GAME_ACTION', '你没有参加这次挑战')
  if (d.fantasy[callerUid]) throw new GameActionError('INVALID_GAME_ACTION', '你已经声明过幻想牌了')
  if (!isValidTexasCard(fantasyCard)) throw new GameActionError('INVALID_GAME_ACTION', '幻想牌必须是一张有花色和点数的牌')
  const fantasy = { ...d.fantasy, [callerUid]: fantasyCard }
  const both = [d.initiatorUid, d.targetUid!]
  if (!both.every((u) => fantasy[u])) {
    return { ...state, dream: { ...d, fantasy }, history: appendHistory(state.history, '声明了幻想牌，等待对方。', now, callerUid) }
  }
  const hands = both.map((uid) => {
    const cards = [...state.players[uid]!.texasHoleCards, fantasy[uid]!]
    const r = evaluate3(cards)
    return { uid, cards, handName: r.name, score: r.score }
  })
  const cmp = compareScores(hands[0]!.score, hands[1]!.score)
  const winners = cmp === 0 ? [] : [cmp > 0 ? hands[0]!.uid : hands[1]!.uid]
  const players = clonePlayers(state)
  for (const w of winners) payFromBank(state, players, w, 1)
  const summary = winners.length === 0 ? `平局（${hands[0]!.handName}），双方都不得金币` : `${hands.find((h) => h.uid === winners[0])!.handName}获胜，胜者从银行得 1 金币`
  return {
    ...state,
    players,
    dream: { ...d, fantasy, step: 'DONE', result: { winners, hands: hands.map(({ uid, cards, handName }) => ({ uid, cards, handName })), summary } },
    history: appendHistory(state.history, `梦幻拖拉机：${summary}。`, now, callerUid),
  }
}

export function requireTexasPlayer(state: GameState, uid: string): void {
  requirePlayer(state, uid)
}
