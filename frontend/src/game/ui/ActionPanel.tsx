import { useState } from 'react'
import type { GameController } from '../useGameController'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import type { GamePlayerState, GameState, PendingDecision } from '../../../../shared/game/types'
import { TACTIC_HAND_LIMIT, getTacticCard } from '../../../../shared/game/cards/tacticCards'
import { getTarotCard } from '../../../../shared/game/cards/tarotCards'
import { neighborUid } from '../../../../shared/game/engine/stateHelpers'
import { allowedTruthOrDareChoices, truthOrDareCompletionBonus, TAROT_ID } from '../../../../shared/game/engine/tarotEffects'
import { truthOrDareRefusalPenalty } from '../../../../shared/game/engine/turnEngine'
import { LadyCardReveal, LadyEventPanel } from './LadyEventPanel'
import { DiceButton } from './DiceButton'
import { HOST_LINE_BUY_PROPERTY, HOST_LINE_HOST_RULING } from '../tutorial/tutorialLines'

interface ActionPanelProps {
  game: GameState
  myUid: string
  hostUid: string | null
  isMyTurn: boolean
  isHost: boolean
  rolling: boolean
  onRollDice: () => void
  me: GamePlayerState
  roomPlayers: GameRoomPlayer[]
  nicknameOf: (uid: string) => string
  controller: GameController
}

export function ActionPanel({ game, myUid, hostUid, isMyTurn, isHost, rolling, onRollDice, me, roomPlayers, nicknameOf, controller }: ActionPanelProps) {
  const { phase, pendingDecision, lastRoll, revealedLadyCardId } = game.turn
  const currentName = nicknameOf(game.turn.currentPlayerUid)

  // 进行中的小姐牌事件：所有人都看到同一个面板，按身份显示可以做的操作
  if (game.ladyEvent && game.ladyEvent.status === 'ACTIVE') {
    return (
      <LadyEventPanel
        key={game.ladyEvent.eventId}
        game={game}
        event={game.ladyEvent}
        myUid={myUid}
        hostUid={hostUid}
        roomPlayers={roomPlayers}
        nicknameOf={nicknameOf}
        controller={controller}
      />
    )
  }

  if (pendingDecision) {
    return (
      <PendingDecisionPanel
        decision={pendingDecision}
        game={game}
        isMyTurn={isMyTurn}
        isHost={isHost}
        currentName={currentName}
        roomPlayers={roomPlayers}
        nicknameOf={nicknameOf}
        controller={controller}
      />
    )
  }

  if (!isMyTurn) {
    return <WaitingNote text={`等待 ${currentName} 操作，你的界面会自动同步…`} />
  }

  if (phase === 'ROLLING') {
    return (
      <div className="mg-action-panel mg-action-panel-center mg-stack">
        <DiceButton value={lastRoll?.natural ?? null} rolling={rolling} disabled={controller.busy} onRoll={onRollDice} label={game.turn.extraRollPending ? '额外掷骰' : '掷骰子'} />
        <DiceTarotHint tarotId={game.currentTarotId} />
      </div>
    )
  }

  if (phase === 'LANDING') {
    return (
      <div className="mg-action-panel mg-stack">
        {lastRoll?.tarotNote && (
          <p className="mg-tarot-inline">
            掷出 {lastRoll.natural} → {lastRoll.tarotNote}，实际移动 {lastRoll.effective} 格
          </p>
        )}
        <button type="button" className="mg-btn mg-btn-primary" style={{ width: '100%' }} disabled={controller.busy || !game.turn.landingResolved} onClick={() => void controller.advanceAfterLanding()}>
          {game.turn.landingResolved ? (lastRoll?.grantsExtraRoll && !game.turn.extraRollUsed && !game.turn.extraRollPending ? '继续：额外掷骰' : '继续：翻主牌') : '正在结算落点…'}
        </button>
      </div>
    )
  }

  if (phase === 'LADY_CARD') {
    return (
      <div className="mg-action-panel mg-action-panel-center">
        <button type="button" className="mg-btn mg-btn-gold mg-flip-btn" disabled={controller.busy} onClick={() => void controller.revealLadyCard()}>
          翻开主牌
        </button>
      </div>
    )
  }

  return <TacticPanel game={game} me={me} roomPlayers={roomPlayers} revealedLadyCardId={revealedLadyCardId} controller={controller} />
}

