/**
 * V1.6 数字版新增玩法的界面：战术响应栈、德州扑克、梦幻拖拉机、阿瓦隆、河边选择、神鬼道入口、终局排行榜。
 * 所有按钮只调用 controller（经过数据库乐观锁），界面本身不改任何游戏状态。
 */
import { useState, type ReactNode } from 'react'
import type { GameController } from '../useGameController'
import type { GameRoomPlayer } from '../../../../shared/gameRoomTypes'
import type { GameState, PendingDecision } from '../../../../shared/game/types'
import { getTacticCard } from '../../../../shared/game/cards/tacticCards'
import { texasCardLabel } from '../../../../shared/game/engine/texas'
import { riverGodUid } from '../../../../shared/game/engine/zones'
import { BRIDGE_LENGTH, BRIDGE_TOLL, godsRegion } from '../../../../shared/game/godsPath'
import { AVALON_TARGET } from '../../../../shared/game/engine/avalon'

const SUITS = [
  { id: 'S', label: '♠ 黑桃' },
  { id: 'H', label: '♥ 红桃' },
  { id: 'D', label: '♦ 方块' },
  { id: 'C', label: '♣ 梅花' },
]
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function CardPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const suit = value[0] ?? 'S'
  const rank = value.slice(1) || 'A'
  return (
    <div className="mg-card-picker">
      <select className="mg-text-input" value={suit} onChange={(e) => onChange(`${e.target.value}${rank}`)} aria-label="花色">
        {SUITS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select className="mg-text-input" value={rank} onChange={(e) => onChange(`${suit}${e.target.value}`)} aria-label="点数">
        {RANKS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  )
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="mg-faint">
      <span className="mg-waiting-dot" aria-hidden="true" /> {text}
    </p>
  )
}

// ---------------------------------------------------------------------------
// 战术响应栈
// ---------------------------------------------------------------------------

export function TacticStackPanel({
  game,
  myUid,
  isHost,
  nicknameOf,
  controller,
}: {
  game: GameState
  myUid: string
  isHost: boolean
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  const stack = game.tacticStack
  if (!stack) return null
  const name = (u: string) => (u === myUid ? '你' : nicknameOf(u))
  const origin = getTacticCard(stack.originKind).name
  const top = stack.entries[stack.entries.length - 1]!
  const iAwait = stack.awaiting.includes(myUid)
  const hand = game.players[myUid]?.tacticHand ?? []
  const canShan = iAwait && stack.originKind === 'tactic-sha' && stack.entries.length === 1 && stack.targetUid === myUid && hand.includes('tactic-shan')
  const canWuxie = iAwait && hand.includes('tactic-wuxie')
  return (
    <div className="mg-v16-panel mg-fade-in">
      <p className="mg-active-tarot-name">战术牌响应</p>
      <p className="mg-lady-step">
        {name(stack.sourceUid)} 对 {name(stack.targetUid)} 打出「{origin}」
      </p>
      <ol className="mg-stack-list">
        {stack.entries.map((e) => (
          <li key={e.entryId}>
            {name(e.playerUid)}：{getTacticCard(e.cardId).name}
          </li>
        ))}
      </ol>
      <p className="mg-faint">
        当前栈顶是 {name(top.playerUid)} 的「{getTacticCard(top.cardId).name}」。还没表态：{stack.awaiting.map(name).join('、') || '无'}。全部放弃后从栈顶往下结算。
      </p>
      {iAwait ? (
        <div className="mg-action-row">
          {canShan && (
            <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.respondTactic(stack.stackId, 'tactic-shan')}>
              打出「闪」抵消杀
            </button>
          )}
          {canWuxie && (
            <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.respondTactic(stack.stackId, 'tactic-wuxie')}>
              打出「无懈可击」
            </button>
          )}
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.passTactic(stack.stackId, myUid)}>
            不响应
          </button>
        </div>
      ) : (
        <Waiting text={`等待 ${stack.awaiting.map(name).join('、')} 决定是否响应`} />
      )}
      {isHost &&
        stack.awaiting
          .filter((u) => u !== myUid)
          .map((u) => (
            <button key={u} type="button" className="mg-btn mg-btn-ghost mg-lady-cancel" disabled={controller.busy} onClick={() => void controller.passTactic(stack.stackId, u)}>
              房主：{nicknameOf(u)} 离线，记录为放弃（不会替 TA 出牌）
            </button>
          ))}
    </div>
  )
}

