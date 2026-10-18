/**
 * 正式棋盘 v1 的数字化数据，从 `docs/source/棋盘v1.pptx` 的真实图形坐标中
 * 提取（解析每个矩形的位置、填充色、就近的文本标签，按围绕棋盘中心的角度
 * 排序还原出外圈 74 格的顺时针路径），不是凭空设计的替代棋盘。
 *
 * 提取方法记录（供以后更新棋盘时复用）：用 python 的 zipfile+ElementTree
 * 解析 pptx 内的 `ppt/slides/slide1.xml`，按形状尺寸区分"四角起点格"
 * （2781640×2781640 EMU）和"外圈普通格"（1440000×2782800 EMU），
 * 用配色主题（`ppt/theme/theme1.xml` 的 accent4=蓝、accent6=绿，
 * 加上直接写死的 srgbClr：FFC000=黄、DB090A=红）识别棋子颜色分组，
 * 再把最近的文本框（阈值内最近邻）当作格子标签匹配上去。
 *
 * 规则对照（V1.5 规则书第 3 节）：
 * - 起点：经过/停留 +2 金币、抽 1 手牌。
 * - 地产：购买 3 金币，租金 1 金；同色租金 2 金；集齐同色 3 处租金 3 金。
 * - 其余格子标签（金币±、前进/后退、喝酒类、T or D、发车任务、更换塔罗、
 *   抽手牌等）按规则书原文映射到 `BoardEventKind`；规则书没写清楚的
 *   （停骰一次、下家禁骰、德州+1/德扑+1、发车任务的具体人数）标记成
 *   `pendingRuling`，不擅自编造结算方式。
 *
 * 中央神鬼道/河道/天堂地狱/德州扑克/阿瓦隆区域在 pptx 里有独立的形状
 * （非外圈路径的一部分），本文件不建模——Phase C 第一轮只实现外圈核心循环，
 * 这些区域的数字化留给后续阶段，见 docs/source 规则书"第五部分"的待确认清单。
 */

export type PropertySetColor = 'R' | 'G' | 'B' | 'Y'

export type BoardEventKind =
  | 'coin'
  | 'forward'
  | 'back'
  | 'drinkSelf'
  | 'drinkPrev'
  | 'drinkNext'
  | 'drinkTarget'
  | 'truthOrDare'
  | 'changeTarot'
  | 'drawTacticCard'
  | 'pendingRuling'

export interface BoardCellBase {
  id: number
  /** 格子在棋盘上的中心位置，百分比坐标（0-100），用于 CSS 绝对定位 */
  x: number
  y: number
  /** 格子所在的象限配色（和四个起点颜色对应，仅用于视觉分区，不影响规则） */
  color: PropertySetColor | null
}

export interface StartCell extends BoardCellBase {
  kind: 'start'
  color: PropertySetColor
}

export interface PropertyCell extends BoardCellBase {
  kind: 'property'
  color: PropertySetColor
  propertyName: string
  propertySet: PropertySetColor
  propertySetIndex: number
}

export interface EventCell extends BoardCellBase {
  kind: 'event'
  effectKind: BoardEventKind
  /** 数字类效果（金币数、格数、喝酒口数）为 number；需要文字说明的待裁定事件为 string；无参数效果为 null */
  effectN: number | string | null
  /** 原始棋盘标签文字，教学提示/格子详情直接复用，不需要二次翻译 */
  label: string
}

export interface BlankCell extends BoardCellBase {
  kind: 'blank'
}

export type BoardCell = StartCell | PropertyCell | EventCell | BlankCell

