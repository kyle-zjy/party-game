/**
 * V1.6 补充：外圈以外的地图区域（神鬼道、河道/桥、天堂地狱）在一次地图移动里怎么走。
 * 节点和外圈连接点来自 PPTX，见 shared/game/godsPath.ts 的说明。
 *
 * 一次地图移动（applyResolveLanding）在 V1.6 房间里先调用 planMove：
 * - 外圈：逐格前进；经过自己的起点记一圈（开启神鬼道）；
 *   跨过河道空档时停在河岸，产生 RIVER_CROSS 决定；经过神鬼道入口格时，若神鬼道已开启，停在入口格询问是否进入（ENTER_GODS）。
 * - 神鬼道：沿方向移动，恰好停在终点 = 抵达；穿过终点继续走，走出另一端回到外圈入口格。
 * - 桥：每次掷骰前进，走完 13 步回到对岸外圈格。
 * 天堂/地狱金币和桥上 2 口，以掷骰前所在区域为准，只对地图移动骰生效。
 */
import { BOARD_SIZE } from '../board'
import {
  BRIDGE_DRINK_PER_ROLL,
  BRIDGE_LENGTH,
  BRIDGE_TOLL,
  distanceToFinish,
  GODS_BOTTOM_ENTRANCE_NODE,
  GODS_BOTTOM_RING_CELL,
  GODS_FINISH_NODE,
  GODS_TOP_ENTRANCE_NODE,
  GODS_TOP_RING_CELL,
  godsRegion,
  moveOnGods,
  RIVER_CROSSINGS,
} from '../godsPath'
import type { GamePlayerState, GameState, PendingDecision } from '../types'
import { GameActionError } from './errors'
import { appendHistory } from './history'
import { computeNewPosition, startCellIdForColor } from './movement'
import { clonePlayers, pushDrinkAck } from './stateHelpers'

/** 神鬼道中离终点最近的玩家；距离相同时按当前行动顺序取前者。没有人在神鬼道时为 null */
export function riverGodUid(state: Pick<GameState, 'turnOrder' | 'players'>): string | null {
  let best: { uid: string; d: number } | null = null
  for (const uid of state.turnOrder) {
    const z = state.players[uid]?.zone
    if (!z || z.kind !== 'gods') continue
    const d = distanceToFinish(z.node)
    if (!best || d < best.d) best = { uid, d }
  }
  return best?.uid ?? null
}

export interface RingWalk {
  /** 实际停下的外圈格 */
  position: number
  /** 实际走了几步 */
  walked: number
  /** 经过（含停在）自己起点的次数 */
  startPasses: number
  stop: PendingDecision | null
}

/**
 * 外圈逐格前进 steps 步。遇到需要玩家选择的位置（河岸、神鬼道入口）立刻停下，剩余步数作废
 * ——V1.6 约定：选择本身就是这次移动的落点，避免"选完再继续走"带来的二次结算。
 */
export function walkRing(state: GameState, player: GamePlayerState, steps: number): RingWalk {
  const startCell = startCellIdForColor(player.color)
  let pos = player.position
  let startPasses = 0
  for (let i = 1; i <= steps; i += 1) {
    const crossing = RIVER_CROSSINGS.find((c) => c.fromCell === pos)
    if (crossing && state.rulesVersion === 2) {
      // 跨河空档：停在河岸，选择过桥 / 渡河
      return {
        position: pos,
        walked: i - 1,
        startPasses,
        stop: { kind: 'RIVER_CROSS', side: crossing.side, dir: 1, bankCell: crossing.fromCell, farCell: crossing.toCell },
      }
    }
    pos = computeNewPosition(pos, 1)
    if (pos === startCell) startPasses += 1
    if (state.rulesVersion === 2 && state.godsPathOpen && i === steps && (pos === GODS_TOP_RING_CELL || pos === GODS_BOTTOM_RING_CELL)) {
      return { position: pos, walked: i, startPasses, stop: { kind: 'ENTER_GODS', entranceNode: pos === GODS_TOP_RING_CELL ? GODS_TOP_ENTRANCE_NODE : GODS_BOTTOM_ENTRANCE_NODE } }
    }
  }
  return { position: pos, walked: steps, startPasses, stop: null }
}

