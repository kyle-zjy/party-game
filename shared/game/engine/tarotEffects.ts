/**
 * 世界塔罗的持续效果——每个结算点调用这里的对应函数，读取 `currentTarotId`
 * 决定数值。塔罗被替换后，下一次结算自然读到新 id，旧的持续效果立即失效，
 * 不需要任何"撤销"逻辑。
 *
 * 即时效果（恋人/命运之轮/正义/死神/审判）在 `tarotActions.ts` 里，只在
 * 塔罗被翻开的那一次动作中结算。
 */
import { computeRent, PROPERTY_FULL_SET_RENT } from '../board'
import type { GamePlayerState, GameState } from '../types'

export const TAROT_ID = {
  FOOL: 'tarot-0',
  MAGICIAN: 'tarot-1',
  HIGH_PRIESTESS: 'tarot-2',
  EMPRESS: 'tarot-3',
  EMPEROR: 'tarot-4',
  HIEROPHANT: 'tarot-5',
  LOVERS: 'tarot-6',
  CHARIOT: 'tarot-7',
  STRENGTH: 'tarot-8',
  HERMIT: 'tarot-9',
  WHEEL: 'tarot-10',
  JUSTICE: 'tarot-11',
  HANGED_MAN: 'tarot-12',
  DEATH: 'tarot-13',
  TEMPERANCE: 'tarot-14',
  DEVIL: 'tarot-15',
  TOWER: 'tarot-16',
  STAR: 'tarot-17',
  MOON: 'tarot-18',
  SUN: 'tarot-19',
  JUDGEMENT: 'tarot-20',
  WORLD: 'tarot-21',
} as const

export interface DiceModification {
  effective: number
  grantsExtraRoll: boolean
  note: string | null
}

/** 愚者 / 战车：修正移动步数与额外掷骰资格 */
export function modifyDiceRoll(tarotId: string, natural: number): DiceModification {
  if (tarotId === TAROT_ID.FOOL) {
    if (natural === 1) return { effective: 6, grantsExtraRoll: false, note: '愚者：自然 1 按 6 移动' }
    if (natural === 6) return { effective: 1, grantsExtraRoll: false, note: '愚者：自然 6 只按 1 移动，且没有额外掷骰' }
    return { effective: natural, grantsExtraRoll: false, note: null }
  }
  if (tarotId === TAROT_ID.CHARIOT) {
    const effective = Math.min(natural + 1, 6)
    return {
      effective,
      grantsExtraRoll: natural === 6,
      note: effective !== natural ? `战车：移动 +1（${natural} → ${effective}）` : '战车：已是最大值 6，不再增加',
    }
  }
  return { effective: natural, grantsExtraRoll: natural === 6, note: null }
}

/** 太阳：经过起点得 3 金币（默认 2） */
export function startPassCoins(tarotId: string): number {
  return tarotId === TAROT_ID.SUN ? 3 : 2
}

/** 世界：所有"前进 4 格"改为前进 6 格（只改 4，不影响其他前进数值） */
export function forwardSteps(tarotId: string, base: number): number {
  return tarotId === TAROT_ID.WORLD && base === 4 ? 6 : base
}

/** 力量：原"退 3 格"改为退 1 格 */
export function backSteps(tarotId: string, base: number): number {
  return tarotId === TAROT_ID.STRENGTH && base === 3 ? 1 : base
}

export type CollisionOutcome = { kind: 'toStart' } | { kind: 'back'; steps: number }

/** 碰撞：默认退回起点；力量塔罗下改为退 3 格（"不叠加"：这 3 格不再被"退3→退1"二次修正） */
export function collisionOutcome(tarotId: string): CollisionOutcome {
  return tarotId === TAROT_ID.STRENGTH ? { kind: 'back', steps: 3 } : { kind: 'toStart' }
}

export interface RentResult {
  rent: number
  note: string | null
}

/**
 * 高塔：暂停收租。
 * 皇帝（Q1，2026-10 正式确认）：地产主人集齐该色三处时，租金由 3 金提升为 4 金；
 * 未集齐时不变，也不影响购买价格。
 */
export function rentForLanding(tarotId: string, ownerProperties: string[], propertyName: string): RentResult {
  if (tarotId === TAROT_ID.TOWER) return { rent: 0, note: '高塔：所有地产暂停收租' }
  const base = computeRent(ownerProperties, propertyName)
  if (tarotId === TAROT_ID.EMPEROR && base === PROPERTY_FULL_SET_RENT) {
    return { rent: EMPEROR_FULL_SET_RENT, note: `皇帝：集齐同色三处，租金 ${PROPERTY_FULL_SET_RENT} → ${EMPEROR_FULL_SET_RENT} 金` }
  }
  return { rent: base, note: null }
}

export const EMPEROR_FULL_SET_RENT = 4

/** 星星：心脏病第一反应者得 2 金币（默认 1） */
export function heartAttackReward(tarotId: string): number {
  return tarotId === TAROT_ID.STAR ? 2 : 1
}

/** 真心话大冒险：女祭司只能选真心话、倒吊人只能选大冒险 */
export function allowedTruthOrDareChoices(tarotId: string): Array<'TRUTH' | 'DARE'> {
  if (tarotId === TAROT_ID.HIGH_PRIESTESS) return ['TRUTH']
  if (tarotId === TAROT_ID.HANGED_MAN) return ['DARE']
  return ['TRUTH', 'DARE']
}

