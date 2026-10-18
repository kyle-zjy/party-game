/**
 * 从云函数运行时的可信上下文中取出调用者身份。
 *
 * 绝对不能从 event（客户端传入的参数）里读 uid/playerId——
 * 这里统一在一个地方做这件事，所有 handler 都通过它获取身份，
 * 避免某个 handler 一不小心信任了客户端传来的字段。
 *
 * 实际的身份解析规则（为什么不能用 loginType 判断、新的判断方式等）
 * 由 hello 和 room 共用的 functions/common/identity.ts 实现，
 * 这里只是薄薄一层转发，确保两个云函数的身份校验规则完全一致。
 * 完整的调查过程（含线上日志证据）见该文件的注释和 docs/next-remote-steps.md。
 */
import { resolveTrustedIdentity, type SCFContext, type TrustedIdentity } from '../../../common/identity'
import { getApp } from './cloudbase-app'

export type { SCFContext }

/** 返回当前调用者的可信身份；无法确认身份时抛 RoomError('UNAUTHORIZED') */
export function getTrustedIdentity(context: SCFContext): TrustedIdentity {
  return resolveTrustedIdentity(getApp(), context)
}

/** 大多数 handler 只需要 uid，提供一个便捷封装 */
export function getTrustedUid(context: SCFContext): string {
  return getTrustedIdentity(context).uid
}
