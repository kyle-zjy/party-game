import type { DiceRollRecord } from '../types'
import { modifyDiceRoll } from './tarotEffects'

/** 真实 d6：1-6 等概率 */
export function rollD6(rng: () => number = Math.random): number {
  return Math.floor(rng() * 6) + 1
}

/** 自然点数 + 当前世界塔罗（愚者/战车）修正 */
export function buildRollRecord(natural: number, tarotId: string): DiceRollRecord {
  const mod = modifyDiceRoll(tarotId, natural)
  return {
    natural,
    effective: mod.effective,
    isNaturalSix: natural === 6,
    grantsExtraRoll: mod.grantsExtraRoll,
    tarotNote: mod.note,
  }
}
