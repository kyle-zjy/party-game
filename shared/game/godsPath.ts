/**
 * V1.6 数字版：神鬼道、河道、桥、天堂与地狱的节点图。
 *
 * 坐标取自 `docs/source/棋盘v1.pptx`（slide1.xml），并换算到 board.ts 使用的同一坐标系：
 * board = 50 + (raw − 50) × 0.91457，raw 为相对 32918401 EMU 底板的百分比（与外圈四个起点格中心对齐校准）。
 *
 * 【PPTX 可以直接确认】
 * - 中央竖排（x≈49.9）：上方 16 个小格（y 16.94–46.90）、中间"终点"方块（49.97）、下方 17 格（52.97–85.90，最后一格双倍高）。
 * - 竖排两端各有"封神or投胎"标签（y 14.04 / 85.98），"天堂"标签贴在上半段两侧，"地狱"标签贴在下半段两侧。
 * - 竖排正上方是外圈第 10 格（显示为第 11 格，空地），正下方是外圈第 47 格（显示为第 48 格，"下家禁骰"）。
 * - 河道：两条横带 y 46.14–53.86，从外圈一直延伸到中央竖排，在"终点"处与竖排相交。
 * - 外圈左右两边在 y≈44–56 处没有普通格，而是画着"桥"：14 条横线组成的梯子（13 格），
 *   左边位于第 65 格（y 57.91）与第 66 格（y 41.93）之间，右边位于第 28 格（41.87）与第 29 格（57.85）之间。
 *   桥旁边写着"OR"并画了上下双向箭头，指向河道。
 *
 * 【V1.5 文字规则明确】
 * - 第一位玩家跑完一圈后开启神鬼道两端入口；没有恰好停在终点则穿过终点去往另一侧。
 * - 过河时：无河神只能过桥（1 金币，桥 13 格，桥上每次掷骰 2 口）；有河神可以选择渡河。
 * - 天堂掷骰 +1 金、地狱 −1 金；天堂河神同意、地狱河神反对。
 *
 * 【开发推断（原稿没有文字说明，需要项目负责人确认）】
 * - 神鬼道入口 = 外圈第 10 / 47 格（与竖排端头相接），停在该格时询问是否进入；经过不进入。
 * - 上半段 16 格是天堂、下半段 17 格是地狱（依据"天堂/地狱"标签的位置）。
 * - 从上端进入向下走、从下端进入向上走；穿过终点后继续同方向走，走出另一端回到对应的外圈入口格，多余步数沿外圈继续。
 * - "过河"= 外圈移动要跨过桥所在的空档；选择过桥就沿外圈走 13 格桥，选择渡河则判定成功后直接到对岸外圈格。
 * - 渡河失败留在河岸（桥前一格）。
 */

export const GODS_NODE_COUNT = 34
export const GODS_FINISH_NODE = 16
export const GODS_TOP_ENTRANCE_NODE = 0
export const GODS_BOTTOM_ENTRANCE_NODE = 33
/** 外圈上正对神鬼道入口的格子 */
export const GODS_TOP_RING_CELL = 10
export const GODS_BOTTOM_RING_CELL = 47
export const BRIDGE_LENGTH = 13
export const BRIDGE_TOLL = 1
export const BRIDGE_DRINK_PER_ROLL = 2

const GODS_Y = [
  16.94, 18.96, 20.86, 22.75, 24.75, 26.73, 28.71, 30.71, 32.69, 34.73, 36.71, 38.73, 40.73, 42.76, 44.79, 46.9,
  49.97,
  52.97, 54.98, 56.95, 58.97, 60.87, 62.77, 64.77, 66.75, 68.72, 70.72, 72.71, 74.74, 76.73, 78.74, 80.74, 82.77, 85.9,
]

export function godsNodePosition(node: number): { x: number; y: number } {
  return { x: 49.9, y: GODS_Y[node] ?? 50 }
}

export type GodsRegion = 'HEAVEN' | 'FINISH' | 'HELL'

export function godsRegion(node: number): GodsRegion {
  if (node === GODS_FINISH_NODE) return 'FINISH'
  return node < GODS_FINISH_NODE ? 'HEAVEN' : 'HELL'
}

export function distanceToFinish(node: number): number {
  return Math.abs(node - GODS_FINISH_NODE)
}

/**
 * 在神鬼道上移动 steps 步：
 * - 恰好停在终点 = 抵达。
 * - 没有恰好停在终点时"穿过终点去往另一侧"：继续沿同一方向移动。
 * - 走出另一端入口时回到外圈对应的入口格（再多出来的步数沿外圈顺时针继续走）。
 */
export function moveOnGods(node: number, dir: 1 | -1, steps: number): { node: number | null; exitRingCell: number | null; leftover: number; reachedFinish: boolean } {
  let n = node
  for (let i = 1; i <= steps; i += 1) {
    n += dir
    if (n < 0 || n >= GODS_NODE_COUNT) {
      return { node: null, exitRingCell: n < 0 ? GODS_TOP_RING_CELL : GODS_BOTTOM_RING_CELL, leftover: steps - i, reachedFinish: false }
    }
  }
  return { node: n, exitRingCell: null, leftover: 0, reachedFinish: n === GODS_FINISH_NODE }
}

/** 河道：外圈顺时针移动跨过的空档。fromCell → toCell 是空档两侧的外圈格 */
export interface RiverCrossing {
  side: 'L' | 'R'
  fromCell: number
  toCell: number
}

export const RIVER_CROSSINGS: RiverCrossing[] = [
  { side: 'R', fromCell: 28, toCell: 29 },
  { side: 'L', fromCell: 65, toCell: 66 },
]

/**
 * 桥上第 step 格（0–12）的位置：PPTX 中桥是外圈左右两边 y 43.9–56.0 之间的梯子（x 左 6.2 / 右 93.9），
 * 13 格从靠近 fromCell 的一端开始排。右桥 fromCell=28（上方）→ 向下；左桥 fromCell=65（下方）→ 向上。
 */
export function bridgePosition(side: 'L' | 'R', step: number): { x: number; y: number } {
  const top = 44.6
  const bottom = 55.3
  const t = Math.min(BRIDGE_LENGTH - 1, Math.max(0, step)) / (BRIDGE_LENGTH - 1)
  return side === 'R' ? { x: 93.86, y: top + t * (bottom - top) } : { x: 6.2, y: bottom - t * (bottom - top) }
}
