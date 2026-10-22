import { useEffect, useState } from 'react'
import type { GameController } from '../useGameController'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import type { GameState, LadyEvent } from '../../../../shared/game/types'
import { getLadyCard } from '../../../../shared/game/cards/ladyCards'
import { formatLadyCard } from '../../../../shared/game/cards/ladyDeck'
import { isAwayWithPass, KING_TASK_MAX_LENGTH, validateKingTaskContent } from '../../../../shared/game/engine/ladyEvents'
import { ladyCardDisplayName, ladyEventStepText, ladyEventWaitingOn, ladyRuleLabel } from '../tutorial/ladyGuide'
import { useAnimateOnce } from '../tutorial/ladyRevealSeen'
import { LadyCardFace } from './LadyCardFace'

const CAMERA_SECONDS = 10

/**
 * 翻开的主牌：牌面 + 规则状态 + 牌义。每次翻牌只播一次翻牌动画。
 * compact：事件进行中的紧凑版（小牌面 + 一行标题，牌义收起，点"查看规则"展开），避免长说明把操作按钮挤出屏幕。
 */
export function LadyCardReveal({ game, cardId, compact = false }: { game: GameState; cardId: string; compact?: boolean }) {
  const animate = useAnimateOnce(`lady-${game.startedAt}-${game.turnNumber}-${cardId}`)
  const [open, setOpen] = useState(false)
  const card = getLadyCard(cardId)
  const ruleLabel = ladyRuleLabel(game, cardId)
  const active = ruleLabel !== '旧房间 · 房主裁定'
  const title = `${formatLadyCard(cardId)} ${active ? ladyCardDisplayName(cardId) : card.name}`
  const rule = active ? (card.candidate?.rule ?? card.description) : card.description
  if (compact) {
    return (
      <div className={`mg-lady-compact${animate ? ' mg-card-flip-in' : ''}`}>
        <LadyCardFace cardId={cardId} small />
        <div className="mg-lady-compact-body">
          <p className="mg-display mg-lady-compact-title">{title}</p>
          <span className={`mg-rule-badge${card.ruleStatus === 'confirmed' ? ' mg-rule-badge-confirmed' : ''}`}>{ruleLabel}</span>
          <button type="button" className="mg-link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? '收起规则' : '查看规则'}
          </button>
          {open && <p className="mg-faint">{rule}</p>}
        </div>
      </div>
    )
  }
  return (
    <div className={`mg-lady-card-reveal${animate ? ' mg-card-flip-in' : ''}`}>
      <LadyCardFace cardId={cardId} />
      <p className="mg-display mg-lady-card-name">{title}</p>
      <span className={`mg-rule-badge${card.ruleStatus === 'confirmed' ? ' mg-rule-badge-confirmed' : ''}`}>{ruleLabel}</span>
      <p className="mg-muted">{rule}</p>
    </div>
  )
}

interface LadyEventPanelProps {
  game: GameState
  event: LadyEvent
  myUid: string
  hostUid: string | null
  roomPlayers: GameRoomPlayer[]
  nicknameOf: (uid: string) => string
  controller: GameController
}

/** 进行中的小姐牌事件：谁在等谁、我要做什么 */
export function LadyEventPanel({ game, event, myUid, hostUid, roomPlayers, nicknameOf, controller }: LadyEventPanelProps) {
  const isHost = myUid === hostUid
  const isActor = myUid === event.actingUid
  const waiting = ladyEventWaitingOn(event, hostUid)
  const iNeedToAct = waiting.includes(myUid)
  const waitingText = waiting.filter((u) => u !== myUid).map(nicknameOf).join('、')

  return (
    <div className="mg-action-panel mg-stack">
      <LadyCardReveal game={game} cardId={event.cardId} compact />
      <p className="mg-lady-step">{ladyEventStepText(game, event, nicknameOf)}</p>
      {iNeedToAct ? (
        <p className="mg-lady-you-act">轮到你操作 ↓</p>
      ) : (
        waitingText && (
          <p className="mg-faint">
            <span className="mg-waiting-dot" aria-hidden="true" /> 等待 {waitingText}
          </p>
        )
      )}
      <StepControls
        game={game}
        event={event}
        myUid={myUid}
        isHost={isHost}
        isActor={isActor}
        roomPlayers={roomPlayers}
        nicknameOf={nicknameOf}
        controller={controller}
      />
      {isHost && ['START', 'HOST_RESULT', 'LUCKY_ROLL', 'CHOOSE_TARGET', 'DUEL_ROLL'].includes(event.step) && (
        <button type="button" className="mg-btn mg-btn-ghost mg-lady-cancel" disabled={controller.busy} onClick={() => void controller.ladyHostCancel(event.eventId)}>
          房主：取消这次事件（无人受罚）
        </button>
      )}
    </div>
  )
}

