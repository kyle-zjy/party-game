/**
 * Phase D.2：统一的小姐主牌事件框架。
 *
 * 翻牌（turnEngine.applyRevealLadyCard）之后，所有牌都走同一条路：
 * `startLadyEvent` 根据规则开关决定这张牌是"自动结算"还是"交给房主裁定"（旧流程）；
 * 自动结算的牌生成一条 `GameState.ladyEvent`，按 rank 进入不同的步骤：
 *
 * - 即时牌（A/2/6/8/10/J/Q）：翻开就结算，事件直接 DONE。
 * - 房主确认牌（3/4/5）：START →（翻牌者开始）→ HOST_RESULT →（房主录入输家）→ DONE。
 * - 系统判定牌（7/9）：骰子由数据库层在重试循环外掷出、写入共享状态，引擎比较结果。
 * - K 国王传承：KING_PERFORM（有上一任任务时）→ KING_WRITE → DONE。
 *
 * 事件未 DONE 时回合停在 LADY_CARD（revealedLadyCardId 已写入，不能再翻），
 * DONE 时进入 TACTIC。每个动作都带 eventId 并校验 step，重复点击、刷新重试、
 * 旧页面的过期点击都会被拒绝，不会重复结算。
 *
 * 持续状态（小姐、神经病、国王、替喝机会、暂离）放在 `GameState.ladyStatus`，
 * 国王任务放在 `GameState.kingTask`，都跟着 game_rooms 文档持久化。
 */
import { getLadyCard } from '../cards/ladyCards'
import { formatLadyCard, parseLadyCardId } from '../cards/ladyDeck'
import type { LadyCardDef } from '../cards/types'
import type { GameState, KingTask, LadyEvent, LadyEventStep, LadyRank, LadyStatus, PendingDrinkAck } from '../types'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { clonePlayers, neighborUid, pushDrinkAck, requirePlayer } from './stateHelpers'
import { drinkExemptionsDisabled, payFromBank } from './tarotEffects'

export const EMPTY_LADY_STATUS: LadyStatus = {
  mistressUid: null,
  crazyUid: null,
  kingUid: null,
  substitutePassUids: [],
  awayPassUids: [],
  away: [],
}

export const KING_TASK_MAX_LENGTH = 80
export const KING_TASK_HISTORY_LIMIT = 10
export const DUEL_MAX_ROUNDS = 3
export const LUCKY_SEVEN_REWARD = 2
/** 线下小游戏/决斗/J/Q 等候选规则的默认惩罚单位 */
export const LADY_PENALTY_SIPS = 1

/**
 * 国王任务的禁止内容：危险、侮辱、泄露隐私、强迫身体接触、强制饮酒。
 * 关键词只能挡住明显的情况，界面同时提示边界，房主也可以随时让国王跳过。
 */
const FORBIDDEN_TASK_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(喝光|干了|一口闷|灌|喝一杯|喝一瓶|吹瓶|整杯|一整瓶|罚酒|多喝)/, reason: '不能强制饮酒' },
  { pattern: /(亲|吻|摸|抱|舔|脱|裸|坐腿|搂)/, reason: '不能要求身体接触或脱衣' },
  { pattern: /(密码|手机号|电话号码|身份证|住址|银行卡|工资|聊天记录|前任.*照片)/, reason: '不能要求泄露隐私' },
  { pattern: /(打人|扇|跳楼|窗户|爬窗|阳台|刀|点火|玩火|电源|插座|飙车|喝醋|吃辣椒|憋气)/, reason: '不能要求危险动作' },
  { pattern: /(傻[逼比]|蠢货|垃圾|废物|丑八怪|死胖子|贱)/, reason: '不能包含侮辱' },
]

export function validateKingTaskContent(raw: string): { ok: true; content: string } | { ok: false; reason: string } {
  const content = raw.trim().replace(/\s+/g, ' ')
  if (content.length < 2) return { ok: false, reason: '任务至少写 2 个字' }
  if (content.length > KING_TASK_MAX_LENGTH) return { ok: false, reason: `任务最多 ${KING_TASK_MAX_LENGTH} 个字` }
  for (const rule of FORBIDDEN_TASK_PATTERNS) {
    if (rule.pattern.test(content)) return { ok: false, reason: `${rule.reason}，请换一个轻松的线下挑战` }
  }
  return { ok: true, content }
}

