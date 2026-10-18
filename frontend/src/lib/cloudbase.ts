/**
 * CloudBase Web SDK 初始化。
 *
 * 整个 App 只应该有一个 cloudbase app 实例、一次匿名登录。
 * 这里用模块级单例 + Promise 缓存做到这一点：无论多少个组件调用
 * `ensureAnonymousLogin()`，实际的网络请求只会发生一次。
 *
 * ## 重要教训：accessKey（Publishable Key）会污染 `getCurrentUser()` / `currentUser`
 *
 * 之前的版本用 `auth.getCurrentUser()` 判断"是否已经登录过、可以跳过
 * `signInAnonymously()`"，这是错的，已经通过反编译 js-sdk 3.10.2 的
 * 构建产物确认了根本原因：
 *
 * 1. `cloudbase.init({ accessKey })` 的 `App` 构造函数里会立即（同步）调用
 *    内部的 `setAccessKey()`，把 `scope: "accessKey"` 的凭证写进内存/本地存储，
 *    这个过程**不需要、也不会**调用 `signInAnonymously()`。
 * 2. 旧的 `getCurrentUser()`（v2 API，`core.d.ts` 里标了 `@deprecated`）
 *    内部通过 `getLoginState()` 判断"是否登录"，而 `getLoginState()`
 *    只要 `credentialsClient.getCredentialsAsync()` 返回任何*truthy*凭证就
 *    认为已登录——它**没有检查** `scope !== "accessKey"`。于是只要配置了
 *    `accessKey`，`getCurrentUser()` 会立刻返回一个"看起来已登录"的对象，
 *    但这个对象的字段（包括 `uid`）来自本地缓存里给 accessKey 场景保留的
 *    占位信息，不是真实匿名用户，这正是线上观察到 `uid: "anon"`、
 *    `isAnonymous: false` 的原因。
 * 3. 相比之下，v3 的 `getSession()` / `getUser()` 内部**明确做了**
 *    `scope !== "accessKey"` 的判断——`scope === "accessKey"` 时直接返回
 *    `{ data: { session: null, user: null }, error: null }`，不会把
 *    accessKey 凭证误判成登录态。这是本次修复改用 `getSession()`、
 *    完全不再调用 `getCurrentUser()` 的原因。
 *
 * 换句话说：**bug 不是"accessKey 本身有问题"，而是"用错了 API"**——
 * `getCurrentUser()` 是没有 accessKey 感知能力的旧接口，`getSession()` 才是
 * 官方为"accessKey 和真实登录需要区分"这个场景设计的正确判断方式。
 */
import cloudbase from '@cloudbase/js-sdk'

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID
const accessKey = import.meta.env.VITE_CLOUDBASE_ACCESS_KEY as string | undefined

if (!envId) {
  // 开发环境下尽早报错，比运行时某个深层调用莫名其妙失败要好排查。
  throw new Error(
    '缺少环境变量 VITE_CLOUDBASE_ENV_ID，请检查 frontend/.env.local（参考 .env.example）',
  )
}

/**
 * accessKey（Publishable Key）只授予"匿名用户的公共资源访问权限"，
 * 不代表已经登录、不会带来真实 uid。真正建立稳定身份仍然必须调用
 * `signInAnonymously()`；判断"是否已经登录"必须用 `getSession()`，
 * 不能用 `getCurrentUser()`（原因见上面的文件头注释）。
 * 这里如果配置了 accessKey 就传入，没配置也不影响匿名登录流程。
 */
export const app = cloudbase.init({
  env: envId,
  ...(accessKey ? { accessKey } : {}),
})

export const auth = app.auth()

/** 完整的身份状态，供测试页面展示用（不含 token/key 等敏感信息） */
export interface IdentityState {
  /** 是否存在真实 Session（accessKey 凭证不算） */
  hasSession: boolean
  /** 当前用户的 uid；没有真实 session 时为 null */
  uid: string | null
  /** 是否为匿名登录用户（来自 signInAnonymously，不是 accessKey） */
  isAnonymous: boolean
}

let loginPromise: Promise<string> | null = null

/**
 * 确保已经完成匿名登录，返回当前用户的 uid。
 *
 * - 如果本地已有*真实*登录态（刷新页面的情况，用 `getSession()` 判断，
 *   不是 `getCurrentUser()`），直接复用，不重复请求。
 * - 并发调用只会触发一次登录请求。
 */
export function ensureAnonymousLogin(): Promise<string> {
  if (!loginPromise) {
    loginPromise = doEnsureAnonymousLogin().catch((error: unknown) => {
      // 失败后清空缓存，允许下次调用重试，而不是永远返回同一个失败的 Promise。
      loginPromise = null
      throw error
    })
  }
  return loginPromise
}

async function doEnsureAnonymousLogin(): Promise<string> {
  const existing = await getIdentityState()
  if (existing.hasSession && existing.uid) {
    return existing.uid
  }

  // 成功前必须先检查 error，不能只看 data 是否存在。
  const { data, error } = await auth.signInAnonymously()
  if (error) {
    throw new Error(`匿名登录失败: ${error.message}`)
  }
  if (!data.user?.id || !data.session) {
    throw new Error('匿名登录返回了空的 user/session，无法确认登录成功')
  }
  return data.user.id
}

/**
 * 读取当前完整的身份状态（用 `getSession()`，不用 `getCurrentUser()`）。
 * 不抛错——查询失败时按"未登录"处理，调用方按 `hasSession` 分支即可。
 */
export async function getIdentityState(): Promise<IdentityState> {
  const { data, error } = await auth.getSession()
  if (error || !data.session || !data.user?.id) {
    return { hasSession: false, uid: null, isAnonymous: false }
  }
  return {
    hasSession: true,
    uid: data.user.id,
    isAnonymous: data.user.is_anonymous === true,
  }
}
