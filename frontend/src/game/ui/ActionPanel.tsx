import { useState } from 'react'
import type { GameController } from '../useGameController'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import type { GamePlayerState, PendingDecision, TurnPhase } from '../../../../shared/game/types'
import { getLadyCard } from '../../../../shared/game/cards/ladyCards'
import { TACTIC_HAND_LIMIT, getTacticCard } from '../../../../shared/game/cards/tacticCards'
import { DiceButton } from './DiceButton'
import {
  HOST_LINE_BUY_PROPERTY,
  HOST_LINE_DRINK_ACK,
  HOST_LINE_HOST_RULING,
  HOST_LINE_TRUTH_OR_DARE,
} from '../tutorial/tutorialLines'

interface ActionPanelProps {
  isMyTurn: boolean
  isHost: boolean
  phase: TurnPhase
  pendingDecision: PendingDecision | null
  lastRollNatural: number | null
  rolling: boolean
  onRollDice: () => void
  revealedLadyCardId: string | null
  me: GamePlayerState
  roomPlayers: GameRoomPlayer[]
  controller: GameController
}

export function ActionPanel({
  isMyTurn,
  isHost,
  phase,
  pendingDecision,
  lastRollNatural,
  rolling,
  onRollDice,
  revealedLadyCardId,
  me,
  roomPlayers,
  controller,
}: ActionPanelProps) {
  if (pendingDecision) {
    return (
      <PendingDecisionPanel
        decision={pendingDecision}
        isMyTurn={isMyTurn}
        isHost={isHost}
        roomPlayers={roomPlayers}
        controller={controller}
      />
    )
  }

  if (!isMyTurn) {
    return <WaitingNote text="等待对方操作，你的界面会自动同步…" />
  }

  if (phase === 'ROLLING') {
    return (
      <div className="mg-action-panel mg-action-panel-center">
        <DiceButton
          value={lastRollNatural}
          rolling={rolling}
          disabled={controller.busy}
          onRoll={onRollDice}
          label="掷骰子"
        />
      </div>
    )
  }

  if (phase === 'LANDING') {
    return (
      <div className="mg-action-panel">
        <button
          type="button"
          className="mg-btn mg-btn-primary"
          style={{ width: '100%' }}
          disabled={controller.busy}
          onClick={() => void controller.advanceAfterLanding()}
        >
          继续
        </button>
      </div>
    )
  }

  if (phase === 'LADY_CARD') {
    if (revealedLadyCardId) {
      const card = getLadyCard(revealedLadyCardId)
      return (
        <div className="mg-action-panel mg-stack">
          <div className="mg-lady-card-reveal mg-card-flip-in">
            <p className="mg-display mg-lady-card-name">{card.name}</p>
            <p className="mg-muted">{card.ruleStatus === 'pending' ? '牌义待房主现场裁定' : card.description}</p>
          </div>
        </div>
      )
    }
    return (
      <div className="mg-action-panel mg-action-panel-center">
        <button
          type="button"
          className="mg-btn mg-btn-gold mg-flip-btn"
          disabled={controller.busy}
          onClick={() => void controller.revealLadyCard()}
        >
          翻开主牌
        </button>
      </div>
    )
  }

  // TACTIC
  return (
    <TacticPanel me={me} roomPlayers={roomPlayers} controller={controller} />
  )
}