/** 棋盘外圈共 74 格，id 即棋盘路径下标，棋子移动用 `(position + steps) % BOARD_CELLS.length` */
export const BOARD_CELLS: BoardCell[] = [
  { id: 0, kind: 'start', color: 'B', x: 8.14, y: 8.14 },
  { id: 1, kind: 'event', color: 'Y', x: 14.01, y: 8.12, effectKind: 'changeTarot', effectN: null, label: '更换塔罗' },
  { id: 2, kind: 'property', color: 'R', x: 18.01, y: 8.12, propertyName: '子女宫', propertySet: 'R', propertySetIndex: 2 },
  { id: 3, kind: 'blank', color: 'B', x: 21.87, y: 8.12 },
  { id: 4, kind: 'event', color: 'G', x: 25.87, y: 8.12, effectKind: 'pendingRuling', effectN: '停骰一次：具体规则待确认（跳过本回合掷骰还是跳过整个回合未写明），本轮由房主现场裁定', label: '停骰一次' },
  { id: 5, kind: 'event', color: 'Y', x: 29.84, y: 8.12, effectKind: 'drinkPrev', effectN: 2, label: '上家喝2口' },
  { id: 6, kind: 'event', color: 'R', x: 33.89, y: 8.11, effectKind: 'coin', effectN: 1, label: '金币+1' },
  { id: 7, kind: 'event', color: 'B', x: 37.89, y: 8.1, effectKind: 'forward', effectN: 4, label: '前进4格' },
  { id: 8, kind: 'event', color: 'G', x: 41.89, y: 8.1, effectKind: 'truthOrDare', effectN: null, label: 'T or D' },
  { id: 9, kind: 'event', color: 'Y', x: 45.89, y: 8.11, effectKind: 'pendingRuling', effectN: '德州+1：具体含义待确认（补发底牌还是推进公共牌阶段未写明），本轮由房主现场裁定', label: '德州+1' },
  { id: 10, kind: 'blank', color: 'R', x: 49.92, y: 8.1 },
  { id: 11, kind: 'property', color: 'B', x: 53.93, y: 8.11, propertyName: '玄秘宫', propertySet: 'B', propertySetIndex: 3 },
  { id: 12, kind: 'event', color: 'G', x: 57.88, y: 8.11, effectKind: 'drinkTarget', effectN: 1, label: '指定喝1口' },
  { id: 13, kind: 'property', color: 'Y', x: 61.88, y: 8.1, propertyName: '交流宫', propertySet: 'Y', propertySetIndex: 1 },
  { id: 14, kind: 'event', color: 'R', x: 65.89, y: 8.1, effectKind: 'drinkSelf', effectN: 2, label: '喝2口' },
  { id: 15, kind: 'blank', color: 'B', x: 69.89, y: 8.1 },
  { id: 16, kind: 'event', color: 'G', x: 73.89, y: 8.11, effectKind: 'back', effectN: 3, label: '后退3格' },
  { id: 17, kind: 'event', color: 'Y', x: 77.89, y: 8.12, effectKind: 'pendingRuling', effectN: '发车任务：阿瓦隆任务触发，人数配置待房主裁定，本阶段暂不自动结算', label: '发车任务' },
  { id: 18, kind: 'event', color: 'R', x: 81.92, y: 8.12, effectKind: 'drinkNext', effectN: 1, label: '下家喝1口' },
  { id: 19, kind: 'blank', color: 'B', x: 85.94, y: 8.12 },
  { id: 20, kind: 'start', color: 'G', x: 91.86, y: 8.14 },
  { id: 21, kind: 'blank', color: 'Y', x: 91.86, y: 13.98 },
  { id: 22, kind: 'event', color: 'B', x: 91.86, y: 17.98, effectKind: 'forward', effectN: 4, label: '前进4格' },
  { id: 23, kind: 'event', color: 'R', x: 91.86, y: 21.85, effectKind: 'pendingRuling', effectN: '发车任务：阿瓦隆任务触发，人数配置待房主裁定，本阶段暂不自动结算', label: '发车任务' },
  { id: 24, kind: 'blank', color: null, x: 91.86, y: 25.85 },
  { id: 25, kind: 'event', color: 'Y', x: 91.86, y: 29.82, effectKind: 'back', effectN: 3, label: '后退3格' },
  { id: 26, kind: 'event', color: 'B', x: 91.87, y: 33.86, effectKind: 'pendingRuling', effectN: '德州+1：具体含义待确认（补发底牌还是推进公共牌阶段未写明），本轮由房主现场裁定', label: '德州+1' },
  { id: 27, kind: 'property', color: 'R', x: 91.88, y: 37.87, propertyName: '命宫', propertySet: 'R', propertySetIndex: 1 },
  { id: 28, kind: 'event', color: 'G', x: 91.88, y: 41.87, effectKind: 'drinkSelf', effectN: 1, label: '喝1口' },
  { id: 29, kind: 'event', color: 'Y', x: 91.87, y: 57.85, effectKind: 'truthOrDare', effectN: null, label: 'T or D' },
  { id: 30, kind: 'event', color: 'B', x: 91.88, y: 61.86, effectKind: 'coin', effectN: 1, label: '金币+1' },
  { id: 31, kind: 'event', color: 'R', x: 91.88, y: 65.87, effectKind: 'drinkPrev', effectN: 1, label: '上家喝1口' },
  { id: 32, kind: 'property', color: 'G', x: 91.88, y: 69.87, propertyName: '官禄宫', propertySet: 'G', propertySetIndex: 3 },
  { id: 33, kind: 'blank', color: 'Y', x: 91.87, y: 73.86 },
  { id: 34, kind: 'property', color: 'B', x: 91.86, y: 77.86, propertyName: '疾厄宫', propertySet: 'B', propertySetIndex: 2 },
  { id: 35, kind: 'event', color: 'R', x: 91.86, y: 81.89, effectKind: 'drinkTarget', effectN: 1, label: '指定喝1口' },
  { id: 36, kind: 'event', color: 'G', x: 91.86, y: 85.92, effectKind: 'drinkSelf', effectN: 2, label: '喝2口' },
  { id: 37, kind: 'start', color: 'Y', x: 91.86, y: 91.86 },
  { id: 38, kind: 'event', color: 'B', x: 85.94, y: 91.86, effectKind: 'back', effectN: 3, label: '后退3格' },
  { id: 39, kind: 'event', color: 'G', x: 81.92, y: 91.86, effectKind: 'changeTarot', effectN: null, label: '更换塔罗' },
  { id: 40, kind: 'property', color: 'Y', x: 77.89, y: 91.86, propertyName: '福德宫', propertySet: 'Y', propertySetIndex: 3 },
  { id: 41, kind: 'blank', color: 'R', x: 73.89, y: 91.85 },
  { id: 42, kind: 'event', color: 'B', x: 69.89, y: 91.83, effectKind: 'drinkPrev', effectN: 1, label: '上家喝1口' },
  { id: 43, kind: 'event', color: 'G', x: 65.89, y: 91.83, effectKind: 'pendingRuling', effectN: '发车任务：阿瓦隆任务触发，人数配置待房主裁定，本阶段暂不自动结算', label: '发车任务' },
  { id: 44, kind: 'event', color: 'Y', x: 61.88, y: 91.83, effectKind: 'coin', effectN: 1, label: '金币+1' },
  { id: 45, kind: 'event', color: 'R', x: 57.88, y: 91.85, effectKind: 'forward', effectN: 4, label: '前进4格' },
  { id: 46, kind: 'event', color: 'B', x: 53.93, y: 91.85, effectKind: 'back', effectN: 3, label: '后退3格' },
  { id: 47, kind: 'event', color: 'G', x: 49.92, y: 91.83, effectKind: 'pendingRuling', effectN: '下家禁骰：具体范围待确认（跳过掷骰还是跳过整个回合未写明），本轮由房主现场裁定', label: '下家禁骰' },
  { id: 48, kind: 'event', color: 'Y', x: 45.89, y: 91.85, effectKind: 'drawTacticCard', effectN: null, label: '抽1张手牌' },
  { id: 49, kind: 'blank', color: 'R', x: 41.89, y: 91.83 },
  { id: 50, kind: 'event', color: 'B', x: 37.89, y: 91.83, effectKind: 'drinkSelf', effectN: 1, label: '喝一口' },
  { id: 51, kind: 'property', color: 'G', x: 33.89, y: 91.85, propertyName: '奴仆宫', propertySet: 'G', propertySetIndex: 2 },
  { id: 52, kind: 'blank', color: 'Y', x: 29.84, y: 91.86 },
  { id: 53, kind: 'event', color: 'R', x: 25.87, y: 91.86, effectKind: 'drinkNext', effectN: 2, label: '下家喝两口' },
  { id: 54, kind: 'property', color: 'B', x: 21.87, y: 91.86, propertyName: '田宅宫', propertySet: 'B', propertySetIndex: 1 },
  { id: 55, kind: 'event', color: 'G', x: 18.01, y: 91.86, effectKind: 'pendingRuling', effectN: '德扑+1：具体含义待确认（补发底牌还是推进公共牌阶段未写明），本轮由房主现场裁定', label: '德扑+1' },
  { id: 56, kind: 'event', color: 'Y', x: 14.01, y: 91.86, effectKind: 'truthOrDare', effectN: null, label: 'T or D' },
  { id: 57, kind: 'start', color: 'R', x: 8.14, y: 91.86 },
  { id: 58, kind: 'blank', color: null, x: 8.15, y: 85.98 },
  { id: 59, kind: 'event', color: 'G', x: 8.15, y: 81.95, effectKind: 'drawTacticCard', effectN: null, label: '抽1张手牌' },
  { id: 60, kind: 'blank', color: 'Y', x: 8.15, y: 77.92 },
  { id: 61, kind: 'event', color: 'R', x: 8.16, y: 73.92, effectKind: 'drinkTarget', effectN: 2, label: '指定喝2口' },
  { id: 62, kind: 'event', color: 'B', x: 8.17, y: 69.93, effectKind: 'truthOrDare', effectN: null, label: 'T or D' },
  { id: 63, kind: 'property', color: 'G', x: 8.17, y: 65.93, propertyName: '财帛宫', propertySet: 'G', propertySetIndex: 1 },
  { id: 64, kind: 'event', color: 'Y', x: 8.17, y: 61.92, effectKind: 'forward', effectN: 4, label: '前进4格' },
  { id: 65, kind: 'event', color: 'R', x: 8.16, y: 57.91, effectKind: 'drinkNext', effectN: 1, label: '下家喝1口' },
  { id: 66, kind: 'event', color: 'B', x: 8.17, y: 41.93, effectKind: 'coin', effectN: 2, label: '金币+2' },
  { id: 67, kind: 'event', color: 'G', x: 8.17, y: 37.93, effectKind: 'back', effectN: 3, label: '后退3格' },
  { id: 68, kind: 'property', color: 'Y', x: 8.16, y: 33.92, propertyName: '夫妻宫', propertySet: 'Y', propertySetIndex: 2 },
  { id: 69, kind: 'property', color: 'R', x: 8.15, y: 29.88, propertyName: '迁移宫', propertySet: 'R', propertySetIndex: 3 },
  { id: 70, kind: 'blank', color: 'B', x: 8.15, y: 25.91 },
  { id: 71, kind: 'event', color: 'G', x: 8.15, y: 21.91, effectKind: 'drinkTarget', effectN: 1, label: '指定喝1口' },
  { id: 72, kind: 'event', color: 'Y', x: 8.14, y: 18.04, effectKind: 'pendingRuling', effectN: '发车任务：阿瓦隆任务触发，人数配置待房主裁定，本阶段暂不自动结算', label: '发车任务' },
  { id: 73, kind: 'event', color: 'R', x: 8.14, y: 14.04, effectKind: 'drinkSelf', effectN: 1, label: '喝1口' },
]

