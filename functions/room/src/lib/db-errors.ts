/**
 * 数据库异常的统一处理。
 *
 * ## 背景：`doc(id).get()` 对"文档不存在"的处理方式没有在当前 SDK 版本下确认过
 *
 * 调查过程（不是凭空假设）：
 * - CloudBase 文档型数据库的 HTTP API 文档明确写了：单文档查询接口
 *   （Get Single Document）在文档不存在时返回 `404 DOCUMENT_NOT_FOUND`。
 * - 微信小程序云开发的 `wx-server-sdk`（和 CloudBase 同源的技术栈）文档
 *   写明 `doc().get()` 默认在查不到记录时**抛出异常**，有一个
 *   `throwOnNotFound`（默认 `true`）配置项可以改成返回空结果而不抛异常。
 * - 但 `@cloudbase/js-sdk@3.10.2` 的类型声明里**没有找到** `throwOnNotFound`
 *   这个配置项，也没有在反编译结果里找到对应的处理逻辑；`GetRes` 类型本身
 *   又同时声明了 `data: any[]`（暗示"查不到就是空数组"）和可选的
 *   `code?`/`message?`（暗示"也可能带错误码地成功 resolve"）。
 * - 结论：**本项目无法确认 `@cloudbase/js-sdk@3.10.2` 的
 *   `collection.doc(id).get()` 在文档不存在时，是 resolve 一个空
 *   `data` 数组，还是 reject 一个异常。** 这是本地环境完全无法验证的，
 *   需要部署后用一个确定不存在的 `roomId` 实测确认（见
 *   docs/next-remote-steps.md）。
 *
 * ## 这里的处理策略（在上述不确定性下选择的保守方案）
 *
 * `getDocOrNull` 包一层 try/catch：
 * - 正常 resolve：按 `res.data[0]` 是否存在判断（已有逻辑，覆盖"resolve
 *   空数组"这种可能性）。
 * - 抛出异常：检查错误信息里是否有"文档不存在"类的信号
 *   （`DOCUMENT_NOT_FOUND`、`not found`、`404` 等关键词，这些关键词来自
 *   CloudBase HTTP API 文档和通用错误码文档，不是瞎猜）。如果匹配，
 *   按"文档不存在"处理，返回 `null`。
 * - 如果异常看起来不是"文档不存在"（比如没有任何这些关键词），
 *   **不会**被当成"不存在"而悄悄吞掉——会重新包装成
 *   `RoomError('INTERNAL_ERROR', ...)` 向上抛出。这样做是为了避免一个更危险
 *   的后果：如果把所有数据库异常都当成"文档不存在"处理，一次权限配置错误
 *   或者网络故障会让所有房间看起来像是"不存在"，而不是明确报错，
 *   排查起来会更难、也可能被误以为是正常的业务状态。
 *
 * 这个关键词匹配是**启发式的、未经真实环境验证的**，不是对 SDK 行为的
 * 确定性保证。如果部署后发现真实错误信息里有其他措辞，需要回来扩充
 * `NOT_FOUND_SIGNALS` 这个列表。
 *
 * ## 客户端不应该看到数据库异常的原始内容
 *
 * 早期实现把 `wrapDbError` 生成的详细信息（含原始 SDK 错误文本）直接放进
 * `RoomError.message`，而 `RoomError.message` 会经 `toApiError()` 原样
 * 发给客户端——这意味着一次 `INVALID_CREDENTIALS` 之类的内部凭证问题，
 * 会被客户端在网络请求里完整看到。这不是故意设计的信息泄露，但确实不应该
 * 让客户端看到任何数据库层面的实现细节（哪怕只是错误文案）。
 *
 * 现在的做法：`wrapDbError` 用 `console.error` 把完整诊断信息（调用上下文 +
 * 原始错误文本）打到云函数自己的日志里（`tcb logs search` 能查到，
 * `src=app`），`RoomError` 发给客户端的 `message` 只是一句固定的、
 * 不含任何实现细节的中文提示，完整细节放进 `internalDetail` 字段
 * （`RoomError.toApiError()` 不会序列化这个字段，见 shared/errors.ts）。
 */
import { RoomError } from '../../../../shared/errors'

const NOT_FOUND_SIGNALS = ['DOCUMENT_NOT_FOUND', 'not found', 'NOT_FOUND', '404']

function looksLikeNotFound(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return NOT_FOUND_SIGNALS.some((signal) => text.includes(signal))
}

/**
 * 执行一次"按 ID 查单个文档"的操作，统一处理"文档不存在"和"真实数据库异常"
 * 两种情况。`run` 应该是 `() => collection.doc(id).get()` 这样的调用。
 *
 * @param extractDoc 从 resolve 的结果里取出文档（resolve-but-empty 的情况）
 */
export async function getDocOrNull<TRes, TDoc>(
  run: () => Promise<TRes>,
  extractDoc: (res: TRes) => TDoc | undefined,
  context: string,
): Promise<TDoc | null> {
  let res: TRes
  try {
    res = await run()
  } catch (error) {
    if (looksLikeNotFound(error)) {
      return null
    }
    throw wrapDbError(error, context)
  }
  return extractDoc(res) ?? null
}

/**
 * 把"看起来是真实数据库异常"的错误统一包装成 RoomError。
 *
 * 完整诊断信息（调用上下文 + 原始错误）只进服务端日志
 * （`console.error`，可以用 `tcb logs search --query 'function_name:"room"
 * AND src:app'` 查到），绝不放进会发给客户端的 `message` 里。
 */
export function wrapDbError(error: unknown, context: string): RoomError {
  const message = error instanceof Error ? error.message : String(error)
  const detail = `数据库操作失败（${context}）：${message}`
  console.error(`[db-error] ${detail}`)
  return new RoomError('INTERNAL_ERROR', '服务器内部错误，请稍后重试', detail)
}
