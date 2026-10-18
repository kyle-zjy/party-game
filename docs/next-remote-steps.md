# 需要你手动执行的远端操作

本次任务不会自动执行下面任何一项——按约束，任何涉及远端 CloudBase 资源
（部署、建集合、改安全规则、改认证配置、建 API Key 等）都只记录在这里，
由你确认后自行执行。

## 已完成（记录状态，不需要再执行）

### ✅ 创建数据库集合（已完成）

`rooms`、`players` 两个集合已经在 CloudBase 控制台创建，都配置为
**ADMINONLY**（仅云函数环境身份可读写，客户端完全没有权限）。
这个选择比本文档更早版本讨论的"自定义安全规则"方案更保守、也更简单——
不需要在规则语言里表达"房间成员"这种数组字段的归属判断，相关调研记录
保留在 [docs/cloudbase-security-rules.md](./cloudbase-security-rules.md)
的"历史记录"一节，仅供参考。

两个集合目前都是空的，不需要手动初始化任何数据——`createRoom` 会自己
创建第一条 `rooms` 文档。

## 阶段 B：`game_rooms` 集合需要你在控制台手动配置（待执行，本次任务不会自动做）

阶段 B（多人房间 MVP，前端直连数据库，不经过云函数）新增了一个集合
`game_rooms`，和旧模型的 `rooms`/`players`（ADMINONLY）完全独立、互不影响。
这个新集合需要你手动在 CloudBase 控制台完成两件事，代码侧目前假设这两件事
还没做（所以暂时还不能做双浏览器真实测试）：

### 1. 权限：集合 `game_rooms` 设置为「所有用户可读写」中的登录用户可读写

- **目的**：阶段 A 已经验证过，`dbtest` 集合配置成**仅创建者可读写**或
  **所有用户可读写**（二选一，取决于当时的实际配置）时，匿名登录用户可以
  直接用 Web SDK 读写。`game_rooms` 需要同样的思路，但注意一个关键区别：
  房间内的"加入房间"操作需要**修改别人创建的文档**（把自己加进
  `players` 数组），不是只读写自己创建的文档，所以**不能**选"仅创建者
  可读写"这种按 `_openid`/创建者隔离的规则，必须选**「所有用户可读写」**
  （文档里 CloudBase 控制台一般写作"所有用户可读写"或等价的自定义安全规则
  `{"read": true, "write": true}`）。
- **风险**：中——这意味着任何匿名登录用户都能读写任意 `game_rooms`
  文档，包括不属于自己房间的文档。这是用户本人已经确认接受的权衡
  （"朋友聚会场景，不是陌生玩家商业场景"），本项目的乐观锁
  （`gameRoomDb.ts` 的 `version` 字段）防的是*并发写冲突*，**不防**
  "恶意用户乱改别人房间数据"这类问题——这类风险在当前方向下被认为可以
  接受，不在本轮解决范围内。
- **操作**：控制台 → 数据库 → 创建集合 `game_rooms`（如果还没有）→
  权限设置选「所有用户可读写」。
- **不要**把这个权限设置用到 `rooms`/`players`（它们必须继续保持
  ADMINONLY，本次任务没有改也不应该改）。

### 2. 索引：在 `roomCode` 字段上创建唯一索引

- **目的**：`createGameRoom()`（`frontend/src/lib/gameRoomDb.ts`）生成
  随机 6 位房间码后直接 `add()`，依赖数据库层面的唯一约束来发现冲突
  （失败就换一个房间码重试，最多 5 次），而不是"先查是否冲突再写入"
  这种天然有竞态窗口的方式。**没有唯一索引的话，两个用户几乎同时生成了
  同一个房间码，会各自写入成功，产生两条 `roomCode` 相同的文档**——
  这会让所有后续 `joinGameRoom`/`rejoinGameRoom` 按 `roomCode` 查询时
  行为不确定（`where({roomCode}).limit(1)` 可能拿到两条里的任意一条）。
- **操作**：控制台 → 数据库 → `game_rooms` 集合 → 索引管理 → 新建索引：
  - 索引字段：`roomCode`
  - 索引属性：**唯一**
  - 其余字段（`_id` 以外不需要额外的普通索引——`where({_id, version})`
    走的是主键索引，查询量级在"朋友聚会"场景下也不需要为 `status`/
    `updatedAt` 单独建索引）。
- **风险**：低——创建唯一索引是幂等、可逆操作（可以在控制台删除重建），
  且 `game_rooms` 目前应该是空集合，不会有历史脏数据导致建索引失败。
- **如果暂时不建**：代码仍然能跑，只是"两个用户同时抢到同一个房间码"
  这种极小概率场景会产生脏数据——建议在双浏览器测试之前就把这个索引建好，
  不需要等出现问题再补。

### 3. 建好以上两项之后，再进行双浏览器真实测试

代码已经完成（见下面的实现说明），`typecheck`/`build`/`lint`/`test` 均已
通过，但还没有、也不可能在没有上述权限+索引的真实环境下做端到端验证——
请先完成 1、2 两步，再按以下方式测试：
1. 浏览器 A 打开 `/#/mp`，输入昵称，点击"创建房间"，记下房间码。
2. 浏览器 B（独立浏览器或无痕窗口）打开 `/#/mp`，输入昵称 + 房间码，
   点击"加入房间"。
3. 两边应该都能在 5 秒内（轮询间隔）看到对方的昵称出现在玩家列表里。
4. 刷新其中一个浏览器，应该自动恢复到同一个房间（不需要重新加入）。
5. 任意一方点击"离开房间"，另一方应该在下一次轮询后看到人数变化
   （房主离开时房主身份应该转移给座位号最小的剩余玩家）。

## 阶段 C：正式游戏不需要新的权限/索引，但要留意单文档大小

阶段 C（正式棋盘 + 回合引擎）复用了阶段 B 已经配置好的 `game_rooms`
集合和它的权限/唯一索引，**不需要新建集合、不需要新建索引**——游戏状态
存在同一份房间文档新增的 `game` 字段里，乐观锁也复用同一个顶层 `version`
字段（见 `shared/gameRoomTypes.ts` 的说明）。

需要你知道、但本轮不需要你操作的一点：
- `game.history`（最近事件记录）在代码里已经做了上限截断（见
  `shared/game/engine/history.ts` 的 `HISTORY_LIMIT = 60`），避免单个游戏
  玩很多回合后文档无限变大超出 CloudBase 单文档大小限制。如果以后实测发现
  60 条仍然太大（取决于 CloudBase 具体的单文档大小上限，本次没有查到一个
  确切数值去对照验证），需要调低这个常量。
