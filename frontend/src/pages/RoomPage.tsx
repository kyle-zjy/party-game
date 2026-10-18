import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoomContext } from '../room/RoomContext'
import { ApiBusinessError, CallFunctionFailure } from '../lib/api'
import { ERROR_MESSAGES_ZH } from '../../../shared/errors'
import { MIN_PLAYERS } from '../../../shared/constants'
import { loadNickname, saveNickname } from '../lib/session'

export function RoomPage() {
  const { state, joinAsNewPlayer, leaveRoom, startGame } = useRoomContext()
  const navigate = useNavigate()

  if (state.phase === 'resolving') {
    return <p className="text-muted">正在连接房间…</p>
  }

  if (state.phase === 'not-member') {
    return <JoinForm roomCode={state.roomCode} onJoined={() => undefined} onJoin={joinAsNewPlayer} />
  }

  if (state.phase === 'error') {
    return <ErrorView code={state.code} message={state.message} />
  }

  const { room, playerId, connection } = state
  const me = room.players.find((p) => p.playerId === playerId)
  const isHost = me?.isHost ?? false
  const canStart = room.players.length >= MIN_PLAYERS

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
              <li key={p.playerId} className={`player-row${p.online ? '' : ' offline'}`}>
                <span className="seat">{p.seat + 1}</span>
                <span className="nickname">{p.nickname}</span>
                {p.isHost && <span className="badge">👑 房主</span>}
                {!p.online && <span className="badge">离线</span>}
              </li>
            ))}
        </ul>
      </div>

      <div className="spacer" />

      <div className="bottom-actions stack">
        {isHost ? (
          <>
            <button className="btn btn-primary" disabled={!canStart} onClick={() => void startGame()}>
              开始游戏
            </button>
            {!canStart && <p className="text-muted">至少需要 {MIN_PLAYERS} 名玩家</p>}
          </>
        ) : (
          <p className="text-muted">等待房主开始游戏</p>
        )}
        <button
          className="btn btn-danger"
          onClick={() => {
            void leaveRoom().then(() => navigate('/'))
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
  onJoined: () => void
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
      if (err instanceof ApiBusinessError) {
        setError(ERROR_MESSAGES_ZH[err.code] ?? err.message)
      } else if (err instanceof CallFunctionFailure) {
        setError(`暂时无法连接服务器：${err.message}`)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
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
        <button className="btn btn-primary" disabled={!nicknameValid || busy} onClick={handleJoin}>
          {busy ? '加入中…' : '加入房间'}
        </button>
        {error && <p className="text-error">{error}</p>}
      </div>
    </div>
  )
}

function ErrorView({ code, message }: { code: string; message: string }) {
  const friendly = ERROR_MESSAGES_ZH[code as keyof typeof ERROR_MESSAGES_ZH]
  return (
    <div className="stack">
      <h1>出错了</h1>
      <p className="text-error">{friendly ?? message}</p>
      {code === 'FUNCTION_UNAVAILABLE' && (
        <p className="text-warn">
          提示：room 云函数可能尚未部署到远端 CloudBase 环境，这是开发阶段的预期状态。
        </p>
      )}
    </div>
  )
}
