import { useState } from 'react'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import { TAROT_ID } from '../../../../shared/game/engine/tarotEffects'
import type { GameController } from '../useGameController'

/**
 * 全局禁令"不能说为什么"：有人当场指认后，由房主录入谁抓了谁、指认是否成立。
 * 正确：抓人者从银行得 1 金币（教皇 2 金币），违规者罚 1 口；错误：抓人者罚 1 金币。
 */
export function BanCatchSheet({
  players,
  tarotId,
  controller,
  onClose,
}: {
  players: GameRoomPlayer[]
  tarotId: string
  controller: GameController
  onClose: () => void
}) {
  const [catcher, setCatcher] = useState<string | null>(null)
  const [violator, setViolator] = useState<string | null>(null)
  // 每次打开面板 = 一次违规事件，重复点击/重试都带同一个 id，只结算一次
  const [incidentId] = useState(() => `ban-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const reward = tarotId === TAROT_ID.HIEROPHANT ? 2 : 1
  const ready = catcher && violator && catcher !== violator

  const submit = (correct: boolean) => {
    if (!catcher || !violator) return
    void controller.banCatch(catcher, violator, correct, incidentId).then(onClose)
  }

  return (
    <div className="mg-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mg-sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="mg-display">禁令：有人说了"为什么"</h3>
        <p className="mg-muted">
          正确指认：抓人者从银行得 {reward} 金币{reward === 2 ? '（教皇生效中）' : ''}，说了"为什么"的人罚 1 口。错误指认：抓人者罚 1 金币。
        </p>
        <p className="mg-faint" style={{ marginTop: 10 }}>谁抓的？</p>
        <div className="mg-target-grid">
          {players.map((p) => (
            <button key={p.uid} type="button" className={`mg-btn mg-btn-ghost${catcher === p.uid ? ' mg-tactic-target-selected' : ''}`} onClick={() => setCatcher(p.uid)}>
              {p.nickname}
            </button>
          ))}
        </div>
        <p className="mg-faint" style={{ marginTop: 10 }}>被指认的人：</p>
        <div className="mg-target-grid">
          {players.map((p) => (
            <button key={p.uid} type="button" className={`mg-btn mg-btn-ghost${violator === p.uid ? ' mg-tactic-target-selected' : ''}`} onClick={() => setViolator(p.uid)}>
              {p.nickname}
            </button>
          ))}
        </div>
        <div className="mg-action-row" style={{ marginTop: 16 }}>
          <button type="button" className="mg-btn mg-btn-ghost" disabled={!ready || controller.busy} onClick={() => submit(false)}>
            指认不成立
          </button>
          <button type="button" className="mg-btn mg-btn-gold" disabled={!ready || controller.busy} onClick={() => submit(true)}>
            指认成立
          </button>
        </div>
      </div>
    </div>
  )
}
