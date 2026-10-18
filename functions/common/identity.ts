/**
 * 云函数通用的可信身份解析——hello 和 room 共用同一套规则，
 * 确保两个函数的"什么算已认证"判断完全一致，不会各写一套互相矛盾的逻辑。
 *
 * ## 背景：为什么不能用 loginType === 'ANONYMOUS'（真实踩过的坑，已用线上日志验证）
 *
 * 之前的实现用 `getAuthContext(context).loginType === 'ANONYMOUS'` 判断
 * "是否是合法的匿名登录"。部署后的真实 CloudBase 运行日志显示：
 * 前端已经成功调用 `signInAnonymously()`、`getSession()` 返回了真实
 * session、uid 不再是固定值——但服务端收到的 `loginType` 是 `"OAuth"`，
 * 不是 `"ANONYMOUS"`，导致合法用户被误判为未授权。
 *
 * 结合这些事实（查阅 CloudBase Authentication v2 相关文档确认）：
 * - CloudBase Authentication v2 把包括匿名登录在内的所有登录方式统一到了
 *   基于 provider 的架构下（`ProviderType` 有 `OAUTH`/`OIDC`/`SAML`/
 *   `CUSTOM`/`EMAIL` 等），`signInAnonymously()` 底层可能被实现成走
 *   OAuth 风格的 provider token 流程。
 * - `getAuthContext()`/`auth.getAuthContext(context)` 返回的 `loginType`
 *   字段是旧版（v1）`LoginType` 枚举（`NULL`/`ANONYMOUS`/`WECHAT`/...），
 *   这个字段在 v2 架构下的真实取值未必还是那几个旧枚举值——线上日志证明
 *   它可以是 `"OAuth"`，这不是文档能查到的、而是生产环境实测的事实。
 *
 * **结论：`loginType` 不能作为"请求是否已认证"的判断依据，也不能用来
 * 可靠地判断"是否匿名"。** 本文件不再使用它做任何安全判断。
 *
 * ## 新的可信身份规则
 *
 * 1. **是否已认证**：只看 `uid` 是否存在、非空、且不等于公开占位身份
 *    `"anon"`。`uid` 来自 `getCloudbaseContext()` 解析出的 `TCB_UUID`，
 *    这是 CloudBase 运行时/网关注入的、不受 event 参数影响的字段——
 *    这是本项目能找到的、唯一有服务端文档和代码依据的可信身份来源。
 *    "`uid` 为什么可信"这件事本身仍然依赖上一轮调查确认的两点：
 *    (a) 两个云函数都是 Event 类型，官方文档确认默认单实例单并发，
 *        不存在同一时刻两个请求互相读到对方身份的竞态；
 *    (b) `TCB_UUID` 是否逐请求被网关正确刷新（而不是被实例复用污染）
 *        没有找到官方逐字确认，这一点仍然是"尚未验证"的风险，
 *        见 docs/next-remote-steps.md。
 * 2. **是否匿名登录**：改读 `TCB_ISANONYMOUS_USER` 这个专门字段（反编译
 *    `@cloudbase/js-sdk@3.10.2` 确认：Node 运行时的 `getUserInfo()` 内部
 *    就是用 `"true" === TCB_ISANONYMOUS_USER` 判断匿名的，而不是看
 *    `LOGINTYPE`）。这个字段不在 `getAuthContext()` 的返回值里
 *    （`INodeAuthContext` 类型只有 `uid`/`loginType`/`appId`/`openId`），
 *    所以本文件改用 `app.getCloudbaseContext(context)` 直接读取完整的
 *    `ICompleteCloudbaseContext`，拿到这个字段。
 * 3. **"无法可靠判断匿名登录类型时不伪造 `isAnonymous: true`"**：
 *    `TCB_ISANONYMOUS_USER` 缺失（`undefined`）时，`isAnonymous` 返回
 *    `false`，而不是假设"没有这个字段就默认不匿名所以安全"——调用方
 *    应该把 `isAnonymous` 当作"目前能确认是匿名" vs
 *    "不能确认是匿名"（包含真匿名但字段缺失、以及真的是实名登录两种情况），
 *    不要把 `false` 直接理解成"这是实名用户"。
 * 4. **固定公共身份 `"anon"` 的拒绝**：CloudBase 文档里有一个专门概念——
 *    Publishable Key 对应一个固定的公共 `"anon"` 角色（这是 PG 鉴权文档里
 *    的说法，概念上和 Web SDK 的 Publishable Key 是一回事：不代表真实
 *    登录、不带用户信息）。即使某个未来的 SDK 版本/配置下，这个固定身份
 *    的字符串真的被写进了 `TCB_UUID`，这里也要显式拒绝，不能让它冒充
 *    成一个合法用户的 uid。
 */
