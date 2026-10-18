/**
 * 统一的云函数响应包装，和 frontend/src/lib/api.ts 里的
 * `RoomFunctionResponse<T>` 类型保持一致。
 *
 * 安全原则：客户端永远只应该收到 `shared/errors.ts` 里定义好的安全错误码
 * 和对应的中文提示，**不应该看到任何原始异常文本**——不管这个异常是
 * `RoomError`（已经刻意区分了 message 和 internalDetail）还是其他任何
 * 意料之外的异常（比如 SDK 内部抛出的、没有被 `db-errors.ts` 包装过的错误）。
 * 完整的诊断信息只进服务端日志（`console.error`，`tcb logs search` 能查到）。
 */
import { RoomError } from '../../../../shared/errors'

export interface OkResponse<T> {
  ok: true
  data: T
}

export interface ErrResponse {
  ok: false
  error: { code: string; message: string }
}

export function ok<T>(data: T): OkResponse<T> {
  return { ok: true, data }
}

export function err(error: unknown): ErrResponse {
  if (error instanceof RoomError) {
    // RoomError.toApiError() 只序列化 code/message，不含 internalDetail，
    // 本身已经是客户端安全的形状。但如果这个 RoomError 带了诊断细节
    // （比如 db-errors.ts 产生的），也顺手记一条日志，方便从这次调用的
    // 日志里直接看到，不用跳到另一次 console.error 输出去找。
    if (error.internalDetail) {
      console.error(`[room-error] ${error.code}: ${error.internalDetail}`)
    }
    return { ok: false, error: error.toApiError() }
  }

  // 任何不是 RoomError 的异常都是"没有被正确分类"的意外情况——
  // 完整内容只打日志，绝不把原始 message 发给客户端。
  const rawMessage = error instanceof Error ? error.message : String(error)
  console.error(`[unexpected-error] ${rawMessage}`)
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试' } }
}