/** 掷骰前所在区域的天堂/地狱/桥效果（只对地图移动骰） */
export function applyZoneRollEffects(
  players: Record<string, GamePlayerState>,
  uid: string,
  history: GameState['history'],
  acks: GameState['pendingDrinkAcks'],
  now: number,
  bankPay: (uid: string, amount: number) => void,
): { history: GameState['history']; acks: GameState['pendingDrinkAcks'] } {
  const z = players[uid]!.zone
  if (z.kind === 'gods') {
    const region = godsRegion(z.node)
    if (region === 'HEAVEN') {
      bankPay(uid, 1)
      history = appendHistory(history, '天堂：每次地图掷骰从银行得 1 金币。', now, uid)
    } else if (region === 'HELL') {
      const p = players[uid]!
      const lost = Math.min(1, p.coins)
      p.coins -= lost
      history = appendHistory(history, lost > 0 ? '地狱：每次地图掷骰向银行支付 1 金币。' : '地狱：本应支付 1 金币，但已经没有金币了。', now, uid)
    }
  } else if (z.kind === 'bridge') {
    acks = pushDrinkAck(acks, uid, BRIDGE_DRINK_PER_ROLL, '桥上每次掷骰喝 2 口', now)
    history = appendHistory(history, `桥上掷骰：喝 ${BRIDGE_DRINK_PER_ROLL} 口。`, now, uid)
  }
  return { history, acks }
}

export interface ZoneMoveResult {
  /** 移动结束后仍然不在外圈（神鬼道或桥上）：不结算外圈格子 */
  offRing: boolean
  reachedFinish: boolean
  /** 走回外圈后还要继续前进的步数（神鬼道出口、桥走完后） */
  ringLeftover: number
  message: string | null
}

/** 神鬼道 / 桥上的一次移动。直接修改 player */
export function moveOffRing(player: GamePlayerState, steps: number): ZoneMoveResult {
  const z = player.zone
  if (z.kind === 'gods') {
    const r = moveOnGods(z.node, z.dir, steps)
    if (r.node !== null) {
      player.zone = { kind: 'gods', node: r.node, dir: z.dir }
      if (r.reachedFinish) return { offRing: true, reachedFinish: true, ringLeftover: 0, message: '恰好停在终点！抵达终点。' }
      const passed = (z.dir === 1 && z.node < GODS_FINISH_NODE && r.node > GODS_FINISH_NODE) || (z.dir === -1 && z.node > GODS_FINISH_NODE && r.node < GODS_FINISH_NODE)
      return { offRing: true, reachedFinish: false, ringLeftover: 0, message: passed ? '没有恰好停在终点，穿过终点去往另一侧。' : null }
    }
    player.zone = { kind: 'ring' }
    player.position = r.exitRingCell!
    return { offRing: false, reachedFinish: false, ringLeftover: r.leftover, message: '走出神鬼道另一端，回到外圈。' }
  }
  if (z.kind === 'bridge') {
    const step = z.step + steps
    if (step < BRIDGE_LENGTH) {
      player.zone = { ...z, step }
      return { offRing: true, reachedFinish: false, ringLeftover: 0, message: `桥上前进 ${steps} 格（${step}/${BRIDGE_LENGTH}）。` }
    }
    const crossing = RIVER_CROSSINGS.find((c) => c.side === z.side)!
    player.zone = { kind: 'ring' }
    player.position = crossing.toCell
    return { offRing: false, reachedFinish: false, ringLeftover: step - BRIDGE_LENGTH, message: '走过了桥，到达对岸。' }
  }
  return { offRing: false, reachedFinish: false, ringLeftover: steps, message: null }
}

/** 渡河判定：4–6 成功，1–3 失败。天堂/地狱河神的判定固定 */
export function riverVerdict(playerRoll: number, godRoll: number, oracleRoll: number, godRegion: 'HEAVEN' | 'HELL' | 'FINISH'): {
  playerOk: boolean
  godAgrees: boolean
  needOracle: boolean
  success: boolean
} {
  const playerOk = playerRoll >= 4
  const godAgrees = godRegion === 'HEAVEN' ? true : godRegion === 'HELL' ? false : godRoll >= 4
  // 玩家成功且河神反对失败（同意）→ 成功；玩家失败且河神反对成功（不同意）→ 失败；其余同向判定，看神谕
  if (playerOk && godAgrees) return { playerOk, godAgrees, needOracle: false, success: true }
  if (!playerOk && !godAgrees) return { playerOk, godAgrees, needOracle: false, success: false }
  return { playerOk, godAgrees, needOracle: true, success: oracleRoll >= 4 }
}

