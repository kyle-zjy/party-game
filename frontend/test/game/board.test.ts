import { describe, expect, it } from 'vitest'
import {
  BOARD_CELLS,
  BOARD_SIZE,
  computeRent,
  findPropertyCellByName,
  getCell,
  getPropertySetMembers,
  isPropertyCell,
  isStartCell,
} from '../../../shared/game/board'

describe('board data integrity (extracted from 棋盘v1.pptx)', () => {
  it('has 74 cells forming a full ring', () => {
    expect(BOARD_SIZE).toBe(74)
    expect(BOARD_CELLS).toHaveLength(74)
    expect(BOARD_CELLS.map((c) => c.id)).toEqual(Array.from({ length: 74 }, (_, i) => i))
  })

  it('has exactly 4 start cells, one per color', () => {
    const starts = BOARD_CELLS.filter(isStartCell)
    expect(starts).toHaveLength(4)
    expect(new Set(starts.map((s) => s.color))).toEqual(new Set(['R', 'G', 'B', 'Y']))
  })

  it('has exactly 12 property cells, 3 per color set', () => {
    const properties = BOARD_CELLS.filter(isPropertyCell)
    expect(properties).toHaveLength(12)
    for (const color of ['R', 'G', 'B', 'Y'] as const) {
      expect(getPropertySetMembers(color)).toHaveLength(3)
    }
  })

  it('getCell wraps around the ring for out-of-range positions', () => {
    expect(getCell(0).id).toBe(0)
    expect(getCell(74).id).toBe(0)
    expect(getCell(-1).id).toBe(73)
    expect(getCell(75).id).toBe(1)
  })
})

describe('computeRent', () => {
  it('charges base rent when owner has only this one property', () => {
    const cell = findPropertyCellByName('子女宫')!
    expect(computeRent(['子女宫'], '子女宫')).toBe(1)
    void cell
  })

  it('charges same-color rent when owner has 2 properties in that color set', () => {
    const members = getPropertySetMembers('R')
    expect(computeRent([members[0]!, members[1]!], members[0]!)).toBe(2)
  })

  it('charges full-set rent when owner has all 3 properties in that color set', () => {
    const members = getPropertySetMembers('G')
    expect(computeRent(members, members[0]!)).toBe(3)
  })

  it('falls back to base rent for an unknown property name', () => {
    expect(computeRent([], '不存在的地产')).toBe(1)
  })
})
