# CloudBase 接入说明

## SDK 版本

前端和云函数统一使用 **`@cloudbase/js-sdk@3.10.2`**（pin 死的精确版本，不是
`^3.10.2`），不使用 `@cloudbase/node-sdk`——后者官方已经不再维护，4.x 完全基于
`@cloudbase/js-sdk` 重写，官方文档明确建议直接用 `@cloudbase/js-sdk` v3。

不使用 alpha/beta/rc 版本。

## 前端初始化（`frontend/src/lib/cloudbase.ts`）

```ts
import cloudbase from '@cloudbase/js-sdk'

export const app = cloudbase.init({
  env: import.meta.env.VITE_CLOUDBASE_ENV_ID,
  accessKey: import.meta.env.VITE_CLOUDBASE_ACCESS_KEY, // 可选
})
```

- `accessKey`（Publishable Key）**不是**登录态，它只是一个"可以安全暴露在浏览器里
  的匿名资源访问凭证"，不带任何用户身份信息。即使配置了它，仍然需要调用
  `auth.signInAnonymously()` 才能拿到稳定的 `uid`。两者是互补关系，不是互斥选项。
- 真正建立身份用的是 `ensureAnonymousLogin()`：先用 `getSession()` 判断
  本地是否已有*真实*登录态（刷新页面场景），没有的话才调用 `signInAnonymously()`。
  用 Promise 缓存确保并发调用只触发一次登录请求。

  **⚠️ 不要用 `auth.getCurrentUser()` 判断是否已登录**——这是本项目踩过的
  一个真实的坑（部署 `hello` 后实测发现 `uid` 固定返回 `"anon"`，
  `isAnonymous: false`）。根本原因（已通过反编译 js-sdk 3.10.2 的构建产物
  确认，不是猜测）：
  1. `cloudbase.init({ accessKey })` 的 `App` 构造函数里会**同步**调用内部的
     `setAccessKey()`，把 `scope: "accessKey"` 的凭证写进内存，这个过程
     完全不需要、也不会触发 `signInAnonymously()`。
  2. 旧版 `getCurrentUser()`（`core.d.ts` 标了 `@deprecated`）内部通过
     `getLoginState()` 判断"是否登录"，而 `getLoginState()` 只要
     `credentialsClient.getCredentialsAsync()` 返回任何 truthy 凭证就认为
     已登录——**没有检查 `scope !== "accessKey"`**。于是配置了 `accessKey`
     后，`getCurrentUser()` 会立刻返回一个"看起来已登录"的对象，其中的
     `uid` 等字段来自本地缓存给 accessKey 场景保留的占位信息，不是真实
     匿名用户。
  3. v3 的 `getSession()` / `getUser()` **明确做了** `scope !== "accessKey"`
     的判断：`scope === "accessKey"` 时直接返回
     `{ data: { session: null, user: null }, error: null }`，正确地不把
     accessKey 凭证当作登录态。

  结论：bug 不是 "accessKey 配置错误"，而是**用错了判断登录状态的 API**。
  修复方式是把所有"是否已登录"的判断都从 `getCurrentUser()` 换成
  `getSession()`，完整实现见 `frontend/src/lib/cloudbase.ts` 的
  `getIdentityState()`。

## 云函数里获取可信身份

**不要**用 `event` 里客户端传来的任何字段作身份依据。正确做法（实现在
`functions/common/identity.ts`，hello 和 room 共用同一份）：

```ts
import cloudbase from '@cloudbase/js-sdk'

export const main = async (event, context) => {
  const app = cloudbase.init({}) // 不传 env，云函数运行时自动用当前环境
  const full = app.getCloudbaseContext(context)

  const uid = full.TCB_UUID
  if (!uid || uid === 'anon') {
    throw new Error('UNAUTHORIZED') // uid 缺失，或是固定公共占位身份
  }
  const isAnonymous = full.TCB_ISANONYMOUS_USER === 'true'
  // uid 就是可信身份；isAnonymous 只在能明确确认时才是 true
}
```

**⚠️ 不要用 `loginType` 判断"是否已认证"或"是否匿名"**——这是本项目
第二次踩的坑，而且是从**真实 CloudBase 运行日志**里定位到的，不是本地
猜测：第一轮修复好前端的登录问题后，`hello` 云函数在线上抛出了

```
UNAUTHORIZED: 期望匿名登录（loginType=ANONYMOUS），实际 loginType=OAuth
```

