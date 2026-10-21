import { useState } from 'react'
import type { GamePlayerState, GameState, PendingDrinkAck } from '../../../../shared/game/types'
import { TAROT_ID } from '../../../../shared/game/engine/tarotEffects'
import { substituteEligibility } from '../../../../shared/game/engine/ladyEvents'
import type { GameController } from '../useGameController'

/**
 * 非阻塞的喝酒提醒——本人或房主随时可以处理，不卡住正在进行的回合。
 * 所有人都能看到全桌待处理的提醒（"谁需要执行"），但只有本人和房主能确认。
 *
 * 塔罗影响：
 * - 节制：不能"以水代替"，也不能用桃挡酒。
 * - 恶魔：被判 1 口时可以改为付 1 金币并指定另一人喝 2 口。
 * 手里有桃的任何玩家都可以在任意一条提醒上使用（救别人时自己得 1 金币）。
 */
export function DrinkAckTray({
  game,
  acks,
  myUid,
  isHost,
  tarotId,
  me,
  players,
  nicknameOf,
  controller,
}: {
  game: GameState
  acks: PendingDrinkAck[]
  myUid: string
  isHost: boolean
  tarotId: string
  me: GamePlayerState
  players: GamePlayerState[]
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  const [devilAckId, setDevilAckId] = useState<string | null>(null)
  const [substituteAckId, setSubstituteAckId] = useState<string | null>(null)
  const holdsSubstitute = game.ladyStatus.substitutePassUids.includes(myUid)
  if (acks.length === 0) return null

  const temperance = tarotId === TAROT_ID.TEMPERANCE
  const devil = tarotId === TAROT_ID.DEVIL
  const hasPeach = me.tacticHand.includes('tactic-tao')

  return (
    <div className="mg-drink-tray mg-fade-in">
      <p className="mg-faint mg-drink-tray-title">待处理的喝酒提醒（线下执行后由本人或房主确认）</p>
      {acks.map((ack) => {
        const canConfirm = ack.targetUid === myUid || isHost
        const amountLabel = ack.amountText ?? `${ack.amount} 口`
        const devilEligible = devil && ack.amount === 1 && !ack.amountText && ack.targetUid === myUid
        return (
          <div key={ack.id} className="mg-drink-ack-row">
            <div className="mg-drink-ack-info">
              <span className="mg-drink-ack-target">
                {ack.targetUid === myUid ? '你' : nicknameOf(ack.targetUid)} · {amountLabel}
              </span>
              <span className="mg-faint">{ack.reason}</span>
            </div>

            {ack.substituteOffer && (
              <SubstituteOfferRow ack={ack} myUid={myUid} isHost={isHost} nicknameOf={nicknameOf} controller={controller} />
            )}

            {canConfirm && !ack.substituteOffer ? (
              <div className="mg-drink-ack-choices">
                <button type="button" className="mg-btn mg-btn-primary mg-drink-choice-btn" disabled={controller.busy} onClick={() => void controller.resolveDrinkAck(ack.id, 'DONE')}>
                  已完成
                </button>
                <button
                  type="button"
                  className="mg-btn mg-btn-ghost mg-drink-choice-btn"
                  disabled={controller.busy || temperance}
                  title={temperance ? '节制：挡酒/免罚效果失效' : undefined}
                  onClick={() => void controller.resolveDrinkAck(ack.id, 'WATER')}
                >
                  以水代替
                </button>
                <button type="button" className="mg-btn mg-btn-ghost mg-drink-choice-btn" disabled={controller.busy} onClick={() => void controller.resolveDrinkAck(ack.id, 'SKIP')}>
                  跳过
                </button>
              </div>
            ) : (
              !ack.substituteOffer && <p className="mg-faint">等待 {nicknameOf(ack.targetUid)} 或房主确认</p>
            )}

            {holdsSubstitute && ack.targetUid === myUid && !ack.substituteOffer && (
              <SubstitutePicker
                ack={ack}
                reason={substituteEligibility(game, ack, myUid)}
                open={substituteAckId === ack.id}
                onOpen={() => setSubstituteAckId(ack.id)}
                players={players.filter((p) => p.uid !== myUid)}
                nicknameOf={nicknameOf}
                controller={controller}
                onDone={() => setSubstituteAckId(null)}
              />
            )}

            {temperance && canConfirm && <p className="mg-tarot-inline">节制生效中：不能以水代替，也不能用桃挡酒</p>}

            {devilEligible && me.coins >= 1 && (
              <div className="mg-tarot-inline-box">
                <p className="mg-tarot-inline">恶魔：可以改为付 1 金币，指定另一人喝 2 口</p>
                {devilAckId === ack.id ? (
                  <div className="mg-target-grid">
                    {players
                      .filter((p) => p.uid !== myUid)
                      .map((p) => (
                        <button
                          key={p.uid}
                          type="button"
                          className="mg-btn mg-btn-ghost"
                          disabled={controller.busy}
                          onClick={() => {
                            setDevilAckId(null)
                            void controller.resolveDrinkAck(ack.id, 'DEVIL', p.uid)
                          }}
                        >
                          {nicknameOf(p.uid)}
                        </button>
                      ))}
                  </div>
                ) : (
                  <button type="button" className="mg-btn mg-btn-ghost" onClick={() => setDevilAckId(ack.id)}>
                    使用恶魔效果
                  </button>
                )}
              </div>
            )}

            {hasPeach && !temperance && !ack.amountText && (
              <button type="button" className="mg-btn mg-btn-ghost mg-peach-btn" disabled={controller.busy} onClick={() => void controller.usePeach(ack.id)}>
                {ack.targetUid === myUid ? '打出「桃」：自己少喝 1 口' : `打出「桃」救 ${nicknameOf(ack.targetUid)}：对方少喝 1 口，你得 1 金币`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SubstitutePicker({
  ack,
  reason,
  open,
  onOpen,
  players,
  nicknameOf,
  controller,
  onDone,
}: {
  ack: PendingDrinkAck
  reason: string | null
  open: boolean
  onOpen: () => void
  players: GamePlayerState[]
  nicknameOf: (uid: string) => string
  controller: GameController
  onDone: () => void
}) {
  if (reason) return <p className="mg-faint">替喝机会：{reason}</p>
  if (!open) {
    return (
      <button type="button" className="mg-btn mg-btn-ghost mg-peach-btn" onClick={onOpen}>
        使用替喝机会：请人替喝
      </button>
    )
  }
  return (
    <div className="mg-tarot-inline-box">
      <p className="mg-faint">选择替喝玩家（对方可以拒绝）：</p>
      <div className="mg-target-grid">
        {players.map((p) => (
          <button
            key={p.uid}
            type="button"
            className="mg-btn mg-btn-ghost"
            disabled={controller.busy}
            onClick={() => {
              onDone()
              void controller.offerSubstitute(ack.id, p.uid)
            }}
          >
            {nicknameOf(p.uid)}
          </button>
        ))}
      </div>
    </div>
  )
}

function SubstituteOfferRow({
  ack,
  myUid,
  isHost,
  nicknameOf,
  controller,
}: {
  ack: PendingDrinkAck
  myUid: string
  isHost: boolean
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  const offer = ack.substituteOffer!
  const isTarget = offer.toUid === myUid
  const canWithdraw = offer.fromUid === myUid || isHost
  return (
    <div className="mg-tarot-inline-box">
      <p className="mg-faint">
        {offer.fromUid === myUid ? '你' : nicknameOf(offer.fromUid)} 想请 {isTarget ? '你' : nicknameOf(offer.toUid)} 替喝这条提醒
      </p>
      <div className="mg-action-row">
        {isTarget && (
          <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy} onClick={() => void controller.respondSubstitute(ack.id, true)}>
            接受替喝
          </button>
        )}
        {(isTarget || canWithdraw) && (
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.respondSubstitute(ack.id, false)}>
            {isTarget ? '拒绝' : '撤回请求'}
          </button>
        )}
        {!isTarget && !canWithdraw && <p className="mg-faint">等待 {nicknameOf(offer.toUid)} 回应</p>}
      </div>
    </div>
  )
}
