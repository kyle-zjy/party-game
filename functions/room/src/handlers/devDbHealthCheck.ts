/**
 * devDbHealthCheck：仅供开发诊断使用的数据库连通性检查。
 *
 * 用途：部署后快速确认"云函数能否用当前凭证正常访问 ADMINONLY 的数据库
 * 集合"，不需要走完整的创建房间流程就能定位是不是鉴权问题
 * （比如本轮修复的 CLOUDBASE_APIKEY 优先级问题）。
 *
 * 安全约束（全部满足）：
 * - 调用者必须已通过身份校验——这个 action 和其他 action 一样，
 *   `uid` 由 index.ts 在 dispatch 之前统一通过 `getTrustedUid(context)`
 *   解析，无法绕过（没有走身份校验就调不到这个 handler）。
 * - 只读：`checkDbConnectivity` 内部用 `.count()`，不读取任何文档内容，
 *   不创建、不修改、不删除任何数据。
 * - 不返回私人数据：返回值只有一个布尔值 `dbConnected`。
 * - 不返回任何密钥：具体失败原因只写服务端日志
 *   （`tcb logs search --query 'function_name:"room" AND src:app'`），
 *   不会出现在返回给客户端的结果里。
 */
import type { DevDbHealthCheckResult } from '../../../../shared/api'
import { checkDbConnectivity } from '../lib/db'

export async function devDbHealthCheck(): Promise<DevDbHealthCheckResult> {
  const result = await checkDbConnectivity()
  return { dbConnected: result.ok }
}
