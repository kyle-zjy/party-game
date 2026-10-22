/**
 * 回合引擎——纯函数，输入当前 `GameState` + 一个动作，输出新的 `GameState`。
 * 不碰数据库；随机数通过参数注入，方便单测固定结果。乐观锁重试和持久化在
 * `frontend/src/lib/gameEngineDb.ts`。
 *
 * 回合流程（V1.5 规则书"2. 回合流程"）：
 * ROLLING -(掷骰)-> LANDING -(落点效果结算/确认)-> LADY_CARD
 *   -(翻牌+心脏病判定)-> TACTIC -(出牌或跳过)-> 下一位玩家的 ROLLING
 *
 * 自然 6：LANDING 结算完后，如果这次掷骰给予额外掷骰（通常是自然 6，愚者塔罗
 * 下不给）且本回合还没用过，回到 ROLLING、extraRollPending = true；额外掷骰的
 * 落点只结算落点，不额外翻主牌。V1.6 补充 Q7：额外骰再出自然 6 不连锁，最多 2 次地图掷骰。
 *
 * 世界塔罗的持续效果都通过 tarotEffects.ts 在对应结算点读取当前塔罗，
 * 即时效果通过 tarotActions.ts 在"更换塔罗"格子上翻牌时结算一次。
 */
import { getCell, isPropertyCell, PROPERTY_BUY_PRICE } from '../board'
import { getLadyCard } from '../cards/ladyCards'
import { drawFromLadyDeck, formatLadyCard, heartAttackCheck, LADY_SUIT_LABEL, LADY_WINDOW_SIZE } from '../cards/ladyDeck'
import { drawRandomTacticCardId, getTacticCard, TACTIC_HAND_LIMIT } from '../cards/tacticCards'
import { drawRandomTarotId, getTarotCard } from '../cards/tarotCards'
import { drawPrompt } from '../cards/truthOrDareBank'
import type { DrinkAckChoice, GamePlayerState, GameState, PendingDecision, PendingDrinkAck } from '../types'
import { buildRollRecord } from './dice'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { computeNewPosition, startCellIdForColor } from './movement'
import { startLadyEvent } from './ladyEvents'
import { addTexasPotFromBank, applyCasino, openDreamChallenge } from './texas'
import { startAvalonMission } from './avalon'
import { applyZoneRollEffects, moveOffRing, walkRing } from './zones'
import { startEndgame } from './endgame'
import { applyPlayActiveTactic } from './tacticStack'
import { activeProperties } from './properties'
import { clonePlayers, neighborUid, pushDrinkAck, requirePlayer } from './stateHelpers'
import { revealTarot } from './tarotActions'
import {
  allowedTruthOrDareChoices,
  backSteps,
  collisionOutcome,
  drinkExemptionsDisabled,
  forwardSteps,
  heartAttackReward,
  hermitBonus,
  magicianRefill,
  payFromBank,
  rentForLanding,
  startPassCoins,
  TAROT_ID,
  truthOrDareCompletionBonus,
} from './tarotEffects'

export { GameActionError }

const DRINK_CHOICE_LABEL: Record<DrinkAckChoice, string> = {
  DONE: '已完成',
  WATER: '以水代替',
  SKIP: '跳过',
  DEVIL: '改为付 1 金币并指定另一人喝 2 口',
  PAY: '支付',
}

function requireCurrentPlayer(state: GameState, uid: string): void {
  if (state.turn.currentPlayerUid !== uid) {
    throw new GameActionError('NOT_YOUR_TURN', '还没轮到你操作')
  }
}

// ---------------------------------------------------------------------------
// 动作 1：掷骰（ROLLING -> LANDING）
// ---------------------------------------------------------------------------

export function applyRollDice(state: GameState, uid: string, natural: number, now: number = Date.now()): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'ROLLING') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是掷骰阶段')
  }
  if (state.turn.pendingDecision) {
    // 开局塔罗是恋人/正义时，需要先完成指定/裁定才能开始掷骰
    throw new GameActionError('INVALID_GAME_ACTION', '还有未处理的塔罗事件，处理完才能掷骰')
  }
  if (state.endgame) throw new GameActionError('INVALID_GAME_ACTION', '已经有人抵达终点，地图回合已经结束')
  if (state.turn.rollSkipped) throw new GameActionError('INVALID_GAME_ACTION', '本回合停骰，不能掷骰')
  if (!state.turn.extraRollPending && state.players[uid]?.skipNextRoll) throw new GameActionError('INVALID_GAME_ACTION', '你本回合停骰，请点"停骰：直接翻主牌"')
  const roll = buildRollRecord(natural, state.currentTarotId)
  const player = requirePlayer(state, uid)

  const parts = [`掷出 ${roll.natural} 点`]
  if (roll.tarotNote) parts.push(`（${roll.tarotNote}，实际移动 ${roll.effective} 格）`)
  else if (roll.grantsExtraRoll) parts.push('（自然 6！）')
  if (player.zone.kind === 'ring') parts.push(`，前往第 ${computeNewPosition(player.position, roll.effective) + 1} 格。`)
  else parts.push(player.zone.kind === 'gods' ? '，在神鬼道上前进。' : '，在桥上前进。')

  return {
    ...state,
    turn: {
      ...state.turn,
      phase: 'LANDING',
      lastRoll: roll,
      pendingDecision: null,
      landingResolved: false,
      tarotNotes: roll.tarotNote ? [...state.turn.tarotNotes, roll.tarotNote] : state.turn.tarotNotes,
    },
    history: appendHistory(state.history, parts.join(''), now, uid),
  }
}

// ---------------------------------------------------------------------------
// 动作 2：结算落点（移动 + 起点奖励 + 格子效果 + 碰撞）
// ---------------------------------------------------------------------------

export interface LandingOutcome {
  state: GameState
  needsDecision: boolean
}

interface LandingContext {
  state: GameState
  uid: string
  now: number
  rng: () => number
  players: Record<string, GamePlayerState>
  history: GameState['history']
  pendingDrinkAcks: PendingDrinkAck[]
  pendingDecision: PendingDecision | null
  tarotNotes: string[]
  /** 落点效果可能翻开新塔罗，后续结算要用新的 */
  extra: Partial<GameState>
  /** V1.6：落点结束后要开启的事件（阿瓦隆发车、CASINO、梦幻挑战候选人） */
  followUps: ('AVALON' | 'CASINO')[]
  dreamCandidates: string[]
}