- 三人开局、六人中局、十人满房这几种人数下 `game` 字段的实际大小没有做过
  真实测量——建议你在双/三浏览器测试时留意一下创建房间、开局、多轮操作
  之后是否出现过写入失败（如果出现，大概率是文档太大，而不是权限或索引
  问题）。

## 按建议顺序排列的操作清单

### 1. 确认 Web 安全域名

- **目的**：Web SDK 的请求会被 CloudBase 按"安全来源"校验，本地开发和未来
  部署的 GitHub Pages 域名都需要加入白名单。
- **操作**：控制台 → 环境 → 环境配置 → Web 安全域名，添加：
  - `localhost`（本地 `npm run dev`，Vite 默认端口是 5173，但按域名加，不需要精确到端口）
  - `kyle-zjy.github.io`（GitHub Pages 部署域名）
- **风险**：低。
- **预期结果**：本地开发和 Pages 部署后的页面都能正常调用 CloudBase。

### 2. 部署 `hello` 云函数（Phase A 连通性验证）

- **目的**：验证"前端 SDK + 匿名登录 + callFunction + 服务端读取可信 uid"
  整条链路。
- **操作**：
  ```bash
  cd /mnt/e/party-game/functions/hello
  npm run build   # esbuild 打包出 dist/index.js + dist/package.json
  # 确认已用 tcb login 登录过 CLI
  tcb fn deploy hello
  ```
  `cloudbaserc.json` 里 `hello` 这一项的 `dir` 字段指向
  `./functions/hello/dist`——这是部署的实际单元（只有打包后的
  `index.js` + 精简过的 `package.json`，不包含 `src/`、未打包的
  依赖等）。`installDependency: true` 会让 CloudBase 在云端按
  `dist/package.json` 里的 `dependencies`（只有 `@cloudbase/js-sdk`）
  自动安装，本地不需要、也不应该把 `node_modules` 一起传上去。

  部署后，用前端的 `/#/dev/hello` 页面（`HelloTestPage`，仅开发用）
  点击"调用 hello"按钮验证。
- **风险**：低——这是一个无副作用的只读测试函数。
- **预期结果**：页面显示调用成功，返回的 `uid` 和 `isAnonymous: true`；
  `requestTime` 是服务端时间戳。
- **如果失败**：`tcb fn detail hello` 看配置是否符合预期，
  `tcb logs search --query 'function_name:"hello"'` 看是否有
  `MODULE_NOT_FOUND`（多半是 `installDependency` 没生效或者
  `dist/package.json` 没有正确声明依赖）之类的报错。

### 3. 重新部署 `room` 云函数（第五轮修复：signature-nodejs 可选依赖 + 诊断日志）

这一步经历了多轮排查，按顺序记录：

- **第四轮**（已修复）：`createRoom` 报
  `INVALID_CREDENTIALS Credentials are invalid.`，根因是 SDK 凭证优先级
  链——`CLOUDBASE_APIKEY`（如果存在）优先级高于 Event 云函数自动注入的
  `TENCENTCLOUD_SECRETID`/`SECRETKEY`。已修复：显式传入后者压过前者。
- **第四轮修复部署后，`devDbHealthCheck` 仍返回 `{dbConnected: false}`**——
  说明第四轮的修复方向没错，但没有解决全部问题，或者解决了但又触发了
  新的失败点。当时日志没有记录足够细节（`tcb_log` 为空），所以第五轮先补
  诊断日志，再补一个新发现的疑点：
  - **新发现（反编译确认，真实风险，不是推测）**：显式传入
    `secretId`/`secretKey` 之后，Node 环境下的请求签名实际依赖
    `@cloudbase/signature-nodejs` 这个包。SDK 通过内部的
    `optionalRequire()` 按需加载它，**加载失败时不抛异常**，只是
    `console.error` 一行安装提示，把签名函数设成 `null`——这个包在
    `@cloudbase/js-sdk` 自己的 `package.json` 里是 `optionalDependencies`，
    如果 CloudBase 云端的 `installDependency: true` 机制跳过了可选依赖，
    这个包可能没有被装上，导致显式传凭证这件事本身就没真正生效。
    作为佐证：已经不再维护、但曾经是"官方推荐 Node 方案"的
    `@cloudbase/node-sdk` 把这个包列为**普通依赖**，不是可选的。
  - **已修复**：`functions/room/build.mjs` 现在把
    `@cloudbase/signature-nodejs@2.0.0` 显式写进 `dist/package.json` 的
    `dependencies`（不再依赖"作为 js-sdk 的可选依赖被动装上"），
    `functions/room/package.json` 本身也加了这个依赖。
  - **新增诊断能力**：`functions/room/src/lib/db-diagnostics.ts`
    记录结构化、已脱敏的诊断日志——操作名、`error.name`/`error.code`/
    `error.message`、截断的调用堆栈前 5 行、四个凭证环境变量是否存在
    （布尔值）、当前实际采用的凭证来源名称（`cloudbase-app.ts` 的
    `getResolvedCredentialSource()`）。绝不记录任何凭证实际值。
  - **五个错误码的区分已用真实网络请求对照确认**（不是凭空列的，见
    `db-diagnostics.ts` 的文件头注释）：用本机直接对真实
    `party-game-d5g0uxms1b4a800c7` 环境发起数据库请求（只验证凭证解析，
    没有通过云函数，也没有写入任何数据）：
    - 完全不传凭证 / 传空字符串 → `error.code === 'MISSING_CREDENTIALS'`
    - 传格式正确但值无效的 secretId/secretKey → `error.code ===
      'INVALID_CREDENTIALS'`
    - `DATABASE_PERMISSION_DENIED`/`DATABASE_COLLECTION_NOT_EXIST`/
      `DATABASE_REQUEST_FAILED` 这三个只查了官方错误码文档，没有在本项目
      真实环境里实测触发过。
- **操作**：
  ```bash
  cd /mnt/e/party-game/functions/room
  npm run build   # esbuild 打包出 dist/index.js（已内联 shared/）+ dist/package.json
  tcb fn deploy room --force
  ```
  同样部署的是 `functions/room/dist` 这个目录（见 `cloudbaserc.json` 的
  `dir` 字段）。`dist/package.json` 现在会声明两个依赖：
  `@cloudbase/js-sdk` 和 `@cloudbase/signature-nodejs`。
