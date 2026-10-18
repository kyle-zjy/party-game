/**
 * hello 云函数 —— Phase A 的连通性测试函数。
 *
 * 目的：验证"前端 SDK 初始化 + 匿名登录 + callFunction + 服务端读取可信身份"
 * 这条链路全部打通。不承载任何业务逻辑。
 *
 * 身份解析规则和 room 云函数共用同一套实现（functions/common/identity.ts），
 * 完整的调查过程（含线上日志证据：loginType 实测返回过 "OAuth" 而不是
 * "ANONYMOUS"）记录在该文件的注释和 docs/next-remote-steps.md 里，
 * 这里不重复一遍，只说明这个函数自己的返回形状。
 *
 * 返回形状的设计原则：不伪造 `isAnonymous: true`。只有当
 * `TCB_ISANONYMOUS_USER` 这个字段明确等于 `"true"` 时才返回
 * `isAnonymous: true`；其余情况（字段缺失、或明确是实名登录）一律
 * `isAnonymous: false`，并把 `authenticated: true` 和原始
 * `serverLoginType` 暴露出来，方便从测试页面上直接看到服务端实际解析到
 * 的信息，而不是一个二选一的武断判断。
 */
import cloudbase from '@cloudbase/js-sdk'
import { resolveTrustedIdentity, type SCFContext } from '../../common/identity'

interface HelloResult {
  message: string
  uid: string
  authenticated: true
  isAnonymous: boolean
  /** 服务端实际解析到的原始 loginType，仅供调试展示，不代表任何安全判断 */
  serverLoginType: string | undefined
  requestTime: number
}

export const main = async (_event: unknown, context: SCFContext): Promise<HelloResult> => {
  // 不传 env：在云函数里会自动使用当前函数所在的环境，不需要写死 envId。
  //
  // 注意：这里故意不把 SCF 的 context 传给 cloudbase.init()——
  // js-sdk 的 ICloudbaseConfig.context 类型是 functions-framework 风格
  // （要求 eventID 字段），和经典 SCF 的 context（memory_limit_in_mb/request_id 等）
  // 形状不兼容。详见 docs/next-remote-steps.md 的记录。
  const app = cloudbase.init({})

  // resolveTrustedIdentity 内部会在身份无法确认时直接抛 RoomError('UNAUTHORIZED')，
  // 不需要这里再额外判断——不读 event.uid，不用任何固定值兜底。
  const identity = resolveTrustedIdentity(app, context)

  return {
    message: 'hello from CloudBase',
    uid: identity.uid,
    authenticated: true,
    isAnonymous: identity.isAnonymous,
    serverLoginType: identity.rawLoginType,
    requestTime: Date.now(),
  }
}
