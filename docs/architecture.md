# 架构概览（Milestone 1）

## 目录结构

```
party-game/
  frontend/          React + TypeScript + Vite，独立的 npm 项目
    src/
      lib/            CloudBase SDK 封装、API 调用、本地会话存储、
                      roomPolling.ts（低频轮询，替代 watch()）
      room/           RoomProvider：整个房间生命周期的单一状态来源
      pages/          HomePage / RoomPage / GamePage / HelloTestPage（开发用）
    .env.example / .env.local
  functions/
    common/           hello 和 room 共用的身份解析逻辑（identity.ts），
                      确保两个函数的"什么算已认证"规则完全一致
    hello/            Phase A 的连通性测试云函数
    room/             房间大厅云函数（createRoom/joinRoom/.../getRoomState/
                      devDbHealthCheck）
      src/handlers/   每个 action 一个文件
      src/lib/        数据访问层（db.ts + db-errors.ts）、规则、鉴权上下文
                      （cloudbase-app.ts 显式传入管理员临时凭证，
                      压过 CLOUDBASE_APIKEY 的优先级，见下方说明）
      test/           纯函数单元测试（vitest），含身份解析、数据库异常处理、
                      响应包装的测试
  shared/             前端和云函数共用的类型、常量、错误码
  docs/               本目录
  cloudbaserc.json    CloudBase CLI 配置（envId 等，不含任何密钥）
```

`shared/` 单独放在仓库根目录，而不是 `frontend/src/shared` 或
`functions/room/shared`，是因为它要被两边同时引用。云函数实际部署的是
`functions/<name>/dist/` 这一个目录（见 `cloudbaserc.json` 的 `dir` 字段，
不是整个 `functions/<name>/`），所以 `functions/*/build.mjs` 用 esbuild
把 `shared/` 一起打包进 `dist/index.js`（细节见下面"云函数构建"）。

## 为什么是一个 `room` 云函数 + action 分发，而不是 6 个函数

- 冷启动次数更少：一次请求命中一个已经热的函数，而不是分散在 6 个函数上各自冷启动。
- 共享校验逻辑（鉴权、乐观锁重试）更自然，不需要抽成公共包再分别部署。
- 免费额度下函数数量本身也是一种成本，没必要为每个动作都建一个函数。

代价是单个函数文件会变大——用 `handlers/` 目录按 action 拆文件来控制复杂度。

## 云函数访问数据库的凭证

`rooms`/`players` 两个集合是 ADMINONLY，云函数需要管理员权限才能读写。
`functions/room/src/lib/cloudbase-app.ts` 显式把 Event 云函数运行时自动
注入的 `TENCENTCLOUD_SECRETID`/`SECRETKEY`/`SESSIONTOKEN` 传给
`cloudbase.init()`，而不是只传 `{}`——原因是真实部署后发现，如果运行时
环境里存在 `CLOUDBASE_APIKEY` 这个环境变量，SDK 会优先用它（权限不足的
accessKey 风格鉴权），完全不会用到本该生效的管理员凭证，导致数据库请求
报 `INVALID_CREDENTIALS`。完整的根因分析、反编译证据见
[docs/cloudbase-setup.md](./cloudbase-setup.md)。

数据库异常不会把原始内容（比如 `INVALID_CREDENTIALS` 这类实现细节）发给
客户端——`functions/room/src/lib/db-errors.ts` 把完整诊断信息记到服务端
日志，客户端只收到 `shared/errors.ts` 里定义好的安全错误码和通用中文提示。

## 云函数构建

`functions/room/package.json` 的 `build` 脚本调用 `build.mjs`（esbuild），把
`src/index.ts` 连同它引用的 `../../shared/*` 一起打包成单个 `dist/index.js`，
同时额外生成一份精简的 `dist/package.json`（只声明 `@cloudbase/js-sdk`
这一个运行时依赖，`external` 配置让 esbuild 不把它打包进 bundle）。

`cloudbaserc.json` 里每个函数的 `dir` 字段指向这个 `dist/` 目录（而不是
整个 `functions/room/`），`installDependency: true` 让 CloudBase 在云端
根据 `dist/package.json` 自动安装 `@cloudbase/js-sdk`，本地不需要上传
`node_modules`。

`functions/room/tsconfig.json` 的 `include` 额外加了 `../../shared/**/*.ts`，
这样 `tsc --noEmit` 能把 shared 的类型也纳入检查，但构建产物实际由 esbuild 生成，
`tsc` 在这里只做类型检查（`noEmit: true`），不负责打包。

