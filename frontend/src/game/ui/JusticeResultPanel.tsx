import { getTacticCard } from '../../../../shared/game/cards/tacticCards'
import type { GameState } from '../../../../shared/game/types'

/** 正义塔罗交换结果：两人交换前 → 交换后的位置、行动顺序、金币和手牌 */
export function JusticeResultPanel({
  game,
  nicknameOf,
  onClose,
}: {
  game: GameState
  nicknameOf: (uid: string) => string
  onClose: () => void
}) {
  const swap = game.lastJusticeSwap
  if (!swap) return null
  const hand = (cards: string[]) => (cards.length ? cards.map((c) => getTacticCard(c).name).join('、') : '无')
  const rows = [swap.winnerUid, swap.loserUid].map((uid) => {
    const before = swap.before[uid]!
    const now = game.players[uid]!
    return { uid, before, now, seatNow: game.turnOrder.indexOf(uid) }
  })

  return (
    <div className="mg-scrim" role="dialog" aria-modal="true">
      <div className="mg-sheet">
        <h3 className="mg-display">正义塔罗：交换完成</h3>
        <p className="mg-muted">交换了棋盘位置、行动顺序、金币和手牌；地产、德州底牌和身份牌各自保留。</p>
        {rows.map(({ uid, before, now, seatNow }) => (
          <div key={uid} className="mg-justice-row">
            <p className="mg-drink-ack-target">
              {nicknameOf(uid)}（{uid === swap.winnerUid ? '大众赢家' : '大众输家'}）
            </p>
            <table className="mg-justice-table">
              <tbody>
                <tr>
                  <th>棋盘位置</th>
                  <td>第 {before.position + 1} 格 → 第 {now.position + 1} 格</td>
                </tr>
                <tr>
                  <th>行动顺序</th>
                  <td>第 {before.seatIndex + 1} 位 → 第 {seatNow + 1} 位</td>
                </tr>
                <tr>
                  <th>金币</th>
                  <td>{before.coins} → {now.coins}</td>
                </tr>
                <tr>
                  <th>手牌</th>
                  <td>{hand(before.tacticHand)} → {hand(now.tacticHand)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
        <button type="button" className="mg-btn mg-btn-gold" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>
          知道了，继续游戏
        </button>
      </div>
    </div>
  )
}