function StepControls({
  game,
  event,
  myUid,
  isHost,
  isActor,
  roomPlayers,
  nicknameOf,
  controller,
}: Omit<LadyEventPanelProps, 'hostUid'> & { isHost: boolean; isActor: boolean }) {
  const busy = controller.busy
  const id = event.eventId

  if (event.step === 'START') {
    if (!isActor && !isHost) return null
    return <MiniGameStart event={event} busy={busy} onStart={(text) => void controller.ladyStart(id, text)} />
  }

  if (event.step === 'HOST_RESULT') {
    return (
      <>
        {event.rank === '4' && event.startedAt !== null && <CameraCountdown startedAt={event.startedAt} />}
        {isHost ? (
          <>
            <p className="mg-faint">{event.rank === '4' ? '第一个动或笑出声的人：' : '第一位失败者：'}</p>
            <div className="mg-target-grid">
              {roomPlayers
                .filter((p) => event.participants.includes(p.uid))
                .map((p) => (
                  <button key={p.uid} type="button" className="mg-btn mg-btn-ghost" disabled={busy} onClick={() => void controller.ladyHostResult(id, p.uid)}>
                    {p.nickname}
                  </button>
                ))}
            </div>
            <button type="button" className="mg-btn mg-btn-primary" disabled={busy} onClick={() => void controller.ladyHostResult(id, null)}>
              {event.rank === '4' ? '没人动，完成' : event.rank === '5' ? '报到 30 没人出错' : '没人失败，完成'}
            </button>
          </>
        ) : (
          <p className="mg-faint">线下进行中，房主确认结果后自动进入下一阶段。</p>
        )}
      </>
    )
  }

  if (event.step === 'LUCKY_ROLL') {
    if (!isActor && !isHost) return null
    return (
      <button type="button" className="mg-btn mg-btn-gold" disabled={busy} onClick={() => void controller.luckySevenRoll(id)}>
        {isActor ? '掷事件骰' : `替 ${nicknameOf(event.actingUid)} 掷事件骰`}
      </button>
    )
  }

  if (event.step === 'CHOOSE_TARGET') {
    if (!isActor) return null
    const candidates = roomPlayers.filter((p) => p.uid !== myUid && !isAwayWithPass(game, p.uid))
    return (
      <>
        <p className="mg-faint">选择决斗对手（正在使用暂离通行证的人不能被选）：</p>
        <div className="mg-target-grid">
          {candidates.map((p) => (
            <button key={p.uid} type="button" className="mg-btn mg-btn-ghost" disabled={busy} onClick={() => void controller.duelChooseTarget(id, p.uid)}>
              {p.nickname}
            </button>
          ))}
        </div>
      </>
    )
  }

  if (event.step === 'DUEL_ROLL') {
    const round = event.duelRounds[event.duelRounds.length - 1]!
    const sides = [
      { side: 'actor' as const, uid: event.actingUid, roll: round.actorRoll },
      { side: 'target' as const, uid: event.targetUid!, roll: round.targetRoll },
    ]
    return (
      <>
        <DuelHistory event={event} nicknameOf={nicknameOf} />
        <div className="mg-action-row">
          {sides.map(({ side, uid, roll }) => {
            const canRoll = roll === null && (uid === myUid || isHost)
            return (
              <div key={side} className="mg-duel-side">
                <span className="mg-faint">{uid === myUid ? '你' : nicknameOf(uid)}</span>
                <span className="mg-number mg-duel-roll">{roll ?? '?'}</span>
                {canRoll && (
                  <button type="button" className="mg-btn mg-btn-gold" disabled={busy} onClick={() => void controller.duelRoll(id, side)}>
                    {uid === myUid ? '掷骰' : '房主代掷'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </>
    )
  }

  if (event.step === 'KING_PERFORM') {
    const task = game.kingTask
    return (
      <>
        {task && (
          <div className="mg-king-task">
            <p className="mg-faint">上一任国王 {nicknameOf(task.creatorUid)} 留下的任务：</p>
            <p className="mg-king-task-text">「{task.content}」</p>
          </div>
        )}
        <p className="mg-faint">执行人：{isActor ? '你' : nicknameOf(event.actingUid)}。完成后由房主确认；不想做可以跳过，跳过不扣金币、不罚酒。</p>
        <div className="mg-action-row mg-sticky-actions">
          {(isActor || isHost) && (
            <button type="button" className="mg-btn mg-btn-ghost" disabled={busy} onClick={() => void controller.kingTaskResolve(id, false)}>
              跳过任务
            </button>
          )}
          {isHost && (
            <button type="button" className="mg-btn mg-btn-primary" disabled={busy} onClick={() => void controller.kingTaskResolve(id, true)}>
              房主确认：已完成
            </button>
          )}
        </div>
      </>
    )
  }

  if (event.step === 'KING_WRITE') {
    return (
      <>
        {event.result && <p className="mg-faint">{event.result.summary}。</p>}
        {isActor ? (
          <KingTaskWriter busy={busy} onSubmit={(content) => controller.kingWriteTask(id, content)} />
        ) : (
          <p className="mg-faint">新国王正在写任务，内容会在下一任国王出现时公开。</p>
        )}
        {isHost && (
          <button type="button" className="mg-btn mg-btn-ghost mg-lady-cancel" disabled={busy} onClick={() => void controller.kingWriteTask(id, null)}>
            房主：取消留任务（国王传承中断）
          </button>
        )}
      </>
    )
  }

  return null
}

function MiniGameStart({ event, busy, onStart }: { event: LadyEvent; busy: boolean; onStart: (text: string | null) => void }) {
  const [topic, setTopic] = useState('')
  if (event.rank === '3') {
    return (
      <>
        <div className="mg-chip-row">
          {['动物园', '水果园', '菜园', '花园'].map((t) => (
            <button key={t} type="button" className={`mg-pill${topic === t ? ' mg-pill-active' : ''}`} onClick={() => setTopic(t)}>
              {t}
            </button>
          ))}
        </div>
        <input className="mg-text-input" maxLength={20} placeholder="或者输入自定义主题" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <button type="button" className="mg-btn mg-btn-gold" disabled={busy} onClick={() => onStart(topic || null)}>
          开始逛三园
        </button>
      </>
    )
  }
  return (
    <button type="button" className="mg-btn mg-btn-gold" disabled={busy} onClick={() => onStart(null)}>
      {event.rank === '4' ? '咔嚓！开始定格' : '开始数五'}
    </button>
  )
}

/** 定格倒计时只是提示：各设备时钟不同，胜负完全由房主确认 */
function CameraCountdown({ startedAt }: { startedAt: number }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, CAMERA_SECONDS - Math.floor((nowMs - startedAt) / 1000))
  return (
    <p className="mg-lady-countdown">
      {left > 0 ? `定格中… 约 ${left} 秒` : '时间到！'}
      <span className="mg-faint">（倒计时仅供参考，以房主确认为准）</span>
    </p>
  )
}

function DuelHistory({ event, nicknameOf }: { event: LadyEvent; nicknameOf: (uid: string) => string }) {
  const finished = event.duelRounds.slice(0, -1)
  if (finished.length === 0) return null
  return (
    <ul className="mg-duel-history">
      {finished.map((r, i) => (
        <li key={i} className="mg-faint">
          第 {i + 1} 轮：{nicknameOf(event.actingUid)} {r.actorRoll} : {r.targetRoll} {event.targetUid ? nicknameOf(event.targetUid) : ''}（平局，重掷）
        </li>
      ))}
    </ul>
  )
}

function KingTaskWriter({ busy, onSubmit }: { busy: boolean; onSubmit: (content: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const check = text.trim() ? validateKingTaskContent(text) : null
  return (
    <div className="mg-stack">
      <p className="mg-faint">写一个线下轻松完成的小挑战（例如"模仿一种动物叫三声"）。不能有危险、侮辱、隐私、身体接触或强制喝酒的内容。</p>
      <textarea
        className="mg-text-input"
        rows={2}
        maxLength={KING_TASK_MAX_LENGTH}
        placeholder="给下一任国王的任务"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          // 手机键盘弹出后视口变矮：把输入框滚到可见位置，提交按钮吸底
          const el = e.currentTarget
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
        }}
      />
      <div className="mg-sticky-actions">
        {check && !check.ok && <p className="mg-lady-warning">{check.reason}</p>}
        <button
          type="button"
          className="mg-btn mg-btn-gold"
          disabled={busy || !check?.ok}
          onClick={() => {
            void onSubmit(text).then((ok) => {
              if (ok) setText('')
            })
          }}
        >
          留下任务（{text.trim().length}/{KING_TASK_MAX_LENGTH}）
        </button>
      </div>
    </div>
  )
}