export const BOARD_SIZE = BOARD_CELLS.length

export const PROPERTY_BUY_PRICE = 3
export const PROPERTY_BASE_RENT = 1
export const PROPERTY_SAME_COLOR_RENT = 2
export const PROPERTY_FULL_SET_RENT = 3
export const PROPERTIES_PER_SET = 3

export const START_BONUS_COINS = 2

export function getCell(position: number): BoardCell {
  const normalized = ((position % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE
  const cell = BOARD_CELLS[normalized]
  if (!cell) {
    throw new Error(`棋盘格子越界：${position}`)
  }
  return cell
}

export function isStartCell(cell: BoardCell): cell is StartCell {
  return cell.kind === 'start'
}

export function isPropertyCell(cell: BoardCell): cell is PropertyCell {
  return cell.kind === 'property'
}

export function isEventCell(cell: BoardCell): cell is EventCell {
  return cell.kind === 'event'
}

/** 按花色分组的全部地产名，供"是否集齐同色三处"判断复用 */
export function getPropertySetMembers(set: PropertySetColor): string[] {
  return BOARD_CELLS.filter(isPropertyCell)
    .filter((c) => c.propertySet === set)
    .sort((a, b) => a.propertySetIndex - b.propertySetIndex)
    .map((c) => c.propertyName)
}

export function findPropertyCellByName(name: string): PropertyCell | undefined {
  return BOARD_CELLS.filter(isPropertyCell).find((c) => c.propertyName === name)
}

/**
 * 计算地产租金：
 * - 不属于任何人的地产没有租金（调用方应该先检查归属）。
 * - 同色地产集齐 3 处时为 3 金；否则只要落点所属地产和踩中者自己的其他地产
 *   同色（即"同色地产"）为 2 金；否则为 1 金（规则书 3. 地产）。
 * 这里的"同色"判断的是*地产自己的归属者*是否也拥有该地产所在花色的其他地产，
 * 不是"踩中者"的地产——规则书原文："和自己同色地产租金为2金"，指地产主人
 * 名下同色地产数量，不是踩中者的地产。
 */
export function computeRent(ownerProperties: string[], landedPropertyName: string): number {
  const cell = findPropertyCellByName(landedPropertyName)
  if (!cell) return PROPERTY_BASE_RENT
  const sameSetMembers = getPropertySetMembers(cell.propertySet)
  const ownedInSet = sameSetMembers.filter((name) => ownerProperties.includes(name))
  if (ownedInSet.length >= PROPERTIES_PER_SET) {
    return PROPERTY_FULL_SET_RENT
  }
  if (ownedInSet.length >= 2) {
    return PROPERTY_SAME_COLOR_RENT
  }
  return PROPERTY_BASE_RENT
}