function DiceTarotHint({ tarotId }: { tarotId: string }) {
  if (tarotId === TAROT_ID.FOOL) return <p className="mg-tarot-inline">愚者生效中：自然 1 按 6 移动；自然 6 只按 1 移动，且没有额外掷骰</p>
  if (tarotId === TAROT_ID.CHARIOT) return <p className="mg-tarot-inline">战车生效中：移动 +1（最大 6），只有自然 6 才有额外掷骰</p>
  return null
}

function PendingDecisionPanel({
  decision,
  game,
  isMyTurn,
  isHost,
  currentName,
  roomPlayers,
  nicknameOf,
  controller,
}: {
  decision: PendingDecision
  game: GameState
  isMyTurn: boolean
  isHost: boolean
  currentName: string
  roomPlayers: GameRoomPlayer[]
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  if (decision.kind === 'BUY_PROPERTY') {
    if (!isMyTurn) return <WaitingNote text={`${currentName} 正在决定是否买下「${decision.propertyName}」…`} />
    const me = game.players[game.turn.currentPlayerUid]!
    const affordable = me.coins >= decision.price
    return (
      <div className="mg-action-panel mg-stack">
        <p className="mg-muted">{HOST_LINE_BUY_PROPERTY.message}</p>
        {game.currentTarotId === TAROT_ID.TOWER && <p className="mg-tarot-inline">高塔生效中：买下后暂时收不到租金，换掉高塔后恢复</p>}
        <div className="mg-action-row">
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.buyProperty(false)}>
            放弃
          </button>
          <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy || !affordable} onClick={() => void controller.buyProperty(true)}>
            {affordable ? `买下（${decision.price} 金币）` : `金币不足（需要 ${decision.price}）`}
          </button>
        </div>
      </div>
    )
  }

  if (decision.kind === 'CHOOSE_DRINK_TARGET') {
    if (!isMyTurn) return <WaitingNote text={`${currentName} 正在指定谁喝 ${decision.amount} 口…`} />
    return (
      <div className="mg-action-panel mg-stack">
        <p className="mg-muted">指定一名玩家喝 {decision.amount} 口</p>
        <PlayerPicker players={roomPlayers} disabled={controller.busy} onPick={(uid) => void controller.chooseDrinkTarget(uid)} />
      </div>
    )
  }

  if (decision.kind === 'TRUTH_OR_DARE') {
    const allowed = allowedTruthOrDareChoices(game.currentTarotId)
    const bonus = truthOrDareCompletionBonus(game.currentTarotId)
    const tarotName = getTarotCard(game.currentTarotId).name
    if (!isMyTurn) {
      return <WaitingNote text={decision.choice ? `${currentName} 正在线下完成${decision.choice === 'TRUTH' ? '真心话' : '大冒险'}…` : `${currentName} 正在选择真心话或大冒险…`} />
    }
    if (decision.choice === null) {
      return (
        <div className="mg-action-panel mg-stack">
          <p className="mg-muted">真心话大冒险：二选一，选好后在线下回答或完成。</p>
          <div className="mg-action-row">
            {(['TRUTH', 'DARE'] as const).map((c) => (
              <button key={c} type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy || !allowed.includes(c)} onClick={() => void controller.truthOrDareChoice(c)}>
                {c === 'TRUTH' ? '真心话' : '大冒险'}
              </button>
            ))}
          </div>
          {bonus > 0 && <p className="mg-tarot-inline">{tarotName}：完成后从银行得 {bonus} 金币</p>}
        </div>
      )
    }
    const label = decision.choice === 'TRUTH' ? '真心话' : '大冒险'
    const coins = game.players[game.turn.currentPlayerUid]!.coins
    const penalty = truthOrDareRefusalPenalty(coins)
    return (
      <div className="mg-action-panel mg-stack">
        {allowed.length === 1 && <p className="mg-tarot-inline">{tarotName}生效中：只能选{label}</p>}
        <p className="mg-muted">请在线下完成{label}，然后选择结果。</p>
        <p className="mg-faint">
          不做/不答：上缴当前金币的一半（向下取整）给银行——你有 {coins} 金币，将上缴 {penalty} 金币；再喝半杯（可以用非酒精饮品代替）。地产和手牌不受影响。
        </p>
        <div className="mg-action-row">
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.truthOrDareResult(false)}>
            不做/不答（−{penalty} 金币 + 半杯）
          </button>
          <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy} onClick={() => void controller.truthOrDareResult(true)}>
            已完成{bonus > 0 ? `（+${bonus} 金币）` : ''}
          </button>
        </div>
      </div>
    )
  }

  if (decision.kind === 'CHOOSE_LOVERS') {
    if (!isMyTurn) return <WaitingNote text={`恋人塔罗：${currentName} 正在指定两名玩家绑定…`} />
    return <LoversPicker players={roomPlayers} disabled={controller.busy} onConfirm={(a, b) => void controller.chooseLovers(a, b)} />
  }

  if (decision.kind === 'TAROT_JUSTICE') {
    if (!isHost) return <WaitingNote text="正义塔罗：全桌线下依次剪刀石头布，等待房主录入大众赢家和大众输家…" />
    return <JusticePicker players={roomPlayers} disabled={controller.busy} nicknameOf={nicknameOf} onConfirm={(w, l) => void controller.justiceSwap(w, l)} />
  }

  // HOST_RULING / NATURAL_SIX_CHAIN：规则书未写明，交给房主
  return (
    <div className="mg-action-panel mg-stack">
      <p className="mg-muted">{HOST_LINE_HOST_RULING.message}</p>
      {decision.kind === 'HOST_RULING' && game.turn.phase === 'TACTIC' && game.turn.revealedLadyCardId && (
        <LadyCardReveal game={game} cardId={game.turn.revealedLadyCardId} />
      )}
      <p className="mg-faint">{decision.kind === 'HOST_RULING' ? decision.description : '额外掷骰又摇出 6，是否继续连锁？'}</p>
      <p className="mg-faint">需要执行的人：{currentName}。线下按房主的裁定执行完后，由房主点击确认，回合继续。</p>
      {isHost ? (
        <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy} onClick={() => void controller.hostRulingAck()}>
          已现场裁定并执行，继续
        </button>
      ) : (
        <WaitingNote text="等待房主现场裁定…" />
      )}
    </div>
  )
}