export function applyResolveLanding(
  state: GameState,
  uid: string,
  now: number,
  rng: () => number = Math.random,
): LandingOutcome {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'LANDING') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是落点结算阶段')
  }
  if (state.turn.landingResolved) {
    // 幂等保护：重复点击或轮询重试不能把移动、金币、事件效果再结算一遍。
    throw new GameActionError('INVALID_GAME_ACTION', '这一次落点已经结算过了')
  }
  const roll = state.turn.lastRoll
  if (!roll) throw new GameActionError('INVALID_GAME_ACTION', '还没有掷骰结果，无法结算落点')

  const ctx: LandingContext = {
    state,
    uid,
    now,
    rng,
    players: clonePlayers(state),
    history: state.history,
    pendingDrinkAcks: state.pendingDrinkAcks,
    pendingDecision: null,
    tarotNotes: [...state.turn.tarotNotes],
    extra: {},
    followUps: [],
    dreamCandidates: [],
  }
  const player = ctx.players[uid]!

  if (state.rulesVersion === 2) {
    resolveMapMoveV16(ctx, player, roll.effective)
  } else {
    // 起点奖励：只有经过/停在自己颜色的起点才领取（棋盘四角的标注"X色人物由此过领取"）。
    // 额外掷骰的移动同样会经过起点，规则书只说额外骰"只结算落点，不额外翻小姐牌"，
    // 经过起点是移动本身的效果，照常结算。
    if (passesCell(player.position, roll.effective, startCellIdForColor(player.color))) {
      grantStartBonus(ctx, player)
    }
    player.position = computeNewPosition(player.position, roll.effective)
    resolveCell(ctx, player, 0)
  }

  let extra: Partial<GameState> = ctx.extra
  let followState: GameState = { ...state, ...extra, players: ctx.players, history: ctx.history, pendingDrinkAcks: ctx.pendingDrinkAcks }
  for (const f of ctx.followUps) {
    followState = f === 'AVALON' ? startAvalonMission(followState, uid, now) : applyCasino(followState, now, rng, uid)
  }
  if (ctx.dreamCandidates.length > 0 && state.rulesVersion === 2) {
    followState = { ...followState, dream: openDreamChallenge(followState, uid, ctx.dreamCandidates, now) }
  }
  ctx.players = followState.players
  ctx.history = followState.history
  ctx.pendingDrinkAcks = followState.pendingDrinkAcks
  extra = { ...extra, texas: followState.texas, avalon: followState.avalon, dream: followState.dream, godsPathOpen: followState.godsPathOpen }
  ctx.extra = extra

  const nextState: GameState = {
    ...state,
    ...ctx.extra,
    players: ctx.players,
    pendingDrinkAcks: ctx.pendingDrinkAcks,
    turn: {
      ...state.turn,
      ...(ctx.extra.turn ?? {}),
      pendingDecision: ctx.pendingDecision,
      landingResolved: true,
      tarotNotes: ctx.tarotNotes,
    },
    history: ctx.history,
  }
  return { state: nextState, needsDecision: ctx.pendingDecision !== null }
}

/**
 * V1.6 地图移动：掷骰前所在区域的天堂/地狱/桥效果 → 神鬼道/桥/外圈移动 → 外圈落点结算。
 * 抵达终点时记录 reachedFinish，终局在回合结束时开启。
 */
function resolveMapMoveV16(ctx: LandingContext, player: GamePlayerState, steps: number): void {
  const zoneFx = applyZoneRollEffects(ctx.players, player.uid, ctx.history, ctx.pendingDrinkAcks, ctx.now, (uid, amount) =>
    payFromBank(effectiveState(ctx), ctx.players, uid, amount),
  )
  ctx.history = zoneFx.history
  ctx.pendingDrinkAcks = zoneFx.acks

  let remaining = steps
  if (player.zone.kind !== 'ring') {
    const r = moveOffRing(player, steps)
    if (r.message) ctx.history = appendHistory(ctx.history, r.message, ctx.now, player.uid)
    if (r.reachedFinish && !player.reachedFinish) {
      player.reachedFinish = true
      ctx.history = appendHistory(ctx.history, '抵达终点！完成本回合后进入终局结算。', ctx.now, player.uid)
    }
    if (r.offRing) return
    remaining = r.ringLeftover
    if (remaining === 0) {
      resolveCell(ctx, player, 0)
      return
    }
  }

  const walk = walkRing(effectiveState(ctx), player, remaining)
  for (let i = 0; i < walk.startPasses; i += 1) {
    grantStartBonus(ctx, player)
    player.laps += 1
    if (!ctx.state.godsPathOpen && !(ctx.extra.godsPathOpen ?? false)) {
      ctx.extra = { ...ctx.extra, godsPathOpen: true }
      ctx.history = appendHistory(ctx.history, '第一位玩家跑完外圈一圈，神鬼道两端入口开启！之后停在第 11 格或第 48 格可以选择进入。', ctx.now, player.uid)
    }
  }
  player.position = walk.position
  if (walk.stop) {
    ctx.pendingDecision = walk.stop
    ctx.history = appendHistory(
      ctx.history,
      walk.stop.kind === 'RIVER_CROSS' ? '来到河边，需要选择过桥或渡河。' : '来到神鬼道入口，可以选择是否进入。',
      ctx.now,
      player.uid,
    )
    return
  }
  resolveCell(ctx, player, 0)
}

/** 从 oldPos 顺时针前进 steps 格的路径上（含终点）是否经过 cellId */
function passesCell(oldPos: number, steps: number, cellId: number): boolean {
  for (let s = 1; s <= steps; s += 1) {
    if (computeNewPosition(oldPos, s) === cellId) return true
  }
  return false
}

function currentTarot(ctx: LandingContext): string {
  return ctx.extra.currentTarotId ?? ctx.state.currentTarotId
}

function effectiveState(ctx: LandingContext): GameState {
  return { ...ctx.state, ...ctx.extra, players: ctx.players }
}

function grantStartBonus(ctx: LandingContext, player: GamePlayerState): void {
  const tarotId = currentTarot(ctx)
  const coins = startPassCoins(tarotId)
  payFromBank(effectiveState(ctx), ctx.players, player.uid, coins)
  const drew = player.tacticHand.length < TACTIC_HAND_LIMIT
  if (drew) player.tacticHand.push(drawRandomTacticCardId(ctx.rng))
  if (tarotId === TAROT_ID.SUN) ctx.tarotNotes.push('太阳：经过起点改为获得 3 金币')
  ctx.history = appendHistory(
    ctx.history,
    `经过自己的起点，获得 ${coins} 金币${drew ? '和 1 张战术手牌' : '（手牌已满，没有补牌）'}。`,
    ctx.now,
    player.uid,
  )
}

/**
 * 结算当前落点。前进/后退会把玩家带到新格子，再结算一次新格子
 * （depth 防止理论上的无限连跳——棋盘上前进/后退格互相指向时最多连续 3 次）。
 */
