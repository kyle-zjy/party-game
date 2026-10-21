/**
 * 小姐主牌牌堆（Q10 补充方案，数字版新规则）：四种花色 × A–K，共 52 张。
 * 卡牌实例 id 形如 "H-7"（花色-点数）。花色 id 固定为 S/H/D/C，界面显示成传统扑克花色。
 *
 * 德国心脏病：最近 5 张主牌按花色分开累计数量，任意一种花色的合计是正的 5 的倍数就触发；
 * 不同花色绝不混合求和。数量映射按 V1.5 原稿（见 ladyCards.ts 的 heartAttackCount）。
 *
 * 牌堆、弃牌、最近 5 张都保存在共享游戏状态里，所有玩家看到同一个窗口，刷新不会重复翻牌。
 */
import { getLadyCard } from './ladyCards'

export type LadySuit = 'S' | 'H' | 'D' | 'C'

export const LADY_SUITS: LadySuit[] = ['S', 'H', 'D', 'C']

export const LADY_SUIT_LABEL: Record<LadySuit, { symbol: string; name: string; red: boolean }> = {
  S: { symbol: '♠', name: '黑桃', red: false },
  H: { symbol: '♥', name: '红桃', red: true },
  D: { symbol: '♦', name: '方块', red: true },
  C: { symbol: '♣', name: '梅花', red: false },
}

export const LADY_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const

export const LADY_WINDOW_SIZE = 5

export function buildLadyDeck(): string[] {
  return LADY_SUITS.flatMap((suit) => LADY_RANKS.map((rank) => `${suit}-${rank}`))
}

/** 解析卡牌 id；Phase D.1 之前的旧 id（"lady-A"）没有花色，suit 为 null */
export function parseLadyCardId(id: string): { suit: LadySuit | null; rank: string } {
  if (id.startsWith('lady-')) return { suit: null, rank: id.slice(5) }
  const [suit, rank] = id.split('-')
  const validSuit = LADY_SUITS.includes(suit as LadySuit) ? (suit as LadySuit) : null
  return { suit: validSuit, rank: rank ?? '' }
}

export function formatLadyCard(id: string): string {
  const { suit, rank } = parseLadyCardId(id)
  return `${suit ? LADY_SUIT_LABEL[suit].name : ''}${rank}`
}

/** Fisher–Yates，返回新数组 */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/** 确定性随机数（mulberry32）：给旧存档补牌堆时，所有客户端用同一个种子得到同一副牌 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SuitTotal {
  suit: LadySuit
  count: number
}

export function heartAttackCheck(windowIds: string[]): { suitTotals: SuitTotal[]; triggeredSuits: SuitTotal[] } {
  const suitTotals = LADY_SUITS.map((suit) => ({
    suit,
    count: windowIds
      .filter((id) => parseLadyCardId(id).suit === suit)
      .reduce((sum, id) => sum + getLadyCard(id).heartAttackCount, 0),
  }))
  return { suitTotals, triggeredSuits: suitTotals.filter((t) => t.count > 0 && t.count % 5 === 0) }
}

export interface LadyDraw {
  cardId: string
  deck: string[]
  discard: string[]
  reshuffled: boolean
}

/**
 * 从牌堆顶抽一张。牌堆抽完时，把弃牌堆里不在"最近 5 张"窗口中的牌洗回牌堆
 * （窗口里的牌还摆在桌面上，不洗回，避免同一张牌同时出现两次）。
 */
export function drawFromLadyDeck(deck: string[], discard: string[], windowIds: string[], rng: () => number): LadyDraw {
  let pile = deck
  let used = discard
  let reshuffled = false
  if (pile.length === 0) {
    const onTable = new Set(windowIds)
    pile = shuffle(
      used.filter((id) => !onTable.has(id)),
      rng,
    )
    used = used.filter((id) => onTable.has(id))
    reshuffled = true
  }
  const [cardId, ...rest] = pile
  if (!cardId) throw new Error('主牌牌堆为空，不应该发生')
  return { cardId, deck: rest, discard: [...used, cardId], reshuffled }
}