- **调用权限**：前端这一侧不变。云函数内部访问 `rooms`/`players`
  （ADMINONLY）仍然是显式使用运行时自动注入的
  `TENCENTCLOUD_SECRETID`/`SECRETKEY` 管理员临时凭证，不需要配置任何新的
  密钥，也不需要用前端的 Publishable Key。
- **风险**：中——建议先用"6. 验证数据库连通性"确认这轮修复是否生效，
  再走完整的创建房间流程。
- **预期结果**：`devDbHealthCheck` 返回 `dbConnected: true`。
- **如果仍然失败**：查
  `tcb logs search --query 'function_name:"room" AND src:app'`，
  找 `[db-diagnostic]` 和 `[db-health-check]` 这两行日志（见下面第 6 步
  的详细说明），日志里的 `classification` 字段会明确是五个错误码中的
  哪一个，`resolved-credential-source` 会明确当前实际用的是
  `TENCENTCLOUD_SECRETID_SECRETKEY_ENV` 还是
  `CLOUDBASE_DEFAULT_INIT_EMPTY`——如果是后者，说明
  `TENCENTCLOUD_SECRETID`/`SECRETKEY` 这两个环境变量在这个云函数的真实
  运行时里根本不存在，需要确认这个具体环境的云函数运行时是否真的会注入
  这两个环境变量（理论上 Event 云函数都会，但不能排除这个具体账号/环境
  有特殊配置）。

### 4. 验证云函数调用者身份解析在真实环境下的行为（含重新部署 hello，第二轮修复）

这一步经历了两轮修复，记录两轮的原因是避免以后又走回头路：

- **第一轮**（根因在前端）：`ensureAnonymousLogin()` 用 `auth.getCurrentUser()`
  判断是否已登录，这个旧 API 不区分 accessKey 凭证和真实登录态，导致从未
  真正调用 `signInAnonymously()`。已修复为用 `getSession()` 判断。
- **第二轮**（根因在服务端，是第一轮修复后才暴露出来的新问题）：前端修好后，
  真实 CloudBase 运行日志显示服务端抛出
  `UNAUTHORIZED: 期望匿名登录（loginType=ANONYMOUS），实际 loginType=OAuth`——
  也就是说当时服务端的校验逻辑本身是错的：它硬编码要求
  `loginType === 'ANONYMOUS'`，但线上实测 CloudBase Authentication v2
  把匿名登录也走了 OAuth 风格的 provider 架构，`loginType` 返回的是
  `"OAuth"`，不是旧版 v1 枚举里的 `"ANONYMOUS"`。
  **结论：`loginType` 不能用来判断"是否已认证"或"是否匿名"**，已改为：
  - "是否已认证"只看 `uid`（`TCB_UUID`）是否存在、非空、且不等于
    CloudBase 文档里提到的固定公共占位身份 `"anon"`。
  - "是否匿名登录"改读专门的 `TCB_ISANONYMOUS_USER` 字段（反编译确认
    `getUserInfo()` 内部就是这么判断的），而不是 `LOGINTYPE`。
  完整实现见 `functions/common/identity.ts`（hello 和 room 共用）。
- **这一步需要重新部署 `hello`**（服务端身份校验逻辑第二次改动）：
  ```bash
  cd /mnt/e/party-game/functions/hello
  npm run build
  tcb fn deploy hello --force
  ```
- **room 云函数不需要单独部署就能验证这次改动**——room 还没有第一次部署过，
  等它第一次部署时自然带着新的身份校验逻辑（见上面第 3 步）。
- **操作（验证）**：
  1. 打开 `/#/dev/hello`，点击"检查当前 Session"——预期"是否存在真实
     Session：否"（还没登录）。
  2. 点击"匿名登录"，uid 应该是随机字符串（不是 `"anon"`），
     "是否为真正的匿名登录用户：是"。
  3. 刷新页面，点击"检查当前 Session"（不点"匿名登录"）——uid 应该和
     刷新前一致（验证标准 D）。
  4. 点击"调用 hello"，预期**调用成功**（不再抛 UNAUTHORIZED），
     返回的 `uid` 和前端显示的一致，"服务端是否确认为匿名登录"显示"是"，
     "服务端原始 loginType"这里预期显示 `OAuth`（这是正常的，前面已经
     解释过为什么不能拿它做安全判断，只是展示出来方便排查）。
  5. 换一个独立的浏览器 session（无痕窗口或另一个浏览器）重复 1-4，
     预期拿到一个**不同**的 uid，服务端对这次调用返回的也是这个新 uid
     （验证标准 E/F）。
- **风险**：低（只是验证 + 重新部署一个无副作用的测试函数）。
- **预期结果**：上述 5 步全部符合预期，且页面上不再出现 UNAUTHORIZED。
  如果仍然失败，把 `tcb logs search --query 'function_name:"hello"'`
  的报错贴出来，可能是还有没发现的第三个身份解析问题。
- **额外待验证点（和之前记录的一致，仍未验证，这次修复没有解决，只是
  没有恶化）**：云函数实例被复用处理"先后到达、不同调用者"的请求时，
  `TCB_UUID`/`TCB_ISANONYMOUS_USER` 是否逐请求正确刷新，不会串号。
  上面第 5 步的"两个独立浏览器分别调用"同时也是对这一点的验证。

### 5. 验证 `database.runTransaction` 的真实行为

- **目的**：见下面"API 冲突记录"一节——`runTransaction` 不在 js-sdk 3.10.2
  的类型声明里，虽然运行时反编译确认方法存在、签名吻合，但**没有在真实
  CloudBase 环境下跑过，不能当作已验证可靠**。
- **操作**：部署 `room` 云函数后，手动测试"两个请求几乎同时创建两个不同房间"
  "两个请求几乎同时 join 同一个房间抢最后一个座位"这类场景，观察：
  - 数据是否符合预期（没有出现数据错乱、重复 playerId 等）。
  - 事务失败时是否真的做到"全部回滚"而不是"部分写入"
    （比如人为制造一次写入失败，确认 `players` 和 `rooms` 两边都没有
    留下不一致的半成品数据）。
- **风险**：低（只是验证，不是不可逆操作）。
- **预期结果**：确认事务语义符合预期；如果发现和假设不符，需要回来调整
  `functions/room/src/lib/db.ts` 的实现（比如放弃用 `runTransaction`，
  改成"先写 players，成功后再写 rooms，前者写入失败就直接报错不重试"
  这种更保守但不依赖未文档化 API 的方式）。

