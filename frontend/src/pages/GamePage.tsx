import { useRoomContext } from '../room/RoomContext'

/**
 * Milestone 1 占位页。真正的游戏逻辑（棋盘、规则等）属于后续 Milestone，
 * 这里只展示一个简单状态，证明"房间状态 WAITING -> PLAYING"的整条链路跑通了。
 */
export function GamePage() {
  const { state } = useRoomContext()

  if (state.phase !== 'ready') {
    return <p className="text-muted">正在加载…</p>
  }

  return (
    <div className="stack">
      <h1>游戏即将开始</h1>
      <p className="text-muted">房间码 {state.room.roomCode}</p>
      <p className="text-muted">
        玩家：{state.room.players.map((p) => p.nickname).join('、')}
      </p>
    </div>
  )
}
