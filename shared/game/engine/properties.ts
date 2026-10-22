import type { GamePlayerState } from '../types'
import { getPropertySetMembers, PROPERTIES_PER_SET, type PropertySetColor } from '../board'

/** 计入租金加成和完整套装的地产：已抵押的不算（V1.6 补充） */
export function activeProperties(p: Pick<GamePlayerState, 'properties' | 'mortgaged'>): string[] {
  return p.properties.filter((n) => !p.mortgaged.includes(n))
}

/** 有效完整同色套装数（抵押地产不计入） */
export function fullSetCount(p: Pick<GamePlayerState, 'properties' | 'mortgaged'>): number {
  const active = activeProperties(p)
  return (['R', 'G', 'B', 'Y'] as PropertySetColor[]).filter((c) => getPropertySetMembers(c).filter((n) => active.includes(n)).length >= PROPERTIES_PER_SET).length
}
