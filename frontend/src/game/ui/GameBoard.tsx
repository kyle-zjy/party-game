import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { BOARD_CELLS, isPropertyCell, isStartCell } from '../../../../shared/game/board'
import type { BoardCell } from '../../../../shared/game/board'
import type { GamePlayerState, PlayerColor } from '../../../../shared/game/types'
import { CellDetailSheet } from './CellDetailSheet'
import { CellIcon } from './cellIcons'
import './board.css'

const COLOR_CLASS: Record<PlayerColor, string> = { R: 'mg-token-R', G: 'mg-token-G', B: 'mg-token-B', Y: 'mg-token-Y' }

/**
 * 棋盘画布的虚拟像素尺寸。
 *
 * 【修复记录：棋盘裁剪/格子文字重叠的真实根因】
 * 旧实现把 `.mg-board` 写死成 720×720px，放进一个只有 `overflow: auto`
 * （没有任何自动缩放/居中逻辑）的容器里——浏览器默认从左上角 (0,0) 开始
 * 显示，手机屏幕（360-430px 宽）只能看到左上角四分之一左右的区域，
 * 这正是"棋盘只显示部分路径，大量区域空白"的根因，不是什么"裁剪 bug"，
 * 而是画布比视口大很多、又没有任何自动适配手段。
 *
 * 文字重叠的根因是另一件独立的事：74 个格子的坐标是从 `棋盘v1.pptx`
 * 真实图形坐标换算出的百分比坐标，相邻格子中心的最小间距只有棋盘宽度的
 * 3.86%。在 720px 画布下，3.86% ≈ 27.8px——而格子本身是 56×68px 的方块，
 * 必然互相重叠。这不是"手机太小"的问题，桌面端同样会重叠，是画布尺寸
 * 相对真实格子密度定得太小。
 *
 * 修复方式：把虚拟画布放大到 2000×2000px，并且把格子自身的像素尺寸
 * （见 board.css 的 `.mg-cell`/`.mg-cell-compact`）精确控制在"任意两个
 * 相邻格子中心间距的一半以内"——外圈普通格最小间距 ≈77px（3.86% ×
 * 2000px），起点格和相邻普通格之间最小间距 ≈117px（5.84% × 2000px）。
 * 按这两个真实约束反推：概览态（compact）格子 34px、放大态（detail）
 * 格子 62px、起点格始终比普通格大一圈（compact 42px / detail 78px），
 * 这组尺寸在两种状态下都有十几到几十像素的安全余量，不会重叠。
 *
 * 不再要求"一屏放下所有细节"，而是用 `react-zoom-pan-pinch` 做"默认显示
 * 整个棋盘概览（缩小到能看清整体路径，这时格子只显示颜色+图标）+
 * 双指缩放/拖动查看细节（放大后格子显示完整名称）"——两件事分别用
 * "画布够大、格子尺寸和真实间距匹配"和"默认视图整体可见、按需放大看
 * 细节"来解决，不是同一个修复，缺一个都会导致重叠或裁剪重新出现。
 */
const CANVAS_SIZE = 2000

function cellColorClass(cell: BoardCell): string {
  if (isStartCell(cell)) return `mg-cell-start mg-cell-${cell.color}`
  if (isPropertyCell(cell)) return `mg-cell-property mg-cell-${cell.propertySet}`
  if (cell.kind === 'event') return `mg-cell-event${cell.color ? ` mg-cell-${cell.color}` : ''}`
  return `mg-cell-blank${cell.color ? ` mg-cell-${cell.color}` : ''}`
}

/** 放大到这个倍率以上才显示完整文字；以下只显示颜色+图标（见文件头说明） */
const DETAIL_ZOOM_THRESHOLD = 0.85