export function LastTacticResult({ game, myUid, nicknameOf }: { game: GameState; myUid: string; nicknameOf: (uid: string) => string }) {
  const r = game.lastTacticResult
  if (!r || game.tacticStack || r.at < (game.history[0]?.at ?? 0)) return null
  if (game.turn.phase !== 'TACTIC') return null
  const name = (u: string) => (u === myUid ? '你' : nicknameOf(u))
  return (
    <p className="mg-faint">
      上一张战术牌：{name(r.sourceUid)} →「{getTacticCard(r.originKind).name}」→ {name(r.targetUid)}：{r.summary}
    </p>
  )
}

// ---------------------------------------------------------------------------
// 德州扑克
// ---------------------------------------------------------------------------

export function TexasPanel({
  game,
  myUid,
  isHost,
  nicknameOf,
  controller,
}: {
  game: GameState
  myUid: string
  isHost: boolean
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  const t = game.texas
  const me = game.players[myUid]
  const b = t.betting
  const folded = t.folded.includes(myUid)
  const stageLabel = t.stage === 'PREFLOP' ? '等待第 1 次 CASINO（翻 Flop）' : t.stage === 'FLOP' ? 'Flop 已翻开' : t.stage === 'TURN' ? 'Turn 已翻开' : t.stage === 'RIVER' ? 'River 已翻开' : '本周期已结束，下一次 CASINO 开新周期'
  const show = t.lastShowdown
  return (
    <div className="mg-v16-panel">
      <div className="mg-lady-status-head">
        <span className="mg-active-tarot-name">德州扑克 · 第 {t.cycle} 周期</span>
        <span className="mg-faint">底池 {t.pot} 金{t.carryPot > 0 ? ` · 下周期预存 ${t.carryPot}` : ''}</span>
      </div>
      <p className="mg-faint">{stageLabel}。棋盘上的"德州+1 / 德扑+1"格子会向底池投 1 金币并触发一次 CASINO。</p>
      <div className="mg-texas-row">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={`mg-texas-card${t.community[i] ? '' : ' mg-texas-card-back'}`}>
            {t.community[i] ? texasCardLabel(t.community[i]!) : '?'}
          </span>
        ))}
      </div>
      {me && (
        <p className="mg-faint">
          你的底牌（只有你能看到）：<strong>{me.texasHoleCards.map(texasCardLabel).join(' ')}</strong>
          {folded ? '（本周期已弃牌）' : ''}
        </p>
      )}
      {b && (
        <>
          <p className="mg-lady-step">
            {b.stage} 下注：{b.betUid ? `${b.betUid === myUid ? '你' : nicknameOf(b.betUid)} 下注了 1 金币，其他人跟注或弃牌` : '还没人下注，可以过牌或下注 1 金币'}
          </p>
          {b.awaiting.includes(myUid) ? (
            <div className="mg-action-row">
              {b.betUid ? (
                <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy || (me?.coins ?? 0) < 1} onClick={() => void controller.texasBet('CALL')}>
                  跟注 1 金币
                </button>
              ) : (
                <>
                  <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.texasBet('CHECK')}>
                    过牌
                  </button>
                  <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy || (me?.coins ?? 0) < 1} onClick={() => void controller.texasBet('BET')}>
                    下注 1 金币
                  </button>
                </>
              )}
              <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.texasBet('FOLD')}>
                弃牌
              </button>
            </div>
          ) : (
            <Waiting text={`等待 ${b.awaiting.map((u) => (u === myUid ? '你' : nicknameOf(u))).join('、')} 表态`} />
          )}
          {isHost && b.awaiting.length > 0 && (
            <button type="button" className="mg-btn mg-btn-ghost mg-lady-cancel" disabled={controller.busy} onClick={() => void controller.texasCloseBetting()}>
              房主：结束本阶段下注（未表态 = 无人下注时过牌，有人下注时弃牌）
            </button>
          )}
        </>
      )}
      {show && t.stage === 'DONE' && (
        <div className="mg-texas-result">
          <p className="mg-faint">
            上一周期结果：{show.winners.map((u) => (u === myUid ? '你' : nicknameOf(u))).join('、') || '无人'}赢得 {show.pot} 金币
            {show.returnedToBank > 0 ? `（${show.returnedToBank} 金币除不尽回银行）` : ''}
          </p>
          {show.hands.length > 0 && (
            <ul className="mg-duel-history">
              {show.hands.map((h) => (
                <li key={h.uid} className="mg-faint">
                  {h.uid === myUid ? '你' : nicknameOf(h.uid)}：{h.holeCards.map(texasCardLabel).join(' ')} → {h.handName}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="mg-faint mg-trust-note">好友聚会信任模式：底牌存在共享房间数据里，界面只给本人看；它不是防作弊的保密机制。</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 梦幻拖拉机
// ---------------------------------------------------------------------------

export function DreamPanel({ game, myUid, nicknameOf, controller }: { game: GameState; myUid: string; nicknameOf: (uid: string) => string; controller: GameController }) {
  const d = game.dream
  const [card, setCard] = useState('SA')
  if (!d) return null
  const name = (u: string) => (u === myUid ? '你' : nicknameOf(u))
  const involved = myUid === d.initiatorUid || myUid === d.targetUid
  if (d.step === 'OPEN') {
    if (myUid !== d.initiatorUid) return null
    return (
      <div className="mg-v16-panel">
        <p className="mg-active-tarot-name">梦幻拖拉机（可选）</p>
        <p className="mg-faint">这次地产/碰撞事件可以向涉及的玩家提出一次梦幻挑战：双方亮出 2 张底牌，各声明 1 张幻想牌，比三张牌型。胜者从银行得 1 金币，败者不扣钱。不想挑战就不用管。</p>
        <div className="mg-target-grid">
          {d.candidates.map((u) => (
            <button key={u} type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.dreamChallenge(d.eventId, u)}>
              挑战 {nicknameOf(u)}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="mg-v16-panel">
      <p className="mg-active-tarot-name">梦幻拖拉机</p>
      <p className="mg-lady-step">
        {name(d.initiatorUid)} 向 {name(d.targetUid!)} 提出挑战
      </p>
      {d.step === 'AWAIT_ACCEPT' &&
        (myUid === d.targetUid ? (
          <div className="mg-action-row">
            <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.dreamRespond(d.eventId, false)}>
              拒绝（不受罚）
            </button>
            <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.dreamRespond(d.eventId, true)}>
              接受挑战
            </button>
          </div>
        ) : (
          <Waiting text={`等待 ${name(d.targetUid!)} 接受或拒绝`} />
        ))}
      {d.step === 'DECLARE' &&
        (involved && !d.fantasy[myUid] ? (
          <>
            <p className="mg-faint">你的底牌：{game.players[myUid]!.texasHoleCards.map(texasCardLabel).join(' ')}。声明一张幻想第三张牌（不消耗真实牌堆）：</p>
            <CardPicker value={card} onChange={setCard} />
            <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.dreamDeclare(d.eventId, card)}>
              声明 {texasCardLabel(card)}
            </button>
          </>
        ) : (
          <Waiting text="等待双方声明幻想牌" />
        ))}
      {d.step === 'DONE' && d.result && (
        <>
          {d.result.hands.map((h) => (
            <p key={h.uid} className="mg-faint">
              {name(h.uid)}：{h.cards.map(texasCardLabel).join(' ')} → {h.handName}
            </p>
          ))}
          <p className="mg-lady-step">{d.result.summary}</p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 阿瓦隆
// ---------------------------------------------------------------------------

export function AvalonPanel({
  game,
  myUid,
  isHost,
  roomPlayers,
  nicknameOf,
  controller,
}: {
  game: GameState
  myUid: string
  isHost: boolean
  roomPlayers: GameRoomPlayer[]
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  const a = game.avalon
  const m = a.active
  const [picked, setPicked] = useState<string[]>([])
  const myRole = a.roles[myUid]
  const name = (u: string) => (u === myUid ? '你' : nicknameOf(u))
  const toggle = (u: string) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : m && p.length < m.size ? [...p, u] : p))
  return (
    <div className="mg-v16-panel">
      <div className="mg-lady-status-head">
        <span className="mg-active-tarot-name">阿瓦隆</span>
        <span className="mg-faint">
          成功 {a.successes}/{AVALON_TARGET} · 失败 {a.fails}/{AVALON_TARGET}
        </span>
      </div>
      {myRole && !a.winner && (
        <p className="mg-faint">
          你的阵营（只有你能看到）：<strong>{myRole === 'GOOD' ? '好人（只能提交 SUCCESS）' : '坏人（可以提交 SUCCESS 或 FAIL）'}</strong>
        </p>
      )}
      {a.winner && (
        <>
          <p className="mg-lady-step">{a.winner === 'GOOD' ? '好人' : '坏人'}阵营获胜！胜方每人 +1 金币，败方每人 1 口。</p>
          <p className="mg-faint">公开身份：{game.turnOrder.map((u) => `${name(u)}=${a.roles[u] === 'GOOD' ? '好人' : '坏人'}`).join('，')}</p>
        </>
      )}
      {!m && !a.winner && <p className="mg-faint">踩中棋盘上的"发车任务"格子时发车，触发者当车主。</p>}
      {m && m.step === 'PICK' && (
        <>
          <p className="mg-lady-step">
            第 {m.round} 轮发车！车主 {name(m.leaderUid)} 需要选择 {m.size} 名乘客（可以选自己）。
          </p>
          {myUid === m.leaderUid ? (
            <>
              <div className="mg-target-grid">
                {roomPlayers.map((p) => (
                  <button key={p.uid} type="button" className={`mg-btn mg-btn-ghost${picked.includes(p.uid) ? ' mg-tactic-target-selected' : ''}`} onClick={() => toggle(p.uid)}>
                    {p.nickname}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mg-btn mg-btn-gold"
                disabled={controller.busy || picked.length !== m.size}
                onClick={() => void controller.avalonPick(m.missionId, picked).then(() => setPicked([]))}
              >
                发车（已选 {picked.length}/{m.size}）
              </button>
            </>
          ) : (
            <Waiting text={`等待车主 ${name(m.leaderUid)} 选乘客`} />
          )}
        </>
      )}
      {m && m.step === 'VOTE' && (
        <>
          <p className="mg-lady-step">乘客：{m.passengers.map(name).join('、')}。每位乘客秘密提交任务结果，全部提交后只公开是否成功和 FAIL 张数。</p>
          {m.passengers.includes(myUid) && !m.votes[myUid] ? (
            <div className="mg-action-row">
              <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy} onClick={() => void controller.avalonVote(m.missionId, 'SUCCESS')}>
                SUCCESS
              </button>
              {myRole === 'EVIL' && (
                <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.avalonVote(m.missionId, 'FAIL')}>
                  FAIL
                </button>
              )}
            </div>
          ) : (
            <Waiting text={`还有 ${m.passengers.filter((u) => !m.votes[u]).length} 名乘客没有提交`} />
          )}
        </>
      )}
      {m && isHost && (
        <button type="button" className="mg-btn mg-btn-ghost mg-lady-cancel" disabled={controller.busy} onClick={() => void controller.avalonCancel(m.missionId)}>
          房主：有人离线，取消这趟车（本轮不计入，不公开任何人的身份或选择）
        </button>
      )}
      <p className="mg-faint mg-trust-note">好友聚会信任模式：身份和投票存在共享房间数据里，界面只给本人看；它不是防作弊的匿名投票。</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 河边 / 神鬼道入口（落点决定）
// ---------------------------------------------------------------------------

export function ZoneDecisionPanel({
  game,
  decision,
  isMyTurn,
  currentName,
  nicknameOf,
  controller,
}: {
  game: GameState
  decision: Extract<PendingDecision, { kind: 'RIVER_CROSS' | 'ENTER_GODS' }>
  isMyTurn: boolean
  currentName: string
  nicknameOf: (uid: string) => string
  controller: GameController
}) {
  if (decision.kind === 'ENTER_GODS') {
    if (!isMyTurn) return <Waiting text={`${currentName} 来到神鬼道入口，正在决定是否进入`} />
    return (
      <div className="mg-action-panel mg-stack">
        <p className="mg-muted">你来到神鬼道入口（{decision.entranceNode === 0 ? '天堂一侧' : '地狱一侧'}）！</p>
        <p className="mg-faint">进入后每次掷骰沿中央竖排走向终点，恰好停在终点才算抵达（抵达 +10 分并触发终局）；走过头会穿过终点去往另一侧。天堂每次掷骰 +1 金币，地狱每次 −1 金币。在神鬼道里离终点最近的人是河神。</p>
        <div className="mg-action-row">
          <button type="button" className="mg-btn mg-btn-ghost" disabled={controller.busy} onClick={() => void controller.enterGods(false)}>
            留在外圈
          </button>
          <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.enterGods(true)}>
            进入神鬼道
          </button>
        </div>
      </div>
    )
  }
  const god = riverGodUid(game)
  const godZone = god ? game.players[god]!.zone : null
  const godRegion = godZone && godZone.kind === 'gods' ? godsRegion(godZone.node) : null
  if (!isMyTurn) return <Waiting text={`${currentName} 来到河边，正在选择过桥${god ? '或渡河' : ''}`} />
  return (
    <div className="mg-action-panel mg-stack">
      <p className="mg-muted">你来到河边！{god ? `现在的河神是 ${nicknameOf(god)}。` : '现在没有河神，只能过桥。'}</p>
      <p className="mg-faint">
        过桥：付 {BRIDGE_TOLL} 金币（不够就减免），桥长 {BRIDGE_LENGTH} 格，之后在桥上每次掷骰喝 2 口（可以以水代替或跳过），走完回到对岸。
      </p>
      {god && (
        <p className="mg-faint">
          渡河：你和河神各掷一颗骰子，4–6 成功、1–3 失败。你成功且河神同意 → 渡河成功；你失败且河神反对 → 失败；其余情况看神谕骰（4–6 成功）。
          {godRegion === 'HEAVEN' ? '河神在天堂：固定"同意"。' : godRegion === 'HELL' ? '河神在地狱：固定"反对"。' : ''}成功到达对岸，失败留在河岸。
        </p>
      )}
      <div className="mg-action-row">
        <button type="button" className="mg-btn mg-btn-primary" disabled={controller.busy} onClick={() => void controller.riverChoice('BRIDGE')}>
          过桥（{BRIDGE_TOLL} 金币）
        </button>
        {god && (
          <button type="button" className="mg-btn mg-btn-gold" disabled={controller.busy} onClick={() => void controller.riverChoice('FORD')}>
            渡河判定
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 终局排行榜
// ---------------------------------------------------------------------------

export function EndgamePanel({ game, myUid, nicknameOf }: { game: GameState; myUid: string; nicknameOf: (uid: string) => string }) {
  const eg = game.endgame
  if (!eg) return null
  if (eg.phase !== 'DONE' || !eg.scores) {
    return (
      <div className="mg-v16-panel mg-glow-purple">
        <p className="mg-active-tarot-name">终局进行中</p>
        <p className="mg-lady-step">{nicknameOf(eg.triggeredByUid)} 抵达终点！地图回合已经结束，德州已摊牌，正在完成阿瓦隆阵营结算。</p>
        <p className="mg-faint">只允许阿瓦隆的选人、投票操作；全部结束后自动计分。</p>
      </div>
    )
  }
  return (
    <div className="mg-v16-panel mg-glow-purple">
      <p className="mg-display mg-lady-card-name">游戏结束</p>
      <p className="mg-lady-step">{eg.winners.length > 1 ? '并列冠军：' : '冠军：'}{eg.winners.map((u) => (u === myUid ? '你' : nicknameOf(u))).join('、')}</p>
      <table className="mg-score-table">
        <thead>
          <tr>
            <th>名次</th>
            <th>玩家</th>
            <th>终点</th>
            <th>金币</th>
            <th>地产</th>
            <th>套装</th>
            <th>总分</th>
          </tr>
        </thead>
        <tbody>
          {eg.scores.map((s) => (
            <tr key={s.uid} className={s.uid === myUid ? 'mg-leaderboard-row-me' : undefined}>
              <td>{s.rank}</td>
              <td>{s.uid === myUid ? '你' : nicknameOf(s.uid)}</td>
              <td>{s.finishBonus}</td>
              <td>{s.coins}</td>
              <td>
                {s.properties}×2
              </td>
              <td>
                {s.fullSets}×2
              </td>
              <td>
                <strong>{s.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mg-faint">得分 = 抵达终点 10 + 金币 ×1 + 地产 ×2 + 有效完整同色套装 ×2（抵押地产计入地产数，不计入套装）。平分时依次比金币、地产数、套装数。结果已固定。</p>
    </div>
  )
}

/** "牌桌"抽屉：德州和阿瓦隆的完整信息（只是查看，需要操作时面板也会出现在棋盘下面） */
export function TableSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="mg-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mg-sheet mg-sheet-stack" onClick={(e) => e.stopPropagation()}>
        <div className="mg-sheet-header">
          <h3 className="mg-display">牌桌</h3>
          <button type="button" className="mg-btn mg-btn-ghost mg-sheet-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
