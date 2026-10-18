/**
 * 德州扑克底牌——标准 52 张牌，开局每人发 2 张底牌（规则书"1. 开局"）。
 *
 * 本轮只实现"开局发底牌、展示在手牌区"，不实现 CASINO 翻公共牌、加注、
 * 摊牌、梦幻拖拉机、骗子酒馆吹牛判定等后续阶段——规则书"6. 德州扑克"一节
 * 的其余流程属于规则书"第五部分"列出的待确认事项（牌型结算、分池规则
 * 未写明），本轮不擅自补完，只做数据结构和展示。
 */
export type CardSuit = 'S' | 'H' | 'D' | 'C'
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

const SUITS: CardSuit[] = ['S', 'H', 'D', 'C']
const RANKS: CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export interface TexasCardId {
  id: string
  suit: CardSuit
  rank: CardRank
}

export function buildDeck(): TexasCardId[] {
  const deck: TexasCardId[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}${rank}`, suit, rank })
    }
  }
  return deck
}

const SUIT_SYMBOL: Record<CardSuit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

export function formatTexasCard(id: string): string {
  const suit = id[0] as CardSuit
  const rank = id.slice(1) as CardRank
  return `${rank}${SUIT_SYMBOL[suit] ?? suit}`
}

/** 确定性地为一局游戏发牌：按 turnOrder 顺序每人取 2 张，用简单种子洗牌（Fisher-Yates + Math.random），不做可重放的随机数种子管理——聚会场景不需要可验证公平的洗牌证明 */
export function dealHoleCards(playerCount: number): string[][] {
  const deck = buildDeck()
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = deck[i]!
    deck[i] = deck[j]!
    deck[j] = tmp
  }
  const hands: string[][] = []
  let cursor = 0
  for (let p = 0; p < playerCount; p += 1) {
    const a = deck[cursor]!
    const b = deck[cursor + 1]!
    hands.push([a.id, b.id])
    cursor += 2
  }
  return hands
}