function resolveCell(ctx: LandingContext, player: GamePlayerState, depth: number): void {
  const cell = getCell(player.position)

  // 碰撞：落在已有其他玩家的格子上，被撞者 1 口并退回起点（力量塔罗改为退 3 格）。
  // 起点格是安全格——被撞者"退回起点"本来就会和别人同格，不再连锁碰撞。
  if (cell.kind !== 'start') resolveCollisions(ctx, player)

  if (isPropertyCell(cell)) {
    const owner = Object.values(ctx.players).find((p) => p.properties.includes(cell.propertyName))
    if (!owner) {
      ctx.pendingDecision = { kind: 'BUY_PROPERTY', cellId: cell.id, propertyName: cell.propertyName, price: PROPERTY_BUY_PRICE }
      ctx.history = appendHistory(ctx.history, `来到无主地产「${cell.propertyName}」，可以花 ${PROPERTY_BUY_PRICE} 金币买下。`, ctx.now, player.uid)
    } else if (owner.uid === player.uid) {
      ctx.history = appendHistory(ctx.history, `来到自己的地产「${cell.propertyName}」，不用付租金。`, ctx.now, player.uid)
    } else if (owner.mortgaged.includes(cell.propertyName)) {
      ctx.dreamCandidates.push(owner.uid)
      ctx.history = appendHistory(ctx.history, `来到「${cell.propertyName}」，这块地产已抵押，抵押期间不收租。`, ctx.now, player.uid)
    } else {
      ctx.dreamCandidates.push(owner.uid)
      const { rent, note } = rentForLanding(currentTarot(ctx), activeProperties(owner), cell.propertyName)
      const paid = Math.min(rent, player.coins)
      player.coins -= paid
      owner.coins += paid
      if (note) ctx.tarotNotes.push(note)
      ctx.history = appendHistory(
        ctx.history,
        note
          ? `来到「${cell.propertyName}」，${note}，不用付租金。`
          : `来到「${cell.propertyName}」，向地产主人支付租金 ${paid} 金币${paid < rent ? '（金币不够，按实际持有支付）' : ''}。`,
        ctx.now,
        player.uid,
      )
    }
    return
  }

  if (cell.kind !== 'event') return
  const n = cell.effectN
  const tarotId = currentTarot(ctx)

  switch (cell.effectKind) {
    case 'coin': {
      const amount = typeof n === 'number' ? n : 0
      payFromBank(effectiveState(ctx), ctx.players, player.uid, amount)
      ctx.history = appendHistory(ctx.history, `格子效果：从银行获得 ${amount} 金币。`, ctx.now, player.uid)
      return
    }
    case 'forward':
    case 'back': {
      const base = typeof n === 'number' ? n : 0
      const steps = cell.effectKind === 'forward' ? forwardSteps(tarotId, base) : backSteps(tarotId, base)
      if (steps !== base) {
        ctx.tarotNotes.push(
          cell.effectKind === 'forward' ? `世界："前进 ${base} 格"改为前进 ${steps} 格` : `力量："后退 ${base} 格"改为后退 ${steps} 格`,
        )
      }
      const delta = cell.effectKind === 'forward' ? steps : -steps
      // 前进格移动时经过自己的起点，同样领取起点奖励
      if (delta > 0 && passesCell(player.position, delta, startCellIdForColor(player.color))) {
        grantStartBonus(ctx, player)
      }
      player.position = computeNewPosition(player.position, delta)
      ctx.history = appendHistory(
        ctx.history,
        `格子效果：${cell.effectKind === 'forward' ? '前进' : '后退'} ${steps} 格，来到第 ${player.position + 1} 格。`,
        ctx.now,
        player.uid,
      )
      if (depth < 3) resolveCell(ctx, player, depth + 1)
      return
    }
    case 'drinkSelf': {
      const amount = typeof n === 'number' ? n : 1
      ctx.pendingDrinkAcks = pushDrinkAck(ctx.pendingDrinkAcks, player.uid, amount, '踩中喝酒格子', ctx.now)
      ctx.history = appendHistory(ctx.history, `格子效果：喝 ${amount} 口。`, ctx.now, player.uid)
      return
    }
    case 'drinkPrev':
    case 'drinkNext': {
      const amount = typeof n === 'number' ? n : 1
      const target = neighborUid(ctx.state, player.uid, cell.effectKind === 'drinkPrev' ? -1 : 1)
      const who = cell.effectKind === 'drinkPrev' ? '上家' : '下家'
      ctx.pendingDrinkAcks = pushDrinkAck(ctx.pendingDrinkAcks, target, amount, `踩中「${who}喝酒」格子`, ctx.now)
      ctx.history = appendHistory(ctx.history, `格子效果：${who}喝 ${amount} 口。`, ctx.now, player.uid)
      return
    }
    case 'drinkTarget': {
      const amount = typeof n === 'number' ? n : 1
      ctx.pendingDecision = { kind: 'CHOOSE_DRINK_TARGET', amount, reason: '踩中「指定喝酒」格子' }
      ctx.history = appendHistory(ctx.history, `格子效果：指定一名玩家喝 ${amount} 口。`, ctx.now, player.uid)
      return
    }
    case 'truthOrDare': {
      const allowed = allowedTruthOrDareChoices(tarotId)
      // 女祭司/倒吊人只允许一种选择，直接定下来，不需要玩家再点一次
      ctx.pendingDecision = { kind: 'TRUTH_OR_DARE', choice: allowed.length === 1 ? allowed[0]! : null }
      if (allowed.length === 1 && ctx.state.rulesVersion === 2) {
        const prompt = drawPrompt(allowed[0]!, ctx.state.usedPromptIds, ctx.rng)
        ctx.pendingDecision = { ...ctx.pendingDecision, promptId: prompt.id }
        ctx.extra = { ...ctx.extra, usedPromptIds: [...ctx.state.usedPromptIds, prompt.id].slice(-40) }
      }
      if (allowed.length === 1) {
        ctx.tarotNotes.push(tarotId === TAROT_ID.HIGH_PRIESTESS ? '女祭司：只能选真心话' : '倒吊人：只能选大冒险')
      }
      ctx.history = appendHistory(ctx.history, '格子效果：真心话大冒险。', ctx.now, player.uid)
      return
    }
    case 'changeTarot': {
      const newTarotId = drawRandomTarotId(tarotId, ctx.rng)
      const reveal = revealTarot(effectiveState(ctx), newTarotId, player.uid, ctx.now, ctx.rng)
      ctx.players = reveal.state.players
      ctx.pendingDrinkAcks = reveal.state.pendingDrinkAcks
      ctx.history = reveal.state.history
      ctx.extra = {
        ...ctx.extra,
        currentTarotId: reveal.state.currentTarotId,
        tarotState: reveal.state.tarotState,
        lastTarotChange: reveal.state.lastTarotChange,
        pendingTarotDiscards: reveal.state.pendingTarotDiscards,
      }
      if (reveal.followUp) ctx.pendingDecision = reveal.followUp
      // 当前玩家的对象引用可能被替换（命运之轮换手牌会改 players），后续不再使用旧引用
      return
    }
    case 'drawTacticCard': {
      if (player.tacticHand.length < TACTIC_HAND_LIMIT) {
        player.tacticHand.push(drawRandomTacticCardId(ctx.rng))
        ctx.history = appendHistory(ctx.history, '格子效果：抽了 1 张战术手牌。', ctx.now, player.uid)
      } else {
        ctx.history = appendHistory(ctx.history, `格子效果：抽牌，但手牌已满（上限 ${TACTIC_HAND_LIMIT} 张）。`, ctx.now, player.uid)
      }
      return
    }
    case 'skipRoll':
    case 'nextSkipRoll':
    case 'texasPot':
    case 'avalonMission': {
      if (ctx.state.rulesVersion !== 2) {
        // V1.5 旧房间：这些格子原稿只有名称，仍交给房主现场裁定
        ctx.pendingDecision = { kind: 'HOST_RULING', description: `${cell.label}：V1.5 原稿没有写明结算方式，请房主现场裁定` }
        ctx.history = appendHistory(ctx.history, `格子效果：${cell.label}（房主裁定）。`, ctx.now, player.uid)
        return
      }
      if (cell.effectKind === 'skipRoll' || cell.effectKind === 'nextSkipRoll') {
        const targetUid = cell.effectKind === 'skipRoll' ? player.uid : neighborUid(ctx.state, player.uid, 1)
        const target = ctx.players[targetUid]!
        const already = target.skipNextRoll
        target.skipNextRoll = true
        ctx.history = appendHistory(
          ctx.history,
          cell.effectKind === 'skipRoll'
            ? `停骰一次：下一次自己的回合不掷骰、不移动${already ? '（已经有一次待执行的停骰，不叠加）' : ''}。`
            : `下家禁骰：下家下一次回合不掷骰、不移动${already ? '（对方已经有一次待执行的禁骰，不叠加）' : ''}。`,
          ctx.now,
          player.uid,
        )
        return
      }
      if (cell.effectKind === 'texasPot') {
        ctx.extra = { ...ctx.extra, ...addTexasPotFromBank(effectiveState(ctx), 1) }
        ctx.history = appendHistory(ctx.history, `${cell.label}：银行向德州公共底池投入 1 金币（不扣你的金币），并触发一次 CASINO。`, ctx.now, player.uid)
        ctx.followUps.push('CASINO')
        return
      }
      ctx.followUps.push('AVALON')
      return
    }
    case 'pendingRuling': {
      const description = typeof n === 'string' ? n : '这个格子的规则书没有写明结算方式'
      ctx.pendingDecision = { kind: 'HOST_RULING', description }
      ctx.history = appendHistory(ctx.history, `格子效果：${description}`, ctx.now, player.uid)
      return
    }
    default:
      return
  }
}

