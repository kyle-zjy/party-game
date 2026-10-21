import { getTarotCard } from '../../../../shared/game/cards/tarotCards'

/** 自绘塔罗牌面：罗马数字 + 名称，用 CSS 做翻牌入场动画，不依赖图片资源 */
export function TarotCardFace({ tarotId, large = false }: { tarotId: string; large?: boolean }) {
  const card = getTarotCard(tarotId)
  return (
    <div className={`mg-tarot-face${large ? ' mg-tarot-face-large mg-card-flip-in' : ''}`} aria-label={`塔罗 ${card.name}`}>
      <span className="mg-tarot-face-numeral">{card.romanNumeral}</span>
      <svg className="mg-tarot-face-star" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2l2.6 6.9L22 9.3l-5.6 4.8L18.2 22 12 17.8 5.8 22l1.8-7.9L2 9.3l7.4-.4z" fill="currentColor" />
      </svg>
      <span className="mg-tarot-face-name">{card.name}</span>
      {large && <span className="mg-tarot-face-en">{card.nameEn}</span>}
    </div>
  )
}
