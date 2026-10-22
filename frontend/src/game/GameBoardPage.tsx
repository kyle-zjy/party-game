import { useCallback, useMemo, useState } from 'react'
import { useGameRoomContext } from '../gameRoom/GameRoomContext'
import { useGameController } from './useGameController'
import { useAutoResolveLanding } from './useLandingAdvance'
import { useTokenAnimation } from './useTokenAnimation'
import { GameBoard } from './ui/GameBoard'
import { TopBar } from './ui/TopBar'
import { HostLineBanner } from './ui/HostLineBanner'
import { MyResourcesBar } from './ui/MyResourcesBar'
import { ActionPanel } from './ui/ActionPanel'
import { DrinkAckTray } from './ui/DrinkAckTray'
import { LeaderboardDrawer, HistoryDrawer, TarotDrawer, HelpDrawer } from './ui/Drawers'
import { QuickStartOverlay } from './ui/QuickStartOverlay'
import { HeartAttackOverlay } from './ui/HeartAttackOverlay'
import { ActiveTarotStrip, TarotDiscardTray, TarotRevealOverlay } from './ui/TarotPanels'
import { BanCatchSheet } from './ui/BanCatchSheet'
import { LadyWindowStrip } from './ui/LadyWindowStrip'
import { JusticeResultPanel } from './ui/JusticeResultPanel'
import { LadyStatusStrip } from './ui/LadyStatusStrip'
import { CrazyCatchSheet, LadyRulesSheet } from './ui/LadyRulesSheet'
import { AvalonPanel, DreamPanel, EndgamePanel, TableSheet, TexasPanel } from './ui/V16Panels'
import { TableInfoBar } from './ui/TableInfoBar'
import { riverGodUid } from '../../../shared/game/engine/zones'
import { getTarotCard } from '../../../shared/game/cards/tarotCards'
import { BOARD_SIZE } from '../../../shared/game/board'
import { contextualHostLine } from './tutorial/tutorialLines'
import { hasCompletedQuickStart, markQuickStartCompleted } from './tutorial/tutorialSeen'
import { hasSeenTarotReveal, markTarotRevealSeen } from './tutorial/tarotRevealSeen'
import type { GameRoom } from '../../../shared/gameRoomTypes'
import './theme.css'
import './ui/gameBoardPage.css'

type DrawerKind = 'leaderboard' | 'history' | 'tarot' | 'help' | 'menu' | 'ban' | 'ladyRules' | 'crazy' | 'table' | null

export function GameBoardPage() {
  const { state } = useGameRoomContext()
  if (state.phase !== 'ready' || state.room.status !== 'PLAYING' || !state.room.game) {
    return <p className="mg-muted">正在加载游戏…</p>
  }
  return <GameBoardInner room={state.room} myUid={state.uid} />
}

