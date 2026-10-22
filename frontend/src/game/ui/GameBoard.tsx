import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { BOARD_CELLS, isPropertyCell, isStartCell } from '../../../../shared/game/board'
import type { BoardCell } from '../../../../shared/game/board'
import type { GamePlayerState, PlayerColor } from '../../../../shared/game/types'
import { bridgePosition, GODS_FINISH_NODE, GODS_NODE_COUNT, godsNodePosition, godsRegion } from '../../../../shared/game/godsPath'
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
/** 画布四周的留白：让靠近棋盘边缘的格子在跟随视角下也能居中（limitToBounds 不会把它们卡在边上） */
const CANVAS_PAD = 360

function cellColorClass(cell: BoardCell): string {
  if (isStartCell(cell)) return `mg-cell-start mg-cell-${cell.color}`
  if (isPropertyCell(cell)) return `mg-cell-property mg-cell-${cell.propertySet}`
  if (cell.kind === 'event') return `mg-cell-event${cell.color ? ` mg-cell-${cell.color}` : ''}`
  return `mg-cell-blank${cell.color ? ` mg-cell-${cell.color}` : ''}`
}

/** 放大到这个倍率以上才显示完整文字；以下只显示颜色+图标（见文件头说明） */
const DETAIL_ZOOM_THRESHOLD = 0.72
/** 默认游玩视角的缩放：格子约 60px、标签可读，手机宽度下大约能看到附近 5–9 格 */
const FOLLOW_SCALE = 0.8