/** 完成真心话/大冒险后的银行奖励：女祭司/倒吊人/皇后均为 1 金币，三者不会同时生效 */
export function truthOrDareCompletionBonus(tarotId: string): number {
  return tarotId === TAROT_ID.HIGH_PRIESTESS || tarotId === TAROT_ID.HANGED_MAN || tarotId === TAROT_ID.EMPRESS ? 1 : 0
}

/** 魔术师：本回合第一次打出战术牌后补抽 1 张 */
export function magicianRefill(tarotId: string, alreadyPlayedThisTurn: boolean): boolean {
  return tarotId === TAROT_ID.MAGICIAN && !alreadyPlayedThisTurn
}

/** 节制（V1.6 补充 Q5）：游戏机制里的挡酒/免罚效果失效——桃、A 替喝、骗子酒馆吹牛免罚。以水代替和跳过不受影响 */
export function drinkExemptionsDisabled(tarotId: string): boolean {
  return tarotId === TAROT_ID.TEMPERANCE
}

/** 隐者：回合开始时独自占据一个格子，得 1 金币 */
export function hermitBonus(tarotId: string, state: GameState, uid: string): number {
  if (tarotId !== TAROT_ID.HERMIT) return 0
  const me = state.players[uid]
  if (!me) return 0
  const sharing = Object.values(state.players).some((p) => p.uid !== uid && p.position === me.position)
  return sharing ? 0 : 1
}

export interface BankPayout {
  uid: string
  amount: number
}

/**
 * 从银行给玩家发金币，统一经过这里结算恋人塔罗：绑定的两人中任一人从银行得金币时，
 * 另一人也得 1 金币。转账（租金、顺手牵羊）不是"从银行获得"，不走这里。
 * 恋人的连带奖励本身不再触发连带，避免无限循环。
 */
export function payFromBank(
  state: GameState,
  players: Record<string, GamePlayerState>,
  uid: string,
  amount: number,
): BankPayout[] {
  const payouts: BankPayout[] = []
  if (amount <= 0) return payouts
  const target = players[uid]
  if (!target) return payouts
  target.coins += amount
  payouts.push({ uid, amount })

  const pair = state.tarotState.loversPair
  if (state.currentTarotId === TAROT_ID.LOVERS && pair && pair.includes(uid)) {
    const partnerUid = pair[0] === uid ? pair[1] : pair[0]
    const partner = players[partnerUid]
    if (partner) {
      partner.coins += 1
      payouts.push({ uid: partnerUid, amount: 1 })
    }
  }
  return payouts
}

/** 当前塔罗对各系统的持续影响，给 HUD"当前生效规则"面板使用 */
export function activeTarotImpacts(tarotId: string): string[] {
  switch (tarotId) {
    case TAROT_ID.FOOL:
      return ['掷骰：自然 1 → 移动 6 格', '掷骰：自然 6 → 只移动 1 格，没有额外掷骰']
    case TAROT_ID.MAGICIAN:
      return ['战术牌：每回合第一次打出后自动补抽 1 张（上限 3）']
    case TAROT_ID.HIGH_PRIESTESS:
      return ['真心话大冒险：只能选真心话', '完成后从银行得 1 金币']
    case TAROT_ID.EMPRESS:
      return ['真心话大冒险：完成后从银行得 1 金币']
    case TAROT_ID.EMPEROR:
      return ['地产：集齐同色三处的租金从 3 金提高到 4 金（未集齐不变）']
    case TAROT_ID.HIEROPHANT:
      return ['禁令：正确抓到说"为什么"的人，得 2 金币（平时 1 金币）']
    case TAROT_ID.LOVERS:
      return ['绑定的两人：一人从银行得金币时，另一人也得 1 金币']
    case TAROT_ID.CHARIOT:
      return ['掷骰：移动 +1（最大 6）', '只有自然 6 才有额外掷骰']
    case TAROT_ID.STRENGTH:
      return ['碰撞：被撞者不再退回起点，改为后退 3 格', '"后退 3 格"格子：改为后退 1 格', '两项独立生效，不叠加']
    case TAROT_ID.HERMIT:
      return ['回合开始时独自占据一格：从银行得 1 金币']
    case TAROT_ID.HANGED_MAN:
      return ['真心话大冒险：只能选大冒险', '完成后从银行得 1 金币']
    case TAROT_ID.TEMPERANCE:
      return ['桃、替喝、吹牛免罚暂时失效；以水代替和跳过仍然可以']
    case TAROT_ID.DEVIL:
      return ['被判 1 口：可改为付 1 金币并指定另一人喝 2 口']
    case TAROT_ID.TOWER:
      return ['地产：全部暂停收租']
    case TAROT_ID.STAR:
      return ['德国心脏病：第一反应者得 2 金币']
    case TAROT_ID.MOON:
      return ['骗子酒馆：质疑胜者额外得 1 金币（骗子酒馆模块未实现）']
    case TAROT_ID.SUN:
      return ['起点：经过得 3 金币']
    case TAROT_ID.WORLD:
      return ['"前进 4 格"格子：改为前进 6 格']
    case TAROT_ID.WHEEL:
    case TAROT_ID.JUSTICE:
    case TAROT_ID.DEATH:
    case TAROT_ID.JUDGEMENT:
      return ['即时效果，翻开时已结算，没有持续影响']
    default:
      return []
  }
}