function GameBoardInner({ room, myUid }: { room: GameRoom; myUid: string }) {
  const game = room.game!
  const controller = useGameController(room._id, myUid)
  useAutoResolveLanding(game, myUid, controller)

  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [showQuickStart, setShowQuickStart] = useState(!hasCompletedQuickStart())
  // 已经关闭过的塔罗揭示事件；结合 localStorage 记录，刷新后不重复弹出同一次更换
  const [dismissedRevealId, setDismissedRevealId] = useState<string | null>(null)
  const [dismissedJusticeId, setDismissedJusticeId] = useState<string | null>(null)

  const playersList = useMemo(() => game.turnOrder.map((uid) => game.players[uid]!).filter(Boolean), [game.turnOrder, game.players])
  const displayPositions = useTokenAnimation(playersList)
  const animatedPlayers = useMemo(
    () => playersList.map((p) => ({ ...p, position: displayPositions.get(p.uid) ?? p.position })),
    [playersList, displayPositions],
  )

  const me = game.players[myUid]
  const isMyTurn = game.turn.currentPlayerUid === myUid
  const isHost = room.players.find((p) => p.uid === myUid)?.isHost ?? false
  const hostUid = room.players.find((p) => p.isHost)?.uid ?? null
  const v16 = game.rulesVersion === 2
  // 需要玩家操作的事件进行中：操作区可以占更多高度（内部滚动），棋盘保持可见
  const eventMode = Boolean(
    game.turn.pendingDecision || (game.ladyEvent && game.ladyEvent.status === 'ACTIVE') || game.tacticStack || game.endgame,
  )
  const nicknameOf = useCallback((uid: string) => room.players.find((p) => p.uid === uid)?.nickname ?? '一位玩家', [room.players])
  const currentNickname = nicknameOf(game.turn.currentPlayerUid)

  // 骰子"摇动中"只在点击事件里设置，保证一次点击始终有稳定的最短动画时长
  const [rolling, setRolling] = useState(false)
  const handleRollDice = useCallback(() => {
    setRolling(true)
    void controller.rollDice().finally(() => {
      setTimeout(() => setRolling(false), 650)
    })
  }, [controller])

  // 移动路线：落点结算前，棋子还在起点位置，按有效步数高亮将要走过的格子；
  // 结算后位置已经是终点，不再高亮（否则会高亮到终点之后的格子）。
  const highlightPath = useMemo(() => {
    const current = game.players[game.turn.currentPlayerUid]
    const roll = game.turn.lastRoll
    if (!current || !roll || game.turn.phase !== 'LANDING' || game.turn.landingResolved || current.zone.kind !== 'ring') return []
    return Array.from({ length: roll.effective + 1 }, (_, s) => (current.position + s) % BOARD_SIZE)
  }, [game])

  const revealEvent =
    game.lastTarotChange && game.lastTarotChange.id !== dismissedRevealId && !hasSeenTarotReveal(game.lastTarotChange.id) && !showQuickStart
      ? game.lastTarotChange
      : null

  if (!me) return <p className="mg-muted">找不到你的游戏状态，请刷新页面重试。</p>

  const worldTarot = getTarotCard(game.currentTarotId)

  return (
    <div className="mg-root mg-game-page">
      <TopBar
        roomCode={room.roomCode}
        turnNumber={game.turnNumber}
        currentNickname={currentNickname}
        isMyTurn={isMyTurn}
        phase={game.turn.phase}
        legacyRules={!v16}
        onOpenMenu={() => setDrawer('menu')}
      />

      <div className="mg-scroll-area mg-scrollbar-hidden">
        <HostLineBanner line={contextualHostLine(game, myUid, isHost, nicknameOf)} />
        <TableInfoBar
          game={game}
          myUid={myUid}
          nicknameOf={nicknameOf}
          renderSection={(section) =>
            section === 'tarot' ? (
              <ActiveTarotStrip game={game} nicknameOf={nicknameOf} onOpen={() => setDrawer('tarot')} />
            ) : section === 'heart' ? (
              <LadyWindowStrip game={game} />
            ) : (
              <LadyStatusStrip
                game={game}
                myUid={myUid}
                isHost={isHost}
                nicknameOf={nicknameOf}
                controller={controller}
                onOpenRules={() => setDrawer('ladyRules')}
                onCrazyCatch={() => setDrawer('crazy')}
              />
            )
          }
        />

        <EndgamePanel game={game} myUid={myUid} nicknameOf={nicknameOf} />

        <GameBoard
          players={animatedPlayers}
          currentUid={myUid}
          activeUid={game.turn.currentPlayerUid}
          highlightPath={highlightPath}
          worldTarotLabel={`${worldTarot.romanNumeral} ${worldTarot.name}`}
          showCentral={v16}
          godsOpen={game.godsPathOpen}
          riverGodUid={riverGodUid(game)}
        />

        {/* 需要我马上操作的牌桌事件放在棋盘下面；其余德州/阿瓦隆信息放进"牌桌"抽屉 */}
        {v16 && game.dream && <DreamPanel game={game} myUid={myUid} nicknameOf={nicknameOf} controller={controller} />}
        {v16 && game.avalon.active && (
          <AvalonPanel game={game} myUid={myUid} isHost={isHost} roomPlayers={room.players} nicknameOf={nicknameOf} controller={controller} />
        )}
        {v16 && game.texas.betting && <TexasPanel game={game} myUid={myUid} isHost={isHost} nicknameOf={nicknameOf} controller={controller} />}

        <TarotDiscardTray game={game} myUid={myUid} isHost={isHost} nicknameOf={nicknameOf} controller={controller} />
        <DrinkAckTray
          game={game}
          acks={game.pendingDrinkAcks}
          myUid={myUid}
          isHost={isHost}
          tarotId={game.currentTarotId}
          me={me}
          players={playersList}
          nicknameOf={nicknameOf}
          controller={controller}
        />

        <div className="mg-quick-nav">
          {v16 && (
            <button type="button" className="mg-pill" onClick={() => setDrawer('table')}>
              牌桌（德州 / 阿瓦隆）
            </button>
          )}
          <button type="button" className="mg-pill" onClick={() => setDrawer('leaderboard')}>
            排行榜
          </button>
          <button type="button" className="mg-pill" onClick={() => setDrawer('history')}>
            最近事件
          </button>
          <button type="button" className="mg-pill" onClick={() => setDrawer('ladyRules')}>
            小姐牌规则
          </button>
          <button type="button" className="mg-pill" onClick={() => setDrawer('help')}>
            帮助
          </button>
          {isHost && (
            <button type="button" className="mg-pill" onClick={() => setDrawer('ban')}>
              禁令：有人说了"为什么"
            </button>
          )}
        </div>
      </div>

      {controller.error && (
        <div className="mg-error-toast" role="alert">
          <span>{controller.error}</span>
          <button type="button" className="mg-btn-icon" onClick={controller.clearError} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      <div className={`mg-bottom-dock${eventMode ? ' mg-dock-event' : ''}`}>
        <MyResourcesBar me={me} onOpenProperties={() => setDrawer('leaderboard')} onOpenHand={() => setDrawer('help')} />
        <ActionPanel
          game={game}
          myUid={myUid}
          hostUid={hostUid}
          isMyTurn={isMyTurn}
          isHost={isHost}
          rolling={rolling}
          onRollDice={handleRollDice}
          me={me}
          roomPlayers={room.players}
          nicknameOf={nicknameOf}
          controller={controller}
        />
      </div>

      {drawer === 'leaderboard' && (
        <LeaderboardDrawer game={game} players={playersList} roomPlayers={room.players} myUid={myUid} controller={controller} onClose={() => setDrawer(null)} />
      )}
      {drawer === 'history' && <HistoryDrawer history={game.history} nicknameOf={nicknameOf} onClose={() => setDrawer(null)} />}
      {drawer === 'tarot' && <TarotDrawer currentTarotId={game.currentTarotId} onClose={() => setDrawer(null)} />}
      {(drawer === 'help' || drawer === 'menu') && <HelpDrawer onClose={() => setDrawer(null)} />}
      {drawer === 'table' && (
        <TableSheet onClose={() => setDrawer(null)}>
          <TexasPanel game={game} myUid={myUid} isHost={isHost} nicknameOf={nicknameOf} controller={controller} />
          <AvalonPanel game={game} myUid={myUid} isHost={isHost} roomPlayers={room.players} nicknameOf={nicknameOf} controller={controller} />
        </TableSheet>
      )}
      {drawer === 'ladyRules' && <LadyRulesSheet game={game} isHost={isHost} controller={controller} onClose={() => setDrawer(null)} />}
      {drawer === 'crazy' && isHost && <CrazyCatchSheet game={game} players={room.players} controller={controller} onClose={() => setDrawer(null)} />}
      {drawer === 'ban' && isHost && <BanCatchSheet players={room.players} tarotId={game.currentTarotId} controller={controller} onClose={() => setDrawer(null)} />}

      {game.pendingHeartAttack && (
        <HeartAttackOverlay
          event={game.pendingHeartAttack}
          isHost={isHost}
          tarotId={game.currentTarotId}
          players={room.players}
          nicknameOf={nicknameOf}
          busy={controller.busy}
          onResolve={(first, falseStarts) => void controller.resolveHeartAttack(first, falseStarts)}
        />
      )}

      {revealEvent && (
        <TarotRevealOverlay
          event={revealEvent}
          nicknameOf={nicknameOf}
          onClose={() => {
            markTarotRevealSeen(revealEvent.id)
            setDismissedRevealId(revealEvent.id)
          }}
        />
      )}

      {!revealEvent && game.lastJusticeSwap && game.lastJusticeSwap.id !== dismissedJusticeId && !hasSeenTarotReveal(game.lastJusticeSwap.id) && (
        <JusticeResultPanel
          game={game}
          nicknameOf={nicknameOf}
          onClose={() => {
            markTarotRevealSeen(game.lastJusticeSwap!.id)
            setDismissedJusticeId(game.lastJusticeSwap!.id)
          }}
        />
      )}

      {showQuickStart && (
        <QuickStartOverlay
          onDone={() => {
            markQuickStartCompleted()
            setShowQuickStart(false)
          }}
        />
      )}
    </div>
  )
}
