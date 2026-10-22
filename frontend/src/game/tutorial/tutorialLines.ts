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
import type { GameState, TurnPhase } from '../../../../shared/game/types'
import { getTarotCard } from '../../../../shared/game/cards/tarotCards'
import { TAROT_ID } from '../../../../shared/game/engine/tarotEffects'
import { getLadyCard } from '../../../../shared/game/cards/ladyCards'
import { getTacticCard } from '../../../../shared/game/cards/tacticCards'
import { riverGodUid } from '../../../../shared/game/engine/zones'

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
      detail: '自然 6 送你一次额外掷骰（愚者塔罗下没有）。额外这一次就算又摇出 6，也不会再加第三次。',
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
        detail: '系统会先看看最近 5 张牌会不会凑出"德国心脏病"，有的话全桌都要反应。有些牌（比如 K 国王）需要你继续操作，跟着面板提示走就行。',
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

export const HOST_LINE_BUY_PROPERTY: HostLine = {
  message: '这是一块还没有主人的地产，花几枚金币可以买下它。',
  detail: '买下之后，以后别人踩中这里就要向你付租金；同色地产集齐 3 块，租金会更高。不买也没关系，下次路过别人说不定也没买。',
}

export const HOST_LINE_HOST_RULING: HostLine = {
  message: '这个效果规则书没写清楚，交给房主现场定一下吧。',
  detail: '这不是系统的缺陷——原始规则书这里确实只写了关键词或者问号，系统不会替你编一套规则，房主拍板之后点"确认裁定"继续。',
}

export const QUICK_START_STEPS: HostLine[] = [
  { message: '① 轮到你时，点骰子——系统会算好点数，棋子自动走过去。' },
  { message: '② 落地之后，先处理这个格子的效果（买地产/喝酒/金币变化……）。' },
  { message: '③ 翻一张小姐牌，按面板提示完成它的小游戏或效果。' },
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
  skipRoll: '停骰一次（V1.6 补充）：你的下一个回合不掷骰、不移动，但照常翻小姐牌和出战术牌。不会累积超过一次。',
  nextSkipRoll: '下家禁骰（V1.6 补充）：你的下家下一个回合不掷骰、不移动，但照常翻小姐牌和出战术牌。不会累积超过一次。',
  texasPot: '德州+1 / 德扑+1（V1.6 补充）：银行向德州公共底池投 1 金币（不扣你的钱），并触发一次 CASINO：依次翻 Flop / Turn / River 并摊牌。',
  avalonMission: '发车任务：触发阿瓦隆任务，你当车主，按人数表选乘客，乘客秘密提交任务结果。',
  property: '地产格——没人买就可以花 3 金币买下；别人的地产要付租金；自己的地产免费经过。',
  start: '起点——经过或停留都能获得 2 金币和 1 张战术手牌。',
}

/**
 * 根据当前共享游戏状态给出主持人提示：发生了什么 → 需要谁做什么 → 为什么 → 下一步。
 * 优先级：等待中的决定 > 当前阶段；塔罗正在影响这一步时把影响写进提示。
 */
