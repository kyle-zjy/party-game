import { useState } from 'react'
import type { GamePlayerState, GameState, PendingDrinkAck } from '../../../../shared/game/types'
import { TAROT_ID } from '../../../../shared/game/engine/tarotEffects'
import { substituteEligibility } from '../../../../shared/game/engine/ladyEvents'
import { bluffEligibility, texasCardLabel } from '../../../../shared/game/engine/texas'
import { CardPicker } from './V16Panels'
import type { GameController } from '../useGameController'

/**
 * 非阻塞的喝酒提醒——本人或房主随时可以处理，不卡住正在进行的回合。
 * 所有人都能看到全桌待处理的提醒（"谁需要执行"），但只有本人和房主能确认。
 *
 * 塔罗影响：
 * - 节制（V1.6 Q5）：桃、替喝、吹牛免罚失效；以水代替和跳过照常可用。
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
      <p className="mg-faint mg-drink-tray-title">待处理的喝酒提醒 / 金币惩罚（本人或房主确认）</p>
      {acks.map((ack) => {
        const canConfirm = ack.targetUid === myUid || isHost
        const amountLabel = ack.amountText ?? `${ack.amount} 口`
        const devilEligible = devil && ack.amount === 1 && !ack.amountText && !ack.coinPenalty && !ack.bluff && ack.targetUid === myUid
        return (
          <div key={ack.id} className="mg-drink-ack-row">
            <div className="mg-drink-ack-info">
              <span className="mg-drink-ack-target">
                {ack.targetUid === myUid ? '你' : nicknameOf(ack.targetUid)} · {amountLabel}
              </span>
              <span className="mg-faint">{ack.reason}</span>
            </div>

            {ack.bluff && <BluffRow ackId={ack.id} bluff={ack.bluff} myUid={myUid} isHost={isHost} nicknameOf={nicknameOf} controller={controller} />}

            {ack.substituteOffer && (
              <SubstituteOfferRow ack={ack} myUid={myUid} isHost={isHost} nicknameOf={nicknameOf} controller={controller} />
            )}

            {canConfirm && !ack.substituteOffer && !ack.bluff && ack.coinPenalty ? (
              <div className="mg-drink-ack-choices">
                <button type="button" className="mg-btn mg-btn-primary mg-drink-choice-btn" disabled={controller.busy} onClick={() => void controller.resolveDrinkAck(ack.id, 'PAY')}>
                  支付 {ack.coinPenalty} 金币
                </button>
              </div>
            ) : canConfirm && !ack.substituteOffer && !ack.bluff ? (
              <div className="mg-drink-ack-choices">
                <button type="button" className="mg-btn mg-btn-primary mg-drink-choice-btn" disabled={controller.busy} onClick={() => void controller.resolveDrinkAck(ack.id, 'DONE')}>
                  已完成
                </button>
                <button type="button" className="mg-btn mg-btn-ghost mg-drink-choice-btn" disabled={controller.busy} onClick={() => void controller.resolveDrinkAck(ack.id, 'WATER')}>
                  以水代替
                </button>
                <button type="button" className="mg-btn mg-btn-ghost mg-drink-choice-btn" disabled={controller.busy} onClick={() => void controller.resolveDrinkAck(ack.id, 'SKIP')}>
                  跳过
                </button>
              </div>
            ) : (
              !ack.substituteOffer && !ack.bluff && <p className="mg-faint">等待 {nicknameOf(ack.targetUid)} 或房主确认</p>
            )}

            {ack.targetUid === myUid && !ack.bluff && !ack.substituteOffer && game.rulesVersion === 2 && ((ack.amount === 1 && !ack.amountText) || ack.coinPenalty === 1) && !ack.accompany && !ack.transferredFromUid && (
              <BluffStarter ackId={ack.id} reason={bluffEligibility(game, ack, myUid)} controller={controller} />
            )}

            {holdsSubstitute && ack.targetUid === myUid && !ack.substituteOffer && !ack.bluff && (
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

            {temperance && canConfirm && <p className="mg-tarot-inline">节制生效中：桃、替喝、吹牛免罚暂时失效；以水代替和跳过仍然可以</p>}

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

            {hasPeach && !temperance && !ack.amountText && !ack.coinPenalty && !ack.bluff && !ack.substituteOffer && (
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

/** 骗子酒馆：面对 1 口惩罚时声明"我有某张底牌" */
function BluffStarter({ ackId, reason, controller }: { ackId: string; reason: string | null; controller: GameController }) {
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState('SA')
  if (reason) return <p className="mg-faint">骗子酒馆：{reason}</p>
  if (!open) {
    return (
      <button type="button" className="mg-btn mg-btn-ghost mg-peach-btn" onClick={() => setOpen(true)}>
        骗子酒馆：我要吹牛（每个德州周期一次）
      </button>
    )
  }
  return (
    <div className="mg-tarot-inline-box">
      <p className="mg-faint">声明你有一张德州底牌（可以是真的也可以是吹的）。没人质疑就免罚；有人质疑会核对你的真实底牌：真的则质疑者喝 1 口、原惩罚免除；假的则原惩罚照旧再加 1 口。</p>
      <CardPicker value={card} onChange={setCard} />
      <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.startBluff(ackId, card).then(() => setOpen(false))}>
        声称我有 {texasCardLabel(card)}
      </button>
    </div>
  )
}

function BluffRow({
  ackId,
  bluff,
  myUid,
  isHost,
  nicknameOf,
  controller,
}: {
  ackId: string
  bluff: NonNullable<PendingDrinkAck['bluff']>
  myUid: string
  isHost: boolean
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  const mine = bluff.claimerUid === myUid
  const iAwait = bluff.awaiting.includes(myUid)
  return (
    <div className="mg-tarot-inline-box">
      <p className="mg-faint">
        {mine ? '你' : nicknameOf(bluff.claimerUid)} 声称有 <strong>{texasCardLabel(bluff.claim)}</strong>。
        质疑成功：原惩罚 + 额外 1 口；质疑失败：质疑者喝 1 口。月亮塔罗下胜者额外 +1 金币。
      </p>
      {iAwait ? (
        <div className="mg-action-row">
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.respondBluff(ackId, false)}>
            不质疑
          </button>
          <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.respondBluff(ackId, true)}>
            质疑！
          </button>
        </div>
      ) : (
        <p className="mg-faint">等待 {bluff.awaiting.map((u) => (u === myUid ? '你' : nicknameOf(u))).join('、')} 决定是否质疑（第一位质疑者结算）</p>
      )}
      {isHost && bluff.awaiting.length > 0 && (
        <button type="button" className="mg-btn mg-btn-ghost mg-lady-cancel" disabled={controller.busy} onClick={() => void controller.respondBluff(ackId, false, true)}>
          房主：其余人离线/不表态，按"不质疑"处理
        </button>
      )}
    </div>
  )
}