### 6. 验证数据库连通性 + `getRoomState` 轮询在真实环境下的行为

- **背景**：`rooms`/`players` 已经确认是 ADMINONLY，前端不可能、也没有
  再尝试 `watch()`——这不再是"需要实测哪种方案可行"的开放问题，而是已经
  按 `getRoomState` + 轮询的方案实现完了。这一步是验证这个实现本身，
  不是在几个方案里选一个。
- **第 0 步（先做这个，比直接走完整流程更快定位问题）**：打开
  `/#/dev/hello`，点击"检查数据库连通性"，确认返回"✅ 数据库连通正常"。
  如果失败，不需要往下走完整的创建房间流程——按下面的方法查日志。
- **如何在 CloudBase 日志里查看脱敏后的诊断结果**：
  ```bash
  tcb logs search --query 'function_name:"room" AND src:app' --timeRange 30m
  ```
  这次调用会产生两行关键日志（如果数据库请求失败）：
  1. `[db-diagnostic] {"operation":"checkDbConnectivity:rooms.count()",
     "errorName":"Error","errorCode":"...","classification":"...",
     "errorMessage":"...","stackPreview":"..."}`——`classification`
     字段是五个已知错误码之一（`MISSING_CREDENTIALS`/
     `INVALID_CREDENTIALS`/`DATABASE_PERMISSION_DENIED`/
     `DATABASE_COLLECTION_NOT_EXIST`/`DATABASE_REQUEST_FAILED`）或
     `UNKNOWN`（没见过的错误码）。
  2. `[db-health-check] credential-env-presence {"hasTencentCloudSecretId":
     true/false, "hasTencentCloudSecretKey": true/false,
     "hasTencentCloudSessionToken": true/false, "hasCloudbaseApiKey":
     true/false} resolved-credential-source TENCENTCLOUD_SECRETID_
     SECRETKEY_ENV 或 CLOUDBASE_DEFAULT_INIT_EMPTY`——这一行告诉你
     四个凭证环境变量是否存在，以及这次请求实际用的是哪条凭证来源。
     **这两行日志都不含任何凭证实际值**，只有布尔值和分类名称。
  - 根据 `classification` 字段判断下一步：
    - `MISSING_CREDENTIALS` → 看 `hasTencentCloudSecretId`/
      `hasTencentCloudSecretKey` 是不是 `false`——如果是，说明这个云函数
      运行时根本没有注入这两个环境变量，需要去确认云函数类型/运行时配置。
    - `INVALID_CREDENTIALS` → 看 `resolved-credential-source`：如果是
      `TENCENTCLOUD_SECRETID_SECRETKEY_ENV`，说明环境变量存在但值本身
      无效（可能是临时凭证已过期，或者 `@cloudbase/signature-nodejs`
      没有正确签名——后者需要确认 `tcb fn detail room` 或部署日志里
      `npm install` 是否成功装上了这个包）；如果是
      `CLOUDBASE_DEFAULT_INIT_EMPTY`，说明显式传凭证的分支完全没有
      走到，要回头检查第 5 步两个环境变量是否存在的判断逻辑。
    - `DATABASE_PERMISSION_DENIED` → 凭证本身有效，但没有权限——
      需要回去确认 `rooms` 集合是不是真的配置成了 ADMINONLY 而不是更严格
      的其他模式，或者确认用的凭证是不是真的是管理员身份。
    - `DATABASE_COLLECTION_NOT_EXIST` → 集合名字typo了，或者集合其实
      还没创建成功，去控制台确认。
    - `UNKNOWN` → 这个错误码没有被本项目见过，需要把 `errorMessage`
      （已经是脱敏过的、CloudBase 官方错误描述文本，不含凭证）贴出来
      进一步排查，可能需要扩充 `db-diagnostics.ts` 的已知错误码列表。
- **操作**：
  1. 浏览器 A 创建房间，浏览器 B 用房间码加入。
  2. 观察浏览器 A 的等待大厅页面，确认最多 5 秒内能看到浏览器 B 加入
     （不需要手动刷新页面）。
  3. 把浏览器 A 切到后台（切换标签页或最小化），等 10+ 秒，再切回前台，
     确认切回后立刻有一次状态更新（验证"后台暂停、前台立刻补一次"的行为），
     而不是切到后台期间还在后台偷偷发请求（可以用浏览器开发者工具的
     网络面板确认后台期间没有新的 `callFunction` 请求）。
  4. 浏览器 A 作为房主点击"开始游戏"，确认两个浏览器都能跳转到
     `/game/:code` 占位页，并且确认跳转后两个浏览器都不再继续发起
     `getRoomState` 轮询请求（网络面板确认）。
  5. 任意一方点击"离开房间"，确认该浏览器的轮询立刻停止。
- **风险**：低。
- **预期结果**：上述 5 步全部符合预期。如果 `getRoomState` 调用本身返回
  `NOT_MEMBER` 或其他错误，参照它的报错信息排查（它和其他 action 共用同一套
  错误码，见 `shared/errors.ts`）。

### 7. 验证 `collection.doc(id).get()` 对不存在文档的真实行为

- **目的**：`functions/room/src/lib/db-errors.ts` 详细记录了一个本地无法
  确认的问题：当前安装的 `@cloudbase/js-sdk@3.10.2` 在查询一个不存在的
  文档 ID 时，到底是 resolve 一个空的 `data` 数组，还是 reject 一个异常。
  代码已经写成能同时正确处理两种情况，但哪种才是真实行为需要部署后确认，
  确认了才能知道 `db-errors.ts` 里的"看起来像 DOCUMENT_NOT_FOUND"关键词
  匹配逻辑是不是真的覆盖到了实际会出现的错误信息。
- **操作**：触发一次查询不存在房间的场景——最简单的方式是在浏览器里用一个
  肯定不存在的 6 位数字房间码尝试加入（`joinRoom`），确认返回的是业务错误
  `ROOM_NOT_FOUND`，而不是 `INTERNAL_ERROR`（如果是后者，说明
  `getRoomByCode`/`getRoomById` 遇到了一个没被正确识别成"不存在"的异常，
  需要去看 `tcb logs search` 里的原始错误信息，把新的关键词加进
  `db-errors.ts` 的 `NOT_FOUND_SIGNALS` 列表）。