## 前端的数据流

```
UI 组件（HomePage/RoomPage/GamePage）
  ↓ 读/写
RoomContext（useRoomContext）
  ↑ 提供状态、暴露 joinAsNewPlayer/leaveRoom/startGame/reportOnline
RoomProvider（唯一维护房间状态同步生命周期的地方）
  ↓ 调用
frontend/src/lib/api.ts（callRoomFunction 统一封装）
  ↓ 调用
frontend/src/lib/cloudbase.ts（app.callFunction）
  ↓ HTTP
CloudBase room 云函数
```

UI 组件不会直接 import `lib/cloudbase.ts` 或 `lib/api.ts` 里的东西去拼业务逻辑——
都是通过 `useRoomContext()` 拿到的几个动作函数。

## 实时同步：从 watch() 改为轮询 getRoomState（重要变更，有真实原因）

**这不是最初的设计，是数据库建好之后发现架构冲突而改的。** 最初的设计假设
`rooms` 集合会配置成"房间成员可读"的安全规则，前端直接
`db.collection('rooms').doc(roomId).watch()`。但实际创建数据库时，
`rooms`/`players` 两个集合都配置成了 **ADMINONLY**——仅云函数的环境身份
能读写，前端 SDK 不管是 `get()`/`where()` 还是 `watch()` 都没有权限直接
接触这两个集合。

解决方式**不是**放宽数据库权限（那样会让任意匿名用户读到所有房间数据），
而是新增一个 `getRoomState` action，所有房间状态同步都经过它：

```
frontend/src/lib/roomPolling.ts（pollRoomState）
  ↓ 固定间隔调用（默认 5 秒）
api.getRoomState(roomId)
  ↓
room 云函数 getRoomState handler
  ↓ 用可信 uid 校验调用者是不是房间成员，非成员返回 NOT_MEMBER
getPlayerByUidAndRoom + getRoomById（环境身份，能读 ADMINONLY 集合）
  ↓
返回 Room 公开快照（本来就不含 uid/私密字段，见 shared/types.ts）
```

轮询规则：

- 只在 WAITING 阶段轮询，状态变成 PLAYING 后立即停止——"完整游戏阶段不能
  继续无条件轮询"，Milestone 1 的 GamePage 只是占位页，不需要进一步同步，
  正式的游戏内实时同步方案留到以后单独设计。
- 页面进入后台（`visibilitychange`）时暂停，回到前台立即补一次请求，
  不在用户看不到页面时浪费云函数调用。
- 离开大厅（`leaveRoom`）或组件卸载时彻底停止，不会在后台无限期运行。

`/room/:roomCode` 和 `/game/:roomCode` 两个路由仍然共享**同一个**
`RoomProvider` 实例（父路由 + `<Outlet />`，不是各包一层），这个设计本身
没变——只是"维护的东西"从 watch 连接换成了轮询定时器，原因同样是避免
路由切换时重复创建/销毁。

```tsx
<Route element={<RoomProvider />}>
  <Route path="/room/:roomCode" element={<RoomPage />} />
  <Route path="/game/:roomCode" element={<GamePage />} />
</Route>
```

## 刷新/断线恢复

见 [docs/data-model.md](./data-model.md) 和 [docs/security.md](./security.md)
里关于身份模型的部分；流程细节：

1. 打开 `/room/:code`（或 `/game/:code`，走同一个 RoomProvider）时，
   先确保匿名登录完成，再调用 `rejoinRoom(roomCode)`。
2. 成功：用返回的 `playerId` 开始轮询（如果房间还在 WAITING）；如果
   `status === 'PLAYING'`，`applyRoomSnapshot` 会自动导航到 `/game/:code`，
   不会启动轮询。
3. 返回 `NOT_MEMBER`：显示一个"输入昵称加入"的表单（`RoomPage` 里的
   `JoinForm` 组件），用户确认后调用 `joinRoom`。
4. 其他错误：展示错误信息，不自动重试。

## 轮询失败处理

`RoomProvider` 对轮询的 `onError` 只做状态提示（"连接中断，正在尝试恢复"），
不做指数退避——固定间隔的下一轮轮询本身就会自然重试。如果错误是
`NOT_MEMBER`（理论上不应该发生，防御性处理），会停止轮询并切回
"需要重新加入"的状态。每次轮询拿到的都是完整快照，`version` 字段只用于
丢弃可能乱序到达的旧快照，不需要做增量合并。
