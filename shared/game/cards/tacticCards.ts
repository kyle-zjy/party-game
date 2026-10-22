/**
 * 三国杀战术手牌（V1.5 规则书"5. 三国杀手牌"）。手牌上限 3。
 *
 * playMode（V1.6 房间）：
 * - active：本回合战术阶段主动打出（杀、顺手牵羊、过河拆桥），打出后进入统一响应窗口（engine/tacticStack.ts）。
 * - response：只能作为响应使用（闪：响应针对自己的杀；无懈可击：响应任意战术牌；桃：在喝酒提醒上使用）。
 * V1.5 旧房间没有响应窗口：闪、无懈可击、过河拆桥仍不能打出（见 tacticPlayableInRoom）。
 *
 * copies：规则书写明的张数，抽牌按这个比例加权（共 36 张，视为洗回牌堆的无限牌堆）。
 */
import type { TacticCardDef } from './types'

export const TACTIC_HAND_LIMIT = 3

export const TACTIC_CARDS: TacticCardDef[] = [
  { id: 'tactic-sha', name: '杀', description: '指定任意 1 人喝 1 口', ruleStatus: 'confirmed', playMode: 'active', requiresTarget: true, copies: 10 },
  {
    id: 'tactic-shan',
    name: '闪',
    description: '响应牌：别人对你打出"杀"时使用，抵消这张杀',
    ruleStatus: 'confirmed',
    playMode: 'response',
    requiresTarget: false,
    copies: 8,
  },
  {
    id: 'tactic-tao',
    name: '桃',
    description: '响应牌：在任意一条喝酒提醒上使用，取消 1 口；救别人时你从银行得 1 金币',
    ruleStatus: 'confirmed',
    playMode: 'response',
    requiresTarget: false,
    copies: 6,
  },
  {
    id: 'tactic-wuxie',
    name: '无懈可击',
    description: '响应牌：在任何战术牌（包括另一张无懈可击）即将生效时使用，取消它',
    ruleStatus: 'confirmed',
    playMode: 'response',
    requiresTarget: false,
    copies: 4,
  },
  { id: 'tactic-shunshou', name: '顺手牵羊', description: '从左边或右边相邻玩家那里拿走 1 金币', ruleStatus: 'confirmed', playMode: 'active', requiresTarget: true, copies: 4 },
  {
    id: 'tactic-guohe',
    name: '过河拆桥',
    description: '（V1.6 数字版补充，原稿为"？"）指定任意 1 名其他玩家，随机弃掉 TA 1 张战术手牌；可以被无懈可击取消',
    ruleStatus: 'confirmed',
    playMode: 'active',
    requiresTarget: true,
    copies: 4,
  },
]

/** V1.5 旧房间没有响应窗口：闪、无懈可击、过河拆桥不能打出 */
export function tacticPlayableInRoom(cardId: string, rulesVersion: 1 | 2): boolean {
  if (rulesVersion === 2) return getTacticCard(cardId).playMode === 'active'
  return cardId === 'tactic-sha' || cardId === 'tactic-shunshou'
}

export function getTacticCard(id: string): TacticCardDef {
  const card = TACTIC_CARDS.find((c) => c.id === id)
  if (!card) throw new Error(`未知的战术牌 id：${id}`)
  return card
}

const TOTAL_COPIES = TACTIC_CARDS.reduce((sum, c) => sum + c.copies, 0)

/** 按规则书张数加权抽一张战术牌 */
export function drawRandomTacticCardId(rng: () => number = Math.random): string {
  let roll = rng() * TOTAL_COPIES
  for (const card of TACTIC_CARDS) {
    roll -= card.copies
    if (roll < 0) return card.id
  }
  return TACTIC_CARDS[TACTIC_CARDS.length - 1]!.id
}
