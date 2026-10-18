/**
 * 卡牌系统的通用类型，三类牌（小姐主牌、三国杀战术牌、世界塔罗）共用同一套
 * 形状，方便以后扩展阿瓦隆/德州相关卡牌时复用同一套"卡面展示 + 效果处理器"
 * 的数据驱动模式，而不是每种牌各写一套平行的 UI 逻辑。
 *
 * 【规则来源纪律】这里的 `ruleStatus: 'confirmed'` 表示规则书原文有明确的
 * 触发条件、目标和结算方式，可以放心自动结算；`'pending'` 表示规则书只有
 * 名称或写了"？"，本文件**不编造**效果，`effect` 会产出一个
 * `PendingDecision`（HOST_RULING）交给房主现场裁定，不会被伪装成"已实现"。
 */
import type { ErrorCode } from '../../errors'

export type CardRuleStatus = 'confirmed' | 'pending'

export interface LadyCardDef {
  id: string
  /** A-K，用于德国心脏病花色/数量映射 */
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'
  name: string
  /** 面向玩家的说明文案；pending 状态下展示"规则待确认"提示 */
  description: string
  ruleStatus: CardRuleStatus
  /** 德国心脏病计数：A/6/J=1；2/7/Q=2；3/8/K=3；4/9=4；5/10=5（10 没有心脏病映射，规则书未提供花色，这里按点数本身降级处理，见文件尾注释） */
  heartAttackCount: number
}

export interface TacticCardDef {
  id: string
  name: string
  description: string
  ruleStatus: CardRuleStatus
  requiresTarget: boolean
}

export interface TarotCardDef {
  id: string
  romanNumeral: string
  name: string
  nameEn: string
  description: string
  /** 'instant' 翻出时立即结算一次；'continuous' 在替换前持续生效（本轮不接入实际的持续效果判定，仅展示） */
  effectTiming: 'instant' | 'continuous'
}

export const CARD_ERROR_CODE: ErrorCode = 'INVALID_GAME_ACTION'
