import type { PendingDrinkAck, DrinkAckChoice } from '../../../../shared/game/types'
import type { GameController } from '../useGameController'

/**
 * 非阻塞的"待喝酒确认"提示条——目标玩家自己或房主随时可以处理，不影响
 * 正在进行的回合（见 shared/game/types.ts 的 PendingDrinkAck 注释）。
 * 本人看到的是"我被点名了"；房主额外能看到所有人的待确认事项、可以代确认。
 */
export function DrinkAckTray({
  acks,
  myUid,
  isHost,
  nicknameOf,
  controller,
}: {
  acks: PendingDrinkAck[]
  myUid: string
  isHost: boolean
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  const visible = isHost ? acks : acks.filter((a) => a.targetUid === myUid)
  if (visible.length === 0) return null

  return (
    <div className="mg-drink-tray mg-fade-in">
      {visible.map((ack) => (
        <div key={ack.id} className="mg-drink-ack-row">
          <div className="mg-drink-ack-info">
            <span className="mg-drink-ack-target">{nicknameOf(ack.targetUid)}</span>
            <span className="mg-faint">
              {ack.reason} · {ack.amount} 口
            </span>
          </div>
          <div className="mg-drink-ack-choices">
            {(['DONE', 'WATER', 'SKIP'] as DrinkAckChoice[]).map((choice) => (
              <button
                key={choice}
                type="button"
                className="mg-btn mg-btn-ghost mg-drink-choice-btn"
                disabled={controller.busy}
                onClick={() => void controller.resolveDrinkAck(ack.id, choice)}
              >
                {choiceLabel(choice)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function choiceLabel(choice: DrinkAckChoice): string {
  switch (choice) {
    case 'DONE':
      return '已完成'
    case 'WATER':
      return '以水代替'
    case 'SKIP':
      return '跳过'
  }
}
