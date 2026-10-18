/**
 * 云函数内唯一的 CloudBase app 实例，懒加载单例。
 *
 * 两个原因要集中在这里，而不是让 db.ts / auth-context.ts 各自调用
 * `cloudbase.init(...)`：
 * 1. 避免创建多个 app 实例。
 * 2. `cloudbase.init(...)` 在不是真正云函数运行时的环境下（没有
 *    TCB_ENV 等环境变量）会直接抛错（实测报 `env must not be specified`）。
 *    懒加载意味着只要不实际调用数据库/鉴权相关方法，
 *    单纯 import 这几个模块（比如测试只 import 纯规则函数）不会触发这个报错。
 *
 * ## 根因记录（第一轮）：为什么不能只写 `cloudbase.init({})`
 *
 * 部署后 `createRoom` 真实报错：
 * ```
 * 数据库操作失败（getRoomByCode）：INVALID_CREDENTIALS Credentials are invalid.
 * ```
 * 反编译 `@cloudbase/js-sdk@3.10.2` 的 `getSecretInfo()` 实现（SDK 内部
 * 决定"这次请求用什么身份签名"的函数）确认了完整的优先级链：
 *
 * 1. `init({ accessKey })` 显式传入的 accessKey
 * 2. `init({ secretId, secretKey })` 显式传入
 * 3. `init({ auth: { secretId, secretKey } })` 显式传入
 * 4. **`process.env.CLOUDBASE_APIKEY`**（环境变量，如果存在）
 * 5. `process.env.TENCENTCLOUD_SECRETID` + `TENCENTCLOUD_SECRETKEY`
 *    （+ 可选 `TENCENTCLOUD_SESSIONTOKEN`）——这是 Event 云函数官方文档
 *    里说的"自动注入的管理员临时凭证"
 * 6. `context.extendedContext.tmpSecret`（functions-framework 风格）
 * 7. 否则：空凭证
 *
 * 第 4 条（`CLOUDBASE_APIKEY`）的优先级高于第 5 条——如果运行时环境里
 * 存在 `CLOUDBASE_APIKEY`，SDK 会无条件用它构造请求（accessKey/
 * Publishable Key 风格鉴权，只有匿名用户权限），完全不会走到第 5 条的
 * 管理员凭证分支。本项目的修复：显式把 `TENCENTCLOUD_SECRETID`/
 * `SECRETKEY`/`SESSIONTOKEN` 传给 `cloudbase.init()`，利用优先级第 2 条
 * 压过第 4 条。
 *
 * ## 根因排查（第二轮，仍在进行）：修复后 devDbHealthCheck 仍返回 false
 *
 * 显式传凭证部署后，`devDbHealthCheck` 返回 `{ dbConnected: false }`，
 * 但当时没有记录足够的诊断信息来确认具体是哪一步失败——这是本轮要补的：
 * `getDiagnosticSnapshot()` 记录"当前凭证来源"和"环境变量布尔存在性"，
 * `checkDbConnectivity`（见 db.ts）记录完整的异常信息（经过脱敏）。
 *
 * 同时排查到一个新的潜在风险点（真实反编译确认，不是推测）：显式传入
 * `secretId`/`secretKey` 后，Node 环境下给请求签名实际依赖
 * `@cloudbase/signature-nodejs` 这个包（SDK 通过 `optionalRequire()`
 * 按需加载，加载失败时不抛异常，只打印一行安装提示，把签名函数设为
 * `null`）。这个包在 `@cloudbase/js-sdk` 自己的 `package.json` 里是
 * **`optionalDependencies`**，如果 CloudBase 云端 `installDependency: true`
 * 的 npm 安装跳过了可选依赖，这个包可能没有被装上。处理方式：
 * `build.mjs` 现在把它显式声明进 `dist/package.json` 的 `dependencies`，
 * 不再依赖"作为 js-sdk 的可选依赖被动装上"。详见 build.mjs 的注释。
 *
 * **这件事本身是否是 dbConnected: false 的真正原因，还没有confirmed**——
 * 需要部署这一轮修复后，看 `getDiagnosticSnapshot()` 记录的
 * `error.code`/`error.message` 具体是什么，才能确认。
 */
import cloudbase from '@cloudbase/js-sdk'

let appInstance: ReturnType<typeof cloudbase.init> | null = null

/** 当前 SDK 实际会采用的凭证来源——只是名称，不含任何凭证值 */
export type CredentialSource =
  | 'TENCENTCLOUD_SECRETID_SECRETKEY_ENV'
  | 'CLOUDBASE_DEFAULT_INIT_EMPTY'

let resolvedCredentialSource: CredentialSource | null = null

export function getApp(): ReturnType<typeof cloudbase.init> {
  if (!appInstance) {
    const secretId = process.env.TENCENTCLOUD_SECRETID
    const secretKey = process.env.TENCENTCLOUD_SECRETKEY
    const sessionToken = process.env.TENCENTCLOUD_SESSIONTOKEN

    // 显式传入管理员临时凭证，压过优先级更高但权限不足的 CLOUDBASE_APIKEY
    // （如果存在的话）。不传 env：云函数运行时会自动使用当前函数所在的环境。
    if (secretId && secretKey) {
      appInstance = cloudbase.init({ secretId, secretKey, sessionToken })
      resolvedCredentialSource = 'TENCENTCLOUD_SECRETID_SECRETKEY_ENV'
    } else {
      appInstance = cloudbase.init({})
      resolvedCredentialSource = 'CLOUDBASE_DEFAULT_INIT_EMPTY'
    }
  }
  return appInstance
}

export interface CredentialEnvPresence {
  hasTencentCloudSecretId: boolean
  hasTencentCloudSecretKey: boolean
  hasTencentCloudSessionToken: boolean
  hasCloudbaseApiKey: boolean
}

/**
 * 仅供内部诊断使用：返回"管理员临时凭证环境变量是否存在"的布尔值，
 * 不返回任何密钥的实际内容。
 */
export function getCredentialEnvPresence(): CredentialEnvPresence {
  return {
    hasTencentCloudSecretId: Boolean(process.env.TENCENTCLOUD_SECRETID),
    hasTencentCloudSecretKey: Boolean(process.env.TENCENTCLOUD_SECRETKEY),
    hasTencentCloudSessionToken: Boolean(process.env.TENCENTCLOUD_SESSIONTOKEN),
    hasCloudbaseApiKey: Boolean(process.env.CLOUDBASE_APIKEY),
  }
}

/**
 * 当前 `getApp()` 实际选用的凭证来源名称（不是凭证本身）。
 * 必须先调用过一次 `getApp()`（任何数据库操作都会触发）才有值；
 * 懒加载之前返回 `null`，不代表"没有凭证"，只代表"还没初始化过"。
 */
export function getResolvedCredentialSource(): CredentialSource | null {
  return resolvedCredentialSource
}