- **风险**：低。
- **预期结果**：返回 `ROOM_NOT_FOUND`，不是 `INTERNAL_ERROR`。

### 8. 确认云函数 Node 运行时版本

- **目的**：`cloudbaserc.json` 里写的是 `Nodejs20.19`，需要确认这个版本
  在你的 CloudBase 环境里确实可选。
- **操作**：控制台创建/编辑云函数时查看可选的运行时列表，或者直接尝试
  `tcb fn deploy`，如果 `Nodejs20.19` 不被接受会报错。
- **风险**：低。
- **预期结果**：确认 `Nodejs20.19` 可用（这是 CloudBase 官方 CLI
  配置文档里标注的"Recommended"默认版本，预期不会有问题）；如果
  意外不可用，改成控制台里实际列出的最接近的 LTS 版本。

---

## API 冲突记录（供以后查阅，不是"要执行的操作"）

### `cloudbase.init({ context })` 的 context 类型与经典 SCF context 不一致

- `@cloudbase/js-sdk@3.10.2` 的 `ICloudbaseConfig.context` 字段类型是
  `Readonly<{ eventID: string; extendedContext?: {...} }>`——这是
  `@cloudbase/functions-framework`（云托管/新架构）风格的 context。
- 但 CloudBase 官方 CLI quick-start 文档中云函数的经典写法是
  `exports.main = async (event, context) => {...}`，这里的 `context`
  是 SCF 风格：`{ memory_limit_in_mb, time_limit_in_ms, request_id,
  function_version, function_name, namespace, environ?/environment? }`，
  并没有 `eventID` 字段。
- 两种 context 结构不兼容：如果照搬某些 node-sdk 文档示例写
  `tcb.init({ context })` 直接把 SCF context 塞进去，在 js-sdk 3.10.2 下
  TypeScript 会报类型错误（`Property 'eventID' is missing`）。
- **本项目的处理方式**：不把 SCF context 传给 `cloudbase.init()`，只调用
  `cloudbase.init({})`（云函数运行时会自动使用当前函数所在的环境 ID，
  官方文档对此有明确说明），然后把 SCF context 单独传给
  `auth().getAuthContext(context)`（该方法签名是 `context?: any`，
  不会有类型冲突）。

### `auth.getCurrentUser()` 不区分 accessKey 凭证和真实登录态（已修复，真实踩过的坑）

- **现象**：部署 `hello` 后实测，浏览器显示"已登录"、`uid: anon`，
  `hello` 服务端返回 `isAnonymous: false`——两边都不是真实匿名用户。
- **根因**（反编译 `@cloudbase/js-sdk@3.10.2` 的 web 构建产物
  `dist/index.esm.js` 确认，不是猜测）：
  1. `cloudbase.init({ accessKey })` 的 `App` 构造函数里会**同步**调用
     内部方法 `setAccessKey()`：
     ```js
     n.prototype.setAccessKey = function () {
       // ...
       if (this.config.accessKey) { n = this.config.accessKey, r = "accessKey" }
       // ...
       this.oauthInstance.oauth2client.setAccessKeyCredentials({
         access_token: n, token_type: "Bearer", scope: r, /* ... */
       })
     }
     ```
     这一步在 `init()` 调用时就完成了，**不需要、也不会**触发
     `signInAnonymously()`。
  2. 旧版 `getCurrentUser()`（`core.d.ts` 标注 `@deprecated`）内部调用
     `getLoginState()`，而 `getLoginState()` 的实现是：
     ```js
     n.prototype.getLoginState = function () {
       return this.oauthInstance.authApi.getLoginState() // 最终是 credentialsClient.getCredentialsAsync()
         .then(t => t ? new UserWrapper(...) : null)
     }
     ```
     只要凭证*存在*（truthy）就构造一个"已登录"的 User 对象，
     **完全没有检查 `scope`**。于是 accessKey 凭证（`scope: "accessKey"`）
     被当成了真实登录态。
  3. 相比之下，v3 的 `getSession()` / `getUser()` 的实现里**明确判断**：
     ```js
     n.prototype.getSession = function () {
       // ...
       const t = await oauth2client.getCredentials()
       if (t && t.scope !== "accessKey") { /* 走真实用户分支 */ }
       return { data: { session: null, user: null }, error: null } // accessKey 场景直接返回空
     }
     ```
     这正是官方为区分这两种凭证设计的正确判断方式。
- **本项目的处理方式**：`frontend/src/lib/cloudbase.ts` 不再调用
  `getCurrentUser()`，改用 `getSession()` 实现 `getIdentityState()`，
  `ensureAnonymousLogin()` 的"是否已登录"判断也从这里来。
- **这不是"待验证风险"，是已经通过反编译确认的根因**，但仍需要在真实
  浏览器里重新走一遍完整流程确认修复生效，见上面第 4 步。

### 服务端 `loginType` 字段不能用来判断"是否已认证"或"是否匿名"（真实踩过的坑，线上日志证据，不是推测）

- **现象**：上面那个 bug 修复、前端确认拿到真实 uid 和真实 session 之后，
  `hello` 云函数在**真实 CloudBase 运行日志**里抛出：
  ```
  UNAUTHORIZED: 期望匿名登录（loginType=ANONYMOUS），实际 loginType=OAuth
  ```
  也就是说合法的匿名登录用户被服务端自己的校验逻辑拒绝了。
- **根因**：服务端之前的实现（`functions/room/src/lib/auth-context.ts`
  的旧版本）用 `auth.getAuthContext(context).loginType === 'ANONYMOUS'`
  判断"是否是合法的匿名用户"。这个判断基于一个错误假设：`loginType`
  会一直是 v1 时代的固定枚举值（`NULL`/`ANONYMOUS`/`WECHAT`/...）。
  真实环境证明这个假设不成立——CloudBase Authentication v2 把包括匿名
  登录在内的所有登录方式都统一到了基于 provider 的架构下，`loginType`
  在 v2 架构下可以是 `"OAuth"`，即使这次登录其实是调用
  `signInAnonymously()` 产生的。
