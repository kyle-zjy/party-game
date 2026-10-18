import type { PendingHeartAttack } from '../../../../shared/game/types'
import { HOST_LINE_HEART_ATTACK } from '../tutorial/tutorialLines'

/**
 * 德国心脏病触发——用户明确要求："本阶段可以先完成触发识别和界面准备，
 * 后续再为抢答阶段使用短时实时同步方案。不要伪装成已完成公平抢答。"
 * 所以这里只是一个全桌可见的"触发了！"全屏提示，不做任何抢答判定，
 * 最终"谁是第一反应者"由房主现场确认后点击"确认处理完毕"。
 */
export function HeartAttackOverlay({
  event,
  isHost,
  nicknameOf,
  onDismiss,
}: {
  event: PendingHeartAttack
  isHost: boolean
  nicknameOf: (uid: string) => string
  onDismiss: () => void
}) {
  return (
    <div className="mg-scrim mg-heart-attack-scrim" role="alertdialog" aria-modal="true">
      <div className="mg-heart-attack-burst mg-fade-in">
        <p className="mg-heart-attack-title mg-display">德国心脏病！</p>
        <p className="mg-heart-attack-sub">
          最近 5 张主牌数量和为 {event.count}，由 {nicknameOf(event.revealedByUid)} 翻出
        </p>
        <p className="mg-muted" style={{ marginTop: 12 }}>
          {HOST_LINE_HEART_ATTACK.detail}
        </p>
        {isHost ? (
          <button type="button" className="mg-btn mg-btn-gold" style={{ marginTop: 20 }} onClick={onDismiss}>
            已现场确认，继续游戏
          </button>
        ) : (
          <p className="mg-muted" style={{ marginTop: 20 }}>
            等待房主现场确认第一反应者…
          </p>
        )}
      </div>
    </div>
  )
}