function resolveCollisions(ctx: LandingContext, mover: GamePlayerState): void {
  const victims = Object.values(ctx.players).filter((p) => p.uid !== mover.uid && p.position === mover.position && p.zone.kind === 'ring')
  if (victims.length === 0) return
  ctx.dreamCandidates.push(...victims.map((v) => v.uid))
  const outcome = collisionOutcome(currentTarot(ctx))
  if (outcome.kind === 'back') ctx.tarotNotes.push('力量：碰撞不再退回起点，改为退 3 格')

  for (const victim of victims) {
    victim.position =
      outcome.kind === 'toStart' ? startCellIdForColor(victim.color) : computeNewPosition(victim.position, -outcome.steps)
    ctx.pendingDrinkAcks = pushDrinkAck(ctx.pendingDrinkAcks, victim.uid, 1, '被撞', ctx.now)
    ctx.history = appendHistory(
      ctx.history,
      `碰撞！撞到了其他玩家，对方喝 1 口并${outcome.kind === 'toStart' ? '退回自己的起点' : '后退 3 格'}。`,
      ctx.now,
      mover.uid,
    )
  }
}

// ---------------------------------------------------------------------------
// 动作 3：处理落点的待确认事项
// ---------------------------------------------------------------------------

export function applyBuyPropertyDecision(state: GameState, uid: string, buy: boolean, now: number): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'BUY_PROPERTY') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的购买地产决定')
  }
  const players = clonePlayers(state)
  const player = players[uid]!
  if (buy && player.coins < decision.price) {
    throw new GameActionError('INVALID_GAME_ACTION', `金币不足，买下需要 ${decision.price} 金币`)
  }
  if (buy) {
    player.coins -= decision.price
    player.properties.push(decision.propertyName)
  }
  return {
    ...state,
    players,
    history: appendHistory(
      state.history,
      buy ? `花 ${decision.price} 金币买下了「${decision.propertyName}」。` : `放弃购买「${decision.propertyName}」。`,
      now,
      uid,
    ),
    turn: { ...state.turn, pendingDecision: null },
  }
}

export function applyChooseDrinkTargetDecision(state: GameState, uid: string, targetUid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'CHOOSE_DRINK_TARGET') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的指定喝酒目标')
  }
  requirePlayer(state, targetUid)
  return {
    ...state,
    pendingDrinkAcks: pushDrinkAck(state.pendingDrinkAcks, targetUid, decision.amount, decision.reason, now),
    history: appendHistory(state.history, `指定了一名玩家喝 ${decision.amount} 口。`, now, uid),
    turn: { ...state.turn, pendingDecision: null },
  }
}

/** 真心话大冒险第一步：选择真心话或大冒险（女祭司/倒吊人下已经自动选好） */
export function applyTruthOrDareChoice(
  state: GameState,
  uid: string,
  choice: 'TRUTH' | 'DARE',
  now: number,
  rng: () => number = Math.random,
): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'TRUTH_OR_DARE' || decision.choice !== null) {
    throw new GameActionError('INVALID_GAME_ACTION', '当前不需要选择真心话或大冒险')
  }
  if (!allowedTruthOrDareChoices(state.currentTarotId).includes(choice)) {
    throw new GameActionError('INVALID_GAME_ACTION', '当前世界塔罗不允许这个选择')
  }
  return withDrawnPrompt(
    {
      ...state,
      history: appendHistory(state.history, `选择了「${choice === 'TRUTH' ? '真心话' : '大冒险'}」。`, now, uid),
      turn: { ...state.turn, pendingDecision: { kind: 'TRUTH_OR_DARE', choice } },
    },
    rng,
  )
}

