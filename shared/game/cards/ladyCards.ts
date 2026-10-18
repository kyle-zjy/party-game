/**
 * 小姐主牌 A–K（V1.5 规则书第二部分）。
 *
 * 【诚实声明】规则书原文对这 13 张牌里的每一张都写着"〔原稿无详细说明〕"——
 * 包括看起来像是有提示的名字（比如"干杯""左边喝""右边喝"）。只有牌名/关键词
 * 是确定的，具体的触发条件、目标选择方式、完成判定方式都没有给出。
 * K 虽然多一句"指定下一位'国王'做什么"，但仍然没有说清楚"国王"能指定什么、
 * 有没有限制，同样不够具体到可以自动结算。
 *
 * 所以这里全部 13 张的 `ruleStatus` 都是 `'pending'`——翻到任何一张主牌，
 * 系统只展示牌名/关键词，然后交给房主现场裁定具体怎么执行（`HOST_RULING`），
 * 不会擅自编出一套"杀/闪/桃"那种程度的具体数值规则来冒充原版。
 *
 * 德国心脏病的数量映射（规则书"4. 德国心脏病"）是明确给出的，这部分数据
 * 独立于上面的"牌义待确认"，可以直接使用：A/6/J=1；2/7/Q=2；3/8/K=3；
 * 4/9=4；5/10=5。
 */
import type { LadyCardDef } from './types'

export const LADY_CARDS: LadyCardDef[] = [
  { id: 'lady-A', rank: 'A', name: '替我喝', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 1 },
  { id: 'lady-2', rank: '2', name: '小姐牌', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 2 },
  { id: 'lady-3', rank: '3', name: '逛三园', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 3 },
  { id: 'lady-4', rank: '4', name: '照相机', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 4 },
  { id: 'lady-5', rank: '5', name: '〔待确认〕', description: '原稿只有空白格，牌名和牌义都未定稿', ruleStatus: 'pending', heartAttackCount: 5 },
  { id: 'lady-6', rank: '6', name: '干杯', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 1 },
  { id: 'lady-7', rank: '7', name: '〔待确认〕', description: '原稿只有空白格，牌名和牌义都未定稿', ruleStatus: 'pending', heartAttackCount: 2 },
  { id: 'lady-8', rank: '8', name: '厕所牌', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 3 },
  { id: 'lady-9', rank: '9', name: '决斗', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 4 },
  { id: 'lady-10', rank: '10', name: '神经病', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 5 },
  { id: 'lady-J', rank: 'J', name: '左边喝', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 1 },
  { id: 'lady-Q', rank: 'Q', name: '右边喝', description: '牌义待确认，原稿未写明具体触发与执行方式', ruleStatus: 'pending', heartAttackCount: 2 },
  { id: 'lady-K', rank: 'K', name: '国王牌', description: '指定下一位"国王"做什么——具体能指定的范围原稿未写明，牌义待确认', ruleStatus: 'pending', heartAttackCount: 3 },
]

export function getLadyCard(id: string): LadyCardDef {
  const card = LADY_CARDS.find((c) => c.id === id)
  if (!card) throw new Error(`未知的小姐主牌 id：${id}`)
  return card
}

/**
 * 德国心脏病触发判定：只看最近 5 张主牌，累计数量恰好为 5 或 5 的倍数即触发。
 *
 * 【已知简化，非原版行为】规则书原文是"任一花色数量和"——即按 4 种花色分别
 * 累计。但这套"小姐主牌"是只有 13 种关键词、没有花色设计的自定义牌组
 * （不是标准扑克牌复用），原稿没有给出这 13 张牌对应的花色方案。
 * 在花色方案被房主/规则补完之前，这里按"最近 5 张牌的数量总和"整体判断，
 * 不区分花色——这是一个有记录的简化，不是确认过的原版规则。
 * 已经按用户要求（本阶段只做"触发识别和界面准备"，不做公平抢答）保留：
 * 触发后只记录 `PendingHeartAttack`，由房主确认第一反应者，不用 5 秒轮询
 * 的到达顺序当作抢答结果。
 */
export function checkHeartAttack(recentLadyCardIds: string[]): { triggered: boolean; count: number } {
  const window = recentLadyCardIds.slice(-5)
  const sum = window.reduce((total, id) => total + getLadyCard(id).heartAttackCount, 0)
  return { triggered: window.length === 5 && sum > 0 && sum % 5 === 0, count: sum }
}
