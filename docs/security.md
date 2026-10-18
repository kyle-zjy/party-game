# 安全模型

## 核心原则：客户端不可信

这是一个多人游戏，必须 Server Authoritative（服务端权威）。客户端永远只能
**发送意图**，不能发送结果。

未来游戏逻辑里，客户端发送的是这些意图：

```
ROLL_DICE
BUY_PROPERTY
PLAY_CARD
HEART_BUZZ
AVALON_VOTE
END_TURN
```

下面这些结果，必须由云函数计算，客户端不能自己决定、也不能把"我觉得应该是什么结果"
当参数传给服务端：

- 骰子点数
- 玩家在棋盘上的位置
- 金币变化
- 地产归属
- 抽到的牌
- 手牌是否合法
- 德州扑克的随机发牌
- 阿瓦隆的身份分配
- 德国心脏病谁先拍对
- 游戏的胜负判定

Milestone 1 虽然规则简单（只有房间大厅），但同样的原则适用：

- 骰子/金币/地产 Milestone 1 还不存在，不涉及。
- 但"谁是房主""能不能开始游戏""房间状态是什么"——这些判断全部在云函数里做，
  客户端的 UI 状态只是对服务端状态的展示，不是决策依据。

## 身份模型

- 真正可信的身份是 CloudBase 登录后的 `uid`，由云函数运行时从可信上下文中解析
  （`app.getCloudbaseContext(context)` 的 `TCB_UUID` 字段，封装在
  `functions/common/identity.ts` 里，hello 和 room 共用），不接受
  `event`（客户端传入的参数）里的任何 uid/playerId 字段。
- **"是否已认证"的判断不依赖 `loginType`**——这是真实踩过的坑：早期实现
  用 `loginType === 'ANONYMOUS'` 判断是否是合法匿名用户，真实 CloudBase
  环境的运行日志证明 Authentication v2 下 `loginType` 可以是 `"OAuth"`，
  即使这次登录其实是 `signInAnonymously()` 产生的。现在的判断只看
  `uid` 是否存在、非空、且不等于 CloudBase 文档里提到的固定公共占位身份
  `"anon"`；"是否匿名登录"改读专门的 `TCB_ISANONYMOUS_USER` 字段。
  完整调查过程见 [docs/next-remote-steps.md](./next-remote-steps.md)。
- `playerId` 是展示用的随机字符串，对外暴露在公开 Room 文档里，但它只是一个标签，
  不是身份凭证——拿着别人的 playerId 也无法冒充对方，因为所有写操作都是按 uid 校验权限。

## 当前（Milestone 1）各集合的访问策略

`rooms`、`players` 两个集合在 CloudBase 控制台里已经创建为 **ADMINONLY**
（仅云函数的环境身份能读写，这是已经落地的真实配置，不是本文档的建议）：

| 集合 | 客户端读 | 客户端写 | 云函数（环境身份）读写 |
|---|---|---|---|
| `rooms` | 禁止（ADMINONLY，前端 SDK 无论 `get()`/`where()` 还是 `watch()` 都没有权限） | 禁止 | 可以 |
| `players`（uid -> playerId 映射） | 禁止 | 禁止 | 可以 |
| `game_events`（预留，M1 不写入） | 未创建 | 未创建 | — |

客户端拿房间状态完全经过云函数的 `getRoomState` action：服务端用可信
`uid` 校验调用者是不是房间成员，非成员返回 `NOT_MEMBER`，不会泄漏任何
房间信息；成员只能拿到 `Room` 类型里定义好的公开字段（不含任何玩家的
uid、身份牌、底牌或私有状态——这是数据模型设计阶段就保证的，不是在
`getRoomState` 里临时过滤出来的）。前端通过低频轮询（默认 5 秒，后台
暂停）反复调用这个 action，而不是直接对数据库建立连接。完整说明见
[docs/architecture.md](./architecture.md) 的"实时同步"章节。

**重要更正（历史记录，供参考）**：更早的草稿设想过"用 `auth.uid != null`
之类的规则允许房间成员直接读 `rooms`"，这是不安全的——`auth.uid != null`
只能确认"请求方已登录"，不能确认"请求方是这个房间的成员"。实际创建数据库
时直接选择了更保守的 ADMINONLY，彻底避免了这个问题，具体规则讨论和
CloudBase 规则语言的语法限制见
[docs/cloudbase-security-rules.md](./cloudbase-security-rules.md)。

## 未来：私密状态

手牌、德州底牌、阿瓦隆身份这些信息，以后会放进一个独立的 `private_states` 集合，
不会和 `rooms` 混在一起。原则是：

- 每个文档只属于一个玩家。
- 安全规则限定"只有本人能读"。
- 写入只能通过云函数（校验游戏规则后写入），客户端不能直接写。

Milestone 1 不创建这个集合，这里只是提前把设计原则写清楚。

## 客户端不应该看到服务端的内部错误细节

这也是安全模型的一部分：即使是"内部错误"这种看起来无害的信息，也不应该
把数据库异常的原始文本（比如凭证错误、具体的调用上下文）发给客户端。
`RoomError` 的 `message` 字段（发给客户端）和 `internalDetail` 字段
（只进服务端日志）是分开的，`toApiError()` 只序列化前者。这不是凭空加的
设计，是真实踩过的坑——早期实现曾经把完整的数据库异常文本直接发给客户端，
见 [docs/cloudbase-setup.md](./cloudbase-setup.md) 和
[docs/next-remote-steps.md](./next-remote-steps.md) 的记录。

## 已知的 Milestone 1 风险

1. **房间码唯一性**：`createRoom` 用"查询后创建"的方式生成不重复的 6 位房间码，
   这不是数据库级别的唯一约束，存在极低概率的竞态窗口。见
   [docs/next-remote-steps.md](./next-remote-steps.md)。
2. **乐观锁重试次数有限**（3 次）：高并发写入同一个房间时，极端情况下可能在重试耗尽后
   返回 `CONFLICT`，需要客户端提示用户重试一次。
3. **房主掉线不会自动转移**：只有在房主*主动*调用 `leaveRoom` 时才会转移房主。
   纯粹的掉线（`online=false`）不会触发转移——这是刻意的设计，因为 `online`
   只是 UI 提示，不是可信的在线状态来源。