/** V1.6：从题库抽一题写进共享状态（所有人看到同一题）；V1.5 旧房间继续用线下的牌 */
function withDrawnPrompt(state: GameState, rng: () => number): GameState {
  const d = state.turn.pendingDecision
  if (state.rulesVersion !== 2 || !d || d.kind !== 'TRUTH_OR_DARE' || d.choice === null) return state
  const prompt = drawPrompt(d.choice, state.usedPromptIds, rng)
  return {
    ...state,
    usedPromptIds: [...state.usedPromptIds, prompt.id].slice(-40),
    turn: { ...state.turn, pendingDecision: { ...d, promptId: prompt.id } },
  }
}

/** V1.6：房主觉得题目不合适时换一题（不受罚），游戏继续 */
export function applyRedrawTruthOrDare(state: GameState, callerUid: string, hostUid: string, now: number, rng: () => number = Math.random): GameState {
  if (callerUid !== hostUid && callerUid !== state.turn.currentPlayerUid) throw new GameActionError('INVALID_GAME_ACTION', '只有房主或当前玩家可以换题')
  const d = state.turn.pendingDecision
  if (!d || d.kind !== 'TRUTH_OR_DARE' || d.choice === null) throw new GameActionError('INVALID_GAME_ACTION', '现在没有可以换的题目')
  return withDrawnPrompt({ ...state, history: appendHistory(state.history, '换了一道题。', now, callerUid) }, rng)
}

/** 拒绝真心话大冒险需要上缴的金币：floor(当前金币 / 2)。界面事先显示这个金额。 */
export function truthOrDareRefusalPenalty(coins: number): number {
  return Math.floor(Math.max(0, coins) / 2)
}

/**
 * 真心话大冒险第二步：线下完成后确认结果。
 * completed：完成后按塔罗（女祭司/倒吊人/皇后）从银行领 1 金币。
 * 拒绝：原稿"不做/不答 = 上缴自身 1/2 资产 + 喝半杯"，按 Q13 补充方案结算。
 */
export function applyTruthOrDareResult(state: GameState, uid: string, completed: boolean, now: number): GameState {
  requireCurrentPlayer(state, uid)
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'TRUTH_OR_DARE' || decision.choice === null) {
    throw new GameActionError('INVALID_GAME_ACTION', '请先选择真心话或大冒险')
  }
  const players = clonePlayers(state)
  const label = decision.choice === 'TRUTH' ? '真心话' : '大冒险'
  let history = state.history
  let pendingDrinkAcks = state.pendingDrinkAcks
  const tarotNotes = [...state.turn.tarotNotes]

  if (completed) {
    const bonus = truthOrDareCompletionBonus(state.currentTarotId)
    if (bonus > 0) {
      payFromBank(state, players, uid, bonus)
      tarotNotes.push(`${getTarotCard(state.currentTarotId).name}：完成${label}，从银行得 ${bonus} 金币`)
    }
    history = appendHistory(history, `完成了${label}${bonus > 0 ? `，从银行得 ${bonus} 金币` : ''}。`, now, uid)
  } else {
    // Q13 补充方案：资产仅指当前金币；上缴 floor(金币/2) 给银行（不转给其他玩家），地产/手牌不变。
    // 半杯是线下确认事件，可以用非酒精饮品代替。整个结算在这一次动作里完成，
    // pendingDecision 随之清空，重复提交会因为"请先选择"被拒绝，不会多次扣款。
    const lost = truthOrDareRefusalPenalty(players[uid]!.coins)
    players[uid]!.coins -= lost
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, uid, 0, `拒绝${label}（可用非酒精饮品代替）`, now, '半杯')
    history = appendHistory(history, `拒绝了${label}：上缴 ${lost} 金币给银行，并喝半杯。`, now, uid)
  }

  return { ...state, players, pendingDrinkAcks, history, turn: { ...state.turn, pendingDecision: null, tarotNotes } }
}

export function applyHostRulingAck(state: GameState, callerUid: string, hostUid: string, now: number): GameState {
  if (callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以确认现场裁定结果')
  }
  const decision = state.turn.pendingDecision
  if (!decision || decision.kind !== 'HOST_RULING') {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待房主裁定的事项')
  }
  return {
    ...state,
    history: appendHistory(state.history, `房主已对「${decision.description}」现场裁定完毕。`, now, callerUid),
    turn: { ...state.turn, pendingDecision: null },
  }
}

/**
 * V1.6 补充 Q14：本回合有停骰/禁骰时，当前玩家点"停骰：直接翻主牌"——不掷骰、不移动、不触发落点，
 * 照常翻小姐牌和出战术牌，结束回合时已经清除。
 */
export function applySkipRollTurn(state: GameState, uid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'ROLLING' || state.turn.extraRollPending) throw new GameActionError('INVALID_GAME_ACTION', '现在不是回合开始的掷骰阶段')
  if (state.turn.pendingDecision) throw new GameActionError('INVALID_GAME_ACTION', '还有未处理的塔罗事件')
  const players = clonePlayers(state)
  if (!players[uid]!.skipNextRoll) throw new GameActionError('INVALID_GAME_ACTION', '你本回合没有停骰')
  players[uid]!.skipNextRoll = false
  return {
    ...state,
    players,
    turn: { ...state.turn, phase: 'LADY_CARD', rollSkipped: true },
    history: appendHistory(state.history, '停骰：本回合不掷骰、不移动，直接翻小姐牌。', now, uid),
  }
}

// ---------------------------------------------------------------------------
// 动作 4：从 LANDING 推进（额外掷骰 / 翻主牌）
// ---------------------------------------------------------------------------

export function applyAdvanceAfterLanding(state: GameState, uid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'LANDING') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是落点结算阶段')
  }
  if (!state.turn.landingResolved) {
    throw new GameActionError('INVALID_GAME_ACTION', '落点还没结算完')
  }
  if (state.turn.pendingDecision) {
    throw new GameActionError('INVALID_GAME_ACTION', '还有未处理的事项，不能继续')
  }
  const roll = state.turn.lastRoll
  if (!roll) throw new GameActionError('INVALID_GAME_ACTION', '没有掷骰记录')

  const finished = state.players[uid]?.reachedFinish === true
  if (roll.grantsExtraRoll && !state.turn.extraRollPending && !state.turn.extraRollUsed && !finished) {
    return {
      ...state,
      turn: { ...state.turn, phase: 'ROLLING', extraRollPending: true, lastRoll: null, landingResolved: false },
      history: appendHistory(state.history, '今晚手气爆棚！自然 6，额外掷一次骰子（只结算落点，不再翻主牌；额外骰再出 6 也不会再加一次）。', now, uid),
    }
  }
  if (state.turn.extraRollPending) {
    return { ...state, turn: { ...state.turn, phase: 'LADY_CARD', extraRollPending: false, extraRollUsed: true } }
  }
  return { ...state, turn: { ...state.turn, phase: 'LADY_CARD' } }
}

