import type { ReactNode } from 'react'
import { TAROT_CARDS, getTarotCard } from '../../../../shared/game/cards/tarotCards'
import { activeTarotImpacts } from '../../../../shared/game/engine/tarotEffects'
import type { GameHistoryEntry, GamePlayerState, GameState } from '../../../../shared/game/types'
import type { GameController } from '../useGameController'
import { computeScores } from '../../../../shared/game/engine/endgame'
import { MORTGAGE_VALUE, REDEEM_COST } from '../../../../shared/game/engine/tacticStack'
import { texasCardLabel } from '../../../../shared/game/engine/texas'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import { QUICK_START_STEPS } from '../tutorial/tutorialLines'

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="mg-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mg-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-header">
          <h3 className="mg-display">{title}</h3>
          <button type="button" className="mg-btn mg-btn-ghost mg-sheet-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function LeaderboardDrawer({
  game,
  players,
  roomPlayers,
  myUid,
  controller,
  onClose,
}: {
  game: GameState
  players: GamePlayerState[]
  roomPlayers: GameRoomPlayer[]
  myUid: string
  controller: GameController
  onClose: () => void
}) {
  const nicknameOf = (uid: string) => roomPlayers.find((p) => p.uid === uid)?.nickname ?? uid
  // 正式计分公式（终点 10 + 金币 + 地产×2 + 有效完整套装×2），游戏中途显示当前估算
  const scores = computeScores(game)
  const me = players.find((p) => p.uid === myUid)
  return (
    <Sheet title="排行榜 · 地产" onClose={onClose}>
      <ul className="mg-leaderboard-list">
        {scores.map((sc) => {
          const p = game.players[sc.uid]!
          return (
            <li key={sc.uid} className={`mg-leaderboard-row${sc.uid === myUid ? ' mg-leaderboard-row-me' : ''}`}>
              <span className="mg-leaderboard-rank mg-number">{sc.rank}</span>
              <span className={`mg-token mg-token-${p.color}`} />
              <span className="mg-leaderboard-name">{nicknameOf(sc.uid)}</span>
              <span className="mg-faint">
                {sc.coins} 金 · {sc.properties} 地产 · {sc.fullSets} 套{sc.finishBonus ? ' · 已抵达' : ''}
              </span>
              <span className="mg-number mg-leaderboard-coins">{sc.total} 分</span>
            </li>
          )
        })}
      </ul>
      <p className="mg-faint" style={{ marginTop: 10 }}>
        得分 = 抵达终点 10 + 金币 ×1 + 地产 ×2 + 有效完整同色套装 ×2（抵押地产不算套装）。游戏中途是当前估算，终局时固定。
      </p>
      {me && game.rulesVersion === 2 && (
        <>
          <p className="mg-muted" style={{ margin: '14px 0 6px' }}>
            我的地产（抵押得 3 金，赎回付 4 金；抵押期间不收租、不算套装）
          </p>
          {me.properties.length === 0 && <p className="mg-faint">还没有地产。</p>}
          <ul className="mg-leaderboard-list">
            {me.properties.map((name) => {
              const mortgaged = me.mortgaged.includes(name)
              return (
                <li key={name} className="mg-leaderboard-row">
                  <span className="mg-leaderboard-name">
                    {name}
                    {mortgaged ? '（已抵押）' : ''}
                  </span>
                  <button
                    type="button"
                    className="mg-btn mg-btn-ghost mg-lady-cancel"
                    disabled={controller.busy || game.finished || (mortgaged && me.coins < REDEEM_COST)}
                    onClick={() => void controller.mortgage(name, !mortgaged)}
                  >
                    {mortgaged ? `赎回（${REDEEM_COST} 金）` : `抵押（+${MORTGAGE_VALUE} 金）`}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mg-muted" style={{ margin: '14px 0 6px' }}>
            我的秘密信息（只有你能看到）
          </p>
          <p className="mg-faint">
            阿瓦隆阵营：{game.avalon.roles[myUid] === 'GOOD' ? '好人' : game.avalon.roles[myUid] === 'EVIL' ? '坏人' : '—'} · 德州底牌：
            {me.texasHoleCards.map(texasCardLabel).join(' ')}
          </p>
          <p className="mg-faint mg-trust-note">好友聚会信任模式：这些信息存在共享房间数据里，界面只给本人看，不是防作弊的保密机制。</p>
        </>
      )}
    </Sheet>
  )
}

export function HistoryDrawer({
  history,
  nicknameOf,
  onClose,
}: {
  history: GameHistoryEntry[]
  nicknameOf: (uid: string) => string
  onClose: () => void
}) {
  const recent = [...history].reverse()
  return (
    <Sheet title="最近事件" onClose={onClose}>
      <ul className="mg-history-list">
        {recent.map((h) => (
          <li key={h.id} className="mg-history-row">
            {h.actorUid && <strong>{nicknameOf(h.actorUid)}：</strong>}
            {h.message}
          </li>
        ))}
        {recent.length === 0 && <li className="mg-faint">还没有发生任何事件。</li>}
      </ul>
    </Sheet>
  )
}

export function TarotDrawer({ currentTarotId, onClose }: { currentTarotId: string; onClose: () => void }) {
  const current = getTarotCard(currentTarotId)
  return (
    <Sheet title="世界塔罗" onClose={onClose}>
      <div className="mg-tarot-current mg-glow-purple">
        <p className="mg-faint">{current.romanNumeral}</p>
        <p className="mg-display mg-tarot-current-name">
          {current.name} · {current.nameEn}
        </p>
        <p className="mg-muted">{current.description}</p>
        <p className="mg-faint" style={{ marginTop: 10 }}>
          正在改变的结算：
        </p>
        <ul className="mg-tarot-impact-list">
          {activeTarotImpacts(currentTarotId).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <p className="mg-muted" style={{ margin: '14px 0 6px' }}>
        全部 22 张（仅供查阅）
      </p>
      <ul className="mg-tarot-list">
        {TAROT_CARDS.map((t) => (
          <li key={t.id} className={`mg-tarot-row${t.id === currentTarotId ? ' mg-tarot-row-active' : ''}`}>
            <span className="mg-faint">{t.romanNumeral}</span>
            <span className="mg-tarot-row-name">{t.name}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

const HELP_SECTIONS: { title: string; source: string; lines: string[] }[] = [
  {
    title: '回合流程',
    source: 'V1.5 原稿',
    lines: [
      '① 掷骰并移动（自然 6 结算后额外掷一次，只结算落点；额外这次再出 6 不再加，V1.6 补充）。',
      '② 结算落点：金币、地产、喝酒、事件格。',
      '③ 翻 1 张小姐牌：先看德国心脏病，再执行牌义。',
      '④ 可选打 1 张主动战术牌；响应牌不限。',
    ],
  },
  {
    title: '地产',
    source: 'V1.5 原稿 + V1.6 补充',
    lines: [
      '购买 3 金；租金 1 金，同色 2 金，集齐同色三处 3 金。',
      '抵押得 3 金、赎回付 4 金（原稿）。抵押期间不收租、不算完整套装，所有权保留（V1.6 补充）。',
    ],
  },
  {
    title: '碰撞与起点',
    source: 'V1.5 原稿 + V1.6 补充',
    lines: ['被撞者 1 口并退回自己的起点；力量塔罗下改为后退 3 格，后退后不再结算新格子。', '起点格是安全区，不触发碰撞（V1.6 补充）。只在经过自己颜色的起点时领 2 金 + 1 手牌。'],
  },
  {
    title: '特殊格子',
    source: 'V1.6 补充（原稿只有名称）',
    lines: [
      '停骰一次：自己的下一回合不掷骰不移动，照常翻牌出牌。下家禁骰：同样作用于下家。最多保留一次。',
      '德州+1 / 德扑+1：银行向德州底池投 1 金币，并触发一次 CASINO。',
      '发车任务：开启一轮阿瓦隆任务。',
    ],
  },
  {
    title: '三国杀战术牌',
    source: 'V1.5 原稿 + V1.6 补充',
    lines: [
      '杀：指定 1 人 1 口；可以被闪或无懈可击抵消。闪：只能响应针对自己的杀。',
      '桃：取消 1 口；救别人从银行得 1 金。无懈可击：取消任意战术牌，可以层层叠加，从最后打出的往前结算。',
      '顺手牵羊：从左右相邻玩家拿 1 金。过河拆桥（V1.6 补充）：随机弃掉任意一名玩家 1 张手牌。',
      '有人离线时，房主只能记录"代为放弃"，不能替人出牌。',
    ],
  },
  {
    title: '节制与喝酒',
    source: 'V1.6 补充 Q5',
    lines: ['所有喝酒提醒都可以以水代替或跳过，不强迫饮酒。', '节制塔罗只禁用游戏机制里的挡酒/免罚：桃、A 替喝、骗子酒馆吹牛免罚。'],
  },
  {
    title: '德州扑克 / 骗子酒馆 / 梦幻拖拉机',
    source: 'V1.5 原稿 + V1.6 补充',
    lines: [
      'CASINO 第 1 次翻 Flop，第 2 次 Turn，第 3 次 River 并摊牌；每阶段每人最多投 1 金币（过牌/下注/跟注/弃牌）。',
      '七选五比牌型，不比花色；平局平分，除不尽回银行。下一次 CASINO 开新周期重新发底牌。',
      '骗子酒馆：面对 1 口惩罚时声称有某张底牌；没人质疑免罚；质疑时核对真牌。每个德州周期一次。',
      '梦幻拖拉机：地产或碰撞事件后可以挑战涉及的玩家，底牌 2 张 + 幻想牌 1 张比三张牌型，胜者从银行得 1 金。',
    ],
  },
  {
    title: '阿瓦隆',
    source: 'V1.5 原稿 + V1.6 补充 Q11',
    lines: [
      '身份牌就是阵营。3–10 人的好人/坏人人数和每轮上车人数按 V1.6 人数表。',
      '车主选乘客（可以选自己）；好人只能交 SUCCESS，坏人可以交 FAIL；1 张 FAIL 任务失败。',
      '先到 3 次成功或失败结算：胜方每人 +1 金，败方每人 1 口。最多 5 轮。',
    ],
  },
  {
    title: '神鬼道 / 河道 / 天堂地狱',
    source: 'V1.5 原稿 + V1.6 补充 Q12',
    lines: [
      '第一位玩家跑完外圈一圈后开放神鬼道；停在第 11 格或第 48 格（竖排正对的格子）可以进入。',
      '恰好停在终点才算抵达；走过头穿过终点去往另一侧。神鬼道里离终点最近的人是河神。',
      '外圈经过左右两条河时要选过桥（1 金，13 格，每次掷骰 2 口）或渡河（有河神时）。',
      '渡河：你和河神各掷骰（4–6 成功），你成功且河神同意 → 成功；你失败且河神反对 → 失败；否则看神谕骰。天堂河神固定同意，地狱河神固定反对。',
      '天堂每次地图掷骰 +1 金，地狱每次 −1 金（以掷骰前的位置为准；小游戏骰不算）。',
    ],
  },
  {
    title: '终局与计分',
    source: 'V1.5 原稿 + V1.6 补充',
    lines: [
      '有人抵达终点后完成当前回合，地图回合结束；德州补齐公共牌摊牌；阿瓦隆未分胜负则继续发车直到结算。',
      '得分 = 抵达终点 10 + 金币 ×1 + 地产 ×2 + 有效完整同色套装 ×2。平分依次比金币、地产数、套装数。',
    ],
  },
  {
    title: '好友聚会信任模式',
    source: '技术说明',
    lines: ['底牌、阿瓦隆身份和投票存在所有人都能读取的共享房间数据里，界面只给本人看。它适合朋友聚会，不是防作弊的保密机制。'],
  },
]

export function HelpDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="规则帮助中心" onClose={onClose}>
      <p className="mg-muted" style={{ marginBottom: 10 }}>
        整个回合的流程是：
      </p>
      <ol className="mg-help-steps">
        {QUICK_START_STEPS.map((s, idx) => (
          <li key={idx}>{s.message}</li>
        ))}
      </ol>
      {HELP_SECTIONS.map((sec) => (
        <div key={sec.title} className="mg-help-section">
          <p className="mg-muted" style={{ margin: '14px 0 4px' }}>
            {sec.title} <span className="mg-rule-badge">{sec.source}</span>
          </p>
          <ul className="mg-lady-guide mg-faint">
            {sec.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
      <p className="mg-faint" style={{ marginTop: 12 }}>
        点击棋盘上的任意格子可以查看这个格子的说明；小姐牌规则在"查看 13 张牌规则"里，世界塔罗在顶部塔罗按钮里。
      </p>
    </Sheet>
  )
}
