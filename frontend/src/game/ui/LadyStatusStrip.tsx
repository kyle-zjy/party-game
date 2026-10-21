import type { GameController } from '../useGameController'
import type { GameState } from '../../../../shared/game/types'

/**
 * 小姐牌带来的持续状态，常驻在棋盘上方：当前小姐、神经病、国王和待执行的国王任务、
 * 替喝机会、暂离通行证和暂离中的玩家。自己相关的操作（暂离/回来）也放在这里。
 */
export function LadyStatusStrip({
  game,
  myUid,
  isHost,
  nicknameOf,
  controller,
  onOpenRules,
  onCrazyCatch,
}: {
  game: GameState
  myUid: string
  isHost: boolean
  nicknameOf: (uid: string) => string
  controller: GameController
  onOpenRules: () => void
  onCrazyCatch: () => void
}) {
  const s = game.ladyStatus
  const name = (uid: string) => (uid === myUid ? '你' : nicknameOf(uid))
  const myAway = s.away.find((a) => a.uid === myUid)
  const hasAwayPass = s.awayPassUids.includes(myUid)

  const chips: { key: string; label: string; tone: string }[] = []
  if (s.mistressUid) chips.push({ key: 'mistress', label: `小姐：${name(s.mistressUid)}（别人被罚时陪 1 口）`, tone: 'coral' })
  if (s.crazyUid) chips.push({ key: 'crazy', label: `神经病：${name(s.crazyUid)}（别搭理 TA 的闲聊）`, tone: 'purple' })
  if (s.kingUid) chips.push({ key: 'king', label: `国王：${name(s.kingUid)}`, tone: 'gold' })
  if (game.kingTask?.status === 'PENDING') chips.push({ key: 'task', label: `有一条任务等待下一任国王（${name(game.kingTask.creatorUid)} 留下）`, tone: 'gold' })
  if (s.substitutePassUids.length > 0) chips.push({ key: 'sub', label: `替喝机会：${s.substitutePassUids.map(name).join('、')}`, tone: 'teal' })
  if (s.awayPassUids.length > 0) chips.push({ key: 'pass', label: `暂离通行证：${s.awayPassUids.map(name).join('、')}`, tone: 'teal' })
  for (const a of s.away) chips.push({ key: `away-${a.uid}`, label: `${name(a.uid)} 暂离中${a.withPass ? '（通行证）' : ''}`, tone: 'muted' })

  return (
    <div className="mg-lady-status">
      <div className="mg-lady-status-head">
        <span className="mg-active-tarot-name">小姐牌状态</span>
        <button type="button" className="mg-pill" onClick={onOpenRules}>
          查看 13 张牌规则
        </button>
      </div>
      {chips.length > 0 ? (
        <div className="mg-chip-row">
          {chips.map((c) => (
            <span key={c.key} className={`mg-status-chip mg-status-chip-${c.tone}`}>
              {c.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="mg-faint">还没有持续生效的小姐牌效果。</p>
      )}
      <div className="mg-chip-row">
        {myAway ? (
          <button type="button" className="mg-pill" disabled={controller.busy} onClick={() => void controller.setAway(myUid, false, false)}>
            我回来了
          </button>
        ) : (
          <>
            <button type="button" className="mg-pill" disabled={controller.busy} onClick={() => void controller.setAway(myUid, true, false)}>
              暂离一下
            </button>
            {hasAwayPass && (
              <button type="button" className="mg-pill" disabled={controller.busy} onClick={() => void controller.setAway(myUid, true, true)}>
                使用暂离通行证
              </button>
            )}
          </>
        )}
        {isHost && s.crazyUid && (
          <button type="button" className="mg-pill" onClick={onCrazyCatch}>
            神经病：记录上当
          </button>
        )}
        {isHost &&
          s.away
            .filter((a) => a.uid !== myUid)
            .map((a) => (
              <button key={a.uid} type="button" className="mg-pill" disabled={controller.busy} onClick={() => void controller.setAway(a.uid, false, false)}>
                标记 {nicknameOf(a.uid)} 已回来
              </button>
            ))}
      </div>
      <p className="mg-faint">任何人都可以随时离席，不会受罚；暂离不会跳过任何人的回合，轮到暂离的人时等 TA 回来。</p>
    </div>
  )
}
