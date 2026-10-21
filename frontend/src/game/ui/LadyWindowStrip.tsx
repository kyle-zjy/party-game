import { heartAttackCheck, LADY_SUIT_LABEL, LADY_WINDOW_SIZE } from '../../../../shared/game/cards/ladyDeck'
import type { GameState } from '../../../../shared/game/types'
import { LadyCardFace } from './LadyCardFace'

/**
 * 德国心脏病窗口：所有玩家看到同一组最近 5 张主牌和每种花色的合计。
 * 合计离 5 的倍数越近越要留神——这是给新手的"盯牌"提示。
 */
export function LadyWindowStrip({ game }: { game: GameState }) {
  const windowIds = game.recentLadyCards
  const { suitTotals } = heartAttackCheck(windowIds)
  return (
    <div className="mg-lady-window-strip">
      <div className="mg-lady-window-head">
        <span className="mg-active-tarot-name">德国心脏病 · 最近 {LADY_WINDOW_SIZE} 张主牌</span>
        <span className="mg-faint">牌堆剩 {game.ladyDeck.length} 张</span>
      </div>
      <div className="mg-lady-window">
        {windowIds.length === 0 && <span className="mg-faint">还没有人翻过主牌</span>}
        {windowIds.map((id, i) => (
          <LadyCardFace key={`${id}-${i}`} cardId={id} small />
        ))}
      </div>
      <div className="mg-suit-totals">
        {suitTotals.map((t) => (
          <span key={t.suit} className={`mg-suit-total${LADY_SUIT_LABEL[t.suit].red ? ' mg-suit-red' : ''}`}>
            {LADY_SUIT_LABEL[t.suit].symbol} {t.count}
          </span>
        ))}
      </div>
      <p className="mg-faint">每种花色分别相加；任意一种合计变成 5、10、15… 时立刻抢答。</p>
    </div>
  )
}
