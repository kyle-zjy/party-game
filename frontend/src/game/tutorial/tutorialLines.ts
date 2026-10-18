/**
 * "今晚的主持人"——贯穿全程的情境式教学文案。
 *
 * 设计原则（对应用户需求"全程新手引导"）：
 * - 每条文案都要能回答"发生了什么 / 我需要做什么 / 为什么 / 完成后会怎样"
 *   这四类信息中至少前两类，关键步骤四类都写全。
 * - 文案是纯数据（字符串/函数），不含任何状态变更逻辑——会不会显示、
 *   显示哪一条，由 `frontend/src/game/useGameController.ts` 根据当前
 *   `GameState` 算出来，这里只负责"说什么"。
 * - 语气：轻松、幽默、但准确——不能为了幽默牺牲"说清楚下一步要点哪里"。
 */
import type { TurnPhase } from '../../../../shared/game/types'

export interface HostLine {
  /** 一句话摘要，气泡里的主文案 */
  message: string
  /** 可选的补充说明（为什么/完成后会怎样），教学层展开时显示 */
  detail?: string
}

export const WELCOME_LINE: HostLine = {
  message: '欢迎来到今夜别想下桌！你有 5 枚金币、1 张战术牌和 2 张德州底牌。',
  detail: '今晚的目标很简单：一路冒险，掷骰子往前走，买地产、翻主牌、斗战术牌，最终比谁得分最高。全程跟着我的提示走就行，不用提前背规则。',
}

export function hostLineForMyTurn(phase: TurnPhase, extraRollPending: boolean): HostLine {
  if (phase === 'ROLLING' && extraRollPending) {
    return {
      message: '今晚手气爆棚！再摇一次骰子——这次只结算落点，不用再翻主牌。',
      detail: '自然 6 送你一次额外行动，但规则书没写"额外骰子又摇出 6 要不要继续连锁"，摇到的话会交给房主现场定。',
    }
  }
  switch (phase) {
    case 'ROLLING':
      return {
        message: '到你表演了！点击下方骰子，决定你的命运。',
        detail: '点一下就会摇出 1-6 点，棋子会按点数顺时针走这么多格。',
      }
    case 'LANDING':
      return {
        message: '看看你踩到了哪里，先把这里的效果处理完才能继续。',
        detail: '金币变化、买地产、喝酒之类的格子效果会先弹出来，处理完才会进入下一步。',
      }
    case 'LADY_CARD':
      return {
        message: '移动结束！现在翻一张小姐牌。别担心，牌的效果会自动为你解释。',
        detail: '系统会先看看最近 5 张牌会不会凑出"德国心脏病"，有的话全桌都要反应。',
      }
    case 'TACTIC':
      return {
        message: '你的回合快结束了。要不要出一张战术牌搞点事情？',
        detail: '可以指定别人喝酒、顺走金币，也可以什么都不做，直接点"结束回合"。',
      }
    default:
      return { message: '轮到你了。' }
  }
}

export function hostLineForWatching(currentNickname: string, phase: TurnPhase): HostLine {
  const action: Record<TurnPhase, string> = {
    ROLLING: '准备掷骰子',
    LANDING: '正在结算落点',
    LADY_CARD: '正在翻主牌',
    TACTIC: '正在考虑要不要出牌',
  }
  return {
    message: `现在轮到 ${currentNickname}，看看他今晚会闯什么祸。`,
    detail: `${currentNickname} ${action[phase]}，下一步会自动同步给你，不用刷新页面。`,
  }
}

export function hostLineForLanding(cellLabel: string, effectText: string): HostLine {
  return {
    message: `你来到了「${cellLabel}」，先完成这里的效果。`,
    detail: effectText,
  }
}

export const HOST_LINE_BUY_PROPERTY: HostLine = {
  message: '这是一块还没有主人的地产，花几枚金币可以买下它。',
  detail: '买下之后，以后别人踩中这里就要向你付租金；同色地产集齐 3 块，租金会更高。不买也没关系，下次路过别人说不定也没买。',
}

export const HOST_LINE_DRINK_ACK: HostLine = {
  message: '这个格子要喝酒——线下自己决定怎么处理，点一下确认就行。',
  detail: '已完成 / 以水代替 / 跳过，三选一都可以，不强迫喝酒，房主也可以代你确认。',
}

export const HOST_LINE_TRUTH_OR_DARE: HostLine = {
  message: '真心话大冒险，二选一，线下回答/完成后点一下确认。',
  detail: '不做/不答的话规则书写的是"上缴自身 1/2 资产+喝半杯"，这部分线下自行执行。',
}

export const HOST_LINE_HOST_RULING: HostLine = {
  message: '这个效果规则书没写清楚，交给房主现场定一下吧。',
  detail: '这不是系统的缺陷——原始规则书这里确实只写了关键词或者问号，系统不会替你编一套规则，房主拍板之后点"确认裁定"继续。',
}

export const HOST_LINE_HEART_ATTACK: HostLine = {
  message: '德国心脏病触发了！全桌反应，看谁先喊出来。',
  detail: '5 秒轮询不适合判断毫秒级的抢答顺序，所以这一步由房主现场确认谁是第一个反应的人，系统只负责提醒触发了。',
}

export function hostLineForEndTurn(nextNickname: string): HostLine {
  return {
    message: `本回合结束，交给 ${nextNickname}。`,
    detail: '你的金币、地产和手牌都已经保存，刷新页面也不会丢。',
  }
}

export const QUICK_START_STEPS: HostLine[] = [
  { message: '① 轮到你时，点骰子——系统会算好点数，棋子自动走过去。' },
  { message: '② 落地之后，先处理这个格子的效果（买地产/喝酒/金币变化……）。' },
  { message: '③ 翻一张小姐牌，看看写了什么——规则不清楚的会标"待房主裁定"。' },
  { message: '④ 要不要出一张战术牌？可以跳过。' },
  { message: '⑤ 点"结束回合"，交给下一位。整个流程就这样循环下去。' },
]

/** 格子/事件类型第一次出现时的详细说明——点进"帮助"或格子详情时展示，不打断正在进行的回合 */
export const EVENT_KIND_EXPLANATIONS: Record<string, string> = {
  coin: '获得（或支付）一定数量的金币，自动结算，不需要你做任何操作。',
  forward: '额外往前走若干格——会触发新落点的格子效果，但不会再触发一次"经过起点"的奖励判断。',
  back: '往后退若干格——同样会触发新落点的效果。',
  drinkSelf: '你自己需要喝酒——线下自行处理，系统里点一下"已完成/以水代替/跳过"确认就行。',
  drinkPrev: '上家（轮到你之前行动的那位）需要喝酒，系统会给对方发一条待确认提醒，不卡住你的回合。',
  drinkNext: '下家（轮到你之后行动的那位）需要喝酒，同样不卡住你的回合。',
  drinkTarget: '你可以指定任意一位玩家喝酒。',
  truthOrDare: '真心话大冒险，二选一，线下回答/完成。',
  changeTarot: '更换当前生效的世界塔罗——房主现场抽一张新的公布给大家。',
  drawTacticCard: '抽一张战术手牌（手牌上限 3 张，满了就抽不了）。',
  pendingRuling: '这个格子的具体效果规则书没有写清楚，系统不会猜，交给房主现场裁定。',
  property: '地产格——没人买就可以花 3 金币买下；别人的地产要付租金；自己的地产免费经过。',
  start: '起点——经过或停留都能获得 2 金币和 1 张战术手牌。',
}
