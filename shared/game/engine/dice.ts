import type { DiceRollRecord } from '../types'

/** 真实 d6：1-6 等概率，不接入任何塔罗修正（本轮范围声明见 cards/tarotCards.ts） */
export function rollD6(): number {
  return Math.floor(Math.random() * 6) + 1
}

export function buildRollRecord(natural: number): DiceRollRecord {
  return { natural, effective: natural, isNaturalSix: natural === 6 }
}