- **本项目的处理方式**（`functions/common/identity.ts`，hello 和 room
  共用）：
  1. **"是否已认证"完全不再依赖 `loginType`**，只看
     `app.getCloudbaseContext(context).TCB_UUID` 是否存在、非空、
     且不等于 CloudBase 官方文档中提到的固定公共占位身份字符串
     `"anon"`（这是 Publishable Key 对应的共享匿名角色，在 PG 鉴权
     文档里有专门说明；即使当前 Web SDK 的实测行为下还没观察到它会被
     写进 `TCB_UUID`，也显式防一手，不让它冒充成合法 uid）。
  2. **"是否匿名登录"改读 `TCB_ISANONYMOUS_USER` 这个专门字段**，
     不读 `LOGINTYPE`。这个判断方式是反编译确认的——js-sdk 3.10.2
     的 `getUserInfo()`（Node 运行时实现）内部就是用
     `"true" === TCB_ISANONYMOUS_USER` 判断匿名的，从来没有用过
     `LOGINTYPE`。但 `TCB_ISANONYMOUS_USER` 不在 `getAuthContext()`
     的返回值里（`INodeAuthContext` 类型只有
     `uid`/`loginType`/`appId`/`openId`），所以改用
     `app.getCloudbaseContext(context)` 直接读完整的
     `ICompleteCloudbaseContext`。
  3. `loginType` 原始值仍然保留在 `TrustedIdentity.rawLoginType` 里，
     仅用于日志/调试展示，代码里任何地方都不允许拿它做安全判断。
- **需要部署后验证**：`TCB_ISANONYMOUS_USER` 在真实匿名登录场景下确实
  会被设为 `"true"` 字符串——这是反编译 `getUserInfo()` 的实现推出来的
  预期行为，但本地没有办法起一个真实的匿名登录会话去验证这个字段真的会
  被设置。见上面第 4 步的验证步骤（页面上会显示"服务端是否确认为匿名
  登录"，如果一直显示"不能确认"，说明这个字段的假设也需要重新调查）。

### 官方推荐的 `getUserInfo()` 写法在本项目实际安装的 SDK 版本下编译不过

- CloudBase 官方 AI 工具包（CloudBase-AI-Toolkit）的 Node Auth 指南
  推荐的写法是：
  ```ts
  const { openId, appId, uid, customUserId } = auth.getUserInfo()
  ```
- 但本地验证（用本项目实际安装的 `@cloudbase/js-sdk@3.10.2` 做了一次
  独立的 tsc 编译测试）确认这段代码**编译报错**：
  `core.d.ts`（SDK 的 Web 入口类型声明）把 `getUserInfo()` 标成了
  `@deprecated` 的 `(): Promise<IUserInfo>`，和 Node 运行时实测返回的
  同步对象 `{openId, appId, uid, customUserId, isAnonymous}`
  （反编译确认）完全不是一回事——按 `Promise<IUserInfo>` 这个类型，
  TypeScript 不允许直接解构出 `openId`/`uid` 这些字段。
- **本项目的处理方式**：改用 `getAuthContext(context)`——它在
  `core.node.d.ts`（Node 专属类型声明）里有单独且与运行时行为一致的
  类型（`(context?: any) => INodeAuthContext`），返回
  `{ uid, loginType, appId?, openId? }`。完整的对比和反编译证据记录在
  `functions/room/src/lib/auth-context.ts` 的注释里。
- **需要注意（已过时，仅保留作调查过程记录）**：`getAuthContext()` 不返回
  `isAnonymous` 字段。这里原先记录过"本项目用 `loginType === 'ANONYMOUS'`
  判断是否匿名登录"，但这个判断方式后来被证明是错的（见下面
  "服务端 `loginType` 字段不能用来判断……"这一节的完整说明）——
  现在改成直接读 `TCB_ISANONYMOUS_USER` 这个专门字段，不再用
  `getAuthContext()` 的返回值，也不再依赖 `loginType`。

### 云函数实例复用时，环境变量驱动的身份识别是否逐请求刷新——部分确认，部分未验证

- 已确认（查阅腾讯云官方 SCF 文档）：本项目两个云函数都是 Event 类型
  （`cloudbaserc.json` 没有设置 `isHTTP`），Event 类型云函数的运行实例
  **默认单实例单并发**——这个"单实例多并发"特性官方文档明确写了
  只支持 Web/HTTP 类型函数。也就是说，不存在"同一个实例同一时刻
  处理两个并发请求、互相读到对方身份"这种最坏情况。
- 未验证（本地无法验证）：实例被*先后*复用处理不同调用者的请求时
  （冷启动后的热实例复用，这件事本身官方文档确认会发生），
  运行时/网关是否会在分发*每一次*新请求之前，把身份相关的环境变量
  正确刷新成*这次调用*的调用者，而不是遗留上一次调用的值。
  反编译确认 SDK 的 `getEnv()` 实现本身没有做内部缓存（每次调用都读取
  当前的 `process.env`），所以只要平台确实逐请求更新这个环境变量，
  这里就是安全的，但"平台确实逐请求更新"这个前提本身没有找到
  官方文档的逐字确认。见上面第 4 步的验证方法。

### `db.runTransaction` / `db.startTransaction` 不在 js-sdk 3.10.2 类型声明中，但运行时存在

- 已安装的 `@cloudbase/js-sdk@3.10.2` 的 `core.d.ts` 中，
  `cloudbase.database.App`（`app.database()` 的返回类型）**没有声明**
  `runTransaction` / `startTransaction`，只声明了 `collection()` /
  `runCommands()`。
- 运行时实测（`Object.keys(app.database())`）显示实际对象上确实挂载了
  这两个方法，且 `runTransaction` 反编译后的签名与 `@cloudbase/node-sdk`
  文档描述的 `runTransaction(callback, times?)` 一致（内部实现是：
  创建 Transaction、调用传入的 callback、成功则 `commit()`、
  callback 抛错则捕获并判断是否已经 `inited` 决定如何处理）。
- 这是"类型声明落后于实际实现"的情况：`@cloudbase/node-sdk` 的
  `types/db.d.ts` 明确声明了这两个方法，`@cloudbase/js-sdk@3.10.2` 的
  `core.d.ts` 却没有。
- **本项目的处理方式**：在 `functions/room/src/lib/transaction-types.ts`
  里用本地最小类型声明把实际用到的方法/返回值形状重新声明出来，不用 `any`
  绕过类型检查，并在注释里写明这是为了弥补上游类型声明缺失。
- **这是待联调风险，不是已验证的行为**：事务的真实原子语义（跨集合写入
  失败时是否整体回滚、并发事务之间如何隔离）、是否有专门的事务收费/
  配额限制，都没有在真实 CloudBase 环境下测试过。见上面第 5 步。
  等官方修复类型声明后，可以删除 `transaction-types.ts` 这个本地补丁文件。