// ---------------------------------------------------------------------------
// 动作 5：翻小姐主牌（LADY_CARD -> TACTIC）
// ---------------------------------------------------------------------------

export interface RevealLadyCardOutcome {
  state: GameState
  heartAttackTriggered: boolean
}

/**
 * 翻主牌：从共享牌堆顶抽一张（不是客户端随机生成），写入最近 5 张窗口，
 * 再按花色分别求和判断德国心脏病。抽牌、窗口、牌堆变化在同一次乐观锁写入里落库，
 * 重复点击/刷新会被"本回合已经翻过主牌"拒绝，不会重复抽牌。
 */
export function applyRevealLadyCard(
  state: GameState,
  uid: string,
  now: number,
  rng: () => number = Math.random,
): RevealLadyCardOutcome {
  requireCurrentPlayer(state, uid)
  if (state.endgame) throw new GameActionError('INVALID_GAME_ACTION', '已经进入终局，不再翻小姐牌')
  if (state.turn.phase !== 'LADY_CARD') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是翻主牌阶段')
  }
  if (state.turn.revealedLadyCardId) {
    throw new GameActionError('INVALID_GAME_ACTION', '本回合已经翻过主牌了')
  }

  const draw = drawFromLadyDeck(state.ladyDeck, state.ladyDiscard, state.recentLadyCards, rng)
  const cardId = draw.cardId
  const card = getLadyCard(cardId)
  const recentLadyCards = [...state.recentLadyCards, cardId].slice(-LADY_WINDOW_SIZE)
  const check = heartAttackCheck(recentLadyCards)

  let history = state.history
  if (draw.reshuffled) history = appendHistory(history, '主牌牌堆抽完了，把桌面以外的旧牌重新洗回牌堆。', now)
  history = appendHistory(history, `翻到主牌「${formatLadyCard(cardId)} ${card.name}」。${card.description}`, now, uid)

  let pendingHeartAttack = state.pendingHeartAttack
  if (check.triggeredSuits.length > 0) {
    pendingHeartAttack = { id: `heart-${now}`, triggeredSuits: check.triggeredSuits, windowCardIds: recentLadyCards, revealedByUid: uid, createdAt: now }
    const detail = check.triggeredSuits.map((t) => `${LADY_SUIT_LABEL[t.suit].name}合计 ${t.count}`).join('、')
    history = appendHistory(history, `德国心脏病触发！最近 5 张里${detail}，是 5 的倍数。请房主确认第一反应者。`, now, uid)
  }

  const drawn: GameState = {
    ...state,
    ladyDeck: draw.deck,
    ladyDiscard: draw.discard,
    recentLadyCards,
    pendingHeartAttack,
    turn: { ...state.turn, revealedLadyCardId: cardId },
    history,
  }

  // 已确认的牌（K）和候选规则预览房间里的候选牌走统一的小姐牌事件框架（engine/ladyEvents.ts）；
  // 其余仍交给房主现场裁定
  const evented = startLadyEvent(drawn, cardId, uid, now)
  const pendingDecision: PendingDecision = { kind: 'HOST_RULING', description: `小姐主牌「${formatLadyCard(cardId)} ${card.name}」：${card.description}` }

  return {
    state: evented ?? { ...drawn, turn: { ...drawn.turn, phase: 'TACTIC', pendingDecision } },
    heartAttackTriggered: check.triggeredSuits.length > 0,
  }
}

/**
 * 德国心脏病结算：房主录入线下的第一反应者和误抢者。
 * 第一名从银行得 1 金币（星星塔罗为 2 金币），误抢每人罚 1 口。
 * firstUid 为 null 表示无人正确反应。
 */
export function applyResolveHeartAttack(
  state: GameState,
  callerUid: string,
  hostUid: string,
  firstUid: string | null,
  falseStartUids: string[],
  now: number,
): GameState {
  if (callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有房主可以确认德国心脏病的结果')
  }
  if (!state.pendingHeartAttack) {
    throw new GameActionError('INVALID_GAME_ACTION', '当前没有待处理的德国心脏病事件')
  }
  if (firstUid) requirePlayer(state, firstUid)
  for (const u of falseStartUids) requirePlayer(state, u)

  const players = clonePlayers(state)
  let pendingDrinkAcks = state.pendingDrinkAcks
  let history = state.history
  const tarotNotes = [...state.turn.tarotNotes]

  if (firstUid) {
    const reward = heartAttackReward(state.currentTarotId)
    payFromBank(state, players, firstUid, reward)
    if (state.currentTarotId === TAROT_ID.STAR) tarotNotes.push('星星：心脏病第一反应者改为获得 2 金币')
    history = appendHistory(history, `德国心脏病：第一反应，从银行得 ${reward} 金币。`, now, firstUid)
  } else {
    history = appendHistory(history, '德国心脏病：房主确认本次没有人正确反应。', now, callerUid)
  }
  for (const u of falseStartUids) {
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, u, 1, '德国心脏病误抢', now)
    history = appendHistory(history, '德国心脏病：误抢，罚 1 口。', now, u)
  }

  return { ...state, players, pendingDrinkAcks, pendingHeartAttack: null, history, turn: { ...state.turn, tarotNotes } }
}

// ---------------------------------------------------------------------------
// 非阻塞喝酒提醒：本人或房主处理，不卡住当前回合
// ---------------------------------------------------------------------------