也就是说当时服务端硬编码要求 `auth.getAuthContext(context).loginType
=== 'ANONYMOUS'`，但真实匿名登录的请求在 CloudBase Authentication v2
架构下，`loginType` 返回的是 `"OAuth"`，不是旧版 v1 枚举的
`"ANONYMOUS"`——v2 把所有登录方式（含匿名登录）统一成了基于 OAuth 风格
provider 的架构。`loginType` 这个字段在 v2 下的真实取值已经证明不可预测，
不能再用它做任何安全判断。

修复后的判断方式分成两个独立问题：

1. **"是否已认证"**：只看 `TCB_UUID`（`uid`）是否存在、非空、且不等于
   `"anon"`（CloudBase 文档里提到的 Publishable Key 对应的固定公共角色）。
2. **"是否匿名登录"**：改读 `TCB_ISANONYMOUS_USER` 这个专门字段（反编译
   确认 `getUserInfo()` 内部就是这么判断的），不读 `loginType`。这个字段
   不在 `getAuthContext()` 的返回值里，所以要用
   `app.getCloudbaseContext(context)` 读取完整的上下文对象。

其余几个容易踩坑的地方，已经在代码注释和
[docs/next-remote-steps.md](./next-remote-steps.md) 里记录：

1. **不要用官方 AI 工具包文档里推荐的 `getUserInfo()`**——这个写法
   （`const { openId, uid } = auth.getUserInfo()`）在本项目实际安装的
   `@cloudbase/js-sdk@3.10.2` 下**编译不过**：该版本的 `core.d.ts` 把
   `getUserInfo()` 声明成已废弃的 `(): Promise<IUserInfo>`，和 Node 运行时
   实测返回的同步对象完全不是一回事。
2. **不要把 SCF 的 `context` 传给 `cloudbase.init()`**——`ICloudbaseConfig.context`
   的类型是 `functions-framework` 风格（要求 `eventID` 字段），和经典 SCF
   的 `context`（`memory_limit_in_mb`/`request_id` 等）形状不兼容，会导致
   TypeScript 类型错误。`app.getCloudbaseContext(context)` 的参数类型是
   `context?: IContextParam`，没有这个问题（`getAuthContext` 的参数类型
   是更宽松的 `context?: any`）。
3. **在 Node 环境下调用 `getCloudbaseContext` / `getAuthContext` /
   `getEndUserInfo` 这些方法**，必须用 `moduleResolution: "node16"` 或
   `"nodenext"`——用 `"node10"` 或 `"bundler"` 解析会读不到这些 Node
   专属类型（它们声明在 `index.node.d.ts` 里，只有尊重 `package.json`
   exports 的 `node` 条件的解析策略才能找到）。`functions/*/tsconfig.json`
   已经配置好了。
4. **`cloudbase.init({})` 在非真实云函数运行时环境下会直接抛错**
   （实测报 `env must not be specified`），所以 `functions/room/src/lib/
   cloudbase-app.ts` 用懒加载单例，确保单纯 import 模块（比如跑测试时）
   不会触发这个报错，只有真正调用数据库/鉴权方法时才会初始化。
5. **身份解析的可信性有一部分已确认、一部分还没有**：已确认两个云函数都是
   Event 类型，官方文档明确这类函数默认单实例单并发，不存在"同一实例同时
   处理两个请求互相读错身份"的情况；但"实例被先后复用处理不同调用者时，
   身份是否逐请求正确刷新"这件事本地无法验证，需要部署后按
   [docs/next-remote-steps.md](./next-remote-steps.md) 的步骤实测。
6. **`TCB_ISANONYMOUS_USER` 是否真的会在匿名登录场景下被设为 `"true"`**
   也是反编译推出来的预期行为，没有在真实匿名会话里验证过，同样需要
   部署后确认。

## 云函数访问数据库：`CLOUDBASE_APIKEY` 会抢占管理员凭证（真实踩过的坑）

`room` 部署后，`createRoom` 真实报错：

```
数据库操作失败（getRoomByCode）：INVALID_CREDENTIALS Credentials are invalid.
```

**根因**（反编译 `@cloudbase/js-sdk@3.10.2` 的 `getSecretInfo()` 实现确认，
和官方文档对 `CLOUDBASE_APIKEY` 优先级的说明互相印证）：SDK 内部决定
"这次数据库请求用什么身份签名"时，有一条确定的优先级链，从高到低：

1. `init({ accessKey })` 显式传入
2. `init({ secretId, secretKey })` 显式传入
3. `init({ auth: { secretId, secretKey } })` 显式传入
4. **`process.env.CLOUDBASE_APIKEY`**（如果存在）
5. `process.env.TENCENTCLOUD_SECRETID` + `TENCENTCLOUD_SECRETKEY`
   （Event 云函数官方文档说的"自动注入的管理员临时凭证"）
