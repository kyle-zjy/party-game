import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameRoomContext } from '../gameRoom/GameRoomContext'
import { loadNickname, saveNickname } from '../lib/session'
import { describeUnknownError } from '../../../shared/errors'
import { MIN_PLAYERS } from '../../../shared/constants'
import { GameBoardPage } from '../game/GameBoardPage'
import type { LadyRuleset } from '../../../shared/game/types'

/**
 * 阶段 B 的房间大厅页，对应旧模型的 RoomPage.tsx。
 *
 * 阶段 C 更新：房主可以点击"开始游戏"（`startGame` 来自 GameRoomContext，
 * 调用 `startGameWithEngine` 写入初始 GameState）；一旦 `room.status`
 * 变成 `PLAYING`，这个页面不再渲染大厅视图，而是渲染 `GameBoardPage`——
 * 不单独建一个 `/mp/:roomCode/game` 路由，因为房间状态本来就是单一数据源，
 * 按 `status` 分支渲染比"两个路由 + 再同步一次状态"更简单，也不会有
 * "切路由导致 GameRoomProvider 被卸载重建、轮询被打断"的风险。
 */
export function GameRoomLobbyPage() {
  const { state, joinAsNewPlayer, leaveRoom, startGame } = useGameRoomContext()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  if (state.phase === 'resolving') {
    return <p className="text-muted">正在连接房间…</p>
  }

  if (state.phase === 'not-member') {
    return <JoinForm roomCode={state.roomCode} onJoin={joinAsNewPlayer} />
  }

  if (state.phase === 'error') {
    return (
      <div className="stack">
        <h1>出错了</h1>
        <p className="text-error">{state.message}</p>
      </div>
    )
  }

  const { room, uid, connection } = state

  if (room.status === 'PLAYING' && room.game) {
    return <GameBoardPage />
  }

  const isHost = room.players.find((p) => p.uid === uid)?.isHost ?? false
  const canStart = room.players.length >= MIN_PLAYERS

  async function handleStart(ladyRuleset: LadyRuleset = 'official') {
    setStartError(null)
    setStarting(true)
    try {
      await startGame(ladyRuleset)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[GameRoomLobbyPage] 开始游戏失败，原始错误：', err)
      setStartError(describeUnknownError(err))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>等待房间</h1>
        {connection === 'reconnecting' && (
          <p className="text-warn">连接中断，正在尝试恢复…</p>
        )}
      </div>

      <div className="card">
        <p className="text-muted">房间码</p>
        <p className="room-code">{room.roomCode}</p>
        <button
          className="btn btn-secondary"
          onClick={() => void navigator.clipboard?.writeText(room.roomCode)}
        >
          复制房间码
        </button>
      </div>

      <div className="card">
        <p className="text-muted">
          玩家 {room.players.length} / {room.maxPlayers}
        </p>
        <ul className="player-list">
          {[...room.players]
            .sort((a, b) => a.seat - b.seat)
            .map((p) => (
              <li key={p.uid} className="player-row">
                <span className="seat">{p.seat + 1}</span>
                <span className="nickname">{p.nickname}</span>
                {p.isHost && <span className="badge">👑 房主</span>}
                {p.uid === uid && <span className="badge">我</span>}
              </li>
            ))}
        </ul>
        {room.players.length < MIN_PLAYERS && (
          <p className="text-muted" style={{ marginTop: 8 }}>
            至少需要 {MIN_PLAYERS} 名玩家才能开始游戏
          </p>
        )}
      </div>

      <div className="spacer" />

      <div className="bottom-actions stack">
        {isHost ? (
          <button className="btn btn-primary" disabled={!canStart || starting} onClick={() => void handleStart()}>
            {starting ? '准备中…' : '开始游戏'}
          </button>
        ) : (
          <p className="text-muted">等待房主开始游戏</p>
        )}
        {isHost && import.meta.env.DEV && (
          <button className="btn btn-secondary" disabled={!canStart || starting} onClick={() => void handleStart('candidate-preview')}>
            开发测试：开始游戏（启用候选小姐牌规则）
          </button>
        )}
        {startError && <p className="text-error">{startError}</p>}
        <button
          className="btn btn-danger"
          onClick={() => {
            void leaveRoom().then(() => navigate('/mp'))
          }}
        >
          离开房间
        </button>
      </div>
    </div>
  )
}

function JoinForm({
  roomCode,
  onJoin,
}: {
  roomCode: string
  onJoin: (nickname: string) => Promise<void>
}) {
  const [nickname, setNickname] = useState(loadNickname())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleJoin() {
    setError(null)
    setBusy(true)
    try {
      saveNickname(nickname)
      await onJoin(nickname)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[GameRoomLobbyPage] 加入房间失败，原始错误：', err)
      setError(describeUnknownError(err))
    } finally {
      setBusy(false)
    }
  }

  const nicknameValid = nickname.trim().length > 0 && nickname.trim().length <= 12

  return (
    <div className="stack">
      <h1>加入房间</h1>
      <p className="text-muted">房间码 {roomCode}：你还不是这个房间的成员，请先输入昵称加入。</p>
      <div className="card">
        <div className="field">
          <label htmlFor="join-nickname">你的昵称</label>
          <input
            id="join-nickname"
            className="input"
            maxLength={12}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" disabled={!nicknameValid || busy} onClick={() => void handleJoin()}>
          {busy ? '加入中…' : '加入房间'}
        </button>
        {error && <p className="text-error">{error}</p>}
      </div>
    </div>
  )
}
