import { useState, type ReactNode } from 'react'
import { getTarotCard } from '../../../../shared/game/cards/tarotCards'
import { heartAttackCheck, LADY_SUIT_LABEL } from '../../../../shared/game/cards/ladyDeck'
import { activeTarotImpacts } from '../../../../shared/game/engine/tarotEffects'
import type { GameState } from '../../../../shared/game/types'

export type TableSection = 'tarot' | 'heart' | 'lady' | null

/**
 * 牌桌信息条：世界塔罗、德国心脏病花色合计、小姐牌持续状态，默认各占一个小标签，一行排开；
 * 点一个标签就在下方展开对应的完整面板（同一时间只展开一个），让棋盘留在首屏。
 */
export function TableInfoBar({
  game,
  myUid,
  nicknameOf,
  renderSection,
}: {
  game: GameState
  myUid: string
  nicknameOf: (uid: string) => string
  renderSection: (section: Exclude<TableSection, null>) => ReactNode
}) {
  const [open, setOpen] = useState<TableSection>(null)
  const tarot = getTarotCard(game.currentTarotId)
  const { suitTotals } = heartAttackCheck(game.recentLadyCards)
  const s = game.ladyStatus
  const name = (u: string) => (u === myUid ? '你' : nicknameOf(u))
  const ladyBits: string[] = []
  if (s.mistressUid) ladyBits.push(`小姐 ${name(s.mistressUid)}`)
  if (s.crazyUid) ladyBits.push(`神经病 ${name(s.crazyUid)}`)
  if (s.kingUid) ladyBits.push(`国王 ${name(s.kingUid)}`)
  if (s.away.length > 0) ladyBits.push(`${s.away.length} 人暂离`)
  const toggle = (k: Exclude<TableSection, null>) => setOpen((v) => (v === k ? null : k))

  return (
    <div className="mg-table-info">
      <div className="mg-table-chips">
        <button type="button" className={`mg-table-chip mg-table-chip-tarot${open === 'tarot' ? ' mg-table-chip-open' : ''}`} onClick={() => toggle('tarot')} aria-expanded={open === 'tarot'}>
          <span className="mg-table-chip-label">塔罗</span>
          <span className="mg-table-chip-value">
            {tarot.romanNumeral} {tarot.name}
          </span>
        </button>
        <button type="button" className={`mg-table-chip${open === 'heart' ? ' mg-table-chip-open' : ''}`} onClick={() => toggle('heart')} aria-expanded={open === 'heart'}>
          <span className="mg-table-chip-label">心脏病</span>
          <span className="mg-table-chip-value">
            {suitTotals.map((t) => (
              <span key={t.suit} className={LADY_SUIT_LABEL[t.suit].red ? 'mg-suit-red' : undefined}>
                {LADY_SUIT_LABEL[t.suit].symbol}
                {t.count}{' '}
              </span>
            ))}
          </span>
        </button>
        <button type="button" className={`mg-table-chip${open === 'lady' ? ' mg-table-chip-open' : ''}`} onClick={() => toggle('lady')} aria-expanded={open === 'lady'}>
          <span className="mg-table-chip-label">小姐牌</span>
          <span className="mg-table-chip-value">{ladyBits.length > 0 ? ladyBits[0] : '无持续效果'}</span>
        </button>
      </div>
      {open === 'tarot' && <p className="mg-faint mg-table-hint">{activeTarotImpacts(game.currentTarotId)[0]}</p>}
      {open && <div className="mg-table-section">{renderSection(open)}</div>}
    </div>
  )
}
