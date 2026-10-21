import { useState } from 'react'
import type { GameController } from '../useGameController'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import type { GameState, LadyRank } from '../../../../shared/game/types'
import { KING_GUIDE, LADY_CARDS } from '../../../../shared/game/cards/ladyCards'
import { ladyRuleLabel } from '../tutorial/ladyGuide'

/** 13 张小姐牌的规则查阅：正式规则、候选规则和本局是否启用一目了然。纯展示，不改任何状态 */
export function LadyRulesSheet({
  game,
  isHost,
  controller,
  onClose,
}: {
  game: GameState
  isHost: boolean
  controller: GameController
  onClose: () => void
}) {
  const devPreview = game.ladyRuleset === 'candidate-preview'
  return (
    <div className="mg-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mg-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-header">
          <h3 className="mg-display">小姐牌规则</h3>
          <button type="button" className="mg-btn mg-btn-ghost mg-sheet-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <p className="mg-faint">
          {devPreview
            ? '本局是开发测试局：候选规则也会自动结算。'
            : '正式对局：只有标"正式规则"的牌会自动结算；其余牌翻到后仍由房主现场裁定，下面的候选规则仅供参考。'}
        </p>
        <ul className="mg-lady-rules-list">
          {LADY_CARDS.map((card) => (
            <li key={card.id} className="mg-lady-rules-row">
              <div className="mg-lady-rules-head">
                <span className="mg-number mg-lady-rules-rank">{card.rank}</span>
                <span className="mg-display">{card.candidate?.name ?? card.name}</span>
                <span className={`mg-rule-badge${card.ruleStatus === 'confirmed' ? ' mg-rule-badge-confirmed' : ''}`}>{ladyRuleLabel(game, card.id)}</span>
              </div>
              <p className="mg-muted">{card.candidate?.rule ?? card.description}</p>
              {card.rank === 'K' ? (
                <ol className="mg-faint mg-lady-guide">
                  <li>{KING_GUIDE.first}</li>
                  <li>{KING_GUIDE.received}</li>
                  <li>{KING_GUIDE.perform}</li>
                  <li>{KING_GUIDE.write}</li>
                </ol>
              ) : (
                card.candidate && (
                  <ol className="mg-faint mg-lady-guide">
                    {card.candidate.guide.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ol>
                )
              )}
              {devPreview && isHost && game.turn.phase !== 'LADY_CARD' && (
                <DevStackButton rank={card.rank} controller={controller} />
              )}
            </li>
          ))}
        </ul>
        <p className="mg-faint">涉及喝酒的提醒都可以选"以水代替"或"跳过"，不强迫任何人喝酒。</p>
      </div>
    </div>
  )
}

function DevStackButton({ rank, controller }: { rank: LadyRank; controller: GameController }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="mg-pill"
      disabled={controller.busy}
      onClick={() => void controller.devStackLadyDeck(rank).then(() => setDone(true))}
    >
      {done ? '已放到牌堆顶' : `开发测试：下一张翻 ${rank}`}
    </button>
  )
}

/** 房主记录上当的玩家（神经病） */
export function CrazyCatchSheet({
  game,
  players,
  controller,
  onClose,
}: {
  game: GameState
  players: GameRoomPlayer[]
  controller: GameController
  onClose: () => void
}) {
  const crazy = game.ladyStatus.crazyUid
  return (
    <div className="mg-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mg-sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="mg-display">神经病：谁上当了？</h3>
        <p className="mg-muted">回应了神经病故意闲聊的人喝 1 口。正常的游戏沟通（"轮到你了"等）不算。和"为什么"禁令同时违反时请分别录入。</p>
        <div className="mg-target-grid" style={{ marginTop: 12 }}>
          {players
            .filter((p) => p.uid !== crazy)
            .map((p) => (
              <button key={p.uid} type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.crazyCatch(p.uid).then(onClose)}>
                {p.nickname}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