function PlayerPicker({ players, disabled, onPick, selected }: { players: GameRoomPlayer[]; disabled: boolean; onPick: (uid: string) => void; selected?: string[] }) {
  return (
    <div className="mg-target-grid">
      {players.map((p) => (
        <button key={p.uid} type="button" className={`mg-btn mg-btn-ghost${selected?.includes(p.uid) ? ' mg-tactic-target-selected' : ''}`} disabled={disabled} onClick={() => onPick(p.uid)}>
          {p.nickname}
        </button>
      ))}
    </div>
  )
}

function LoversPicker({ players, disabled, onConfirm }: { players: GameRoomPlayer[]; disabled: boolean; onConfirm: (a: string, b: string) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (uid: string) => setPicked((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : prev.length < 2 ? [...prev, uid] : [prev[1]!, uid]))
  return (
    <div className="mg-action-panel mg-stack">
      <p className="mg-muted">恋人塔罗：指定两名玩家绑定（可以包括你自己）。此后其中一人从银行得金币时，另一人也得 1 金币。</p>
      <PlayerPicker players={players} disabled={disabled} onPick={toggle} selected={picked} />
      <button type="button" className="mg-btn mg-btn-primary" disabled={disabled || picked.length !== 2} onClick={() => onConfirm(picked[0]!, picked[1]!)}>
        确认绑定（已选 {picked.length}/2）
      </button>
    </div>
  )
}

function JusticePicker({ players, disabled, nicknameOf, onConfirm }: { players: GameRoomPlayer[]; disabled: boolean; nicknameOf: (uid: string) => string; onConfirm: (w: string | null, l: string | null) => void }) {
  const [winner, setWinner] = useState<string | null>(null)
  const [loser, setLoser] = useState<string | null>(null)
  return (
    <div className="mg-action-panel mg-stack">
      <p className="mg-muted">正义塔罗：请全桌线下依次剪刀石头布，然后录入大众赢家和大众输家。两人交换座位，手牌和金币随座位交换，地产和德州底牌保留。</p>
      <p className="mg-faint">大众赢家{winner ? `：${nicknameOf(winner)}` : ''}</p>
      <PlayerPicker players={players} disabled={disabled} onPick={setWinner} selected={winner ? [winner] : []} />
      <p className="mg-faint">大众输家{loser ? `：${nicknameOf(loser)}` : ''}</p>
      <PlayerPicker players={players} disabled={disabled} onPick={setLoser} selected={loser ? [loser] : []} />
      <div className="mg-action-row">
        <button type="button" className="mg-btn mg-btn-ghost" disabled={disabled} onClick={() => onConfirm(null, null)}>
          无人交换
        </button>
        <button type="button" className="mg-btn mg-btn-primary" disabled={disabled || !winner || !loser || winner === loser} onClick={() => onConfirm(winner, loser)}>
          确认交换
        </button>
      </div>
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
  game,
  me,
  roomPlayers,
  revealedLadyCardId,
  controller,
}: {
  game: GameState
  me: GamePlayerState
  roomPlayers: GameRoomPlayer[]
  revealedLadyCardId: string | null
  controller: GameController
}) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [targetUid, setTargetUid] = useState<string | null>(null)
  const selectedDef = selectedCardId ? getTacticCard(selectedCardId) : null
  const used = game.turn.activeTacticUsed
  const neighbors = new Set([neighborUid(game, me.uid, -1), neighborUid(game, me.uid, 1)])
  const targets = roomPlayers.filter((p) => p.uid !== me.uid && (selectedCardId !== 'tactic-shunshou' || neighbors.has(p.uid)))

  return (
    <div className="mg-action-panel mg-stack">
      {revealedLadyCardId && <LadyCardReveal game={game} cardId={revealedLadyCardId} />}
      {game.ladyEvent?.status === 'RESOLVED' && game.ladyEvent.result && <p className="mg-lady-step">结果：{game.ladyEvent.result.summary}</p>}
      <p className="mg-muted">
        {used ? '本回合已经出过牌了，可以结束回合。' : `可选：主动打出 1 张战术牌，或者直接结束回合。（手牌 ${me.tacticHand.length}/${TACTIC_HAND_LIMIT}）`}
      </p>
      {game.currentTarotId === TAROT_ID.MAGICIAN && !game.turn.playersWhoPlayedTacticThisTurn.includes(me.uid) && (
        <p className="mg-tarot-inline">魔术师生效中：本回合第一次出牌后自动补抽 1 张</p>
      )}
      {!used && (
        <div className="mg-hand-row">
          {me.tacticHand.length === 0 && <p className="mg-faint">手牌是空的。</p>}
          {me.tacticHand.map((cardId, idx) => {
            const def = getTacticCard(cardId)
            const playable = def.playMode === 'active'
            const selected = selectedCardId === cardId
            return (
              <button
                key={`${cardId}-${idx}`}
                type="button"
                className={`mg-tactic-card${selected ? ' mg-tactic-card-selected' : ''}${playable ? '' : ' mg-tactic-card-disabled'}`}
                disabled={!playable}
                onClick={() => {
                  setSelectedCardId(selected ? null : cardId)
                  setTargetUid(null)
                }}
              >
                <span className="mg-display mg-tactic-card-name">{def.name}</span>
                <span className="mg-faint mg-tactic-card-desc">{playable ? def.description : def.playMode === 'response' ? '响应牌：在喝酒提醒上使用' : '暂不能主动打出'}</span>
              </button>
            )
          })}
        </div>
      )}

      {selectedDef && !used && (
        <>
          <p className="mg-faint">{selectedCardId === 'tactic-shunshou' ? '选择左边或右边的相邻玩家：' : '选择目标玩家：'}</p>
          <PlayerPicker players={targets} disabled={controller.busy} onPick={setTargetUid} selected={targetUid ? [targetUid] : []} />
          <button
            type="button"
            className="mg-btn mg-btn-gold"
            disabled={controller.busy || !targetUid}
            onClick={() => {
              void controller.playTacticCard(selectedDef.id, targetUid).then(() => {
                setSelectedCardId(null)
                setTargetUid(null)
              })
            }}
          >
            打出「{selectedDef.name}」
          </button>
        </>
      )}

      <button type="button" className="mg-btn mg-btn-primary" style={{ width: '100%' }} disabled={controller.busy} onClick={() => void controller.endTurn()}>
        结束回合
      </button>
    </div>
  )
}