export function GameBoard({
  players,
  currentUid,
  highlightPath,
  worldTarotLabel,
  showCentral = false,
  godsOpen = false,
  riverGodUid = null,
  activeUid,
}: {
  players: GamePlayerState[]
  currentUid: string
  /** 当前行动玩家：默认游玩视角跟随这个人 */
  activeUid?: string
  highlightPath: number[]
  worldTarotLabel: string
  /** V1.6：显示神鬼道 / 河道（旧房间不显示） */
  showCentral?: boolean
  godsOpen?: boolean
  riverGodUid?: string | null
}) {
  const [selectedCellId, setSelectedCellId] = useState<number | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const playersByCell = useMemo(() => {
    const map = new Map<number, GamePlayerState[]>()
    for (const p of players) {
      if (p.zone && p.zone.kind !== 'ring') continue
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
    // 整图：把 2000px 棋盘本身（不含四周留白）居中放满容器
    const x = (wrapperEl.clientWidth - CANVAS_SIZE * fitScale) / 2 - CANVAS_PAD * fitScale
    const y = (wrapperEl.clientHeight - CANVAS_SIZE * fitScale) / 2 - CANVAS_PAD * fitScale
    ref.setTransform(x, y, fitScale, animationTime)
  }, [])

  /**
   * 棋盘视角：
   * - follow（默认游玩视角）：聚焦当前行动玩家，缩放到格子图标和名称都看得清（约能看到附近 5–9 格）；
   *   只有当前行动玩家换人或者棋子真的移动时才重新聚焦，5 秒轮询不会重置视角。
   * - free：玩家手动拖动/缩放、或者点了"全图"之后，不再自动跟随，直到点"跟随"或"定位我"。
   */
  const [mode, setMode] = useState<'follow' | 'free'>('follow')
  const modeRef = useRef<'follow' | 'free'>('follow')
  const programmaticRef = useRef(false)
  const followUid = activeUid ?? currentUid
  // 最新的玩家位置和跟随对象，供事件回调读取（避免回调随每次轮询重建）
  const latestRef = useRef({ players, followUid })
  useEffect(() => {
    latestRef.current = { players, followUid }
  }, [players, followUid])
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const focusOnUid = useCallback((uid: string, animationTime: number) => {
    const ref = transformRef.current
    const wrapperEl = wrapperRef.current
    if (!ref || !wrapperEl || wrapperEl.clientWidth === 0) return
    const p = latestRef.current.players.find((x) => x.uid === uid)
    if (!p) return
    const el = document.getElementById(p.zone && p.zone.kind !== 'ring' ? `mg-token-${uid}` : `mg-cell-${p.position}`)
    if (!el) return
    programmaticRef.current = true
    ref.zoomToElement(el, FOLLOW_SCALE, animationTime)
    window.setTimeout(() => (programmaticRef.current = false), animationTime + 80)
  }, [])

  // 容器尺寸从 0 变为可见、或旋转屏幕时：跟随模式重新聚焦，自由模式整图适配
  const lastSizeRef = useRef<string>('')
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`
      if (size === lastSizeRef.current || el.clientWidth === 0 || el.clientHeight === 0) return
      lastSizeRef.current = size
      if (!transformRef.current) return
      if (modeRef.current === 'follow') focusOnUid(latestRef.current.followUid, 0)
      else applyFitToScreen(transformRef.current, 0)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [applyFitToScreen, focusOnUid])

  const active = players.find((p) => p.uid === followUid)
  const activeKey = active ? `${active.uid}:${!active.zone || active.zone.kind === 'ring' ? `r${active.position}` : JSON.stringify(active.zone)}` : ''
  // 只在"谁在行动 / 棋子位置"变化时重新聚焦（activeKey 不随轮询变化）
  useEffect(() => {
    if (modeRef.current !== 'follow' || !activeKey) return
    const t = window.setTimeout(() => focusOnUid(latestRef.current.followUid, 400), 60)
    return () => window.clearTimeout(t)
  }, [activeKey, focusOnUid])

  const handleViewAll = useCallback(() => {
    // 不用 resetTransform()——它会回到 props 里固定写死的 initialScale，按容器真实尺寸重新计算整图适配
    setMode('free')
    if (transformRef.current) {
      programmaticRef.current = true
      applyFitToScreen(transformRef.current, 300)
      window.setTimeout(() => (programmaticRef.current = false), 380)
    }
  }, [applyFitToScreen])

  const handleLocateMe = useCallback(() => {
    setMode('free')
    focusOnUid(currentUid, 300)
  }, [currentUid, focusOnUid])

  const handleFollow = useCallback(() => {
    setMode('follow')
    focusOnUid(latestRef.current.followUid, 300)
  }, [focusOnUid])

  const userMoved = useCallback(() => {
    if (!programmaticRef.current) setMode('free')
  }, [])

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
        minScale={0.06}
        maxScale={2.2}
        centerOnInit
        limitToBounds
        wheel={{ step: 0.15 }}
        doubleClick={{ mode: 'toggle', step: 0.6 }}
        onInit={(ref) => {
          // 先整图适配（保证容器尺寸已知时有一个完整画面），随后默认游玩视角聚焦当前行动玩家
          applyFitToScreen(ref, 0)
          window.setTimeout(() => modeRef.current === 'follow' && focusOnUid(latestRef.current.followUid, 0), 80)
        }}
        onPanningStart={userMoved}
        onPinchingStart={userMoved}
        onWheelStart={userMoved}
        onTransformed={(_ref, state) => {
          setShowDetail(state.scale >= DETAIL_ZOOM_THRESHOLD)
        }}
      >
        <div className="mg-board-viewport" ref={wrapperRef}>
          <TransformComponent
            wrapperClass="mg-board-tc-wrapper"
            contentClass="mg-board-tc-content"
          >
            <div className="mg-board-pad" style={{ padding: CANVAS_PAD }}>
            <div className="mg-board" style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
              <div className={`mg-board-center${showCentral ? ' mg-board-center-quadrant' : ''}`}>
                <div className="mg-board-center-label mg-display">今夜别想下桌</div>
                <div className="mg-board-tarot">
                  <span className="mg-pill mg-glow-purple">当前世界塔罗</span>
                  <span className="mg-board-tarot-name mg-display">{worldTarotLabel}</span>
                </div>
              </div>
              {showCentral && <CentralRegion players={players} currentUid={currentUid} godsOpen={godsOpen} riverGodUid={riverGodUid} />}
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
                            className={`mg-token ${COLOR_CLASS[p.color]}${p.uid === currentUid ? ' mg-token-active' : ''}${p.uid === activeUid ? ' mg-token-turn' : ''}`}
                            style={{ transform: `translate(${idx * 6}px, ${idx * -6}px)` }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            </div>
          </TransformComponent>
        </div>
      </TransformWrapper>

      <div className="mg-board-controls">
        <button type="button" className="mg-board-ctrl-btn" onClick={handleViewAll} aria-label="查看全图">
          <ViewAllIcon />
          <span>全图</span>
        </button>
        {mode === 'free' && (
          <button type="button" className="mg-board-ctrl-btn mg-board-ctrl-follow" onClick={handleFollow} aria-label="跟随当前行动玩家">
            <LocateIcon />
            <span>跟随</span>
          </button>
        )}
        <button type="button" className="mg-board-ctrl-btn" onClick={handleLocateMe} aria-label="定位我的棋子" disabled={!myPlayer}>
          <LocateIcon />
          <span>定位我</span>
        </button>
      </div>

      {selectedCell && <CellDetailSheet cell={selectedCell} onClose={() => setSelectedCellId(null)} />}
    </div>
  )
}

/**
 * V1.6：中央神鬼道竖排和两条河道（坐标取自 PPTX，见 shared/game/godsPath.ts）。
 * 不在外圈的玩家画在这里：神鬼道节点或桥上的进度刻度。
 */
function CentralRegion({
  players,
  currentUid,
  godsOpen,
  riverGodUid,
}: {
  players: GamePlayerState[]
  currentUid: string
  godsOpen: boolean
  riverGodUid: string | null
}) {
  const offRing = players.filter((p) => p.zone && p.zone.kind !== 'ring')
  return (
    <>
      <div className="mg-river mg-river-L" aria-hidden="true">
        <span>河道（渡河）</span>
      </div>
      <div className="mg-river mg-river-R" aria-hidden="true">
        <span>河道（渡河）</span>
      </div>
      {(['L', 'R'] as const).map((side) => (
        <div key={side} className={`mg-bridge mg-bridge-${side}`} aria-hidden="true" title="桥：13 格，过桥费 1 金币，桥上每次掷骰喝 2 口">
          {Array.from({ length: 13 }, (_, i) => (
            <span key={i} className="mg-bridge-step" />
          ))}
        </div>
      ))}
      {Array.from({ length: GODS_NODE_COUNT }, (_, node) => {
        const pos = godsNodePosition(node)
        const region = godsRegion(node)
        const here = offRing.filter((p) => p.zone.kind === 'gods' && p.zone.node === node)
        return (
          <div
            key={node}
            className={`mg-gods-node mg-gods-${region.toLowerCase()}${godsOpen ? '' : ' mg-gods-closed'}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={region === 'FINISH' ? '终点' : region === 'HEAVEN' ? '天堂：每次地图掷骰 +1 金币' : '地狱：每次地图掷骰 −1 金币'}
          >
            {node === GODS_FINISH_NODE && <span className="mg-gods-finish-label">终点</span>}
            {here.map((p, idx) => (
              <span
                key={p.uid}
                id={`mg-token-${p.uid}`}
                className={`mg-token ${COLOR_CLASS[p.color]}${p.uid === currentUid ? ' mg-token-active' : ''}${p.uid === riverGodUid ? ' mg-token-god' : ''}`}
                style={{ transform: `translate(${idx * 6}px, ${idx * -6}px)` }}
              />
            ))}
          </div>
        )
      })}
      <span className="mg-gods-region-label" style={{ left: '49.9%', top: '11.2%' }}>
        天堂 ↓
      </span>
      <span className="mg-gods-region-label" style={{ left: '49.9%', top: '92.2%' }}>
        地狱 ↑
      </span>
      {offRing
        .filter((p) => p.zone.kind === 'bridge')
        .map((p, idx) => {
          const z = p.zone as { kind: 'bridge'; side: 'L' | 'R'; step: number }
          const pos = bridgePosition(z.side, z.step)
          return (
            <span
              key={p.uid}
              id={`mg-token-${p.uid}`}
              className={`mg-token mg-bridge-token ${COLOR_CLASS[p.color]}${p.uid === currentUid ? ' mg-token-active' : ''}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: `translate(calc(-50% + ${idx * 8}px), -50%)` }}
              title={`桥上 ${z.step}/13`}
            />
          )
        })}
    </>
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
