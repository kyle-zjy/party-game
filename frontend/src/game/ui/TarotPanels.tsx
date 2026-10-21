import { useState } from 'react'
import { getTarotCard } from '../../../../shared/game/cards/tarotCards'
import { getTacticCard } from '../../../../shared/game/cards/tacticCards'
import { activeTarotImpacts } from '../../../../shared/game/engine/tarotEffects'
import type { GamePlayerState, GameState, TarotChangeEvent } from '../../../../shared/game/types'
import type { GameController } from '../useGameController'
import { TarotCardFace } from './TarotCardFace'

/**
 * 世界塔罗揭示——每次塔罗更换时，全桌各自弹出一次（按事件 id 去重，刷新后不重复弹出
 * 同一次更换）。分步骤说明：①卡牌名称与动画 ②规则改变了什么 ③影响哪些玩家
 * ④即时效果的结算结果。关闭后游戏自动继续。
 */
export function TarotRevealOverlay({
  event,
  nicknameOf,
  onClose,
}: {
  event: TarotChangeEvent
  nicknameOf: (uid: string) => string
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const card = getTarotCard(event.tarotId)
  const previous = event.previousTarotId ? getTarotCard(event.previousTarotId) : null
  const impacts = activeTarotImpacts(event.tarotId)
  const steps = [
    {
      title: previous ? `世界塔罗更换：${previous.name} → ${card.name}` : `开局世界塔罗：${card.name}`,
      body: (
        <>
          <TarotCardFace tarotId={event.tarotId} large />
          <p className="mg-muted" style={{ marginTop: 12 }}>
            {event.triggeredByUid ? `${nicknameOf(event.triggeredByUid)} 踩中了「更换塔罗」格子。` : '棋盘摆开 1 张世界塔罗，整局任何时候只有 1 张生效。'}
          </p>
        </>
      ),
    },
    {
      title: '这张牌改变了什么',
      body: (
        <>
          <p className="mg-quickstart-message">{card.description}</p>
          <ul className="mg-tarot-impact-list">
            {impacts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {previous && <p className="mg-faint">「{previous.name}」的持续效果已经失效。</p>}
        </>
      ),
    },
    {
      title: event.summary.length > 0 ? '结算结果' : '谁会受到影响',
      body:
        event.summary.length > 0 ? (
          <ul className="mg-tarot-impact-list">
            {event.summary.map((line, i) => (
              <li key={i}>
                <strong>{line.uid ? nicknameOf(line.uid) : '全桌'}</strong>：{line.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mg-muted">所有玩家在相关结算时都会受到这张牌影响，到时界面会提示具体改变了多少。</p>
        ),
    },
  ]
  const current = steps[step]!
  const last = step === steps.length - 1

  return (
    <div className="mg-scrim mg-tarot-reveal-scrim" role="dialog" aria-modal="true">
      <div className="mg-sheet mg-tarot-reveal-sheet">
        <p className="mg-faint">
          世界塔罗 · {step + 1}/{steps.length}
        </p>
        <h3 className="mg-display">{current.title}</h3>
        <div className="mg-tarot-reveal-body">{current.body}</div>
        <div className="mg-action-row" style={{ marginTop: 16 }}>
          <button type="button" className="mg-btn mg-btn-ghost" onClick={onClose}>
            跳过说明
          </button>
          <button type="button" className="mg-btn mg-btn-gold" onClick={() => (last ? onClose() : setStep(step + 1))}>
            {last ? '知道了，继续游戏' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 当前生效的世界塔罗：始终可见，列出它正在改变的结算规则和本回合已经产生的修正 */
export function ActiveTarotStrip({ game, nicknameOf, onOpen }: { game: GameState; nicknameOf: (uid: string) => string; onOpen: () => void }) {
  const card = getTarotCard(game.currentTarotId)
  const impacts = activeTarotImpacts(game.currentTarotId)
  const pair = game.tarotState.loversPair
  return (
    <button type="button" className="mg-active-tarot" onClick={onOpen}>
      <TarotCardFace tarotId={game.currentTarotId} />
      <div className="mg-active-tarot-text">
        <p className="mg-active-tarot-name">
          世界塔罗 · {card.romanNumeral} {card.name}
        </p>
        <p className="mg-faint">{impacts[0]}</p>
        {pair && (
          <p className="mg-tarot-inline">
            绑定：{nicknameOf(pair[0])} ♥ {nicknameOf(pair[1])}
          </p>
        )}
        {game.turn.tarotNotes.length > 0 && <p className="mg-tarot-inline">本回合：{game.turn.tarotNotes[game.turn.tarotNotes.length - 1]}</p>}
      </div>
    </button>
  )
}

/** 死神：需要弃牌的玩家选择弃哪一张（本人或房主处理，不卡住回合） */
export function TarotDiscardTray({
  game,
  myUid,
  isHost,
  nicknameOf,
  controller,
}: {
  game: GameState
  myUid: string
  isHost: boolean
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  if (game.pendingTarotDiscards.length === 0) return null
  return (
    <div className="mg-drink-tray">
      {game.pendingTarotDiscards.map((uid) => {
        const p: GamePlayerState | undefined = game.players[uid]
        if (!p) return null
        const canAct = uid === myUid || isHost
        return (
          <div key={uid} className="mg-drink-ack-row">
            <p className="mg-drink-ack-target">死神：{uid === myUid ? '你' : nicknameOf(uid)}需要弃 1 张手牌</p>
            {canAct ? (
              <div className="mg-target-grid">
                {p.tacticHand.map((cardId, i) => (
                  <button key={`${cardId}-${i}`} type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.tarotDiscard(uid, cardId)}>
                    弃「{getTacticCard(cardId).name}」
                  </button>
                ))}
              </div>
            ) : (
              <p className="mg-faint">等待 {nicknameOf(uid)} 或房主选择</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
