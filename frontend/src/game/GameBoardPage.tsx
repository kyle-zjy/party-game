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
import { getTarotCard } from '../../../shared/game/cards/tarotCards'
import { hostLineForMyTurn, hostLineForWatching } from './tutorial/tutorialLines'
import { hasCompletedQuickStart, markQuickStartCompleted } from './tutorial/tutorialSeen'
import './theme.css'
import './ui/gameBoardPage.css'

type DrawerKind = 'leaderboard' | 'history' | 'tarot' | 'help' | 'menu' | null

export function GameBoardPage() {
  const { state } = useGameRoomContext()
  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [showQuickStart, setShowQuickStart] = useState(!hasCompletedQuickStart())

  if (state.phase !== 'ready' || state.room.status !== 'PLAYING' || !state.room.game) {
    return <p className="mg-muted">正在加载游戏…</p>
  }

  return (
    <GameBoardInner
      room={state.room}
      myUid={state.uid}
      drawer={drawer}
      setDrawer={setDrawer}
      showQuickStart={showQuickStart}
      setShowQuickStart={setShowQuickStart}
    />
  )
}

function GameBoardInner({
  room,
  myUid,
  drawer,
  setDrawer,
  showQuickStart,
  setShowQuickStart,
}: {
  room: Extract<ReturnType<typeof useGameRoomContext>['state'], { phase: 'ready' }>['room']
  myUid: string
  drawer: DrawerKind
  setDrawer: (d: DrawerKind) => void
  showQuickStart: boolean
  setShowQuickStart: (v: boolean) => void
}) {
  const game = room.game!
  const controller = useGameController(room._id, myUid)
  useAutoResolveLanding(game, myUid, controller)

  const playersList = useMemo(() => Object.values(game.players), [game.players])
  const displayPositions = useTokenAnimation(playersList)
  const animatedPlayers = useMemo(
    () => playersList.map((p) => ({ ...p, position: displayPositions.get(p.uid) ?? p.position })),
    [playersList, displayPositions],
  )

  const me = game.players[myUid]
  const isMyTurn = game.turn.currentPlayerUid === myUid
  const currentNickname = room.players.find((p) => p.uid === game.turn.currentPlayerUid)?.nickname ?? '一位玩家'
  const isHost = room.players.find((p) => p.uid === myUid)?.isHost ?? false
  const nicknameOf = (uid: string) => room.players.find((p) => p.uid === uid)?.nickname ?? uid

  // 骰子"摇动中"的状态只在用户点击骰子这个事件处理函数里设置/清除
  // （而不是在 effect 里根据 game 状态变化反推），这样一次点击始终有一个
  // 稳定的最短动画时长，不会因为网络往返特别快就"骰子还没转就停了"。
  const [rolling, setRolling] = useState(false)
  const handleRollDice = useCallback(() => {
    setRolling(true)
    void controller.rollDice().finally(() => {
      setTimeout(() => setRolling(false), 650)
    })
  }, [controller])

  const hostLine = isMyTurn
    ? hostLineForMyTurn(game.turn.phase, game.turn.extraRollPending)
    : hostLineForWatching(currentNickname, game.turn.phase)

  const highlightPath = useMemo(() => {
    if (!isMyTurn || !me) return []
    if (game.turn.phase === 'ROLLING' || !game.turn.lastRoll) return []
    const path: number[] = []
    const steps = game.turn.lastRoll.effective
    for (let s = 0; s <= steps; s += 1) {
      path.push((me.position + s) % 74 >= 0 ? (me.position + s) % 74 : me.position)
    }
    return path
  }, [isMyTurn, me, game.turn.phase, game.turn.lastRoll])

  if (!me) {
    return <p className="mg-muted">找不到你的游戏状态，请刷新页面重试。</p>
  }

  const worldTarot = getTarotCard(game.currentTarotId)

  return (
    <div className="mg-root mg-game-page">
      <TopBar
        roomCode={room.roomCode}
        turnNumber={game.turnNumber}
        currentNickname={currentNickname}
        isMyTurn={isMyTurn}
        phase={game.turn.phase}
        onOpenTarot={() => setDrawer('tarot')}
        onOpenMenu={() => setDrawer('menu')}
      />

      {/*
        可滚动区域：棋盘和"最近事件/排行榜/帮助"这类次级内容放在这里，
        和底部"操作区"（骰子/继续/翻牌/出牌按钮）分离，保证操作区始终
        固定可见，不会被长棋盘或多条喝酒提醒挤出屏幕——这是用户反馈
        "操作按钮被遮挡"问题的直接对应修复。
      */}
      <div className="mg-scroll-area mg-scrollbar-hidden">
        <HostLineBanner line={hostLine} />

        <GameBoard
          players={animatedPlayers}
          currentUid={myUid}
          highlightPath={isMyTurn ? highlightPath : []}
          worldTarotLabel={`${worldTarot.romanNumeral} ${worldTarot.name}`}
        />

        <DrinkAckTray
          acks={game.pendingDrinkAcks}
          myUid={myUid}
          isHost={isHost}
          nicknameOf={nicknameOf}
          controller={controller}
        />

        <div className="mg-quick-nav">
          <button type="button" className="mg-pill" onClick={() => setDrawer('leaderboard')}>
            排行榜
          </button>
          <button type="button" className="mg-pill" onClick={() => setDrawer('history')}>
            最近事件
          </button>
          <button type="button" className="mg-pill" onClick={() => setDrawer('help')}>
            帮助
          </button>
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

      <div className="mg-bottom-dock">
        <MyResourcesBar me={me} onOpenProperties={() => setDrawer('leaderboard')} onOpenHand={() => setDrawer('help')} />
        <ActionPanel
          isMyTurn={isMyTurn}
          isHost={isHost}
          phase={game.turn.phase}
          pendingDecision={game.turn.pendingDecision}
          lastRollNatural={game.turn.lastRoll?.natural ?? null}
          rolling={rolling}
          onRollDice={handleRollDice}
          revealedLadyCardId={game.turn.revealedLadyCardId}
          me={me}
          roomPlayers={room.players}
          controller={controller}
        />
      </div>

      {drawer === 'leaderboard' && (
        <LeaderboardDrawer players={playersList} roomPlayers={room.players} myUid={myUid} onClose={() => setDrawer(null)} />
      )}
      {drawer === 'history' && <HistoryDrawer history={game.history} onClose={() => setDrawer(null)} />}
      {drawer === 'tarot' && <TarotDrawer currentTarotId={game.currentTarotId} onClose={() => setDrawer(null)} />}
      {(drawer === 'help' || drawer === 'menu') && <HelpDrawer onClose={() => setDrawer(null)} />}

      {game.pendingHeartAttack && (
        <HeartAttackOverlay
          event={game.pendingHeartAttack}
          isHost={isHost}
          nicknameOf={nicknameOf}
          onDismiss={() => void controller.dismissHeartAttack()}
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
