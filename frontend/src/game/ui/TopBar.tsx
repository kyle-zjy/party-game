import type { TurnPhase } from '../../../../shared/game/types'

const PHASE_LABEL: Record<TurnPhase, string> = {
  ROLLING: '掷骰',
  LANDING: '落点结算',
  LADY_CARD: '翻主牌',
  TACTIC: '战术阶段',
}

/** 顶部一行：房间 · 回合 · 当前玩家和阶段 · 菜单。旧房间额外标出"V1.5 规则" */
export function TopBar({
  roomCode,
  turnNumber,
  currentNickname,
  isMyTurn,
  phase,
  legacyRules,
  onOpenMenu,
}: {
  roomCode: string
  turnNumber: number
  currentNickname: string
  isMyTurn: boolean
  phase: TurnPhase
  legacyRules: boolean
  onOpenMenu: () => void
}) {
  return (
    <div className="mg-topbar">
      <div className={`mg-topbar-row mg-topbar-compact${isMyTurn ? ' mg-topbar-turn-mine' : ''}`}>
        <span className="mg-topbar-meta">
          {roomCode} · 第 {turnNumber} 回合
          {legacyRules && <span className="mg-legacy-badge">V1.5 规则</span>}
        </span>
        <span className="mg-topbar-turn-name mg-display">{isMyTurn ? '你' : currentNickname}</span>
        <span className="mg-topbar-turn-phase">{PHASE_LABEL[phase]}</span>
        {isMyTurn && <span className="mg-topbar-turn-badge">轮到你</span>}
        <button type="button" className="mg-btn-icon" onClick={onOpenMenu} aria-label="规则帮助">
          <MenuIcon />
        </button>
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
