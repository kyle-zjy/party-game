import { BOARD_CELLS, BOARD_SIZE, getCell } from '../board'

/** 棋盘坐标按顺时针方向、环形取模；`steps` 可以是负数（后退） */
export function computeNewPosition(oldPos: number, steps: number): number {
  return ((oldPos + steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE
}

/**
 * 判断从 oldPos 出发、顺时针前进 `steps` 格（必须为正数——后退不触发"经过起点"
 * 判断，见 `landing.ts` 的设计说明）的路径上，是否经过或停在 `targetCellId`。
 */
export function crossesCellForward(oldPos: number, steps: number, targetCellId: number): boolean {
  if (steps <= 0) return false
  for (let s = 1; s <= steps; s += 1) {
    if (computeNewPosition(oldPos, s) === targetCellId) return true
  }
  return false
}

const START_CELL_BY_COLOR: Record<string, number> = {}
for (const cell of BOARD_CELLS) {
  if (cell.kind === 'start') {
    START_CELL_BY_COLOR[cell.color] = cell.id
  }
}

export function startCellIdForColor(color: 'R' | 'G' | 'B' | 'Y'): number {
  const id = START_CELL_BY_COLOR[color]
  if (id === undefined) throw new Error(`找不到颜色 ${color} 对应的起点格`)
  return id
}

export function isStartCellId(cellId: number): boolean {
  return getCell(cellId).kind === 'start'
}