### `dir` 字段的路径解析行为——已通过阅读 CLI 源码确认

- `@cloudbase/cli@3.8.7` 的 `tcb fn deploy` 命令里，`cloudbaserc.json`
  的 `functions[].dir` 字段解析逻辑（`resolveFunctionPath`）是
  `path.resolve(process.cwd(), func.dir)`——即相对**项目根目录**
  （`cloudbaserc.json` 所在目录）解析成绝对路径，可以指向任意嵌套路径
  （比如 `./functions/room/dist`），不要求这个路径的文件夹名和
  `name` 字段一致。这一点已经直接阅读 CLI 的实际源码确认，不是猜测。
- CloudBase 官方 AI 工具包的部分技能文档把 `dir`描述成"子目录名
  （覆盖 name）"，这是对典型用法的简化描述，不代表 `dir` 不能是
  嵌套路径——两者不矛盾，只是文档层级不同。
- 本项目的 `cloudbaserc.json` 让 `hello`/`room` 的 `dir` 分别指向
  `./functions/hello/dist` 和 `./functions/room/dist`，对应
  `build.mjs` 产出的、只包含 `index.js` + 精简 `package.json` 的
  独立部署单元，而不是把整个 `functions/room/`（含 `src/`、`test/`、
  未打包依赖）都上传。

### `CLOUDBASE_APIKEY` 环境变量的优先级高于 Event 云函数的管理员临时凭证（真实踩过的坑，第四轮修复）

- **现象**：`room` 部署后，`createRoom` 真实报错：
  ```
  数据库操作失败（getRoomByCode）：INVALID_CREDENTIALS Credentials are invalid.
  ```
  在此之前的假设（`docs/cloudbase-setup.md` 早期版本、`db.ts` 的注释）
  一直认为"`cloudbase.init({})` 在 Event 云函数里会自动获得管理员权限，
  不需要任何额外配置"——这个假设本身没有错，但遗漏了一种会让它失效的情况。
- **根因**（反编译 `@cloudbase/js-sdk@3.10.2` 的 `getSecretInfo()` 完整
  实现确认，和搜索到的官方文档说法互相印证，不是单一来源的推测）：
  SDK 内部决定"这次请求用什么凭证签名"的优先级链，从高到低完整是：
  1. `init({ accessKey })` 显式传入
  2. `init({ secretId, secretKey })` 显式传入
  3. `init({ auth: { secretId, secretKey } })` 显式传入
  4. **`process.env.CLOUDBASE_APIKEY`**（如果存在）
  5. `process.env.TENCENTCLOUD_SECRETID` + `TENCENTCLOUD_SECRETKEY`
     （Event 云函数文档里说的"自动注入的管理员临时凭证"）
  6. `context.extendedContext.tmpSecret`
  7. 空凭证

  第 4 条排在第 5 条之前。只要运行时环境里存在 `CLOUDBASE_APIKEY`
  这个环境变量，SDK 就会无条件优先使用它，把请求签名成
  `Authorization: Bearer <CLOUDBASE_APIKEY>`（accessKey/Publishable Key
  风格），完全不会走到第 5 条的管理员凭证分支——即使 `init()` 什么参数
  都没传。accessKey 风格鉴权只有匿名用户权限，对 ADMINONLY 集合没有
  读写权限，这正好对应观察到的 `INVALID_CREDENTIALS`。

  搜索到的官方文档佐证：`CLOUDBASE_APIKEY` 被描述为"属于最高优先级的
  认证方式之一"，且 CloudBase 近期在平台层面推广用这种可管理、可吊销的
  环境 API Key 方式统一云函数的资源访问鉴权——这与反编译结果里
  `accessKey` 排在 `secretId`/`secretKey` 环境变量前面的顺序完全吻合。
- **本项目的处理方式**：`functions/room/src/lib/cloudbase-app.ts`
  显式读取 `process.env.TENCENTCLOUD_SECRETID`/`SECRETKEY`/
  `SESSIONTOKEN`（这些本来就是运行时自动注入的、不是我们自己生成或存储的
  凭证），传给 `cloudbase.init()`，利用优先级链第 2 条压过第 4 条的
  `CLOUDBASE_APIKEY`。这几个环境变量缺失时退回 `cloudbase.init({})`，
  不引入新的失败模式。
- **需要部署后验证**：`CLOUDBASE_APIKEY` 为什么会出现在这个具体环境里
  （是账号层面的默认配置，还是某次操作带进来的）没有 100% 确认，只能确认
  "如果它存在，会被优先使用，且这个优先级解释完全吻合观察到的报错现象"。
  部署后用新增的 `devDbHealthCheck` action（见上面第 6 步）确认连通性
  恢复正常，这是对修复效果的验证，不是对"为什么会有这个环境变量"这件事
  本身的验证——后者如果还想刨根问底，需要去控制台"环境 → API Key 管理"
  里确认是否确实存在一个绑定到这个环境的 API Key。
- **后续更新**：这轮修复部署后，`devDbHealthCheck` 仍然返回
  `dbConnected: false`——说明这个方向本身大概率是对的（没有改回 `{}`），
  但还有别的问题没解决，见下一条记录。

### `@cloudbase/signature-nodejs` 是 js-sdk 的可选依赖，可能没有被云端安装（第五轮修复，未完全确认）

- **背景**：第四轮修复（显式传 `secretId`/`secretKey`）部署后，
  `devDbHealthCheck` 仍然返回 `dbConnected: false`，但当时没有记录足够的
  诊断信息来确认具体是哪一步失败（`tcb_log` 为空）。
- **排查发现**（反编译确认，真实存在的风险点，但**还没有确认这就是
  dbConnected: false 的真正原因**）：显式传入 `secretId`/`secretKey` 后，
  Node 环境下给请求签名实际依赖 `@cloudbase/signature-nodejs`——SDK 内部
  用 `optionalRequire()` 按需加载它：
  ```js
  function b() {
    return y || (e = optionalRequire(["@cloudbase","/","signature-nodejs"],
      "缺少依赖 @cloudbase/signature-nodejs，请执行以下命令安装：\n\n" +
      "  npm install @cloudbase/signature-nodejs\n\n" +
      "该依赖用于 Node 环境下的请求签名。"),
      y = (e?.sign) || null), y
  }
  ```
  `optionalRequire` 的实现是：
  ```js
  function optionalRequire(e, t) {
    if (!isNodeRuntime()) return null
    var n = e.join(""), r = getRuntimeRequire()
    if (!r) return null
    try { return r(n) } catch (e) { return t && console.error(t), null }
  }
  ```
  **加载失败时不抛异常，只是 `console.error` 一行安装提示，把签名函数
  设为 `null`**——下游代码拿到 `null` 后续行为未知（本地没有触发过这个
  分支，不知道它具体会在哪一步报什么错）。
