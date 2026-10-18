import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { ensureAnonymousLogin } from '../lib/cloudbase'
import { joinGameRoom, leaveGameRoom, rejoinGameRoom } from '../lib/gameRoomDb'
import { startGameWithEngine } from '../lib/gameEngineDb'
import { pollGameRoomState } from '../lib/gameRoomPolling'
import type { PollingHandle } from '../lib/polling'
import { describeUnknownError, RoomError } from '../../../shared/errors'
import { GameRoomContext, type GameRoomPageState } from './GameRoomContext'
import type { GameRoom } from '../../../shared/gameRoomTypes'

/**
 * 阶段 B 大厅页面的单一状态来源，对应旧模型的 RoomProvider.tsx。
 *
 * 身份恢复流程：ensureAnonymousLogin() 拿到 uid -> rejoinGameRoom(roomCode, uid)
 * 看这个 uid 是否已经是房间成员。是：直接进入大厅并开始轮询。不是：
 * 进入 not-member 状态，展示加入表单，用户输入昵称后调用 joinAsNewPlayer。
 */
export function GameRoomProvider() {
  const { roomCode } = useParams<{ roomCode: string }>()
  const [state, setState] = useState<GameRoomPageState>({ phase: 'resolving' })

  const pollRef = useRef<PollingHandle | null>(null)
  const roomIdRef = useRef<string | null>(null)
  const uidRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    pollRef.current?.stop()
    pollRef.current = null
  }, [])

  const startPollingFor = useCallback((roomId: string, uid: string) => {
    stopPolling()
    pollRef.current = pollGameRoomState(roomId, {
      onChange: (room) => {
        setState({ phase: 'ready', room, uid, connection: 'connected' })
      },
      onError: () => {
        // 网络抖动等：只提示"连接中断"，下一轮轮询会自动重试。
        setState((prev) => (prev.phase === 'ready' ? { ...prev, connection: 'reconnecting' } : prev))
      },
    })
  }, [stopPolling])

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      if (!roomCode) {
        setState({ phase: 'error', message: '缺少房间码' })
        return
      }
      setState({ phase: 'resolving' })
      try {
        const uid = await ensureAnonymousLogin()
        if (cancelled) return
        uidRef.current = uid
        const result = await rejoinGameRoom(roomCode, uid)
        if (cancelled) return
        roomIdRef.current = result.room._id
        setState({ phase: 'ready', room: result.room, uid, connection: 'connected' })
        startPollingFor(result.room._id, uid)
      } catch (error) {
        if (cancelled) return
        if (error instanceof RoomError && (error.code === 'NOT_MEMBER' || error.code === 'ROOM_NOT_FOUND')) {
          setState({ phase: 'not-member', roomCode })
          return
        }
        if (import.meta.env.DEV) console.error('[GameRoomProvider] 恢复房间身份失败，原始错误：', error)
        setState({
          phase: 'error',
          message: describeUnknownError(error),
        })
      }
    }

    void resolve()

    return () => {
      cancelled = true
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 roomCode 变化时重新建立整条生命周期
  }, [roomCode])

  const joinAsNewPlayer = useCallback(
    async (nickname: string) => {
      if (!roomCode) return
      const uid = await ensureAnonymousLogin()
      uidRef.current = uid
      const result = await joinGameRoom(roomCode, nickname, uid)
      roomIdRef.current = result.room._id
      setState({ phase: 'ready', room: result.room, uid, connection: 'connected' })
      startPollingFor(result.room._id, uid)
    },
    [roomCode, startPollingFor],
  )

  const leaveRoom = useCallback(async () => {
    if (!roomIdRef.current || !uidRef.current) return
    await leaveGameRoom(roomIdRef.current, uidRef.current)
    stopPolling()
  }, [stopPolling])

  const startGame = useCallback(async () => {
    if (!roomIdRef.current || !uidRef.current) return
    const room = await startGameWithEngine(roomIdRef.current, uidRef.current)
    setState({ phase: 'ready', room, uid: uidRef.current, connection: 'connected' })
    // 不需要在这里重启轮询：房间 id 没变，startPollingFor 已经在 resolve() 时启动过，
    // 下一轮轮询自然会读到 status=PLAYING 和 game 字段。
  }, [])

  const applyExternalRoomUpdate = useCallback((room: GameRoom) => {
    setState((prev) => (prev.phase === 'ready' ? { ...prev, room, connection: 'connected' } : prev))
  }, [])

  return (
    <GameRoomContext.Provider value={{ state, joinAsNewPlayer, leaveRoom, startGame, applyExternalRoomUpdate }}>
      <Outlet />
    </GameRoomContext.Provider>
  )
}