export function applyResolveDrinkAck(
  state: GameState,
  callerUid: string,
  hostUid: string,
  ackId: string,
  choice: DrinkAckChoice,
  now: number,
  devilTargetUid: string | null = null,
): GameState {
  const ack = state.pendingDrinkAcks.find((a) => a.id === ackId)
  if (!ack) throw new GameActionError('INVALID_GAME_ACTION', '这条喝酒提醒不存在或已经处理过了')
  if (callerUid !== ack.targetUid && callerUid !== hostUid) {
    throw new GameActionError('INVALID_GAME_ACTION', '只有本人或房主可以确认这条喝酒提醒')
  }
  // V1.6 补充 Q5：节制只禁用游戏机制里的挡酒/免罚（桃、替喝、吹牛免罚）；
  // 以水代替和跳过是玩家的健康选择，任何时候都可以，也不产生金币处罚。
  if (ack.bluff || ack.substituteOffer) throw new GameActionError('INVALID_GAME_ACTION', '这条记录正在吹牛或替喝流程中，请先完成那一步')

  // 待处理的金币惩罚：只能支付（金币不足按实际余额），不能以水代替/跳过/恶魔转嫁
  if (ack.coinPenalty) {
    if (choice !== 'PAY') throw new GameActionError('INVALID_GAME_ACTION', '这是金币惩罚，只能支付或吹牛')
    const players = clonePlayers(state)
    const p = players[ack.targetUid]!
    const paid = Math.min(ack.coinPenalty, p.coins)
    p.coins -= paid
    return {
      ...state,
      players,
      pendingDrinkAcks: state.pendingDrinkAcks.filter((a) => a.id !== ackId),
      history: appendHistory(state.history, `${ack.reason}：支付 ${paid} 金币${paid < ack.coinPenalty ? '（金币不足，按实际余额）' : ''}。`, now, ack.targetUid),
    }
  }
  if (choice === 'PAY') throw new GameActionError('INVALID_GAME_ACTION', '这是喝酒提醒，不需要支付金币')

  let players = state.players
  let pendingDrinkAcks = state.pendingDrinkAcks.filter((a) => a.id !== ackId)

  if (choice === 'DEVIL') {
    if (state.currentTarotId !== TAROT_ID.DEVIL) {
      throw new GameActionError('INVALID_GAME_ACTION', '只有恶魔塔罗生效时才能这样处理')
    }
    if (ack.amount !== 1 || ack.amountText) {
      throw new GameActionError('INVALID_GAME_ACTION', '恶魔塔罗只能用于"被判 1 口"')
    }
    if (!devilTargetUid || devilTargetUid === ack.targetUid) {
      throw new GameActionError('INVALID_GAME_ACTION', '需要指定另一名玩家喝 2 口')
    }
    requirePlayer(state, devilTargetUid)
    players = clonePlayers(state)
    const self = players[ack.targetUid]!
    if (self.coins < 1) throw new GameActionError('INVALID_GAME_ACTION', '金币不足，需要 1 金币才能这样处理')
    self.coins -= 1
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, devilTargetUid, 2, '恶魔：被转嫁 2 口', now)
  }

  return {
    ...state,
    players,
    pendingDrinkAcks,
    history: appendHistory(state.history, `${ack.reason}：${DRINK_CHOICE_LABEL[choice]}。`, now, ack.targetUid),
  }
}

// ---------------------------------------------------------------------------
// 动作 6：战术牌
// ---------------------------------------------------------------------------

/**
 * 主动出牌（战术阶段，每回合最多 1 张）：杀、顺手牵羊。
 * 魔术师塔罗：每名玩家每回合第一次打出战术牌后补抽 1 张。
 */
export function applyPlayTacticCard(
  state: GameState,
  uid: string,
  cardId: string,
  targetUid: string | null,
  now: number,
  rng: () => number = Math.random,
  randomPick = 0,
): GameState {
  if (state.rulesVersion === 2) {
    // V1.6：主动牌进入统一响应窗口（闪 / 无懈可击 / 过河拆桥）
    if (!targetUid) throw new GameActionError('INVALID_GAME_ACTION', '需要指定一名目标玩家')
    return applyPlayActiveTactic(state, uid, cardId, targetUid, now, rng, randomPick)
  }
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'TACTIC') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是战术出牌阶段')
  }
  if (state.turn.activeTacticUsed) {
    throw new GameActionError('INVALID_GAME_ACTION', '本回合已经主动出过 1 张战术牌了')
  }
  const def = getTacticCard(cardId)
  // V1.5 旧房间：只有杀和顺手牵羊能主动打出（没有响应窗口）
  if (cardId !== 'tactic-sha' && cardId !== 'tactic-shunshou') {
    throw new GameActionError(
      'INVALID_GAME_ACTION',
      def.id === 'tactic-tao' ? `「${def.name}」是响应牌，请在喝酒提醒上使用` : `「${def.name}」在旧房间（V1.5 规则）里不能打出：旧房间没有响应窗口`,
    )
  }
  const players = clonePlayers(state)
  const player = players[uid]!
  const handIdx = player.tacticHand.indexOf(cardId)
  if (handIdx === -1) throw new GameActionError('INVALID_GAME_ACTION', '手牌中没有这张牌')
  if (!targetUid || targetUid === uid || !players[targetUid]) {
    throw new GameActionError('INVALID_GAME_ACTION', `「${def.name}」需要指定另一名玩家`)
  }

  let pendingDrinkAcks = state.pendingDrinkAcks
  let history = state.history

  if (cardId === 'tactic-shunshou') {
    const neighbors = [neighborUid(state, uid, -1), neighborUid(state, uid, 1)]
    if (!neighbors.includes(targetUid)) {
      throw new GameActionError('INVALID_GAME_ACTION', '顺手牵羊只能拿左边或右边相邻玩家的金币')
    }
    player.tacticHand.splice(handIdx, 1)
    const target = players[targetUid]!
    const taken = Math.min(1, target.coins)
    target.coins -= taken
    player.coins += taken
    history = appendHistory(history, `打出「顺手牵羊」，拿走了相邻玩家 ${taken} 金币。`, now, uid)
  } else {
    player.tacticHand.splice(handIdx, 1)
    pendingDrinkAcks = pushDrinkAck(pendingDrinkAcks, targetUid, 1, '被「杀」指定', now)
    history = appendHistory(history, '打出「杀」，指定一名玩家喝 1 口。', now, uid)
  }

  const refill = refillForMagician(state, players, uid, now, rng, history)
  return {
    ...state,
    players,
    pendingDrinkAcks,
    history: refill.history,
    turn: {
      ...state.turn,
      activeTacticUsed: true,
      playersWhoPlayedTacticThisTurn: [...new Set([...state.turn.playersWhoPlayedTacticThisTurn, uid])],
      tarotNotes: refill.note ? [...state.turn.tarotNotes, refill.note] : state.turn.tarotNotes,
    },
  }
}

/**
 * 桃（响应牌，随时可用，不受"每回合 1 张"限制）：在一条喝酒提醒上使用，取消 1 口。
 * 用在别人的喝酒提醒上 = "救别人"，出牌者从银行得 1 金币。
 * 节制塔罗下挡酒/免罚失效，不能使用。
 */
