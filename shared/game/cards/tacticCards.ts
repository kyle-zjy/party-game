/**
 * 三国杀战术手牌（V1.5 规则书第五部分，"可随时使用"）。
 *
 * 手牌上限 3（见 `shared/constants.ts` 没有定义这个值——这是游戏内手牌，
 * 和大厅人数常量无关，常量定义在 `shared/game/types.ts` 的使用处就地写明）。
 *
 * 5 张牌里 4 张规则书给出了明确数值和效果（杀/闪/桃/无懈可击/顺手牵羊），
 * 按原文录入为 `confirmed`；"过河拆桥"原文只有一个问号，没有任何效果说明，
 * 标记为 `pending`——本轮**不允许房主之外的人主动打出**这张牌，打出请求会被
 * 引擎拒绝并提示"规则待确认"，不会被悄悄实现成某种猜测的效果。
 */
import type { TacticCardDef } from './types'

export const TACTIC_HAND_LIMIT = 3

export const TACTIC_CARDS: TacticCardDef[] = [
  { id: 'tactic-sha', name: '杀', description: '指定任意 1 人喝 1 口', ruleStatus: 'confirmed', requiresTarget: true },
  {
    id: 'tactic-shan',
    name: '闪',
    description: '原稿效果"取消一次杀对你的效果"是一张响应牌，需要在别人对你出杀的瞬间打出；本轮没有实现这种即时响应窗口，暂不支持主动打出',
    ruleStatus: 'pending',
    requiresTarget: false,
  },
  { id: 'tactic-tao', name: '桃', description: '指定 1 人，救他 +1 金币（原稿"取消自己 1 口"是线下自我豁免，不需要数字化）', ruleStatus: 'confirmed', requiresTarget: true },
  {
    id: 'tactic-wuxie',
    name: '无懈可击',
    description: '原稿效果"取消任意手牌作用"需要一个正在发生的具体动作才能取消；本轮没有实现响应窗口，暂不支持主动打出',
    ruleStatus: 'pending',
    requiresTarget: false,
  },
  { id: 'tactic-shunshou', name: '顺手牵羊', description: '从左边或右边玩家那里拿走 1 金币', ruleStatus: 'confirmed', requiresTarget: true },
  { id: 'tactic-guohe', name: '过河拆桥', description: '规则待确认：原稿只写了"？"，具体效果未定稿，暂不允许主动施放', ruleStatus: 'pending', requiresTarget: false },
]

export function getTacticCard(id: string): TacticCardDef {
  const card = TACTIC_CARDS.find((c) => c.id === id)
  if (!card) throw new Error(`未知的战术牌 id：${id}`)
  return card
}

/** 随机抽一张战术牌 id（不接入"抽完就不放回"的牌堆耗尽逻辑——聚会场景下视为无限牌堆，足够简化且不影响可玩性） */
export function drawRandomTacticCardId(): string {
  const idx = Math.floor(Math.random() * TACTIC_CARDS.length)
  const card = TACTIC_CARDS[idx]
  if (!card) throw new Error('战术牌堆为空，不应该发生')
  return card.id
}