import { RoomError } from '../../shared/errors'

export interface SCFContext {
  memory_limit_in_mb: number
  time_limit_in_ms: number
  request_id: string
  environ?: string
  environment?: string
  function_version: string
  function_name: string
  namespace: string
}

/** 公开、固定、不代表真实用户的占位身份字符串，绝不能当作合法 uid 接受 */
const PUBLIC_PLACEHOLDER_UID = 'anon'

export interface TrustedIdentity {
  uid: string
  authenticated: true
  /**
   * 目前能否确认这是匿名登录创建的身份。
   * `true`：已确认是匿名登录（TCB_ISANONYMOUS_USER === "true"）。
   * `false`：**不能**确认是匿名登录——可能是实名登录，也可能是这个字段
   * 缺失导致无法判断，调用方不能把 `false` 当成"确定是实名用户"。
   */
  isAnonymous: boolean
  /**
   * 原始 loginType，仅用于日志/调试展示，不能用它做任何授权判断
   * （见文件头注释——线上已经证明这个字段的取值不可预测，比如 "OAuth"）。
   */
  rawLoginType: string | undefined
}

/**
 * 解析当前调用者的可信身份。无法确认身份（uid 缺失、或等于固定公共占位
 * 身份 "anon"）时抛 RoomError('UNAUTHORIZED', ...)，调用方不需要、
 * 也不应该再做额外的"要不要信任"判断。
 *
 * @param getApp 返回当前云函数的 CloudBase app 单例（各函数自己的懒加载
 *   实现不同，这里不替调用方管理单例生命周期，由调用方传入）
 */
export function resolveTrustedIdentity(
  app: { getCloudbaseContext: (context: SCFContext) => CompleteContextShape },
  context: SCFContext,
): TrustedIdentity {
  const full = app.getCloudbaseContext(context)
  const uid = full.TCB_UUID

  if (!uid) {
    throw new RoomError('UNAUTHORIZED', '无法从可信上下文中获取 uid，调用者可能未登录')
  }
  if (uid === PUBLIC_PLACEHOLDER_UID) {
    throw new RoomError(
      'UNAUTHORIZED',
      '调用者使用的是公共占位身份（Publishable Key 的固定 anon 身份），不是真实已认证用户',
    )
  }

  return {
    uid,
    authenticated: true,
    isAnonymous: full.TCB_ISANONYMOUS_USER === 'true',
    rawLoginType: full.LOGINTYPE,
  }
}

/**
 * `getCloudbaseContext()` 完整返回值里本文件实际用到的字段。
 * 不用 SDK 自带的 `ICompleteCloudbaseContext` 类型，是因为那个类型
 * 声明在 `core.node.d.ts` 里，而 `shared/`、`functions/common/` 这类
 * 跨函数共享的文件不方便假设调用方一定装了特定版本的 js-sdk 类型——
 * 这里只声明用得到的两个字段，调用方传入的 `app.getCloudbaseContext`
 * 实际返回值是 SDK 的 `ICompleteCloudbaseContext`，字段上是兼容的。
 */
export interface CompleteContextShape {
  TCB_UUID?: string
  TCB_ISANONYMOUS_USER?: string
  LOGINTYPE?: string
}
