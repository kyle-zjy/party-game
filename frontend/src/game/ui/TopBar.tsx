import type { TurnPhase } from '../../../../shared/game/types'

const PHASE_LABEL: Record<TurnPhase, string> = {
  ROLLING: '掷骰阶段',
  LANDING: '落点结算',
  LADY_CARD: '翻主牌',
  TACTIC: '战术阶段',
}

export function TopBar({
  roomCode,
  turnNumber,
  currentNickname,
  isMyTurn,
  phase,
  onOpenTarot,
  onOpenMenu,
}: {
  roomCode: string
  turnNumber: number
  currentNickname: string
  isMyTurn: boolean
  phase: TurnPhase
  onOpenTarot: () => void
  onOpenMenu: () => void
}) {
  return (
    <div className="mg-topbar">
      <div className="mg-topbar-row">
        <span className="mg-pill">房间 {roomCode}</span>
        <span className="mg-pill">第 {turnNumber} 回合</span>
        <button type="button" className="mg-pill mg-topbar-tarot" onClick={onOpenTarot}>
          世界塔罗
        </button>
        <button type="button" className="mg-btn-icon" onClick={onOpenMenu} aria-label="更多">
          <MenuIcon />
        </button>
      </div>
      <div className={`mg-topbar-turn${isMyTurn ? ' mg-topbar-turn-mine' : ''}`}>
        <span className="mg-topbar-turn-name mg-display">{isMyTurn ? '你' : currentNickname}</span>
        <span className="mg-topbar-turn-phase">{PHASE_LABEL[phase]}</span>
        {isMyTurn && <span className="mg-topbar-turn-badge">轮到你了</span>}
      </div>
    </div>
  )
}

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
