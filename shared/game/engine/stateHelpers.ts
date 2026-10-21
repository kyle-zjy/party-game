import type { GamePlayerState, GameState, PendingDrinkAck } from '../types'
import { GameActionError } from './errors'

export function clonePlayers(state: GameState): Record<string, GamePlayerState> {
  const copy: Record<string, GamePlayerState> = {}
  for (const [uid, p] of Object.entries(state.players)) {
    copy[uid] = { ...p, properties: [...p.properties], tacticHand: [...p.tacticHand] }
  }
  return copy
}

export function requirePlayer(state: GameState, uid: string): GamePlayerState {
  const p = state.players[uid]
  if (!p) throw new GameActionError('INVALID_GAME_ACTION', '找不到这名玩家的游戏状态')
  return p
}

export function pushDrinkAck(
  acks: PendingDrinkAck[],
  targetUid: string,
  amount: number,
  reason: string,
  now: number,
  amountText?: string,
): PendingDrinkAck[] {
  return [
    ...acks,
    {
      id: `drink-${now}-${Math.random().toString(36).slice(2, 8)}`,
      targetUid,
      amount,
      reason,
      createdAt: now,
      ...(amountText ? { amountText } : {}),
    },
  ]
}

/** 按固定玩家顺序取相邻玩家：direction 1 为下家，-1 为上家 */
export function neighborUid(state: GameState, uid: string, direction: 1 | -1): string {
  const idx = state.turnOrder.indexOf(uid)
  const n = state.turnOrder.length
  const neighbor = state.turnOrder[(((idx + direction) % n) + n) % n]
  if (!neighbor) throw new Error('找不到相邻玩家，不应该发生')
  return neighbor
}