export function contextualHostLine(game: GameState, myUid: string, isHost: boolean, nicknameOf: (uid: string) => string): HostLine {
  const isMyTurn = game.turn.currentPlayerUid === myUid
  const current = nicknameOf(game.turn.currentPlayerUid)
  const tarot = getTarotCard(game.currentTarotId)
  const decision = game.turn.pendingDecision

  const name = (uid: string) => (uid === myUid ? '你' : nicknameOf(uid))

  if (game.endgame) {
    return game.endgame.phase === 'DONE'
      ? { message: '游戏结束！看看最终排行榜。', detail: '得分 = 抵达终点 10 + 金币 + 地产 ×2 + 有效完整同色套装 ×2。结果已经固定，不会再变化。' }
      : {
          message: '有人抵达终点！地图回合结束，正在完成德州和阵营结算。',
          detail: '德州已经补齐公共牌摊牌；阿瓦隆还没分出胜负的话继续发车，车主按行动顺序轮换。阵营结算后自动计分。',
        }
  }

  if (game.tacticStack) {
    const st = game.tacticStack
    const card = getTacticCard(st.originKind).name
    const iAwait = st.awaiting.includes(myUid)
    return {
      message: iAwait ? `${name(st.sourceUid)} 打出了「${card}」，你可以响应！` : `${name(st.sourceUid)} 对 ${name(st.targetUid)} 打出了「${card}」，等待响应。`,
      detail: '闪只能抵消针对自己的杀；无懈可击可以取消任何战术牌（包括另一张无懈可击）。所有人都放弃后从最后打出的牌往前结算。响应不占本回合主动出牌的次数。',
    }
  }

  if (game.texas.betting?.awaiting.includes(myUid)) {
    const b = game.texas.betting
    return {
      message: `德州 ${b.stage} 下注轮到你表态！`,
      detail: b.betUid ? '已经有人下注 1 金币，你可以跟注 1 金币或弃牌。弃牌后本周期不再参加摊牌。' : '还没人下注：可以过牌，也可以下注 1 金币。每人每阶段最多投入 1 金币，不能反复加注。',
    }
  }

  const mission = game.avalon.active
  if (mission) {
    if (mission.step === 'PICK') {
      return mission.leaderUid === myUid
        ? { message: `阿瓦隆任务开始！你是车主，需要选择 ${mission.size} 名乘客。`, detail: '可以选自己。乘客会秘密提交 SUCCESS 或 FAIL，出现 1 张 FAIL 任务就失败。' }
        : { message: `阿瓦隆任务开始！车主 ${name(mission.leaderUid)} 需要选择 ${mission.size} 名乘客。`, detail: '你是否被选中，将决定你接下来看到的操作。' }
    }
    if (mission.passengers.includes(myUid) && !mission.votes[myUid]) {
      return { message: '你在阿瓦隆的车上，请秘密提交任务结果。', detail: '好人只能交 SUCCESS；坏人可以交 SUCCESS 或 FAIL。全部提交后只公开是否成功和 FAIL 张数。' }
    }
  }

  const ev = game.ladyEvent
  if (ev && ev.status === 'ACTIVE') {
    const card = getLadyCard(ev.cardId)
    const name = card.candidate?.name ?? card.name
    const actor = ev.actingUid === myUid ? '你' : nicknameOf(ev.actingUid)
    if (ev.rank === 'K') {
      return ev.step === 'KING_PERFORM'
        ? { message: `${actor === '你' ? '你' : actor} 成为新国王！上一任国王留下了一个挑战。`, detail: '新国王线下完成挑战后由房主确认；不想做可以跳过，不扣金币、不罚酒。之后新国王给下一任留下新任务。' }
        : {
            message: ev.result ? `${actor === '你' ? '现在轮到你' : `现在轮到 ${actor}`}为下一任国王留下任务。` : `${actor === '你' ? '恭喜你' : actor}成为第一任国王！`,
            detail: '任务会保存在房间里，下一位翻到 K 的人要执行它（同一个人再翻到 K 也一样）。只写线下轻松的挑战，不能有危险、侮辱、隐私、身体接触或强制喝酒的内容。',
          }
    }
    return { message: `小姐牌「${name}」进行中。`, detail: `${card.candidate?.guide.join(' → ') ?? ''}（翻牌者：${actor}）` }
  }

  if (decision?.kind === 'RIVER_CROSS') {
    const god = riverGodUid(game)
    return isMyTurn
      ? {
          message: god ? `你来到河边！现在的河神是 ${name(god)}，可以过桥或渡河。` : '你来到河边！现在没有河神，只能过桥。',
          detail: '过桥付 1 金币，桥长 13 格，桥上每次掷骰喝 2 口；渡河由你和河神各掷一颗骰子判定，相抵时看神谕骰。',
        }
      : { message: `${current} 来到河边，正在选择过桥${god ? '或渡河' : ''}。`, detail: '渡河判定的骰子由系统掷出，所有人看到同一个结果。' }
  }
  if (decision?.kind === 'ENTER_GODS') {
    return isMyTurn
      ? { message: '你来到神鬼道入口！要进去吗？', detail: '恰好停在终点才算抵达（+10 分并触发终局）。天堂每次掷骰 +1 金币，地狱每次 −1。神鬼道里离终点最近的人是河神。' }
      : { message: `${current} 来到神鬼道入口，正在决定是否进入。`, detail: '进入神鬼道的人会影响谁是河神。' }
  }

  if (decision?.kind === 'CHOOSE_LOVERS') {
    return isMyTurn
      ? {
          message: '恋人塔罗翻开了！请指定两名玩家"绑定"。',
          detail: '绑定后，只要其中一人从银行拿到金币（起点、金币格、审判、心脏病奖励等），另一人也自动得 1 金币。换掉恋人塔罗后绑定解除。选好后回合继续。',
        }
      : { message: `恋人塔罗翻开了，${current} 正在指定两名玩家绑定。`, detail: '被绑定的两人以后从银行得金币时会互相带上 1 金币，界面会自动显示绑定对象。' }
  }
  if (decision?.kind === 'TAROT_JUSTICE') {
    return isHost
      ? {
          message: '正义塔罗：请全桌依次剪刀石头布，然后录入大众赢家和大众输家。',
          detail: '两人交换座位：手牌和金币跟着座位走，地产和德州底牌留在本人名下。录入后回合继续；平局可以选"无人交换"。',
        }
      : { message: '正义塔罗：全桌线下依次剪刀石头布！', detail: '房主会录入大众赢家和大众输家，两人交换座位、手牌和金币。' }
  }
  if (decision?.kind === 'TRUTH_OR_DARE') {
    const limit =
      game.currentTarotId === TAROT_ID.HIGH_PRIESTESS ? '女祭司生效中，只能选真心话。' : game.currentTarotId === TAROT_ID.HANGED_MAN ? '倒吊人生效中，只能选大冒险。' : ''
    return isMyTurn
      ? { message: `真心话大冒险！${limit}`, detail: '选好后线下完成，再点"已完成"。不做/不答要交出一半金币并喝半杯。' }
      : { message: `${current} 正在真心话大冒险。${limit}`, detail: '一起监督 TA 完成吧，完成后会自动继续。' }
  }
  if (decision?.kind === 'HOST_RULING') {
    return {
      message: isHost ? '这一步规则书没写清楚，需要你作为房主现场裁定。' : '这一步规则书没写清楚，等房主现场裁定。',
      detail: `需要执行的人：${current}。房主宣布裁定、线下执行完后点"确认"，回合继续。系统不会擅自编规则。`,
    }
  }
  if (decision?.kind === 'BUY_PROPERTY') {
    return isMyTurn
      ? { ...HOST_LINE_BUY_PROPERTY, detail: `${HOST_LINE_BUY_PROPERTY.detail}${game.currentTarotId === TAROT_ID.TOWER ? '注意：高塔生效中，暂时收不到租金。' : ''}` }
      : { message: `${current} 正在考虑要不要买下这块地产。`, detail: '买下后，其他人踩中要付租金。' }
  }
  if (decision?.kind === 'CHOOSE_DRINK_TARGET') {
    return isMyTurn
      ? { message: `你可以指定一名玩家喝 ${decision.amount} 口。`, detail: '选好后对方会收到喝酒提醒，由 TA 或房主确认，不会卡住你的回合。' }
      : { message: `${current} 正在挑选谁来喝 ${decision.amount} 口……`, detail: '被点名的人会看到提醒。' }
  }

  if (!isMyTurn) return hostLineForWatching(current, game.turn.phase)

  const me = game.players[myUid]
  if (game.turn.phase === 'ROLLING' && !game.turn.extraRollPending && me?.skipNextRoll) {
    return { message: '你本回合停骰：不掷骰、不移动。', detail: '点"停骰：直接翻主牌"，照常翻小姐牌，也照常可以出 1 张战术牌。结束回合后停骰状态清除。' }
  }
  if (game.turn.phase === 'ROLLING' && me?.zone.kind === 'gods') {
    const god = riverGodUid(game)
    return { message: '你在神鬼道上，掷骰继续走向终点。', detail: `恰好停在终点才算抵达；走过头会穿过终点去往另一侧。${god === myUid ? '你现在是河神。' : ''}天堂 +1 金币 / 地狱 −1 金币以掷骰前所在的位置为准。` }
  }
  if (game.turn.phase === 'ROLLING' && me?.zone.kind === 'bridge') {
    return { message: `你在桥上（${me.zone.step}/13），掷骰继续过桥。`, detail: '桥上每次掷骰喝 2 口（可以以水代替或跳过），走完 13 格到达对岸。' }
  }

  const base = hostLineForMyTurn(game.turn.phase, game.turn.extraRollPending)
  if (game.turn.phase === 'ROLLING' && (game.currentTarotId === TAROT_ID.FOOL || game.currentTarotId === TAROT_ID.CHARIOT)) {
    return { message: base.message, detail: `${tarot.name}生效中：${tarot.description}掷完后会显示修正前后的步数。` }
  }
  if (game.turn.phase === 'LANDING' && game.turn.lastRoll?.tarotNote) {
    return { message: `${game.turn.lastRoll.tarotNote}，实际移动 ${game.turn.lastRoll.effective} 格。`, detail: base.detail }
  }
  return base
}