/**
 * 规则开关：这张牌在本局是否自动结算。
 * 已确认的牌（K）任何房间都结算；候选牌只在开发环境开局的"候选规则预览"房间结算。
 */
export function isLadyRuleActive(state: Pick<GameState, 'ladyRuleset'>, card: LadyCardDef): boolean {
  if (card.ruleStatus === 'confirmed') return true
  return state.ladyRuleset === 'candidate-preview' && card.candidate !== undefined
}

function rankOf(cardId: string): LadyRank {
  return getLadyCard(cardId).rank
}

export function isAwayWithPass(state: GameState, uid: string): boolean {
  return state.ladyStatus.away.some((a) => a.uid === uid && a.withPass)
}

function baseEvent(state: GameState, cardId: string, uid: string, now: number, step: LadyEventStep, participants: string[]): LadyEvent {
  return {
    eventId: `lady-${now}-${state.turnNumber}-${cardId}`,
    cardId,
    rank: rankOf(cardId),
    actingUid: uid,
    step,
    participants,
    targetUid: null,
    text: null,
    startedAt: null,
    rolls: [],
    duelRounds: [],
    result: null,
    status: step === 'DONE' ? 'RESOLVED' : 'ACTIVE',
    createdAt: now,
    createdAtTurn: state.turnNumber,
  }
}

function done(event: LadyEvent, loserUids: string[], summary: string): LadyEvent {
  return { ...event, step: 'DONE', status: 'RESOLVED', result: { loserUids, summary } }
}

/** 线下小游戏可以被房主选为输家的人：暂离（使用通行证）期间的玩家除外 */
function activeParticipants(state: GameState, uids: string[]): string[] {
  return uids.filter((u) => !isAwayWithPass(state, u))
}

/**
 * 翻牌后调用：返回带事件的新状态。规则未启用的牌返回 null，调用方继续走房主裁定的旧流程。
 * 调用前 state.turn.revealedLadyCardId 已经写入；这里负责设置阶段（事件结束 → TACTIC）。
 */
