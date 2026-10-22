/**
 * 开局初始化——房主点击"开始游戏"时，把 `GameRoomPlayer[]`（阶段 B 大厅模型）
 * 转换成一份全新的 `GameState`（阶段 C 游戏模型）。纯函数，不碰数据库、
 * 不做乐观锁重试（那些在 `frontend/src/lib/gameEngineDb.ts`），方便单测
 * "三人开局的初始状态是否符合规则书"。
 *
 * 按 V1.5 规则书"1. 开局"与"4.1 房间与开局"：
 * - 每人 5 金币、1 张三国杀手牌、2 张德州底牌、1 张身份牌。
 * - 棋盘摆开 1 张世界塔罗（随机抽一张作为开局塔罗）。
 * - 洗好 52 张小姐主牌（四花色 × A–K，Q10 补充方案）。
 * - 玩家顺序固定为开局时的座位顺序（GameRoomPlayer.seat 升序）。
 * - 玩家初始棋子位置：对应自己棋子颜色的起点格（棋盘四角）。
 */
import { startCellIdForColor } from './movement'
import { drawRandomTacticCardId } from '../cards/tacticCards'
import { drawRandomTarotId } from '../cards/tarotCards'
import { freshTexasDeck } from './texas'
import { dealAvalonRoles, emptyAvalon } from './avalon'
import type { GamePlayerState, GameState, LadyRuleset, PlayerColor } from '../types'
import { EMPTY_LADY_STATUS } from './ladyEvents'
import type { GameRoomPlayer } from '../../gameRoomTypes'
import { appendHistory } from './history'
import { revealTarot } from './tarotActions'
import { buildLadyDeck, shuffle } from '../cards/ladyDeck'

const SEAT_COLORS: PlayerColor[] = ['B', 'G', 'Y', 'R']

/** 按座位号分配棋子颜色——4 种颜色循环分配，人数超过 4 人时后面的玩家与前面共享颜色分组（不影响个人棋子位置，只影响视觉配色） */
export function colorForSeat(seat: number): PlayerColor {
  const color = SEAT_COLORS[seat % SEAT_COLORS.length]
  if (!color) throw new Error('座位颜色分配失败，不应该发生')
  return color
}

export const INITIAL_COINS = 5

/**
 * openingTarotId 只给测试固定开局塔罗用；正常开局随机抽一张。
 * 开局摆放的塔罗同样结算即时效果（规则书"棋盘摆开 1 张世界塔罗"），
 * 恋人/正义需要的选择由先手玩家/房主在第一回合开始前完成。
 */
export function initGameState(
  roomPlayers: GameRoomPlayer[],
  now: number,
  openingTarotId?: string,
  rng: () => number = Math.random,
  ladyRuleset: LadyRuleset = 'official',
): GameState {
  const ordered = [...roomPlayers].sort((a, b) => a.seat - b.seat)
  if (ordered.length === 0) {
    throw new Error('无法在没有玩家的房间初始化游戏')
  }

  // V1.6：底牌从本局唯一的德州牌堆发出，剩余牌堆留给公共牌（不再单独随机发底牌）
  const texasDeck = freshTexasDeck(rng)
  const holeCardHands = ordered.map(() => [texasDeck.shift()!, texasDeck.shift()!])
  const players: Record<string, GamePlayerState> = {}

  ordered.forEach((p, idx) => {
    const color = colorForSeat(p.seat)
    const hand = holeCardHands[idx]
    if (!hand) throw new Error('德州底牌发牌数量不足，不应该发生')
    const [hole0, hole1] = hand
    if (!hole0 || !hole1) throw new Error('德州底牌发牌数量不足，不应该发生')
    players[p.uid] = {
      uid: p.uid,
      color,
      position: startCellIdForColor(color),
      coins: INITIAL_COINS,
      properties: [],
      tacticHand: [drawRandomTacticCardId(rng)],
      identityCardId: '',
      texasHoleCards: [hole0, hole1],
      mortgaged: [],
      skipNextRoll: false,
      laps: 0,
      zone: { kind: 'ring' },
      reachedFinish: false,
    }
  })

  const turnOrder = ordered.map((p) => p.uid)
  const roles = dealAvalonRoles(turnOrder, rng)
  // 身份牌 = 阿瓦隆阵营（V1.6 补充 Q11）。好友聚会信任模式：共享文档可读，界面只给本人看
  for (const uid of turnOrder) players[uid]!.identityCardId = `avalon-${roles[uid]}`
  const firstPlayer = turnOrder[0]
  if (!firstPlayer) throw new Error('无法确定首位行动玩家，不应该发生')

  const history = appendHistory(
    [],
    `游戏开始！玩家顺序：${ordered.map((p) => p.nickname).join(' → ')}。轮到 ${ordered[0]!.nickname} 先手。`,
    now,
  )

  const base: GameState = {
    rulesVersion: 2,
    startedAt: now,
    turnOrder,
    currentPlayerIndex: 0,
    turnNumber: 1,
    players,
    turn: {
      phase: 'ROLLING',
      currentPlayerUid: firstPlayer,
      lastRoll: null,
      extraRollPending: false,
      extraRollUsed: false,
      pendingDecision: null,
      revealedLadyCardId: null,
      landingResolved: false,
      playersWhoPlayedTacticThisTurn: [],
      tarotNotes: [],
      activeTacticUsed: false,
      rollSkipped: false,
    },
    pendingDrinkAcks: [],
    recentLadyCards: [],
    ladyDeck: shuffle(buildLadyDeck(), rng),
    ladyDiscard: [],
    pendingHeartAttack: null,
    lastJusticeSwap: null,
    currentTarotId: '',
    tarotState: { loversPair: null },
    lastTarotChange: null,
    pendingTarotDiscards: [],
    ladyRuleset,
    ladyEvent: null,
    ladyStatus: EMPTY_LADY_STATUS,
    kingTask: null,
    kingTaskHistory: [],
    tacticStack: null,
    lastTacticResult: null,
    processedIncidentIds: [],
    texas: {
      cycle: 1,
      stage: 'PREFLOP',
      deck: texasDeck,
      community: [],
      pot: 0,
      carryPot: 0,
      folded: [],
      betting: null,
      bluffUsed: [],
      lastShowdown: null,
      casinoCount: 0,
    },
    dream: null,
    avalon: emptyAvalon(roles),
    godsPathOpen: false,
    endgame: null,
    usedPromptIds: [],
    history,
    finished: false,
  }

  const reveal = revealTarot(base, openingTarotId ?? drawRandomTarotId(undefined, rng), firstPlayer, now, rng)
  return {
    ...reveal.state,
    lastTarotChange: reveal.state.lastTarotChange && { ...reveal.state.lastTarotChange, previousTarotId: null, triggeredByUid: null },
    turn: { ...reveal.state.turn, pendingDecision: reveal.followUp },
  }
}
