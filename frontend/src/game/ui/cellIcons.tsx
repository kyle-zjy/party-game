import type { BoardEventKind } from '../../../../shared/game/board'

/**
 * 缩小状态下格子只显示颜色+图标，不显示完整文字——用户反馈"棋盘格子文本
 * 相互重叠，手机上无法阅读"，根因之一是缩小状态下直接塞长文本进 56px
 * 的格子（见 GameBoard.tsx 的重写说明）。这里给每种格子效果画一个简单的
 * 自绘 SVG 图标，不用 emoji 充当主要 UI 图标。
 */
export function CellIcon({ kind, size = 16 }: { kind: BoardEventKind | 'property' | 'start'; size?: number }) {
  const s = size
  const common = { width: s, height: s, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  switch (kind) {
    case 'start':
      return (
        <svg {...common}>
          <path d="M6 3v18M6 4h11l-3 4 3 4H6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'property':
      return (
        <svg {...common}>
          <path d="M4 11L12 4l8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="6" y="11" width="12" height="9" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      )
    case 'coin':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <text x="12" y="16" textAnchor="middle" fontSize="10" fill="currentColor" fontWeight="700">
            $
          </text>
        </svg>
      )
    case 'forward':
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'back':
      return (
        <svg {...common}>
          <path d="M19 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'drinkSelf':
    case 'drinkPrev':
    case 'drinkNext':
    case 'drinkTarget':
      return (
        <svg {...common}>
          <path d="M5 4h14l-2 9a5 5 0 0 1-10 0L5 4Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M9 20h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 13v7" stroke="currentColor" strokeWidth="2" />
        </svg>
      )
    case 'truthOrDare':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor" fontWeight="700">
            ?
          </text>
        </svg>
      )
    case 'changeTarot':
      return (
        <svg {...common}>
          <rect x="7" y="3" width="10" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M9 7h6M9 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'drawTacticCard':
      return (
        <svg {...common}>
          <rect x="4" y="5" width="12" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="9" y="3" width="12" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.6" />
        </svg>
      )
    case 'pendingRuling':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
          <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor" fontWeight="700">
            !
          </text>
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      )
  }
}