function PendingDecisionPanel({
  decision,
  isMyTurn,
  isHost,
  roomPlayers,
  controller,
}: {
  decision: PendingDecision
  isMyTurn: boolean
  isHost: boolean
  roomPlayers: GameRoomPlayer[]
  controller: GameController
}) {
  if (decision.kind === 'BUY_PROPERTY') {
    if (!isMyTurn) return <WaitingNote text="对方正在决定是否购买地产…" />
    return (
      <div className="mg-action-panel mg-stack">
        <p className="mg-muted">{HOST_LINE_BUY_PROPERTY.message}</p>
        <div className="mg-action-row">
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.buyProperty(false)}>
            放弃
          </button>
          <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.buyProperty(true)}>
            买下「{decision.propertyName}」（{decision.price} 金币）
          </button>
        </div>
      </div>
    )
  }

  if (decision.kind === 'DRINK_ACK') {
    if (!isMyTurn) return <WaitingNote text="对方正在处理喝酒事件…" />
    return (
      <div className="mg-action-panel mg-stack">
        <p className="mg-muted">{HOST_LINE_DRINK_ACK.message}（{decision.amount} 口）</p>
        <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy} onClick={() => void controller.ackDrink()}>
          已处理
        </button>
      </div>
    )
  }

  if (decision.kind === 'CHOOSE_DRINK_TARGET') {
    if (!isMyTurn) return <WaitingNote text="对方正在指定喝酒目标…" />
    return (
      <div className="mg-action-panel mg-stack">
        <p className="mg-muted">指定一名玩家喝 {decision.amount} 口</p>
        <div className="mg-target-grid">
          {roomPlayers.map((p) => (
            <button
              key={p.uid}
              type="button"
              className="mg-btn mg-btn-ghost"
              disabled={controller.busy}
              onClick={() => void controller.chooseDrinkTarget(p.uid)}
            >
              {p.nickname}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (decision.kind === 'TRUTH_OR_DARE') {
    if (!isMyTurn) return <WaitingNote text="对方正在真心话大冒险…" />
    return (
      <div className="mg-action-panel mg-stack">
        <p className="mg-muted">{HOST_LINE_TRUTH_OR_DARE.message}</p>
        <div className="mg-action-row">
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.truthOrDare('TRUTH')}>
            真心话
          </button>
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.truthOrDare('DARE')}>
            大冒险
          </button>
        </div>
      </div>
    )
  }

  // HOST_RULING / NATURAL_SIX_CHAIN：只有房主能确认
  return (
    <div className="mg-action-panel mg-stack">
      <p className="mg-muted">{HOST_LINE_HOST_RULING.message}</p>
      <p className="mg-faint">{decision.kind === 'HOST_RULING' ? decision.description : '是否继续连锁额外掷骰？'}</p>
      {isHost ? (
        <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy} onClick={() => void controller.hostRulingAck()}>
          确认裁定
        </button>
      ) : (
        <WaitingNote text="等待房主现场裁定…" />
      )}
    </div>
  )
}

function WaitingNote({ text }: { text: string }) {
  return (
    <div className="mg-action-panel mg-action-panel-waiting">
      <span className="mg-waiting-dot" aria-hidden="true" />
      <p className="mg-muted">{text}</p>
    </div>
  )
}

function TacticPanel({
  me,
  roomPlayers,
  controller,
}: {
  me: GamePlayerState
  roomPlayers: GameRoomPlayer[]
  controller: GameController
}) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [targetUid, setTargetUid] = useState<string | null>(null)
  const selectedDef = selectedCardId ? getTacticCard(selectedCardId) : null

  return (
    <div className="mg-action-panel mg-stack">
      <p className="mg-muted">要不要出一张战术牌？（手牌 {me.tacticHand.length}/{TACTIC_HAND_LIMIT}）</p>
      <div className="mg-hand-row">
        {me.tacticHand.length === 0 && <p className="mg-faint">手牌是空的。</p>}
        {me.tacticHand.map((cardId, idx) => {
          const def = getTacticCard(cardId)
          const selected = selectedCardId === cardId
          return (
            <button
              key={`${cardId}-${idx}`}
              type="button"
              className={`mg-tactic-card${selected ? ' mg-tactic-card-selected' : ''}`}
              onClick={() => {
                setSelectedCardId(selected ? null : cardId)
                setTargetUid(null)
              }}
            >
              <span className="mg-display mg-tactic-card-name">{def.name}</span>
              <span className="mg-faint mg-tactic-card-desc">{def.description}</span>
            </button>
          )
        })}
      </div>

      {selectedDef && selectedDef.requiresTarget && (
        <div className="mg-target-grid">
          {roomPlayers
            .filter((p) => p.uid !== me.uid)
            .map((p) => (
              <button
                key={p.uid}
                type="button"
                className={`mg-btn mg-btn-ghost${targetUid === p.uid ? ' mg-tactic-target-selected' : ''}`}
                onClick={() => setTargetUid(p.uid)}
              >
                {p.nickname}
              </button>
            ))}
        </div>
      )}

      <div className="mg-action-row">
        <button
          type="button"
          className="mg-btn mg-btn-ghost"
          disabled={controller.busy}
          onClick={() => {
            void (async () => {
              await controller.skipTactic()
              await controller.endTurn()
            })()
          }}
        >
          跳过并结束回合
        </button>
        {selectedDef && (
          <button
            type="button"
            className="mg-btn mg-btn-gold"
            disabled={controller.busy || (selectedDef.requiresTarget && !targetUid)}
            onClick={() => {
              void (async () => {
                await controller.playTacticCard(selectedDef.id, targetUid)
                setSelectedCardId(null)
                setTargetUid(null)
                await controller.endTurn()
              })()
            }}
          >
            打出「{selectedDef.name}」
          </button>
        )}
      </div>
    </div>
  )
}