- **这个包的供应链地位**：在 `@cloudbase/js-sdk@3.10.2` 自己的
  `package.json` 里，`@cloudbase/signature-nodejs` 是
  **`optionalDependencies`**，不是 `dependencies`。npm 的
  `optionalDependencies` 设计成"装不上也不影响整体安装成功"——如果
  CloudBase 云端 `installDependency: true` 执行 npm 安装时用了跳过可选
  依赖的方式，这个包可能没有被装上。**本地没有找到 CloudBase 官方文档
  明确说明云端安装是否跳过 optionalDependencies**，这是真实的未知项，
  不是我们确认过的事实。
- **佐证（不是直接证据，但方向一致）**：已经不再维护、但曾经是"官方
  推荐 Node 方案"的 `@cloudbase/node-sdk@3.18.3`，在它自己的
  `package.json` 里把 `@cloudbase/signature-nodejs` 列为**普通依赖**
  （版本 `2.2.0`），不是可选的——这从侧面印证"这个包对 Node 环境下的
  签名链路是必需的，不应该被当作可选"这个判断方向。
- **本项目的处理方式**：
  1. `functions/room/package.json` 新增 `@cloudbase/signature-nodejs@2.0.0`
     作为普通依赖。
  2. `functions/room/build.mjs` 生成的 `dist/package.json` 现在也显式
     声明这个依赖，不再依赖"作为 js-sdk 的可选依赖被动装上"。
  3. 新增 `functions/room/src/lib/db-diagnostics.ts`，记录足够的诊断信息
     （见上面第 3 步和第 6 步），这样如果这次修复还是没解决问题，
     至少能从日志里看到准确的 `error.code` 和凭证来源，不用再靠猜测。
- **这不是已确认的根因，是一个有依据的加固**：到目前为止，本地找不到
  办法在没有真实 CloudBase 云函数运行时的情况下，确认"可选依赖没装上"
  这件事是否真的发生过。部署后如果 `devDbHealthCheck` 恢复
  `dbConnected: true`，可以倒推这是真正的根因之一；如果仍然失败，
  日志里的 `classification`/`resolved-credential-source` 会告诉下一步
  该往哪个方向查。

### `collection.doc(id).get()` 对不存在文档的行为未经确认（已做防御性处理，不是已验证行为）

- **调查过程**：想确认"按 ID 查一个不存在的文档"在当前
  `@cloudbase/js-sdk@3.10.2` 下到底会怎样，查到了互相印证但不完全一致的
  线索：
  1. CloudBase 文档型数据库的 HTTP API 文档明确写了单文档查询接口
     （Get Single Document）在文档不存在时返回 `404 DOCUMENT_NOT_FOUND`。
  2. 微信小程序云开发的 `wx-server-sdk`（和 CloudBase 同源技术栈）文档
     写明 `doc().get()` 默认在查不到记录时**抛出异常**，有一个
     `throwOnNotFound`（默认 `true`）配置项可以改成"不抛异常、返回空结果"。
  3. 但 `@cloudbase/js-sdk@3.10.2` 的类型声明和反编译结果里，都**没有
     找到** `throwOnNotFound` 这个配置项，`GetRes` 类型本身又同时声明了
     `data: any[]`（暗示"查不到就是空数组"）和可选的 `code?`/`message?`
     （暗示"也可能带错误码地成功 resolve"）。
  - **结论：本项目无法确认这个具体 SDK 版本在文档不存在时是 resolve
    空数组还是 reject 异常**，本地环境（没有真实的 CloudBase 网络连接）
    也无法通过实测来确认。
- **本项目的处理方式**：`functions/room/src/lib/db-errors.ts` 的
  `getDocOrNull` 同时兼容两种可能性——resolve 空结果按"不存在"处理；
  reject 异常时检查错误信息里是否有"文档不存在"类的关键词
  （`DOCUMENT_NOT_FOUND`/`NOT_FOUND`/`404`/`not found`），命中则按
  "不存在"处理，不命中则当作真实数据库异常（权限/网络/配额等）向上抛出，
  不会被误判成"房间不存在"而悄悄吞掉。
- **这是启发式的防御性处理，不是已验证的行为**：如果真实环境下的错误
  信息用了这里列举之外的措辞，`getDocOrNull` 会把它当成真实异常抛出
  （返回 `INTERNAL_ERROR` 而不是业务错误码 `ROOM_NOT_FOUND`），这是故意
  选择的保守方向——宁可多报一次"内部错误"，也不要把真实的权限/网络问题
  误判成"数据不存在"从而掩盖真实故障。需要部署后用上面第 7 步的方法验证，
  如果发现关键词列表不够用，要回来扩充。

### 房间码唯一性不是数据库级约束

- `createRoom` 用"生成随机 6 位码 -> 查询是否已被占用 -> 冲突则重试（最多 5 次）"
  的方式，而不是数据库唯一索引 + 写入冲突捕获重试。存在极低概率的竞态窗口：
  两个并发请求前后脚查到"未冲突"，然后都写入了同一个房间码。
- Milestone 1 接受这个风险。后续正式版本建议：
  1. 给 `roomCode` 建唯一索引（如果 CloudBase 数据库支持）。
  2. 写入时直接 `add()`，失败时捕获"唯一键冲突"错误再重新生成重试，
     而不是"先查后写"。

### 服务端人数门槛的 dev override（未实现，仅记录想法）

- `startGame` 的最少人数门槛写死在 `shared/constants.ts` 的 `MIN_PLAYERS`
  （当前是 3），不读取任何前端环境变量——这是刻意的，因为信任前端传来的配置
  等于前端可以伪造门槛。
- 如果以后真的需要本地单人调试，正确的做法是服务端自己的 dev-only 开关
  （比如只在特定的测试环境 ID 下生效，且这个判断逻辑本身在服务端），
  而不是客户端传参。Milestone 1 不实现这个，只在这里记录。