export function startLadyEvent(state: GameState, cardId: string, uid: string, now: number): GameState | null {
  const card = getLadyCard(cardId)
  if (!isLadyRuleActive(state, card)) return null

  const label = `「${formatLadyCard(cardId)} ${card.candidate?.name ?? card.name}」`
  let history = state.history
  let ladyStatus: LadyStatus = state.ladyStatus
  let pendingDrinkAcks = state.pendingDrinkAcks
  let kingTask = state.kingTask
  let kingTaskHistory = state.kingTaskHistory
  let event: LadyEvent

  switch (card.rank) {
    case 'A': {
      const has = ladyStatus.substitutePassUids.includes(uid)
      if (!has) ladyStatus = { ...ladyStatus, substitutePassUids: [...ladyStatus.substitutePassUids, uid] }
      event = done(baseEvent(state, cardId, uid, now, 'DONE', [uid]), [], has ? '已经持有替喝机会，不叠加' : '获得 1 次替喝机会')
      break
    }
    case '2': {
      const previous = ladyStatus.mistressUid
      ladyStatus = { ...ladyStatus, mistressUid: uid }
      event = done(
        baseEvent(state, cardId, uid, now, 'DONE', [uid]),
        [],
        previous && previous !== uid ? '成为新的小姐，上一任小姐的陪喝效果解除' : previous === uid ? '连任小姐' : '成为本桌小姐',
      )
      break
    }
    case '6': {
      for (const u of state.turnOrder) pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, u, LADY_PENALTY_SIPS, '小姐牌 6 干杯', now)
      event = done(baseEvent(state, cardId, uid, now, 'DONE', [...state.turnOrder]), [...state.turnOrder], '全桌每人 1 口干杯提醒')
      break
    }
    case '8': {
      const has = ladyStatus.awayPassUids.includes(uid)
      if (!has) ladyStatus = { ...ladyStatus, awayPassUids: [...ladyStatus.awayPassUids, uid] }
      event = done(baseEvent(state, cardId, uid, now, 'DONE', [uid]), [], has ? '已经持有暂离通行证，不叠加' : '获得 1 张暂离通行证')
      break
    }
    case '10': {
      const previous = ladyStatus.crazyUid
      ladyStatus = { ...ladyStatus, crazyUid: uid }
      event = done(
        baseEvent(state, cardId, uid, now, 'DONE', [uid]),
        [],
        previous && previous !== uid ? '成为新的神经病，上一任解除' : previous === uid ? '继续当神经病' : '成为神经病',
      )
      break
    }
    case 'J':
    case 'Q': {
      const target = neighborUid(state, uid, card.rank === 'J' ? -1 : 1)
      const side = card.rank === 'J' ? '左边（上家）' : '右边（下家）'
      pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, target, LADY_PENALTY_SIPS, `小姐牌 ${card.rank} ${card.candidate!.name}`, now)
      event = { ...done(baseEvent(state, cardId, uid, now, 'DONE', [target]), [target], `${side}的玩家喝 1 口`), targetUid: target }
      break
    }
    case '3':
    case '5':
      event = baseEvent(state, cardId, uid, now, 'START', activeParticipants(state, [...state.turnOrder]))
      break
    case '4':
      event = baseEvent(state, cardId, uid, now, 'START', activeParticipants(state, state.turnOrder.filter((u) => u !== uid)))
      break
    case '7':
      event = baseEvent(state, cardId, uid, now, 'LUCKY_ROLL', [uid])
      break
    case '9':
      event = baseEvent(state, cardId, uid, now, 'CHOOSE_TARGET', [uid])
      break
    case 'K': {
      ladyStatus = { ...ladyStatus, kingUid: uid }
      if (kingTask && kingTask.status === 'PENDING') {
        kingTask = { ...kingTask, status: 'IN_PROGRESS', receiverUid: uid }
        event = { ...baseEvent(state, cardId, uid, now, 'KING_PERFORM', [uid, kingTask.creatorUid]), text: kingTask.content }
        history = appendHistory(history, `成为新国王，接到上一任国王留下的任务：「${kingTask.content}」`, now, uid)
      } else {
        if (kingTask) {
          // 不应该出现的残留任务（不是 PENDING）：归档为跳过，不能卡住新国王留任务
          const archived: KingTask = { ...kingTask, status: 'SKIPPED', resolvedAtTurn: state.turnNumber }
          kingTaskHistory = [...kingTaskHistory, archived].slice(-KING_TASK_HISTORY_LIMIT)
          kingTask = null
        }
        event = baseEvent(state, cardId, uid, now, 'KING_WRITE', [uid])
        history = appendHistory(history, '成为第一任国王，没有要执行的任务，请给下一任国王留下一个挑战。', now, uid)
      }
      break
    }
  }

  if (event.status === 'RESOLVED') {
    history = appendHistory(history, `小姐牌${label}：${event.result!.summary}。`, now, uid)
  } else if (card.rank !== 'K') {
    history = appendHistory(history, `小姐牌${label}开始，按提示操作。`, now, uid)
  }

  return {
    ...state,
    ladyStatus,
    pendingDrinkAcks,
    kingTask,
    kingTaskHistory,
    ladyEvent: event,
    history,
    turn: { ...state.turn, phase: event.status === 'RESOLVED' ? 'TACTIC' : 'LADY_CARD', pendingDecision: null },
  }
}

function requireEvent(state: GameState, eventId: string, steps: LadyEventStep[]): LadyEvent {
  const ev = state.ladyEvent
  if (!ev || ev.eventId !== eventId) throw new GameActionError('INVALID_GAME_ACTION', '这个小姐牌事件已经结束或已经被替换，请刷新后再试')
  if (!steps.includes(ev.step)) throw new GameActionError('INVALID_GAME_ACTION', '这一步已经处理过了')
  return ev
}

function finishEvent(state: GameState, event: LadyEvent, extra: Partial<GameState>, now: number, actorUid: string): GameState {
  const card = getLadyCard(event.cardId)
  const history = appendHistory(
    (extra.history ?? state.history),
    `小姐牌「${formatLadyCard(event.cardId)} ${card.candidate?.name ?? card.name}」结束：${event.result?.summary ?? ''}。`,
    now,
    actorUid,
  )
  return { ...state, ...extra, ladyEvent: event, history, turn: { ...state.turn, phase: 'TACTIC' } }
}

