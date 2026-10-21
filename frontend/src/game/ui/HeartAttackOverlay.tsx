import { useState } from 'react'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import type { PendingHeartAttack } from '../../../../shared/game/types'
import { heartAttackCheck, LADY_SUIT_LABEL } from '../../../../shared/game/cards/ladyDeck'
import { heartAttackReward, TAROT_ID } from '../../../../shared/game/engine/tarotEffects'
import { LadyCardFace } from './LadyCardFace'

/**
 * 德国心脏病：全桌看到同一个最近 5 张窗口和每种花色的合计。
 * 5 秒轮询无法公平判断抢答先后，由房主线下观察后录入第一反应者和误抢者，
 * 系统按规则结算奖惩（星星塔罗下第一名改为 2 金币）。
 */
export function HeartAttackOverlay({
  event,
  isHost,
  tarotId,
  players,
  nicknameOf,
  busy,
  onResolve,
}: {
  event: PendingHeartAttack
  isHost: boolean
  tarotId: string
  players: GameRoomPlayer[]
  nicknameOf: (uid: string) => string
  busy: boolean
  onResolve: (firstUid: string | null, falseStartUids: string[]) => void
}) {
  const [first, setFirst] = useState<string | null>(null)
  const [falseStarts, setFalseStarts] = useState<string[]>([])
  const reward = heartAttackReward(tarotId)
  const { suitTotals } = heartAttackCheck(event.windowCardIds)
  const triggered = new Set(event.triggeredSuits.map((t) => t.suit))

  return (
    <div className="mg-scrim mg-heart-attack-scrim" role="alertdialog" aria-modal="true">
      <div className="mg-heart-attack-burst mg-fade-in">
        <p className="mg-heart-attack-title mg-display">德国心脏病！</p>
        <p className="mg-heart-attack-sub">{nicknameOf(event.revealedByUid)} 翻出了第 5 张，触发了反应</p>

        {event.windowCardIds.length > 0 && (
          <>
            <div className="mg-lady-window">
              {event.windowCardIds.map((id, i) => (
                <LadyCardFace key={`${id}-${i}`} cardId={id} small />
              ))}
            </div>
            <div className="mg-suit-totals">
              {suitTotals.map((t) => (
                <span key={t.suit} className={`mg-suit-total${triggered.has(t.suit) ? ' mg-suit-total-hit' : ''}${LADY_SUIT_LABEL[t.suit].red ? ' mg-suit-red' : ''}`}>
                  {LADY_SUIT_LABEL[t.suit].symbol} {t.count}
                </span>
              ))}
            </div>
            <p className="mg-faint">每种花色分别相加，任意一种是 5 的倍数就触发，不同花色不混算。</p>
          </>
        )}

        <p className="mg-muted" style={{ marginTop: 10 }}>
          全桌立刻反应！第一名从银行得 {reward} 金币，误抢的人罚 1 口。
          {tarotId === TAROT_ID.STAR && '（星星生效中：奖励从 1 金币提高到 2 金币）'}
        </p>

        {isHost ? (
          <div className="mg-stack" style={{ marginTop: 16 }}>
            <p className="mg-faint">第一个正确反应的人：</p>
            <div className="mg-target-grid">
              {players.map((p) => (
                <button key={p.uid} type="button" className={`mg-btn mg-btn-ghost${first === p.uid ? ' mg-tactic-target-selected' : ''}`} onClick={() => setFirst(first === p.uid ? null : p.uid)}>
                  {p.nickname}
                </button>
              ))}
            </div>
            <p className="mg-faint">误抢的人（可多选，可不选）：</p>
            <div className="mg-target-grid">
              {players.map((p) => (
                <button
                  key={p.uid}
                  type="button"
                  className={`mg-btn mg-btn-ghost${falseStarts.includes(p.uid) ? ' mg-tactic-target-selected' : ''}`}
                  onClick={() => setFalseStarts((prev) => (prev.includes(p.uid) ? prev.filter((u) => u !== p.uid) : [...prev, p.uid]))}
                >
                  {p.nickname}
                </button>
              ))}
            </div>
            <button type="button" className="mg-btn mg-btn-gold" disabled={busy} onClick={() => onResolve(first, falseStarts.filter((u) => u !== first))}>
              {first ? `确认：${nicknameOf(first)} 第一，得 ${reward} 金币` : '确认：无人正确反应'}
            </button>
          </div>
        ) : (
          <p className="mg-muted" style={{ marginTop: 20 }}>
            快反应！房主会在线下确认谁是第一名…
          </p>
        )}
      </div>
    </div>
  )
}
