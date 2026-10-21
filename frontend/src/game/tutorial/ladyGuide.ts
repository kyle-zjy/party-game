/**
 * 小姐牌事件的分步中文指引："现在在哪一步 / 在等谁 / 我要做什么"。
 * 纯文案函数，不改任何游戏状态——教学文案永远不会影响真实结算。
 */
import { getLadyCard, KING_GUIDE } from '../../../../shared/game/cards/ladyCards'
import { isLadyRuleActive } from '../../../../shared/game/engine/ladyEvents'
import type { GameState, LadyEvent } from '../../../../shared/game/types'

export function ladyCardDisplayName(cardId: string): string {
  const card = getLadyCard(cardId)
  return card.candidate?.name ?? card.name
}

/** 规则状态标签：正式 / 候选（本局预览启用）/ 候选（未启用，房主裁定） */
export function ladyRuleLabel(game: Pick<GameState, 'ladyRuleset'>, cardId: string): string {
  const card = getLadyCard(cardId)
  if (card.ruleStatus === 'confirmed') return '正式规则'
  return isLadyRuleActive(game, card) ? '候选规则 · 开发预览' : '候选规则 · 未启用'
}

/** 当前步骤需要谁操作（用于"等待 X"） */
export function ladyEventWaitingOn(ev: LadyEvent, hostUid: string | null): string[] {
  switch (ev.step) {
    case 'START':
    case 'LUCKY_ROLL':
    case 'CHOOSE_TARGET':
    case 'KING_WRITE':
      return [ev.actingUid]
    case 'HOST_RESULT':
    case 'KING_PERFORM':
      return hostUid ? [hostUid] : []
    case 'DUEL_ROLL': {
      const round = ev.duelRounds[ev.duelRounds.length - 1]
      const waiting: string[] = []
      if (round?.actorRoll === null) waiting.push(ev.actingUid)
      if (round?.targetRoll === null && ev.targetUid) waiting.push(ev.targetUid)
      return waiting
    }
    default:
      return []
  }
}

/** 一句话说明这一步在做什么（所有人都看得到） */
export function ladyEventStepText(game: GameState, ev: LadyEvent, nicknameOf: (uid: string) => string): string {
  const actor = nicknameOf(ev.actingUid)
  switch (ev.step) {
    case 'START':
      if (ev.rank === '3') return `${actor} 正在选择逛三园的主题。`
      if (ev.rank === '4') return `${actor} 准备喊"咔嚓"，全桌准备定格！`
      return `${actor} 准备开始数五，从 TA 开始报"1"。`
    case 'HOST_RESULT':
      if (ev.rank === '3') return `主题：${ev.text ?? '口头公布'}。从 ${actor} 的下家开始轮流回答，房主确认第一位失败者。`
      if (ev.rank === '4') return '全桌定格中！第一个动或笑出声的人失败，房主确认结果。'
      return '正在报数：5 的倍数拍桌子。房主确认失败者，或者报到 30 没人出错。'
    case 'LUCKY_ROLL':
      return `${actor} 掷一次幸运七事件骰：6 点得 2 金币，1 点喝 1 口。`
    case 'CHOOSE_TARGET':
      return `${actor} 正在选择决斗对手。`
    case 'DUEL_ROLL':
      return `${actor} 和 ${ev.targetUid ? nicknameOf(ev.targetUid) : '对手'} 决斗第 ${ev.duelRounds.length} 轮，各掷一颗骰子。`
    case 'KING_PERFORM': {
      const creator = game.kingTask?.creatorUid
      return `${KING_GUIDE.received}${creator ? `（来自上一任国王 ${nicknameOf(creator)}）` : ''}${KING_GUIDE.perform}`
    }
    case 'KING_WRITE':
      return ev.result ? `${KING_GUIDE.write}` : KING_GUIDE.first
    default:
      return ev.result?.summary ?? ''
  }
}