// ---------------------------------------------------------------------------
// 3 / 4 / 5：线下小游戏，翻牌者开始，房主录入结果
// ---------------------------------------------------------------------------

/** 翻牌者（或房主代为）开始小游戏；3 可以带主题 */
export function applyLadyStart(state: GameState, callerUid: string, hostUid: string, eventId: string, text: string | null, now: number): GameState {
  const ev = requireEvent(state, eventId, ['START'])
  if (callerUid !== ev.actingUid && callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有翻牌者或房主可以开始')
  const topic = ev.rank === '3' ? (text ?? '').trim().slice(0, 20) || null : null
  const message =
    ev.rank === '3' ? `逛三园开始！主题：${topic ?? '口头公布'}，从下家开始轮流回答。` : ev.rank === '4' ? '咔嚓！全桌定格 10 秒。' : '数五开始！从翻牌者报"1"，5 的倍数拍桌子。'
  return {
    ...state,
    ladyEvent: { ...ev, step: 'HOST_RESULT', text: topic, startedAt: now },
    history: appendHistory(state.history, message, now, callerUid),
  }
}

/** 房主录入线下结果：输家（null 表示没人失败） */
export function applyLadyHostResult(state: GameState, callerUid: string, hostUid: string, eventId: string, loserUid: string | null, now: number): GameState {
  if (callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以确认结果')
  const ev = requireEvent(state, eventId, ['HOST_RESULT'])
  let pendingDrinkAcks = state.pendingDrinkAcks
  let summary: string
  if (loserUid) {
    requirePlayer(state, loserUid)
    if (!ev.participants.includes(loserUid)) throw new GameActionError('INVALID_GAME_ACTION', '这名玩家没有参加这次小游戏')
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, loserUid, LADY_PENALTY_SIPS, `小姐牌 ${ev.rank} ${getLadyCard(ev.cardId).candidate!.name}：失败`, now)
    summary = '房主确认了失败者，失败者喝 1 口'
  } else {
    summary = ev.rank === '5' ? '没人出错，全员成功' : '没人失败，直接完成'
  }
  return finishEvent(state, done(ev, loserUid ? [loserUid] : [], summary), { pendingDrinkAcks }, now, callerUid)
}

/**
 * 房主取消当前小姐牌事件（无人受罚、不结算），保证任何人不操作都不会卡住对局。
 * K 国王事件不走这里：执行阶段可以跳过任务，留任务阶段房主可以跳过留任务。
 */
export function applyLadyHostCancel(state: GameState, callerUid: string, hostUid: string, eventId: string, now: number): GameState {
  if (callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以取消这个事件')
  const ev = requireEvent(state, eventId, ['START', 'HOST_RESULT', 'LUCKY_ROLL', 'CHOOSE_TARGET', 'DUEL_ROLL'])
  return finishEvent(state, done(ev, [], '房主取消了这次事件，无人受罚'), {}, now, callerUid)
}

// ---------------------------------------------------------------------------
// 7 幸运七：事件骰，与移动骰完全隔离
// ---------------------------------------------------------------------------

export function applyLuckySevenRoll(state: GameState, callerUid: string, hostUid: string, eventId: string, natural: number, now: number): GameState {
  const ev = requireEvent(state, eventId, ['LUCKY_ROLL'])
  if (callerUid !== ev.actingUid && callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有翻牌者或房主可以掷事件骰')
  if (!Number.isInteger(natural) || natural < 1 || natural > 6) throw new GameActionError('INVALID_GAME_ACTION', '骰子点数无效')
  const players = clonePlayers(state)
  let pendingDrinkAcks = state.pendingDrinkAcks
  let summary: string
  let losers: string[] = []
  if (natural === 6) {
    payFromBank(state, players, ev.actingUid, LUCKY_SEVEN_REWARD)
    summary = `事件骰掷出 6，从银行得 ${LUCKY_SEVEN_REWARD} 金币`
  } else if (natural === 1) {
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, ev.actingUid, LADY_PENALTY_SIPS, '小姐牌 7 幸运七：掷出 1', now)
    summary = '事件骰掷出 1，喝 1 口'
    losers = [ev.actingUid]
  } else {
    summary = `事件骰掷出 ${natural}，无事发生`
  }
  return finishEvent(state, done({ ...ev, rolls: [natural] }, losers, summary), { players, pendingDrinkAcks }, now, callerUid)
}

// ---------------------------------------------------------------------------
// 9 决斗
// ---------------------------------------------------------------------------

export function applyDuelChooseTarget(state: GameState, callerUid: string, eventId: string, targetUid: string, now: number): GameState {
  const ev = requireEvent(state, eventId, ['CHOOSE_TARGET'])
  if (callerUid !== ev.actingUid) throw new GameActionError('NOT_YOUR_TURN', '只有翻牌者可以选择决斗对手')
  requirePlayer(state, targetUid)
  if (targetUid === ev.actingUid) throw new GameActionError('INVALID_GAME_ACTION', '不能和自己决斗')
  if (isAwayWithPass(state, targetUid)) throw new GameActionError('INVALID_GAME_ACTION', '这名玩家正在使用暂离通行证，换一个对手吧')
  return {
    ...state,
    ladyEvent: { ...ev, step: 'DUEL_ROLL', targetUid, participants: [ev.actingUid, targetUid], duelRounds: [{ actorRoll: null, targetRoll: null }] },
    history: appendHistory(state.history, '发起决斗！双方各掷一颗骰子。', now, callerUid),
  }
}

/** 决斗方掷自己的骰子（房主可以代掷，避免有人不操作卡住对局） */
export function applyDuelRoll(
  state: GameState,
  callerUid: string,
  hostUid: string,
  eventId: string,
  side: 'actor' | 'target',
  natural: number,
  now: number,
): GameState {
  const ev = requireEvent(state, eventId, ['DUEL_ROLL'])
  const sideUid = side === 'actor' ? ev.actingUid : ev.targetUid
  if (!sideUid) throw new GameActionError('INVALID_GAME_ACTION', '还没有选择决斗对手')
  if (callerUid !== sideUid && callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只能掷自己的决斗骰')
  if (!Number.isInteger(natural) || natural < 1 || natural > 6) throw new GameActionError('INVALID_GAME_ACTION', '骰子点数无效')

  const rounds = ev.duelRounds.map((r) => ({ ...r }))
  const current = rounds[rounds.length - 1]!
  const key = side === 'actor' ? 'actorRoll' : 'targetRoll'
  if (current[key] !== null) throw new GameActionError('INVALID_GAME_ACTION', '这一轮已经掷过了，等对方掷骰')
  current[key] = natural

  let history = appendHistory(state.history, `决斗第 ${rounds.length} 轮掷出 ${natural}。`, now, sideUid)
  if (current.actorRoll === null || current.targetRoll === null) {
    return { ...state, ladyEvent: { ...ev, duelRounds: rounds }, history }
  }

  if (current.actorRoll === current.targetRoll) {
    if (rounds.length < DUEL_MAX_ROUNDS) {
      rounds.push({ actorRoll: null, targetRoll: null })
      history = appendHistory(history, `决斗平局（${current.actorRoll} : ${current.targetRoll}），重掷！`, now)
      return { ...state, ladyEvent: { ...ev, duelRounds: rounds }, history }
    }
    return finishEvent(state, done({ ...ev, duelRounds: rounds }, [], `${DUEL_MAX_ROUNDS} 轮都是平局，无人失败`), { history }, now, callerUid)
  }

  const loser = current.actorRoll < current.targetRoll ? ev.actingUid : ev.targetUid!
  const pendingDrinkAcks = pushDrinkAck(state.pendingDrinkAcks, loser, LADY_PENALTY_SIPS, '小姐牌 9 决斗：点数小', now)
  return finishEvent(
    state,
    done({ ...ev, duelRounds: rounds }, [loser], `决斗结果 ${current.actorRoll} : ${current.targetRoll}，点数小的一方喝 1 口`),
    { history, pendingDrinkAcks },
    now,
    callerUid,
  )
}

// ---------------------------------------------------------------------------
// K 国王传承（正式规则）
// ---------------------------------------------------------------------------

/** 房主确认新国王完成/跳过上一任的任务；跳过不扣金币也不罚酒。新国王自己也可以选择跳过。 */
export function applyKingTaskResolve(
  state: GameState,
  callerUid: string,
  hostUid: string,
  eventId: string,
  completed: boolean,
  now: number,
): GameState {
  const ev = requireEvent(state, eventId, ['KING_PERFORM'])
  if (completed && callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '完成任务需要房主确认')
  if (!completed && callerUid !== hostUid && callerUid !== ev.actingUid) throw new GameActionError('INVALID_GAME_ACTION', '只有国王本人或房主可以跳过任务')
  const task = state.kingTask
  if (!task || task.status !== 'IN_PROGRESS' || task.receiverUid !== ev.actingUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '这条国王任务已经处理过了')
  }
  const resolved: KingTask = { ...task, status: completed ? 'COMPLETED' : 'SKIPPED', resolvedAtTurn: state.turnNumber }
  return {
    ...state,
    kingTask: null,
    kingTaskHistory: [...state.kingTaskHistory, resolved].slice(-KING_TASK_HISTORY_LIMIT),
    ladyEvent: { ...ev, step: 'KING_WRITE', result: { loserUids: [], summary: completed ? '完成了上一任国王的任务' : '跳过了上一任国王的任务' } },
    history: appendHistory(
      state.history,
      completed ? `完成了上一任国王的任务「${task.content}」（房主确认）。` : `跳过了上一任国王的任务「${task.content}」，不扣金币、不罚酒。`,
      now,
      ev.actingUid,
    ),
  }
}

/** 国王给下一任国王留下任务。content 为 null 表示房主让国王跳过留任务（下一任将成为"第一任"） */
export function applyKingWriteTask(
  state: GameState,
  callerUid: string,
  hostUid: string,
  eventId: string,
  content: string | null,
  now: number,
): GameState {
  const ev = requireEvent(state, eventId, ['KING_WRITE'])
  const previousSummary = ev.result?.summary
  if (content === null) {
    if (callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以跳过留任务')
    const summary = [previousSummary, '房主跳过了留任务，下一任国王没有任务要执行'].filter(Boolean).join('；')
    return finishEvent(state, done(ev, [], summary), {}, now, callerUid)
  }
  if (callerUid !== ev.actingUid) throw new GameActionError('INVALID_GAME_ACTION', '只有国王本人可以留任务')
  const check = validateKingTaskContent(content)
  if (!check.ok) throw new GameActionError('INVALID_GAME_ACTION', check.reason)
  if (state.kingTask) throw new GameActionError('INVALID_GAME_ACTION', '已经有一条等待下一任国王的任务了')

  const kingTask: KingTask = {
    taskId: `king-${now}-${state.turnNumber}`,
    content: check.content,
    creatorUid: ev.actingUid,
    createdAtTurn: state.turnNumber,
    status: 'PENDING',
    receiverUid: null,
    resolvedAtTurn: null,
  }
  const summary = [previousSummary, '给下一任国王留下了新任务'].filter(Boolean).join('；')
  return finishEvent(state, done({ ...ev, text: check.content }, [], summary), { kingTask }, now, callerUid)
}

// ---------------------------------------------------------------------------
// A 替我喝：在喝酒提醒上发起替喝，对方接受/拒绝
// ---------------------------------------------------------------------------

export function substituteEligibility(state: GameState, ack: PendingDrinkAck, uid: string): string | null {
  if (!state.ladyStatus.substitutePassUids.includes(uid)) return '你没有替喝机会'
  if (ack.targetUid !== uid) return '只能把自己的喝酒提醒交给别人替喝'
  if (ack.amountText) return '半杯惩罚不能替喝'
  if (ack.transferredFromUid) return '这条提醒已经被替喝转过一次，不能再转'
  if (ack.substituteOffer) return '已经在等对方回应了'
  if (drinkExemptionsDisabled(state.currentTarotId)) return '节制塔罗生效中：替喝暂时不能使用（与节制的关系待确认）'
  return null
}

export function applyOfferSubstitute(state: GameState, callerUid: string, ackId: string, toUid: string, now: number): GameState {
  const ack = state.pendingDrinkAcks.find((a) => a.id === ackId)
  if (!ack) throw new GameActionError('INVALID_GAME_ACTION', '这条喝酒提醒不存在或已经处理过了')
  const reason = substituteEligibility(state, ack, callerUid)
  if (reason) throw new GameActionError('INVALID_GAME_ACTION', reason)
  requirePlayer(state, toUid)
  if (toUid === callerUid) throw new GameActionError('INVALID_GAME_ACTION', '请选择另一名玩家')
  return {
    ...state,
    pendingDrinkAcks: state.pendingDrinkAcks.map((a) => (a.id === ackId ? { ...a, substituteOffer: { fromUid: callerUid, toUid } } : a)),
    history: appendHistory(state.history, '想用替喝机会，请一名玩家代喝，等待对方回应。', now, callerUid),
  }
}

/** 被请求的人接受/拒绝；发起人或房主也可以撤回（accept=false），避免请求一直挂着 */
export function applyRespondSubstitute(state: GameState, callerUid: string, hostUid: string, ackId: string, accept: boolean, now: number): GameState {
  const ack = state.pendingDrinkAcks.find((a) => a.id === ackId)
  const offer = ack?.substituteOffer
  if (!ack || !offer) throw new GameActionError('INVALID_GAME_ACTION', '这条替喝请求已经处理过了')
  if (accept && callerUid !== offer.toUid) throw new GameActionError('INVALID_GAME_ACTION', '只有被请求的人可以接受替喝')
  if (!accept && ![offer.toUid, offer.fromUid, hostUid].includes(callerUid)) throw new GameActionError('INVALID_GAME_ACTION', '你不能处理这条替喝请求')
  if (accept && !state.ladyStatus.substitutePassUids.includes(offer.fromUid)) throw new GameActionError('INVALID_GAME_ACTION', '对方的替喝机会已经用掉了')

  if (!accept) {
    const next = { ...ack }
    delete next.substituteOffer
    return {
      ...state,
      pendingDrinkAcks: state.pendingDrinkAcks.map((a) => (a.id === ackId ? next : a)),
      history: appendHistory(state.history, '替喝请求被拒绝/撤回，提醒仍由原来的人处理，替喝机会保留。', now, callerUid),
    }
  }
  const moved: PendingDrinkAck = { ...ack, targetUid: offer.toUid, transferredFromUid: offer.fromUid, reason: `${ack.reason}（替喝）` }
  delete moved.substituteOffer
  return {
    ...state,
    pendingDrinkAcks: state.pendingDrinkAcks.map((a) => (a.id === ackId ? moved : a)),
    ladyStatus: { ...state.ladyStatus, substitutePassUids: state.ladyStatus.substitutePassUids.filter((u) => u !== offer.fromUid) },
    history: appendHistory(state.history, '接受了替喝，这条提醒转给自己，对方的替喝机会用掉了。', now, callerUid),
  }
}

// ---------------------------------------------------------------------------
// 8 暂离：任何人随时可以暂离，不受罚、不跳过任何回合
// ---------------------------------------------------------------------------

export function applySetAway(state: GameState, callerUid: string, hostUid: string, targetUid: string, away: boolean, usePass: boolean, now: number): GameState {
  if (callerUid !== targetUid && callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只能标记自己的暂离状态')
  requirePlayer(state, targetUid)
  const current = state.ladyStatus.away.find((a) => a.uid === targetUid)
  if (!away) {
    if (!current) throw new GameActionError('INVALID_GAME_ACTION', '这名玩家没有在暂离')
    return {
      ...state,
      ladyStatus: { ...state.ladyStatus, away: state.ladyStatus.away.filter((a) => a.uid !== targetUid) },
      history: appendHistory(state.history, '回到了桌上。', now, targetUid),
    }
  }
  if (current) throw new GameActionError('INVALID_GAME_ACTION', '已经在暂离了')
  if (usePass && callerUid !== targetUid) throw new GameActionError('INVALID_GAME_ACTION', '只有本人可以使用暂离通行证')
  if (usePass && !state.ladyStatus.awayPassUids.includes(targetUid)) throw new GameActionError('INVALID_GAME_ACTION', '没有暂离通行证')
  return {
    ...state,
    ladyStatus: {
      ...state.ladyStatus,
      awayPassUids: usePass ? state.ladyStatus.awayPassUids.filter((u) => u !== targetUid) : state.ladyStatus.awayPassUids,
      away: [...state.ladyStatus.away, { uid: targetUid, since: now, withPass: usePass }],
    },
    history: appendHistory(state.history, usePass ? '使用暂离通行证，暂时离席。' : '暂时离席。', now, targetUid),
  }
}

// ---------------------------------------------------------------------------
// 10 神经病：房主记录上当的人
// ---------------------------------------------------------------------------

export function applyCrazyCatch(state: GameState, callerUid: string, hostUid: string, violatorUid: string, now: number): GameState {
  if (callerUid !== hostUid) throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以记录上当的人')
  const crazy = state.ladyStatus.crazyUid
  if (!crazy) throw new GameActionError('INVALID_GAME_ACTION', '现在没有神经病')
  requirePlayer(state, violatorUid)
  if (violatorUid === crazy) throw new GameActionError('INVALID_GAME_ACTION', '神经病自己不会上当')
  return {
    ...state,
    pendingDrinkAcks: pushDrinkAck(state.pendingDrinkAcks, violatorUid, LADY_PENALTY_SIPS, '小姐牌 10：搭理了神经病', now),
    history: appendHistory(state.history, '搭理了神经病，喝 1 口。', now, violatorUid),
  }
}

// ---------------------------------------------------------------------------
// 2 小姐陪喝：所有动作写库前统一检查一次
// ---------------------------------------------------------------------------

/**
 * 一次动作（= 一次事件）新增了别人的喝酒提醒时，小姐收到 1 条陪喝提醒：
 * - 同一次动作最多 1 条；
 * - 小姐自己在这次动作里也要喝（比如干杯）时不再陪；
 * - 陪喝提醒本身（accompany）不计入"新增"，不会再触发陪喝；
 * - 替喝转移只改目标、不新增提醒，不触发陪喝。
 * 数据库层在每个游戏动作写回前调用它，纯函数测试也可以直接调用。
 */
export function applyMistressAccompany(prev: GameState, next: GameState, now: number): GameState {
  const mistress = next.ladyStatus.mistressUid
  if (!mistress || !next.players[mistress]) return next
  const prevIds = new Set(prev.pendingDrinkAcks.map((a) => a.id))
  const newAcks = next.pendingDrinkAcks.filter((a) => !prevIds.has(a.id))
  // 已经陪过（同一次动作重复收尾）就不再加，保证幂等
  if (newAcks.some((a) => a.accompany)) return next
  const added = newAcks.filter((a) => !a.accompany)
  if (added.length === 0) return next
  if (added.some((a) => a.targetUid === mistress)) return next
  const acks = pushDrinkAck(next.pendingDrinkAcks, mistress, 1, '小姐牌 2：小姐陪喝', now)
  acks[acks.length - 1] = { ...acks[acks.length - 1]!, accompany: true }
  return { ...next, pendingDrinkAcks: acks, history: appendHistory(next.history, '作为小姐陪喝 1 口。', now, mistress) }
}

/** 数据库层每次写回前统一调用的收尾钩子 */
export function finalizeGameAction(prev: GameState, next: GameState, now: number): GameState {
  return applyMistressAccompany(prev, next, now)
}

// ---------------------------------------------------------------------------
// 开发测试入口：把指定点数的牌放到牌堆顶（只在候选规则预览房间可用）
// ---------------------------------------------------------------------------

export function applyDevStackLadyDeck(state: GameState, rank: LadyRank): GameState {
  if (state.ladyRuleset !== 'candidate-preview') throw new GameActionError('INVALID_GAME_ACTION', '只有开发测试房间可以指定下一张主牌')
  const idx = state.ladyDeck.findIndex((id) => parseLadyCardId(id).rank === rank)
  if (idx === -1) throw new GameActionError('INVALID_GAME_ACTION', `牌堆里已经没有 ${rank} 了`)
  const deck = [...state.ladyDeck]
  const [card] = deck.splice(idx, 1)
  return { ...state, ladyDeck: [card!, ...deck] }
}