export function applyUsePeach(
  state: GameState,
  callerUid: string,
  ackId: string,
  now: number,
  rng: () => number = Math.random,
): GameState {
  if (drinkExemptionsDisabled(state.currentTarotId)) {
    throw new GameActionError('INVALID_GAME_ACTION', '节制塔罗生效中：挡酒/免罚效果失效，不能用桃')
  }
  const ack = state.pendingDrinkAcks.find((a) => a.id === ackId)
  if (!ack) throw new GameActionError('INVALID_GAME_ACTION', '这条喝酒提醒不存在或已经处理过了')
  if (ack.amountText || ack.coinPenalty) throw new GameActionError('INVALID_GAME_ACTION', '桃只能取消"口"为单位的惩罚')
  if (ack.bluff || ack.substituteOffer) throw new GameActionError('INVALID_GAME_ACTION', '这条提醒正在吹牛或替喝流程中')

  const players = clonePlayers(state)
  const caller = players[callerUid]
  if (!caller) throw new GameActionError('INVALID_GAME_ACTION', '找不到你的游戏状态')
  const idx = caller.tacticHand.indexOf('tactic-tao')
  if (idx === -1) throw new GameActionError('INVALID_GAME_ACTION', '手牌中没有「桃」')
  caller.tacticHand.splice(idx, 1)

  const remaining = ack.amount - 1
  const pendingDrinkAcks = state.pendingDrinkAcks
    .map((a) => (a.id === ackId ? { ...a, amount: remaining } : a))
    .filter((a) => a.amount > 0)

  const savingOther = callerUid !== ack.targetUid
  if (savingOther) payFromBank(state, players, callerUid, 1)
  const refill = refillForMagician(
    state,
    players,
    callerUid,
    now,
    rng,
    appendHistory(
      state.history,
      savingOther ? '打出「桃」救了别人，对方少喝 1 口，自己从银行得 1 金币。' : '打出「桃」，自己少喝 1 口。',
      now,
      callerUid,
    ),
  )
  const history = refill.history

  return {
    ...state,
    players,
    pendingDrinkAcks,
    history,
    turn: {
      ...state.turn,
      playersWhoPlayedTacticThisTurn: [...new Set([...state.turn.playersWhoPlayedTacticThisTurn, callerUid])],
      tarotNotes: refill.note ? [...state.turn.tarotNotes, refill.note] : state.turn.tarotNotes,
    },
  }
}

function refillForMagician(
  state: GameState,
  players: Record<string, GamePlayerState>,
  uid: string,
  now: number,
  rng: () => number,
  history: GameState['history'],
): { history: GameState['history']; note: string | null } {
  const already = state.turn.playersWhoPlayedTacticThisTurn.includes(uid)
  if (!magicianRefill(state.currentTarotId, already)) return { history, note: null }
  const p = players[uid]!
  if (p.tacticHand.length >= TACTIC_HAND_LIMIT) {
    return { history: appendHistory(history, '魔术师：本应补抽 1 张，但手牌已满。', now, uid), note: '魔术师：手牌已满，未补抽' }
  }
  p.tacticHand.push(drawRandomTacticCardId(rng))
  return { history: appendHistory(history, '魔术师：本回合第一次出牌，补抽 1 张战术牌。', now, uid), note: '魔术师：出牌后补抽 1 张' }
}

export function applySkipTactic(state: GameState, uid: string, now: number): GameState {
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'TACTIC') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是战术出牌阶段')
  }
  return { ...state, history: appendHistory(state.history, '跳过了战术出牌。', now, uid) }
}

// ---------------------------------------------------------------------------
// 动作 7：结束回合（TACTIC -> 下一位玩家的 ROLLING）
// ---------------------------------------------------------------------------

export function applyEndTurn(state: GameState, uid: string, now: number): GameState {
  if (state.finished || state.endgame) throw new GameActionError('INVALID_GAME_ACTION', '已经进入终局，不能再结束地图回合')
  requireCurrentPlayer(state, uid)
  if (state.turn.phase !== 'TACTIC') {
    throw new GameActionError('INVALID_GAME_ACTION', '现在不是可以结束回合的阶段')
  }
  if (state.turn.pendingDecision) {
    throw new GameActionError('INVALID_GAME_ACTION', '还有未处理的事项，不能结束回合')
  }
  if (state.tacticStack) throw new GameActionError('INVALID_GAME_ACTION', '还有一张战术牌在等待响应')
  if (state.ladyEvent && state.ladyEvent.status === 'ACTIVE') throw new GameActionError('INVALID_GAME_ACTION', '小姐牌事件还没结束')
  if (state.dream && state.dream.step !== 'DONE' && state.dream.step !== 'OPEN') throw new GameActionError('INVALID_GAME_ACTION', '梦幻挑战还没结束')
  if (state.rulesVersion === 2 && state.players[uid]?.reachedFinish && !state.endgame) {
    // 进入终局前，会影响金币/得分的未完成事项要先处理完（平时这些是非阻塞的）
    if (state.pendingHeartAttack) throw new GameActionError('INVALID_GAME_ACTION', '进入终局前，请房主先确认德国心脏病的结果')
    if (state.texas.betting) throw new GameActionError('INVALID_GAME_ACTION', '进入终局前，请先完成本阶段德州下注（房主可以结束下注）')
    if (state.pendingDrinkAcks.some((a) => a.bluff)) throw new GameActionError('INVALID_GAME_ACTION', '进入终局前，请先完成正在进行的吹牛质疑')
    return startEndgame(state, uid, now)
  }
  const nextIndex = (state.currentPlayerIndex + 1) % state.turnOrder.length
  const nextUid = state.turnOrder[nextIndex]
  if (!nextUid) throw new Error('找不到下一位玩家，不应该发生')

  const players = clonePlayers(state)
  let history = appendHistory(state.history, '回合结束，轮到下一位玩家。', now, uid)
  const tarotNotes: string[] = []

  // 隐者：回合开始时独自占据一个格子，从银行得 1 金币
  const hermit = hermitBonus(state.currentTarotId, state, nextUid)
  if (hermit > 0) {
    payFromBank(state, players, nextUid, hermit)
    tarotNotes.push('隐者：回合开始时独自占据一格，得 1 金币')
    history = appendHistory(history, '隐者：回合开始时独自占据一格，从银行得 1 金币。', now, nextUid)
  }

  return {
    ...state,
    players,
    // 本回合的小姐牌事件、未提出的梦幻挑战随回合结束清空；持续状态在 ladyStatus 里
    ladyEvent: null,
    dream: null,
    currentPlayerIndex: nextIndex,
    turnNumber: state.turnNumber + 1,
    turn: {
      phase: 'ROLLING',
      currentPlayerUid: nextUid,
      lastRoll: null,
      extraRollPending: false,
      extraRollUsed: false,
      pendingDecision: null,
      revealedLadyCardId: null,
      landingResolved: false,
      playersWhoPlayedTacticThisTurn: [],
      tarotNotes,
      activeTacticUsed: false,
      rollSkipped: false,
    },
    history,
  }
}
