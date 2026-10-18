import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { ensureAnonymousLogin } from '../lib/cloudbase'
import * as api from '../lib/api'
import { ApiBusinessError, CallFunctionFailure } from '../lib/api'
import { pollRoomState, type RoomPollingHandle } from '../lib/roomPolling'
import { clearSession, saveSession } from '../lib/session'
import { RoomContext, type RoomState } from './RoomContext'
import type { Room } from '../../../shared/types'

/**
 * 整个房间生命周期（等待大厅 + 占位游戏页）共用的单一状态来源。
 *
 * 职责：
 * - 进入 /room/:code 或 /game/:code 时，确保登录 + 恢复/建立玩家身份（rejoinRoom）。
 * - 建立并维护*唯一*一份对该房间状态的轮询（RoomPage/GamePage 都读这里的状态，
 *   不各自再建）。`rooms`/`players` 是 ADMINONLY，不能用 `watch()`，
 *   详见 ../lib/roomPolling.ts 的说明。
 * - Room.status 变为 PLAYING 时自动导航到 /game/:code，并停止轮询——
 *   "完整游戏阶段不能继续无条件轮询"，Milestone 1 的 GamePage 只是占位页，
 *   不需要进一步的状态同步。
 */
export function RoomProvider() {
  const { roomCode } = useParams<{ roomCode: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<RoomState>({ phase: 'resolving' })

  const pollRef = useRef<RoomPollingHandle | null>(null)
  const roomIdRef = useRef<string | null>(null)
  const localVersionRef = useRef(0)
  const playerIdRef = useRef<string | null>(null)
  const lastNavigatedStatusRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    pollRef.current?.stop()
    pollRef.current = null
  }, [])

  const applyRoomSnapshot = useCallback(
    (room: Room, playerId: string) => {
      if (room.version < localVersionRef.current) {
        // 旧快照，丢弃（理论上轮询结果不会乱序到这个程度，这里是防御性处理）。
        return
      }
      localVersionRef.current = room.version
      playerIdRef.current = playerId
      setState({ phase: 'ready', room, playerId, connection: 'connected' })

      if (room.status === 'PLAYING' && lastNavigatedStatusRef.current !== 'PLAYING') {
        lastNavigatedStatusRef.current = 'PLAYING'
        navigate(`/game/${room.roomCode}`, { replace: true })
        // 已经离开等待大厅：停止轮询，不在完整游戏阶段继续无条件请求。
        // Milestone 1 的 GamePage 只是占位页，不需要进一步的状态更新；
        // 正式的游戏内实时同步方案以后单独设计。
        stopPolling()
      } else if (room.status === 'WAITING' && lastNavigatedStatusRef.current === 'PLAYING') {
        lastNavigatedStatusRef.current = 'WAITING'
        navigate(`/room/${room.roomCode}`, { replace: true })
      }
    },
    [navigate, stopPolling],
  )

  const startPolling = useCallback(
    (roomId: string, playerId: string) => {
      stopPolling()
      pollRef.current = pollRoomState(roomId, {
        onChange: (result) => {
          setState((prev) =>
            prev.phase === 'ready' ? { ...prev, connection: 'connected' } : prev,
          )
          applyRoomSnapshot(result.room, playerId)
        },
        onError: (error) => {
          if (error instanceof ApiBusinessError && error.code === 'NOT_MEMBER') {
            // 理论上不会发生（已经是成员才会开始轮询），防御性处理：
            // 停止轮询并把状态切回"需要重新加入"。
            stopPolling()
            setState({ phase: 'not-member', roomCode: roomCode ?? '' })
            return
          }
          // 其他错误（网络抖动等）只提示"连接中断"，下一轮轮询会自动重试，
          // 不在这里做指数退避——轮询本身的固定间隔已经起到了类似效果。
          setState((prev) =>
            prev.phase === 'ready' ? { ...prev, connection: 'reconnecting' } : prev,
          )
        },
      })
    },
    [applyRoomSnapshot, stopPolling, roomCode],
  )

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      if (!roomCode) {
        setState({ phase: 'error', code: 'INVALID_ROOM_CODE', message: '缺少房间码' })
        return
      }
      setState({ phase: 'resolving' })
      try {
        await ensureAnonymousLogin()
        const result = await api.rejoinRoom(roomCode)
        if (cancelled) return
        roomIdRef.current = result.room.roomId
        localVersionRef.current = 0
        lastNavigatedStatusRef.current = result.room.status === 'PLAYING' ? 'PLAYING' : 'WAITING'
        saveSession({
          roomId: result.room.roomId,
          roomCode: result.room.roomCode,
          playerId: result.playerId,
        })
        applyRoomSnapshot(result.room, result.playerId)
        // 只有还在 WAITING 阶段才需要轮询；如果刷新时房间已经在 PLAYING，
        // applyRoomSnapshot 会导航到 /game，不需要再启动轮询。
        if (result.room.status === 'WAITING') {
          startPolling(result.room.roomId, result.playerId)
        }
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiBusinessError && error.code === 'NOT_MEMBER') {
          setState({ phase: 'not-member', roomCode })
          return
        }
        if (error instanceof ApiBusinessError) {
          setState({ phase: 'error', code: error.code, message: error.message })
          return
        }
        if (error instanceof CallFunctionFailure) {
          setState({ phase: 'error', code: 'FUNCTION_UNAVAILABLE', message: error.message })
          return
        }
        setState({
          phase: 'error',
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
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
      const result = await api.joinRoom(roomCode, nickname)
      roomIdRef.current = result.room.roomId
      localVersionRef.current = 0
      lastNavigatedStatusRef.current = result.room.status === 'PLAYING' ? 'PLAYING' : 'WAITING'
      saveSession({
        roomId: result.room.roomId,
        roomCode: result.room.roomCode,
        playerId: result.playerId,
      })
      applyRoomSnapshot(result.room, result.playerId)
      if (result.room.status === 'WAITING') {
        startPolling(result.room.roomId, result.playerId)
      }
    },
    [roomCode, applyRoomSnapshot, startPolling],
  )

  const leaveRoom = useCallback(async () => {
    if (!roomIdRef.current) return
    await api.leaveRoom(roomIdRef.current)
    stopPolling()
    clearSession()
  }, [stopPolling])

  const startGame = useCallback(async () => {
    if (!roomIdRef.current) return
    await api.startGame(roomIdRef.current)
    // 不需要在这里手动导航：startGame 成功后下一次轮询会拿到 status=PLAYING，
    // applyRoomSnapshot 会自动导航到 /game 并停止轮询。
  }, [])

  const reportOnline = useCallback((online: boolean) => {
    if (!roomIdRef.current) return
    // best-effort：不等待结果，也不处理失败——这只是 UI 提示，不是权威状态。
    void api.setOnline(roomIdRef.current, online).catch(() => undefined)
  }, [])

  // Presence：页面隐藏/恢复时尽力上报在线状态。不做心跳，不保证送达
  // （比如标签页被直接杀掉时 beforeunload 也可能来不及执行），
  // 这完全符合"online 只是 UI 提示"的设计前提。
  useEffect(() => {
    function handleVisibilityChange() {
      reportOnline(document.visibilityState === 'visible')
    }
    function handleBeforeUnload() {
      reportOnline(false)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [reportOnline])

  return (
    <RoomContext.Provider value={{ state, joinAsNewPlayer, leaveRoom, startGame, reportOnline }}>
      <Outlet />
    </RoomContext.Provider>
  )
}
