/**
 * 统一错误码。云函数失败时返回 `{ error: { code, message } }`，
 * 前端只根据 code 做分支判断，message 仅用于日志/调试展示。
 */
export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_NOT_WAITING'
  | 'ROOM_STALE'
  | 'NOT_HOST'
  | 'NOT_MEMBER'
  | 'NOT_ENOUGH_PLAYERS'
  | 'INVALID_NICKNAME'
  | 'NICKNAME_TAKEN'
  | 'INVALID_ROOM_CODE'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'
  | 'NOT_YOUR_TURN'
  | 'INVALID_GAME_ACTION'
  | 'GAME_NOT_STARTED'

export interface ApiError {
  code: ErrorCode
  message: string
}

export class RoomError extends Error {
  code: ErrorCode
  /**
   * 仅供服务端日志使用的诊断细节（比如底层数据库异常的原始文本），
   * **绝不会**出现在 `toApiError()` 的返回值里，不会发给客户端。
   * 用于"服务端知道具体哪里错了，客户端只知道一个安全的错误码+提示"
   * 这种场景——见 functions/room/src/lib/db-errors.ts 的 wrapDbError。
   */
  internalDetail?: string

  constructor(code: ErrorCode, message?: string, internalDetail?: string) {
    super(message ?? code)
    this.code = code
    this.name = 'RoomError'
    this.internalDetail = internalDetail
  }

  /** 发给客户端的安全形状：只有 code 和（已经是中文安全提示的）message，不含 internalDetail */
  toApiError(): ApiError {
    return { code: this.code, message: this.message }
  }
}

/** 中文提示文案，前端按 code 查表展示，而不是直接显示英文 message */
export const ERROR_MESSAGES_ZH: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: '房间不存在',
  ROOM_FULL: '房间已满',
  ROOM_NOT_WAITING: '房间已经开始或已关闭',
  ROOM_STALE: '房间已过期',
  NOT_HOST: '只有房主可以执行该操作',
  NOT_MEMBER: '你还不是这个房间的成员',
  NOT_ENOUGH_PLAYERS: '人数不足，至少需要 3 名玩家',
  INVALID_NICKNAME: '昵称不合法（1-12 个字符）',
  NICKNAME_TAKEN: '昵称已被使用',
  INVALID_ROOM_CODE: '房间码格式不正确',
  CONFLICT: '操作冲突，请重试',
  UNAUTHORIZED: '未登录或登录已失效',
  INTERNAL_ERROR: '服务器内部错误',
  NOT_YOUR_TURN: '还没轮到你',
  INVALID_GAME_ACTION: '当前阶段不能执行这个操作',
  GAME_NOT_STARTED: '游戏还没有开始',
}

/**
 * Phase C.1 修复：把任意 `catch (err)` 捕获到的值安全地转成一句中文提示。
 *
 * ## 这是在修复什么真实 bug
 *
 * 之前几乎每个页面/hook 里都是各自写一遍
 * `err instanceof Error ? err.message : String(err)`。这段代码本身没有
 * 类型错误，但有一个被真实踩到的行为缺陷：**`String()` 作用在一个
 * "看起来像对象但不是 `Error` 实例"的值上时，会产出字面量字符串
 * `"[object Object]"`**（`String({code:'x',message:'y'})` 的结果就是
 * `"[object Object]"`，这是 JS 规范行为，不是 bug，但对用户来说毫无意义）。
 *
 * 真实会走到这个分支的场景（已经在 `@cloudbase/js-sdk@3.10.2` 的
 * database 模块源码里确认过，不是假设）：
 * - `frontend/src/lib/gameRoomDb.ts` / `frontend/src/lib/gameEngineDb.ts`
 *   里的 `getRoomById`/`getRoomByCode`/`updateRoomWithVersion` 直接
 *   `await db().collection(...).get()/.update()`，**没有包 try/catch**。
 *   SDK 内部 `errorToResult()`（`utilities/dist/cjs/libs/util.js`）的实现
 *   显示：请求失败时既可能 reject 一个 `CloudbaseError`（继承自 `Error`，
 *   不会触发这个 bug），也可能在更底层的网关/权限校验失败时 reject 一个
 *   `{code, message}` 形状的**纯对象**（不继承 `Error`）——后一种情况下，
 *   旧代码的 `String(err)` 就会变成 `"[object Object]"`，而这个对象其实
 *   带着有用的 `code`/`message` 字段，只是没有被正确提取。
 * - `shared/game/engine/turnEngine.ts` 的 `GameActionError` 也不是
 *   `RoomError`（虽然它 `extends Error`，理论上不会触发这个 bug，但
 *   `useGameController.ts` 之前的 `describeError` 对它的处理路径和这个
 *   新函数统一到一起，减少以后再出现类似遗漏的可能）。
 *
 * ## 处理策略
 *
 * 1. `RoomError`：按 `ERROR_MESSAGES_ZH` 查表（已有行为，不变）。
 * 2. 任何对象形状是 `{code, message}`（不管是不是 `Error` 实例，这正是
 *    上面分析的 CloudBase 原始拒绝对象的形状）：优先用 `code` 查
 *    `ERROR_MESSAGES_ZH`（如果 `code` 恰好命中已知错误码），否则直接展示
 *    `message` 字段本身（已经是人类可读的文本，不是 `[object Object]`）。
 * 3. `Error` 实例：用 `.message`（已有行为）。
 * 4. 字符串：原样返回。
 * 5. 其余任何情况（包括真的拿不到任何可读字段的纯对象）：返回一句固定的
 *    "发生未知错误" 提示，**不再调用 `String()`**，从根上避免
 *    `[object Object]` 出现在界面上。
 *
 * 开发环境下（`import.meta.env.DEV`）额外用 `console.error` 把原始错误
 * 对象完整打到控制台，保留完整诊断信息，不会因为这层"安全转文字"而丢失
 * 排查线索——调用方应该在 catch 块里自己决定是否要打 `console.error`，
 * 这个函数本身只负责"产出一句人能看懂的话"，不耦合日志策略。
 */
export function describeUnknownError(err: unknown): string {
  if (err instanceof RoomError) {
    return ERROR_MESSAGES_ZH[err.code] ?? err.message
  }
  if (err instanceof Error) {
    return err.message || '发生未知错误'
  }
  if (typeof err === 'string') {
    return err
  }
  if (err && typeof err === 'object') {
    const code = 'code' in err ? (err as { code: unknown }).code : undefined
    const message = 'message' in err ? (err as { message: unknown }).message : undefined
    if (typeof code === 'string' && code in ERROR_MESSAGES_ZH) {
      return ERROR_MESSAGES_ZH[code as ErrorCode]
    }
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
    if (typeof code === 'string' && code.length > 0) {
      return `错误（${code}）`
    }
  }
  return '发生未知错误，请重试'
}
