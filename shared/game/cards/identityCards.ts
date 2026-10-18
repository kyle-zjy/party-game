/**
 * 开局身份牌——V1.5 规则书写明"每人 1 张身份牌"，但具体身份种类、阵营平衡
 * 只在阿瓦隆章节（第七部分）里间接提到"好人/坏人"，且明确说"未指定适配
 * 3–10 人的阵营身份配置"（规则书"第五部分"待确认清单）。
 *
 * 【本轮处理方式】不擅自发明一套完整的阵营身份表。开局只发一张中性的
 * "访客"占位身份牌，仅做展示（证明"每人有一张身份牌"这个数据结构存在），
 * 不接入阿瓦隆的好人/坏人判定、不影响任何结算。等房主/规则后续补完
 * 3–10 人的阵营配置表，再把真正的阵营身份接进来。
 */
import type { CardRuleStatus } from './types'

export interface IdentityCardDef {
  id: string
  name: string
  description: string
  ruleStatus: CardRuleStatus
}

export const PLACEHOLDER_IDENTITY_CARD: IdentityCardDef = {
  id: 'identity-guest',
  name: '访客',
  description: '阿瓦隆阵营身份配置待房主/规则补完（规则书未给出 3–10 人的身份与人数表），本轮所有玩家持有同一张占位身份牌，不参与任何阵营判定。',
  ruleStatus: 'pending',
}
