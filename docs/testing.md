# 测试

## 工具选择

`functions/room` 用 **vitest**（和 frontend 的 vitest 版本一致，`5.0.5`，
pin 死精确版本）。选它的原因：轻量、对 TypeScript/ESM 开箱即用、和 Vite
生态一致，不需要额外的 babel/ts-jest 配置。

Milestone 1 没有给 `frontend` 写测试——目前前端代码基本是"调用 API + 渲染"，
真正有价值测的业务规则都在云函数这边。如果以后前端出现复杂的纯逻辑
（比如本地的乐观更新计算），再补测试。

## 测试范围

**只测纯函数**（`functions/room/src/lib/rules.ts`、`retry.ts`、
`db-errors.ts`，以及 `functions/common/identity.ts`），不 mock CloudBase
SDK 本身、不测 handler 和数据库的集成行为（含 `getRoomState`）——那些需要
真实的 CloudBase 环境才能有意义地验证，Milestone 1 阶段做不到，硬要 mock
出一套假的数据库行为意义也不大，还可能和真实行为不一致、给人错误的信心。

`identity.test.ts`、`db-errors.test.ts` 是例外：它们测的函数本身就只
依赖一个很窄的、已知形状的纯函数接口（分别是
`app.getCloudbaseContext`、传入的 `run`/`extractDoc` 回调），
所以测试里 mock 的只是这一个接口的返回值，不是整个 CloudBase SDK，
没有虚构数据库或网络行为。

运行：

```bash
cd functions/room
npm test
```

## 覆盖的场景

`test/rules.test.ts`：

- 昵称校验：trim、空昵称、超长昵称、刚好 12 字符
- 房间码校验：6 位数字、非数字字符、长度不对
- 房间码生成：始终是 6 位数字字符串
- 昵称查重：英文大小写不敏感、非 ASCII 字符按原样比较
- 座位分配：空房间、有空位、座位连续时分配下一个
- 房主转移：无人剩余返回 null、选中座位号最小的玩家
- 房间过期判定：PLAYING 永不过期、WAITING 超过/未超过 24 小时
- `assertJoinable`：房间非 WAITING、已过期、已满、正常情况
- `assertCanStartGame`：非房主、房间非 WAITING、人数不足、正常情况

`test/retry.test.ts`（版本冲突重试的公共逻辑）：

- 第一次就成功
- 重试几次后成功
- 重试耗尽后抛 `RoomError('CONFLICT')`
- `attempt()` 内部抛出的业务错误不会被重试逻辑吞掉、也不会继续重试

`test/identity.test.ts`（hello/room 共用的身份解析规则，`resolveTrustedIdentity`）：

- `loginType` 为 `"OAuth"` + 真实 uid → 认证通过（这正是线上日志证明过
  会出现、且不该被拒绝的场景，对应修复前的真实 bug）
- `loginType` 为 `"OAuth"` 且 `TCB_ISANONYMOUS_USER` 为 `"true"` → 确认是匿名登录
- uid 等于固定公共占位身份 `"anon"` → 拒绝，即使其他字段看起来正常
- uid 缺失 / 空字符串 → 拒绝
- 完全没有任何可信字段的非法上下文 → 拒绝
- `resolveTrustedIdentity` 的参数签名里没有 `event`，物理上不可能读到
  客户端伪造的字段（这个测试更多是文档性的，证明接口设计本身排除了这个风险）
- 两个不同真实 uid 的独立调用互不影响，各自返回正确结果
- `TCB_ISANONYMOUS_USER` 缺失时 `isAnonymous` 为 `false`，但只代表"目前
  无法确认是匿名"，不代表"确认是实名用户"
- 循环验证 `loginType` 取 `OAuth`/`EMAIL`/`CUSTOM`/`undefined` 时都不会
  因为"不等于 ANONYMOUS"而被拒绝——这是对"不能再用 loginType 做判断"
  这条规则本身的回归测试，防止以后有人不小心改回去

`test/db-errors.test.ts`（数据库异常处理，`getDocOrNull`/`wrapDbError`）：

- resolve 且有数据时正确返回文档
- resolve 但 data 为空数组时返回 null（覆盖"查不到文档时 resolve 空结果"
  这种可能的 SDK 行为）
