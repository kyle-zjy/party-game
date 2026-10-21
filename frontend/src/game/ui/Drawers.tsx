import type { ReactNode } from 'react'
import { TAROT_CARDS, getTarotCard } from '../../../../shared/game/cards/tarotCards'
import { activeTarotImpacts } from '../../../../shared/game/engine/tarotEffects'
import type { GameHistoryEntry, GamePlayerState } from '../../../../shared/game/types'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import { QUICK_START_STEPS } from '../tutorial/tutorialLines'

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="mg-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mg-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-header">
          <h3 className="mg-display">{title}</h3>
          <button type="button" className="mg-btn mg-btn-ghost mg-sheet-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function LeaderboardDrawer({
  players,
  roomPlayers,
  myUid,
  onClose,
}: {
  players: GamePlayerState[]
  roomPlayers: GameRoomPlayer[]
  myUid: string
  onClose: () => void
}) {
  const nicknameOf = (uid: string) => roomPlayers.find((p) => p.uid === uid)?.nickname ?? uid
  const ranked = [...players].sort((a, b) => scoreOf(b) - scoreOf(a))
  return (
    <Sheet title="排行榜" onClose={onClose}>
      <ul className="mg-leaderboard-list">
        {ranked.map((p, idx) => (
          <li key={p.uid} className={`mg-leaderboard-row${p.uid === myUid ? ' mg-leaderboard-row-me' : ''}`}>
            <span className="mg-leaderboard-rank mg-number">{idx + 1}</span>
            <span className={`mg-token mg-token-${p.color}`} />
            <span className="mg-leaderboard-name">{nicknameOf(p.uid)}</span>
            <span className="mg-faint">{p.properties.length} 处地产</span>
            <span className="mg-number mg-leaderboard-coins">{p.coins} 金</span>
          </li>
        ))}
      </ul>
      <p className="mg-faint" style={{ marginTop: 10 }}>
        得分规则（抵达终点 10 分 + 每金币 1 分 + 每地产 2 分 + 每套同色地产额外 2 分）尚未接入最终结算，这里先按金币排序，仅供参考。
      </p>
    </Sheet>
  )
}

function scoreOf(p: GamePlayerState): number {
  return p.coins + p.properties.length * 2
}

export function HistoryDrawer({
  history,
  nicknameOf,
  onClose,
}: {
  history: GameHistoryEntry[]
  nicknameOf: (uid: string) => string
  onClose: () => void
}) {
  const recent = [...history].reverse()
  return (
    <Sheet title="最近事件" onClose={onClose}>
      <ul className="mg-history-list">
        {recent.map((h) => (
          <li key={h.id} className="mg-history-row">
            {h.actorUid && <strong>{nicknameOf(h.actorUid)}：</strong>}
            {h.message}
          </li>
        ))}
        {recent.length === 0 && <li className="mg-faint">还没有发生任何事件。</li>}
      </ul>
    </Sheet>
  )
}

export function TarotDrawer({ currentTarotId, onClose }: { currentTarotId: string; onClose: () => void }) {
  const current = getTarotCard(currentTarotId)
  return (
    <Sheet title="世界塔罗" onClose={onClose}>
      <div className="mg-tarot-current mg-glow-purple">
        <p className="mg-faint">{current.romanNumeral}</p>
        <p className="mg-display mg-tarot-current-name">
          {current.name} · {current.nameEn}
        </p>
        <p className="mg-muted">{current.description}</p>
        <p className="mg-faint" style={{ marginTop: 10 }}>
          正在改变的结算：
        </p>
        <ul className="mg-tarot-impact-list">
          {activeTarotImpacts(currentTarotId).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <p className="mg-muted" style={{ margin: '14px 0 6px' }}>
        全部 22 张（仅供查阅）
      </p>
      <ul className="mg-tarot-list">
        {TAROT_CARDS.map((t) => (
          <li key={t.id} className={`mg-tarot-row${t.id === currentTarotId ? ' mg-tarot-row-active' : ''}`}>
            <span className="mg-faint">{t.romanNumeral}</span>
            <span className="mg-tarot-row-name">{t.name}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

export function HelpDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="新手帮助" onClose={onClose}>
      <p className="mg-muted" style={{ marginBottom: 10 }}>
        整个回合的流程是：
      </p>
      <ol className="mg-help-steps">
        {QUICK_START_STEPS.map((s, idx) => (
          <li key={idx}>{s.message}</li>
        ))}
      </ol>
      <p className="mg-faint" style={{ marginTop: 12 }}>
        点击棋盘上的任意格子可以查看这个格子的详细说明；标"规则待确认"的卡牌/格子是原始规则书没写清楚的部分，交给房主现场裁定，不是系统的 bug。
      </p>
    </Sheet>
  )
}