6. `context.extendedContext.tmpSecret`
7. 空凭证

问题出在第 4 条排在第 5 条前面：如果运行时环境里存在
`CLOUDBASE_APIKEY`（CloudBase 近期推广的一种凭证管理方式，文档确认它
"属于最高优先级的认证方式之一"），即使只写了 `cloudbase.init({})`
什么参数都不传，SDK 也会在内部优先使用这个环境变量，把请求签名成
accessKey/Publishable Key 风格（`Authorization: Bearer <CLOUDBASE_APIKEY>`）
——这种凭证只有匿名用户权限，对 ADMINONLY 集合没有读写权限，
直接导致 `INVALID_CREDENTIALS`。

**修复方式**（`functions/room/src/lib/cloudbase-app.ts`）：显式读取
`process.env.TENCENTCLOUD_SECRETID`/`TENCENTCLOUD_SECRETKEY`/
`TENCENTCLOUD_SESSIONTOKEN`（这些本来就是运行时自动注入的管理员临时凭证，
不是我们自己生成或存储的密钥），传给 `cloudbase.init()`，利用优先级链的
第 2 条压过第 4 条的 `CLOUDBASE_APIKEY`：

```ts
const secretId = process.env.TENCENTCLOUD_SECRETID
const secretKey = process.env.TENCENTCLOUD_SECRETKEY
const sessionToken = process.env.TENCENTCLOUD_SESSIONTOKEN

const app = secretId && secretKey
  ? cloudbase.init({ secretId, secretKey, sessionToken })
  : cloudbase.init({}) // 兜底：这几个环境变量缺失时退回原来的行为
```

这**不是**在代码里硬编码密钥、**不是**创建新的 API Key、**不是**放宽数据库
权限——这几个环境变量本来就只存在于云函数自己的运行时进程里，修复只是把
"该被用、但被 CLOUDBASE_APIKEY 抢先"的凭证重新摆到最前面。

**这个根因分析还需要部署后验证**：`CLOUDBASE_APIKEY` 出现在这个具体环境里
的原因本身没有 100% 确认（只能确认"如果它存在，会被优先使用，且这个优先级
解释完全吻合观察到的报错现象"），部署后用新增的 `devDbHealthCheck` action
（见下面"开发诊断：数据库连通性检查"）确认连通性恢复正常。

### 开发诊断：数据库连通性检查

`room` 云函数新增了 `devDbHealthCheck` action（`functions/room/src/
handlers/devDbHealthCheck.ts`），用于快速确认"云函数能否用当前凭证正常
访问数据库"，不需要走完整的创建房间流程就能定位是不是鉴权问题：

- 要求调用者已通过身份校验（和其他 action 一样，由 `getTrustedUid`
  在 dispatch 之前统一校验）。
- 只读：用 `.count()`，不读取任何文档内容，不创建、不修改、不删除任何数据。
- 不返回私人数据：返回值只有 `{ dbConnected: boolean }`。
- 不返回任何密钥：失败时具体原因只写进服务端日志（`console.error`，
  `tcb logs search --query 'function_name:"room" AND src:app'` 能查到），
  不会出现在返回给客户端的结果里。

前端的 `/#/dev/hello` 页面（仅开发用）加了一张"数据库连通性检查"卡片，
点一下按钮就能调用这个 action。

失败时，服务端日志（`functions/room/src/lib/db-diagnostics.ts`）会记录
结构化、已脱敏的诊断信息：操作名、`error.name`/`error.code`/
`error.message`、截断的调用堆栈前几行、四个凭证环境变量是否存在（布尔值）、
当前实际采用的凭证来源名称。五个 CloudBase 官方错误码
（`MISSING_CREDENTIALS`/`INVALID_CREDENTIALS`/`DATABASE_PERMISSION_DENIED`/
`DATABASE_COLLECTION_NOT_EXIST`/`DATABASE_REQUEST_FAILED`）被严格区分，
不用字符串模糊匹配——前两个已经用真实网络请求对真实环境确认过触发条件，
后三个只查了官方文档，没有实测触发过。完整说明和查看日志的方法见
[docs/next-remote-steps.md](./next-remote-steps.md)。

## `@cloudbase/signature-nodejs`：js-sdk 的可选依赖，Node 签名链路的必需组件

