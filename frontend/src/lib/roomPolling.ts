/**
 * 房间状态的低频轮询同步——替代直接对 `rooms` 集合 `watch()`。
 *
 * ## 为什么不能再用 `db.collection('rooms').doc(roomId).watch()`
 *
 * `rooms`/`players` 两个集合在 CloudBase 控制台里配置成了 **ADMINONLY**
 * （仅云函数的环境身份能读写），这是数据库创建时就定好的安全设置，
 * 本次任务不会去改它。ADMINONLY 意味着前端 SDK 不管是 `get()`/`where()`
 * 还是 `watch()`，都没有权限直接接触这两个集合——继续尝试 `watch()`
 * 要么直接报权限错误，要么（更危险）只有在把安全规则放宽给所有登录用户时
 * 才能"侥幸"工作，而那样做等于让任意匿名用户都能读到所有房间的数据，
 * 不是本项目能接受的方案。
 *
 * ## Milestone 1 的临时方案：低频、按需的轮询
 *
 * 不做"完整游戏阶段"的无条件轮询——只在等待大厅（WAITING 状态）使用。
 * 具体规则：
 * - 固定间隔轮询（默认 5 秒），调用云函数的 `getRoomState` action
 *   （服务端会用可信 uid 校验调用者是不是房间成员，非成员返回
 *   `NOT_MEMBER`，不会泄漏任何房间信息）。
 * - 页面进入后台（`document.visibilityState !== 'visible'`）时暂停轮询，
 *   回到前台时恢复，不在用户看不到的时候浪费云函数调用次数。
 * - 调用方（RoomProvider）负责在离开大厅/组件卸载时调用 `stop()`，
 *   轮询不会在后台无限期运行下去。
 *
 * 正式的实时同步方案（游戏进行中需要的低延迟更新）属于以后的设计范畴，
 * Milestone 1 不在这里一并解决——这里的轮询只是为了不牺牲数据库安全性
 * 而做的、等待大厅专用的过渡方案。
 */
import * as api from './api'
import type { GetRoomStateResult } from '../../../shared/api'

export interface RoomPollingCallbacks {
  onChange: (result: GetRoomStateResult) => void
  /** 轮询出错时触发（含 NOT_MEMBER 等业务错误），调用方决定如何处理 */
  onError: (error: unknown) => void
}

export interface RoomPollingHandle {
  /** 彻底停止轮询，不再恢复。离开大厅/组件卸载时必须调用。 */
  stop: () => void
}

const DEFAULT_INTERVAL_MS = 5000

/**
 * 开始轮询房间状态。返回的 handle 只有 `stop()`，暂停/恢复由本模块
 * 自己监听 `visibilitychange` 处理，调用方不需要关心。
 */
export function pollRoomState(
  roomId: string,
  callbacks: RoomPollingCallbacks,
  intervalMs = DEFAULT_INTERVAL_MS,
): RoomPollingHandle {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false

  async function tick() {
    if (stopped || document.visibilityState !== 'visible') {
      scheduleNext()
      return
    }
    if (inFlight) {
      // 避免网络慢的时候同一时刻叠加多个请求。
      scheduleNext()
      return
    }
    inFlight = true
    try {
      const result = await api.getRoomState(roomId)
      if (!stopped) callbacks.onChange(result)
    } catch (error) {
      if (!stopped) callbacks.onError(error)
    } finally {
      inFlight = false
      scheduleNext()
    }
  }

  function scheduleNext() {
    if (stopped) return
    timer = setTimeout(() => void tick(), intervalMs)
  }

  function handleVisibilityChange() {
    // 从后台恢复到前台时，立刻查一次，不用等到下一个整点间隔。
    if (document.visibilityState === 'visible' && !stopped && !inFlight) {
      if (timer) clearTimeout(timer)
      void tick()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  void tick()

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    },
  }
}
