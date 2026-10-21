import { getLadyCard } from '../../../../shared/game/cards/ladyCards'
import { LADY_SUIT_LABEL, parseLadyCardId } from '../../../../shared/game/cards/ladyDeck'

/** 小姐主牌牌面：花色 + 点数 + 牌名 + 德国心脏病数量 */
export function LadyCardFace({ cardId, small = false }: { cardId: string; small?: boolean }) {
  const { suit, rank } = parseLadyCardId(cardId)
  const card = getLadyCard(cardId)
  const suitInfo = suit ? LADY_SUIT_LABEL[suit] : null
  return (
    <div className={`mg-lady-face${small ? ' mg-lady-face-small' : ''}${suitInfo?.red ? ' mg-lady-face-red' : ''}`} aria-label={`${suitInfo?.name ?? ''}${rank} ${card.name}`}>
      <span className="mg-lady-face-corner">
        {rank}
        {suitInfo?.symbol}
      </span>
      {!small && <span className="mg-lady-face-name">{card.name}</span>}
      <span className="mg-lady-face-count" title="德国心脏病数量">
        ×{card.heartAttackCount}
      </span>
    </div>
  )
}