- 抛出带 `DOCUMENT_NOT_FOUND`/`404` 字样的异常时也返回 null（覆盖"查不到
  文档时 reject 异常"这种可能的 SDK 行为——这两种可能性具体是哪一种，
  当前 SDK 版本没有查到权威说明，见 `functions/room/src/lib/db-errors.ts`
  的注释和 docs/next-remote-steps.md）
- 抛出看起来不是"文档不存在"的异常（比如权限错误）时，不会被误判成
  "文档不存在"而悄悄吞掉，会包装成 `RoomError('INTERNAL_ERROR')` 向上抛出
- **客户端能看到的 `message` 是通用安全提示，不包含原始错误文本或调用
  上下文**（比如 `INVALID_CREDENTIALS` 这类内部细节不会出现在
  `message` 里）；完整诊断信息放进 `RoomError.internalDetail`，并且会被
  `console.error` 记录到服务端日志，`toApiError()` 不会序列化
  `internalDetail` 字段。

`test/response.test.ts`（统一响应包装，`ok`/`err`）：

- `RoomError` 直接转成客户端安全形状（`{code, message}`）
- 带 `internalDetail` 的 `RoomError`：客户端收不到 `internalDetail`，
  但会记一条日志
- 任意非 `RoomError` 异常（含非 `Error` 类型的 throw）：不泄漏原始错误
  文本，统一返回 `INTERNAL_ERROR` + 通用提示，但完整内容仍会记到服务端日志

`test/db-diagnostics.test.ts`（数据库诊断分类，`logDbDiagnostic`）：

- 五个 CloudBase 官方错误码（`MISSING_CREDENTIALS`/`INVALID_CREDENTIALS`/
  `DATABASE_PERMISSION_DENIED`/`DATABASE_COLLECTION_NOT_EXIST`/
  `DATABASE_REQUEST_FAILED`）分别被正确分类，互不混淆——前两个的
  `error.code` 是用本机直接对真实 CloudBase 环境发起请求实测确认的，
  不是编的测试数据
- 未知的 `error.code`、没有 `code` 字段的普通 `Error`、非 `Error` 类型的
  throw，都分类为 `UNKNOWN`，不会抛出二次异常
- 诊断信息包含 operation/errorName/errorCode/classification/message/
  stackPreview 全部字段，并会被 `console.error` 记录
- 调用堆栈只截断前几行，不会把完整堆栈刷屏
- 诊断日志里不出现任何看起来像凭证的字符串（防呆检查）

## 没有覆盖、以后需要远端验证的部分

- `createRoom`/`joinRoom` 里 `runTransaction` 的真实原子性语义——运行时
  存在性和签名已经反编译确认（和实际安装的 `@cloudbase/js-sdk@3.10.2`
  兼容），但事务的隔离/回滚行为没有在真实环境跑过。
- `collection.doc(id).get()` 在文档不存在时到底是 resolve 空结果还是
  reject 异常——`db-errors.test.ts` 用 mock 覆盖了两种可能性下的处理逻辑，
  但哪一种才是真实行为需要部署后用一个确定不存在的 `roomId` 实测。
- `getRoomState` 在真实环境下的端到端行为（含轮询、后台暂停/恢复）。
- `TCB_ISANONYMOUS_USER` 在真实匿名登录场景下是否真的会被设为 `"true"`
  字符串——这是反编译 `getUserInfo()` 实现推出来的预期行为，本地无法
  验证真实的匿名登录会话。
- 云函数实例被复用处理"先后到达、不同调用者"的请求时，`TCB_UUID` 是否
  逐请求正确刷新，不会串号。
- 显式传入 `TENCENTCLOUD_SECRETID`/`SECRETKEY` 是否真的能让数据库请求
  正确压过 `CLOUDBASE_APIKEY` 的优先级、恢复管理员权限——这是反编译 SDK
  源码推导出的修复方式，本地没有一个带真实 `CLOUDBASE_APIKEY` 的运行时
  环境可以复现"修复前失败、修复后成功"的对照实验，需要部署后用
  `devDbHealthCheck` action 验证。
- `@cloudbase/signature-nodejs` 是否真的因为是 `optionalDependencies`
  而在 CloudBase 云端 `installDependency: true` 的安装过程中被跳过——
  这是本地找不到官方文档确认、只能通过部署后观察 `devDbHealthCheck`
  结果变化来间接验证的风险点。

这些都记录在 [docs/next-remote-steps.md](./next-remote-steps.md)，
属于"需要先部署才能验证"的范畴，不属于单元测试能覆盖的范围。
