/**
 * 旧存档兼容：Phase D.1 之前开局的房间文档没有塔罗状态等新字段。
 * 每次读取共享状态后先补齐默认值，正在进行的旧对局可以继续玩，不需要删除房间数据。
 */
import type { DiceRollRecord, GameState, PendingDecision, PendingDrinkAck, PendingHeartAttack, TurnState } from '../types'
import { pushDrinkAck } from './stateHelpers'
import { buildLadyDeck, parseLadyCardId, seededRng, shuffle } from '../cards/ladyDeck'
import { EMPTY_LADY_STATUS } from './ladyEvents'

type Loose<T> = { [K in keyof T]?: T[K] }
type LegacyDecision = PendingDecision | { kind: 'DRINK_ACK'; amount: number; reason: string } | { kind: 'TRUTH_OR_DARE' }

export function normalizeGameState(raw: GameState): GameState {
  const g = raw as GameState & Loose<GameState>
  const turn = g.turn as TurnState & Loose<TurnState>

  const rawRoll = turn.lastRoll as (DiceRollRecord & Loose<DiceRollRecord>) | null
  const lastRoll: DiceRollRecord | null = rawRoll
    ? { ...rawRoll, grantsExtraRoll: rawRoll.grantsExtraRoll ?? rawRoll.isNaturalSix, tarotNote: rawRoll.tarotNote ?? null }
    : null

  let pendingDrinkAcks: PendingDrinkAck[] = g.pendingDrinkAcks ?? []
  let pendingDecision: PendingDecision | null = null
  const legacy = (turn.pendingDecision ?? null) as LegacyDecision | null
  if (legacy?.kind === 'DRINK_ACK') {
    // 旧版本里"自己喝酒"会卡住回合；现在统一进非阻塞的喝酒提醒
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, turn.currentPlayerUid, legacy.amount, legacy.reason, Date.now())
  } else if (legacy?.kind === 'TRUTH_OR_DARE' && !('choice' in legacy)) {
    pendingDecision = { kind: 'TRUTH_OR_DARE', choice: null }
  } else {
    pendingDecision = legacy as PendingDecision | null
  }

  // 旧存档（Q10 之前）没有主牌牌堆，最近 5 张是不带花色的旧 id。
  // 用开局时间作种子洗牌：所有客户端补出的是同一副牌，谁先写回都一致。
  // 旧的无花色窗口清空——它无法按花色判定德国心脏病。
  const hasDeck = Array.isArray(g.ladyDeck)
  const legacyWindow = (g.recentLadyCards ?? []).some((id) => parseLadyCardId(id).suit === null)

  return {
    ...g,
    ladyDeck: hasDeck ? g.ladyDeck : shuffle(buildLadyDeck(), seededRng(g.startedAt ?? 0)),
    ladyDiscard: g.ladyDiscard ?? [],
    recentLadyCards: legacyWindow ? [] : (g.recentLadyCards ?? []),
    lastJusticeSwap: g.lastJusticeSwap ?? null,
    pendingHeartAttack: normalizeHeartAttack(g.pendingHeartAttack ?? null),
    pendingDrinkAcks,
    tarotState: g.tarotState ?? { loversPair: null },
    lastTarotChange: g.lastTarotChange ?? null,
    pendingTarotDiscards: g.pendingTarotDiscards ?? [],
    // Phase D.2 之前的房间：正式规则集，没有事件和持续状态
    ladyRuleset: g.ladyRuleset ?? 'official',
    ladyEvent: g.ladyEvent ?? null,
    ladyStatus: { ...EMPTY_LADY_STATUS, ...(g.ladyStatus ?? {}) },
    kingTask: g.kingTask ?? null,
    kingTaskHistory: g.kingTaskHistory ?? [],
    turn: {
      ...turn,
      lastRoll,
      pendingDecision,
      playersWhoPlayedTacticThisTurn: turn.playersWhoPlayedTacticThisTurn ?? [],
      tarotNotes: turn.tarotNotes ?? [],
      activeTacticUsed: turn.activeTacticUsed ?? false,
    },
  }
}

type LegacyHeartAttack = PendingHeartAttack & { suitLabel?: string; count?: number }

/** 旧版心脏病记录没有花色明细，保留"待房主确认"的状态，只补齐新字段 */
function normalizeHeartAttack(raw: PendingHeartAttack | null): PendingHeartAttack | null {
  if (!raw) return null
  const legacy = raw as LegacyHeartAttack
  return { ...raw, triggeredSuits: legacy.triggeredSuits ?? [], windowCardIds: legacy.windowCardIds ?? [] }
}