/**
 * 河岸选择：过桥（付 1 金币，不足按实际支付并记录减免）或渡河（三颗独立骰，由数据库层在重试循环外掷出）。
 * 渡河成功：到对岸外圈格；失败：留在河岸。两种都不再继续移动、不额外掷骰。
 */
export function applyRiverChoice(
  state: GameState,
  uid: string,
  choice: 'BRIDGE' | 'FORD',
  dice: { player: number; god: number; oracle: number },
  now: number,
): GameState {
  if (state.turn.currentPlayerUid !== uid) throw new GameActionError('NOT_YOUR_TURN', '还没轮到你操作')
  const d = state.turn.pendingDecision
  if (!d || d.kind !== 'RIVER_CROSS') throw new GameActionError('INVALID_GAME_ACTION', '现在不需要选择过河方式')
  const god = riverGodUid(state)
  if (choice === 'FORD' && !god) throw new GameActionError('INVALID_GAME_ACTION', '现在没有河神，只能过桥')
  const players = clonePlayers(state)
  const p = players[uid]!
  let history = state.history

  if (choice === 'BRIDGE') {
    const paid = Math.min(BRIDGE_TOLL, p.coins)
    p.coins -= paid
    p.zone = { kind: 'bridge', side: d.side, step: 0, dir: d.dir }
    history = appendHistory(
      history,
      paid === BRIDGE_TOLL ? `选择过桥：支付过桥费 ${BRIDGE_TOLL} 金币，桥长 ${BRIDGE_LENGTH} 格，之后每次在桥上掷骰喝 ${BRIDGE_DRINK_PER_ROLL} 口。` : '选择过桥：金币不足，过桥费减免（不会卡住游戏）。',
      now,
      uid,
    )
  } else {
    const godZone = players[god!]!.zone
    const region = godZone.kind === 'gods' ? godsRegion(godZone.node) : 'FINISH'
    const v = riverVerdict(dice.player, dice.god, dice.oracle, region)
    const godText = region === 'HEAVEN' ? '天堂河神固定"同意"' : region === 'HELL' ? '地狱河神固定"反对"' : `河神掷出 ${dice.god}（${v.godAgrees ? '同意' : '反对'}）`
    const oracleText = v.needOracle ? `，判定相抵，神谕骰 ${dice.oracle}` : ''
    if (v.success) p.position = d.farCell
    history = appendHistory(
      history,
      `渡河判定：你掷出 ${dice.player}（${v.playerOk ? '成功' : '失败'}），${godText}${oracleText} → ${v.success ? '渡河成功，到达对岸' : '渡河失败，留在河岸'}。`,
      now,
      uid,
    )
  }
  return { ...state, players, history, turn: { ...state.turn, pendingDecision: null } }
}

export function applyEnterGods(state: GameState, uid: string, enter: boolean, now: number): GameState {
  if (state.turn.currentPlayerUid !== uid) throw new GameActionError('NOT_YOUR_TURN', '还没轮到你操作')
  const d = state.turn.pendingDecision
  if (!d || d.kind !== 'ENTER_GODS') throw new GameActionError('INVALID_GAME_ACTION', '现在不需要选择是否进入神鬼道')
  const players = clonePlayers(state)
  if (enter) players[uid]!.zone = { kind: 'gods', node: d.entranceNode, dir: d.entranceNode === GODS_TOP_ENTRANCE_NODE ? 1 : -1 }
  const god = enter ? riverGodUid({ turnOrder: state.turnOrder, players }) : null
  return {
    ...state,
    players,
    history: appendHistory(
      state.history,
      enter
        ? `进入神鬼道（${d.entranceNode === GODS_TOP_ENTRANCE_NODE ? '天堂一侧' : '地狱一侧'}）！之后每次掷骰沿竖排走向终点。${god === uid ? '你现在是河神。' : ''}`
        : '没有进入神鬼道，继续留在外圈。',
      now,
      uid,
    ),
    turn: { ...state.turn, pendingDecision: null },
  }
}

export function ringSize(): number {
  return BOARD_SIZE
}