显式传入 `secretId`/`secretKey`（见上一节）之后，反编译确认 Node 环境下
给请求签名实际依赖 `@cloudbase/signature-nodejs` 这个包。SDK 用
`optionalRequire()` 按需加载它，**加载失败时不抛异常**，只是打一行安装
提示、把签名函数设为 `null`。

这个包在 `@cloudbase/js-sdk@3.10.2` 自己的 `package.json` 里是
`optionalDependencies`，不是 `dependencies`——如果 CloudBase 云端
`installDependency: true` 的 npm 安装跳过了可选依赖，这个包可能没有被
装上。作为佐证：已不再维护、但曾是"官方推荐 Node 方案"的
`@cloudbase/node-sdk@3.18.3` 把它列为**普通依赖**，不是可选的。

**处理方式**：`functions/room/package.json` 和 `build.mjs` 生成的
`dist/package.json` 都显式声明 `@cloudbase/signature-nodejs@2.0.0`
为普通依赖，不再依赖"作为 js-sdk 的可选依赖被动装上"。

**这不是已确认的根因**：本地没有办法在没有真实云函数运行时的情况下验证
"可选依赖是否真的没装上"这件事是否发生过，只是一个有依据的加固。
完整调查过程见 [docs/next-remote-steps.md](./next-remote-steps.md)。

## 客户端不会看到数据库异常的原始内容

早期实现把数据库异常的详细信息（含原始 SDK 错误文本，比如这次的
`INVALID_CREDENTIALS`）直接放进发给客户端的错误 `message` 里——这不是
故意设计的信息泄露，但确实不应该让客户端看到任何实现细节。

现在的做法（`shared/errors.ts` 的 `RoomError` 新增 `internalDetail` 字段，
`functions/room/src/lib/db-errors.ts` 和 `response.ts` 配合使用）：

- 完整诊断信息（调用上下文 + 原始错误）只进服务端日志
  （`console.error`，`tcb logs search` 能查到）。
- 客户端收到的 `message` 永远是一句固定的、不含任何实现细节的中文提示
  （比如"服务器内部错误，请稍后重试"）。
- `RoomError.internalDetail` 这个字段专门装完整诊断信息，
  `toApiError()`（发给客户端的序列化方法）不会包含这个字段。

## 本地环境变量

`frontend/.env.example`：

```
VITE_CLOUDBASE_ENV_ID=
VITE_CLOUDBASE_ACCESS_KEY=
```

`frontend/.env.local`（不进 Git，已在 `frontend/.gitignore` 里通过 `*.local`
规则忽略）填真实值。`VITE_CLOUDBASE_ENV_ID` 不是 Secret，可以出现在文档、
`cloudbaserc.json`、CI 配置里；`VITE_CLOUDBASE_ACCESS_KEY`（Publishable Key）
设计上也允许暴露在浏览器端，但本项目仍然把它放进 `.env.local` 而不是硬编码，
方便以后换 key 或者不同环境用不同 key。

## 部署单元：`dist/` 目录，不是整个函数源码目录

`functions/{hello,room}/build.mjs` 用 esbuild 把 `src/index.ts`
打包成 `dist/index.js`，并额外生成一份精简的 `dist/package.json`
（只声明 `@cloudbase/js-sdk` 这一个运行时依赖）。`cloudbaserc.json`
里每个函数的 `dir` 字段都指向各自的 `dist/` 目录，而不是
`functions/room/` 整个目录——后者还有 `src/`、`test/`、
未打包的 `package.json`/`package-lock.json` 等不应该上传的内容。

`dir` 字段的路径解析行为（是否支持这种嵌套路径）已经通过直接阅读
`@cloudbase/cli` 的源码确认，不是猜测，见
[docs/next-remote-steps.md](./next-remote-steps.md) 里的记录。

部署前必须先 `npm run build` 生成 `dist/`，`tcb fn deploy` 才有东西可传。

## 当前部署状态

- `hello`、`room` 两个云函数的**代码**已经写好、typecheck 通过、esbuild
  打包通过（`functions/*/dist/index.js` + `dist/package.json`），
  但**都还没有部署到远端** CloudBase 环境。
- 远端数据库集合（`rooms`/`players`）、安全规则、匿名登录开关、Web 安全域名
  等控制台配置，部分已由你确认完成（匿名登录已开启），其余需要的操作列在
  [docs/next-remote-steps.md](./next-remote-steps.md)。
- 前端的 `HelloTestPage`（路由 `/#/dev/hello`，仅开发用）会尝试调用
  `hello` 云函数，在未部署状态下会收到 `FUNCTIONS_NOT_FOUND` 类的错误码，
  页面会展示"函数尚未部署 / 调用失败"而不是假装成功。
