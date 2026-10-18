import { describe, expect, it } from 'vitest'
import { RoomError } from '../../../shared/errors'
import { resolveTrustedIdentity, type CompleteContextShape, type SCFContext } from '../../common/identity'

/**
 * 测试 `resolveTrustedIdentity`——hello 和 room 共用的身份解析规则。
 *
 * 不 mock CloudBase SDK 本身，只 mock `app.getCloudbaseContext` 这一个
 * 方法的返回值（它本来就是一个"读取环境变量/context，返回一个普通对象"的
 * 纯函数式接口），这样可以直接测试"给定不同的 TCB_UUID / LOGINTYPE /
 * TCB_ISANONYMOUS_USER 组合，解析结果应该是什么"，不需要真实的云函数运行时。
 */

const fakeContext: SCFContext = {
  memory_limit_in_mb: 128,
  time_limit_in_ms: 3000,
  request_id: 'req-1',
  function_version: '1',
  function_name: 'test',
  namespace: 'default',
}

function fakeApp(contextShape: CompleteContextShape) {
  return {
    getCloudbaseContext: (_context: SCFContext) => contextShape,
  }
}

describe('resolveTrustedIdentity', () => {
  it('场景 1：OAuth 上下文 + 可信真实 uid -> 认证通过', () => {
    // 这是线上实测会出现的真实情况：loginType 是 "OAuth"，但 uid 是真实的，
    // 不应该因为 loginType 不是 "ANONYMOUS" 就拒绝。
    const app = fakeApp({ TCB_UUID: 'real-user-uid-1', LOGINTYPE: 'OAuth' })
    const identity = resolveTrustedIdentity(app, fakeContext)
    expect(identity.uid).toBe('real-user-uid-1')
    expect(identity.authenticated).toBe(true)
    expect(identity.rawLoginType).toBe('OAuth')
  })

  it('场景 1b：OAuth 上下文 + TCB_ISANONYMOUS_USER=true -> 认证通过且确认是匿名登录', () => {
    const app = fakeApp({
      TCB_UUID: 'real-anon-uid',
      LOGINTYPE: 'OAuth',
      TCB_ISANONYMOUS_USER: 'true',
    })
    const identity = resolveTrustedIdentity(app, fakeContext)
    expect(identity.uid).toBe('real-anon-uid')
    expect(identity.isAnonymous).toBe(true)
  })

  it('场景 2：uid 等于固定公共占位身份 "anon" -> 拒绝，即使 loginType 看起来正常', () => {
    const app = fakeApp({ TCB_UUID: 'anon', LOGINTYPE: 'OAuth' })
    expect(() => resolveTrustedIdentity(app, fakeContext)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('场景 3：uid 缺失 -> 拒绝', () => {
    const app = fakeApp({ LOGINTYPE: 'OAuth' })
    expect(() => resolveTrustedIdentity(app, fakeContext)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('场景 3b：uid 为空字符串 -> 拒绝（空字符串也不算有效 uid）', () => {
    const app = fakeApp({ TCB_UUID: '', LOGINTYPE: 'OAuth' })
    expect(() => resolveTrustedIdentity(app, fakeContext)).toThrow(RoomError)
  })

  it('场景 4：非法身份上下文（没有任何可信字段）-> 拒绝', () => {
    const app = fakeApp({})
    expect(() => resolveTrustedIdentity(app, fakeContext)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('场景 5：客户端伪造的字段不会影响解析结果（resolveTrustedIdentity 根本不读 event）', () => {
    // resolveTrustedIdentity 的签名里完全没有 event 参数，这里用类型系统本身
    // 证明了"无法从 event 伪造身份"——这个测试更多是文档性的：确认真实身份
    // 只能来自 app.getCloudbaseContext(context) 这一个可信来源。
    const app = fakeApp({ TCB_UUID: 'real-user', LOGINTYPE: 'OAuth' })
    const identity = resolveTrustedIdentity(app, fakeContext)
    // 即使"假装"客户端在 event 里传了别的 uid，resolveTrustedIdentity 也不接受
    // 任何 event 参数，物理上不可能读到它。
    expect(identity.uid).toBe('real-user')
    expect(identity.uid).not.toBe('attacker-supplied-uid')
  })

  it('场景 6：两个不同真实 uid 的独立调用互不影响，各自返回正确的身份', () => {
    const appA = fakeApp({ TCB_UUID: 'user-a', LOGINTYPE: 'OAuth' })
    const appB = fakeApp({ TCB_UUID: 'user-b', LOGINTYPE: 'OAuth' })

    const identityA = resolveTrustedIdentity(appA, fakeContext)
    const identityB = resolveTrustedIdentity(appB, fakeContext)

    expect(identityA.uid).toBe('user-a')
    expect(identityB.uid).toBe('user-b')
    expect(identityA.uid).not.toBe(identityB.uid)
  })

  it('TCB_ISANONYMOUS_USER 缺失时 isAnonymous 为 false，但不代表"确认是实名用户"', () => {
    const app = fakeApp({ TCB_UUID: 'real-user', LOGINTYPE: 'EMAIL' })
    const identity = resolveTrustedIdentity(app, fakeContext)
    expect(identity.isAnonymous).toBe(false)
  })

  it('旧的 loginType === "ANONYMOUS" 假设不再是判断依据：ANONYMOUS 以外的值一样能通过认证', () => {
    for (const loginType of ['OAuth', 'EMAIL', 'CUSTOM', undefined]) {
      const app = fakeApp({ TCB_UUID: `uid-for-${String(loginType)}`, LOGINTYPE: loginType })
      expect(() => resolveTrustedIdentity(app, fakeContext)).not.toThrow()
    }
  })
})
