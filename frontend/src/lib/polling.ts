/**
 * 通用的低频轮询封装：固定间隔、页面进入后台时暂停、回到前台立刻补一次、
 * 同一时刻避免叠加多个请求。`roomPolling.ts`（旧模型，调用 room 云函数的
 * getRoomState）和阶段 B 的 `gameRoomPolling.ts`（新模型，直接查数据库）
 * 共用这一份轮询机制本身，只是各自传入不同的"查一次"函数。
 */
export interface PollingCallbacks<T> {
  onChange: (result: T) => void
  onError: (error: unknown) => void
}

export interface PollingHandle {
  /** 彻底停止轮询，不再恢复。离开页面/组件卸载时必须调用。 */
  stop: () => void
}

const DEFAULT_INTERVAL_MS = 5000

export function startPolling<T>(
  fetchOnce: () => Promise<T>,
  callbacks: PollingCallbacks<T>,
  intervalMs = DEFAULT_INTERVAL_MS,
): PollingHandle {
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
      const result = await fetchOnce()
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
