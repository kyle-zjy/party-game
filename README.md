# 今夜别想下桌（party-game）

手机端多人派对桌游 Web App，支持 3-10 人同房间游玩。

**当前阶段：Milestone 1**——只实现多人房间大厅（创建/加入房间、等待大厅、
房主开始游戏），不包含任何具体游戏规则。

## 技术栈

- 前端：React + TypeScript + Vite，部署到 GitHub Pages
- 后端：Tencent CloudBase（云数据库 + 云函数 + Web SDK）
- 架构：Server Authoritative——客户端只发送意图，所有结果由云函数计算，
  详见 [docs/security.md](docs/security.md)

## 目录结构

```
frontend/   React 前端
functions/  云函数（hello: 连通性测试；room: 房间大厅）
shared/     前端和云函数共用的类型/常量/错误码
docs/       设计文档
```

详细说明见 [docs/architecture.md](docs/architecture.md)。

## 本地开发

```bash
cd frontend
npm install
cp .env.example .env.local   # 填入 CloudBase envId（和可选的 accessKey）
npm run dev
```

`.env.local` 不会进入 Git（已在 `.gitignore` 里忽略），其中的
`VITE_CLOUDBASE_ACCESS_KEY` 即使留空也不影响匿名登录——它只是一个可选的
"Publishable Key"，具体说明见 [docs/cloudbase-setup.md](docs/cloudbase-setup.md)。

## 环境变量

| 变量 | 说明 | 是否 Secret |
|---|---|---|
| `VITE_CLOUDBASE_ENV_ID` | CloudBase 环境 ID | 否，可以出现在代码/文档里 |
| `VITE_CLOUDBASE_ACCESS_KEY` | 可选的匿名访问 Publishable Key | 不是传统意义的密钥，但仍然放在 `.env.local` 管理，不硬编码 |

**任何 SecretId / SecretKey / Token / 私钥都不会、也不应该出现在这个仓库里。**

## Build / Lint / Test

```bash
cd frontend
npm run build     # tsc -b && vite build
npm run lint      # eslint .

cd ../functions/room
npm run typecheck # tsc -p tsconfig.json
npm run build     # esbuild 打包成 dist/index.js
npm test          # vitest run（纯业务规则的单元测试）

cd ../hello
npm run typecheck
npm run build
```

## CloudBase 架构

- 一个 `room` 云函数，内部按 `action` 分发（`createRoom`/`joinRoom`/
  `rejoinRoom`/`leaveRoom`/`setOnline`/`startGame`/`getRoomState`），
  而不是每个动作一个函数。
- 身份：CloudBase 匿名登录，服务端从云函数运行时的可信上下文解析 `uid`，
  不信任客户端传来的任何身份字段，也不依赖 `loginType` 做安全判断
  （详见 [docs/cloudbase-setup.md](docs/cloudbase-setup.md)）。
- 数据库：`rooms`/`players` 两个集合都是 ADMINONLY，客户端没有直接读写权限。
  房间状态同步走云函数的 `getRoomState` action + 低频轮询（等待大厅阶段，
  默认 5 秒一次，后台暂停，离开大厅停止），不是数据库 `watch()`。

详见 [docs/architecture.md](docs/architecture.md)、
[docs/data-model.md](docs/data-model.md)、
[docs/security.md](docs/security.md)。

## 云函数部署状态

`hello`、`room` 两个云函数的代码已经写好并通过本地构建，但**尚未部署**到
远端 CloudBase 环境。需要手动执行的远端操作（建集合、配安全规则、部署云函数等）
列在 [docs/next-remote-steps.md](docs/next-remote-steps.md)。
