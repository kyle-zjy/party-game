import { isEventCell, isPropertyCell, isStartCell, PROPERTY_BUY_PRICE } from '../../../../shared/game/board'
import type { BoardCell } from '../../../../shared/game/board'
import { EVENT_KIND_EXPLANATIONS } from '../tutorial/tutorialLines'

export function CellDetailSheet({ cell, onClose }: { cell: BoardCell; onClose: () => void }) {
  return (
    <div className="mg-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mg-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-header">
          <h3 className="mg-display">{title(cell)}</h3>
          <button type="button" className="mg-btn mg-btn-ghost mg-sheet-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <p className="mg-muted">{description(cell)}</p>
        {isPropertyCell(cell) && (
          <p className="mg-faint" style={{ marginTop: 8 }}>
            购买价格 {PROPERTY_BUY_PRICE} 金币 · 所属花色 {cell.propertySet}
          </p>
        )}
        <button type="button" className="mg-btn mg-btn-primary" style={{ marginTop: 16, width: '100%' }} onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  )
}

function title(cell: BoardCell): string {
  if (isStartCell(cell)) return '起点'
  if (isPropertyCell(cell)) return cell.propertyName
  if (isEventCell(cell)) return cell.label
  return '空地'
}

function description(cell: BoardCell): string {
  if (isStartCell(cell)) {
    return '经过或停留在起点都能获得 2 枚金币和 1 张战术手牌（手牌已满时不会补发）。'
  }
  if (isPropertyCell(cell)) {
    return '无主地产可以花 3 金币买下；已经有主人的话，踩中需要付租金（同色地产越多，租金越高）；自己的地产免费经过。'
  }
  if (isEventCell(cell)) {
    return EVENT_KIND_EXPLANATIONS[cell.effectKind] ?? cell.label
  }
  return '这是一块空地，没有特殊效果。'
}
