/**
 * 三国杀战术手牌（V1.5 规则书"5. 三国杀手牌"）。手牌上限 3。
 *
 * playMode：
 * - active：本回合战术阶段主动打出（杀、顺手牵羊）。
 * - response：只能作为响应使用（桃：在喝酒提醒上使用，取消 1 口）。
 * - pending：规则书有名称/效果，但需要的响应窗口还没实现（闪、无懈可击），
 *   或规则书本身没写效果（过河拆桥），暂不能打出。
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
    description: '取消一次"杀"对你的效果——需要在被杀的瞬间响应，响应窗口尚未实现，暂不能打出',
    ruleStatus: 'confirmed',
    playMode: 'pending',
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
    description: '取消任意手牌作用——需要响应窗口，尚未实现，暂不能打出',
    ruleStatus: 'confirmed',
    playMode: 'pending',
    requiresTarget: false,
    copies: 4,
  },
  { id: 'tactic-shunshou', name: '顺手牵羊', description: '从左边或右边相邻玩家那里拿走 1 金币', ruleStatus: 'confirmed', playMode: 'active', requiresTarget: true, copies: 4 },
  { id: 'tactic-guohe', name: '过河拆桥', description: '规则待确认：原稿只写了"？"，暂不能打出', ruleStatus: 'pending', playMode: 'pending', requiresTarget: false, copies: 4 },
]

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
