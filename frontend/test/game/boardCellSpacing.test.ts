import { describe, expect, it } from 'vitest'
import { BOARD_CELLS, isStartCell } from '../../../shared/game/board'

/**
 * 几何回归测试：确保棋盘格子的 CSS 像素尺寸和真实提取出的坐标间距
 * 始终匹配，不会重叠。
 *
 * 这组测试直接对应用户报告的"棋盘格子文本相互重叠"问题。真实根因（完整
 * 分析见 frontend/src/game/ui/GameBoard.tsx 和 board.css 的文件头注释）
 * 是画布像素尺寸和格子像素尺寸是两个独立写死的数字，没有任何机制保证它们
 * 互相匹配——改了画布大小却忘记重新核算格子尺寸（或反过来），重叠就会
 * 重新出现，且不会在 TypeScript 类型检查或一般的渲染测试里报错。
 *
 * 这里把 CSS 里写死的像素尺寸复制过来做常量（而不是解析 CSS 文件——
 * 那样会引入脆弱的字符串解析），用百分比坐标系统计算真实几何间距，
 * 和像素尺寸换算成的"同一百分比坐标系下的等效宽度"比较。这组数字如果
 * 以后要调整 CANVAS_SIZE 或任何 .mg-cell 尺寸，必须同步改这里的常量，
 * 测试才能验证新的组合依然不重叠——这正是测试的意义：强制"两处改一处"
 * 的耦合关系不会被悄悄破坏。
 */

// 必须和 GameBoard.tsx 的 CANVAS_SIZE 保持一致
const CANVAS_SIZE = 2000

// 必须和 board.css 的 .mg-cell / .mg-cell-compact / .mg-cell-start 保持一致
const RING_CELL_PX = { detail: 62, compact: 34 }
const START_CELL_PX = { detail: 78, compact: 42 }

function cellRadiusPercent(px: number): number {
  // 格子用 translate(-50%, -50%) 居中，半径 = 像素宽度的一半，
  // 换算成画布百分比坐标系下的等效值。
  return (px / 2 / CANVAS_SIZE) * 100
}

function percentDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

describe('board cell spacing (regression test for the "[overlap]" bug)', () => {
  it('no two cells overlap in compact (overview) mode', () => {
    checkNoOverlap(RING_CELL_PX.compact, START_CELL_PX.compact)
  })

  it('no two cells overlap in detail (zoomed-in) mode', () => {
    checkNoOverlap(RING_CELL_PX.detail, START_CELL_PX.detail)
  })

  function checkNoOverlap(ringPx: number, startPx: number) {
    const violations: string[] = []
    for (let i = 0; i < BOARD_CELLS.length; i += 1) {
      for (let j = i + 1; j < BOARD_CELLS.length; j += 1) {
        const a = BOARD_CELLS[i]!
        const b = BOARD_CELLS[j]!
        const dist = percentDistance(a, b)
        const radiusA = cellRadiusPercent(isStartCell(a) ? startPx : ringPx)
        const radiusB = cellRadiusPercent(isStartCell(b) ? startPx : ringPx)
        const requiredGap = radiusA + radiusB
        if (dist < requiredGap) {
          violations.push(
            `cell ${a.id} and cell ${b.id} overlap: distance=${dist.toFixed(2)}% required=${requiredGap.toFixed(2)}%`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  }
})