export function GameBoard({
  players,
  currentUid,
  highlightPath,
  worldTarotLabel,
}: {
  players: GamePlayerState[]
  currentUid: string
  highlightPath: number[]
  worldTarotLabel: string
}) {
  const [selectedCellId, setSelectedCellId] = useState<number | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const playersByCell = useMemo(() => {
    const map = new Map<number, GamePlayerState[]>()
    for (const p of players) {
      const list = map.get(p.position) ?? []
      list.push(p)
      map.set(p.position, list)
    }
    return map
  }, [players])

  const highlightSet = useMemo(() => new Set(highlightPath), [highlightPath])
  const selectedCell = selectedCellId !== null ? BOARD_CELLS[selectedCellId] ?? null : null

  const myPlayer = players.find((p) => p.uid === currentUid)

  const applyFitToScreen = useCallback((ref: ReactZoomPanPinchRef, animationTime: number) => {
    const wrapperEl = wrapperRef.current
    if (!wrapperEl) return
    const fitScale = Math.min(wrapperEl.clientWidth, wrapperEl.clientHeight) / CANVAS_SIZE
    // 容器还没有尺寸（被隐藏/布局未完成）时不适配，否则缩放为 0，棋盘消失
    if (!(fitScale > 0)) return
    ref.setTransform(0, 0, fitScale, animationTime)
    ref.centerView(fitScale, animationTime)
  }, [])

  // 容器尺寸从 0 变为可见、或旋转屏幕时重新适配一次
  const lastSizeRef = useRef<string>('')
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`
      if (size === lastSizeRef.current || el.clientWidth === 0 || el.clientHeight === 0) return
      lastSizeRef.current = size
      if (transformRef.current) applyFitToScreen(transformRef.current, 0)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [applyFitToScreen])

  const handleViewAll = useCallback(() => {
    // 不用 resetTransform()——它会回到 props 里固定写死的 initialScale，
    // 在桌面端（视口更宽，真正的"整图适配"缩放比例也更大）会比实际需要
    // 缩得更小。这里改成每次点击都按当前容器真实尺寸重新计算一次适配
    // 缩放，和挂载时 onInit 的逻辑保持一致，手机和桌面都准确。
    if (transformRef.current) applyFitToScreen(transformRef.current, 300)
  }, [applyFitToScreen])

  const handleLocateMe = useCallback(() => {
    if (!myPlayer) return
    const el = document.getElementById(`mg-cell-${myPlayer.position}`)
    if (el && transformRef.current) {
      transformRef.current.zoomToElement(el, 1.3, 300)
    }
  }, [myPlayer])

  return (
    <div className="mg-board-wrap">
      <TransformWrapper
        ref={transformRef}
        // initialScale 只是挂载瞬间的占位值——onInit 会立刻按容器真实宽高
        // 重新计算并覆盖它（见下面 onInit 的说明）。minScale 必须明显小于
        // 任何目标视口下的"整图适配"缩放比例（360px 手机 ≈0.17，1280px
        // 桌面 ≈0.63），否则用户缩小到"查看全图"时会被 minScale 卡住，
        // 看不到完整棋盘——这和本次要修复的"棋盘被裁剪"是同一类问题，
        // 只是触发方式从"根本没做适配"变成"适配值被下限夹住"，所以这里
        // 特意留了远超过安全边际的下限。
        initialScale={0.2}
        minScale={0.08}
        maxScale={2.2}
        centerOnInit
        limitToBounds
        wheel={{ step: 0.15 }}
        doubleClick={{ mode: 'toggle', step: 0.6 }}
        onInit={(ref) => {
          // 初次挂载时让"整个棋盘概览"这件事真正发生——用 fitToBounds 的等价
          // 做法：把缩放设到刚好能让 CANVAS_SIZE×CANVAS_SIZE 的画布完整塞进
          // 容器宽高（取较小的一边，保证整个正方形棋盘都能看到，不会裁掉）。
          applyFitToScreen(ref, 0)
        }}
        onTransformed={(_ref, state) => {
          setShowDetail(state.scale >= DETAIL_ZOOM_THRESHOLD)
        }}
      >
        <div className="mg-board-viewport" ref={wrapperRef}>
          <TransformComponent
            wrapperClass="mg-board-tc-wrapper"
            contentClass="mg-board-tc-content"
          >
            <div className="mg-board" style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
              <div className="mg-board-center">
                <div className="mg-board-center-label mg-display">今夜别想下桌</div>
                <div className="mg-board-tarot">
                  <span className="mg-pill mg-glow-purple">当前世界塔罗</span>
                  <span className="mg-board-tarot-name mg-display">{worldTarotLabel}</span>
                </div>
              </div>
              {BOARD_CELLS.map((cell) => {
                const occupants = playersByCell.get(cell.id) ?? []
                const isHighlighted = highlightSet.has(cell.id)
                return (
                  <button
                    key={cell.id}
                    id={`mg-cell-${cell.id}`}
                    type="button"
                    className={`mg-cell ${cellColorClass(cell)}${isHighlighted ? ' mg-cell-highlight' : ''}${showDetail ? ' mg-cell-detail' : ' mg-cell-compact'}`}
                    style={{ left: `${cell.x}%`, top: `${cell.y}%` }}
                    onClick={() => setSelectedCellId(cell.id)}
                    aria-label={cellAriaLabel(cell)}
                  >
                    <span className="mg-cell-icon">
                      <CellIcon kind={isStartCell(cell) ? 'start' : isPropertyCell(cell) ? 'property' : cell.kind === 'event' ? cell.effectKind : 'start'} />
                    </span>
                    {showDetail && <span className="mg-cell-label">{cellShortLabel(cell)}</span>}
                    {occupants.length > 0 && (
                      <span className="mg-cell-tokens">
                        {occupants.map((p, idx) => (
                          <span
                            key={p.uid}
                            className={`mg-token ${COLOR_CLASS[p.color]}${p.uid === currentUid ? ' mg-token-active' : ''}`}
                            style={{ transform: `translate(${idx * 6}px, ${idx * -6}px)` }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </TransformComponent>
        </div>
      </TransformWrapper>

      <div className="mg-board-controls">
        <button type="button" className="mg-board-ctrl-btn" onClick={handleViewAll} aria-label="查看全图">
          <ViewAllIcon />
          <span>全图</span>
        </button>
        <button type="button" className="mg-board-ctrl-btn" onClick={handleLocateMe} aria-label="定位我的棋子" disabled={!myPlayer}>
          <LocateIcon />
          <span>定位我</span>
        </button>
      </div>

      {selectedCell && <CellDetailSheet cell={selectedCell} onClose={() => setSelectedCellId(null)} />}
    </div>
  )
}

function cellShortLabel(cell: BoardCell): string {
  if (isStartCell(cell)) return '起点'
  if (isPropertyCell(cell)) return cell.propertyName
  if (cell.kind === 'event') return cell.label
  return ''
}

function cellAriaLabel(cell: BoardCell): string {
  return `查看格子详情：${cellShortLabel(cell) || '空地'}`
}

function ViewAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4m11-5v4a1 1 0 0 1-1 1h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LocateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path
        d="M12 3v3M12 18v3M3 12h3M18 12h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
