# 数据模型（Milestone 1）

类型定义见 [shared/types.ts](../shared/types.ts)，错误码见
[shared/errors.ts](../shared/errors.ts)，常量见
[shared/constants.ts](../shared/constants.ts)。本文档只做说明，不重复贴代码。

## `rooms` 集合

每个房间一条文档。这个集合在 CloudBase 控制台里配置为 **ADMINONLY**，
客户端没有任何直接读写权限——拿到房间信息的唯一方式是云函数的返回值
（`createRoom`/`joinRoom`/`rejoinRoom` 的返回值，以及轮询用的
`getRoomState` action），不存在客户端直接 `watch()`/`get()` 这个集合的路径。

关键字段：

- `roomCode`：6 位数字，用户手动输入用的，和数据库文档 ID（`roomId`）是两回事。
- `status`：`WAITING | PLAYING | CLOSED`。
- `players`：`PublicPlayer[]`，**不含 uid**，只有 `playerId`（展示用随机 ID）。
- `version`：乐观锁版本号，每次服务端写入都 `version + 1`。客户端收到 watch
  推送时，如果 `version` 比本地记录的旧就丢弃（理论上不会发生，是防御性处理）。
- `lastEvent`：最近一次事件的摘要（谁加入/离开/房主变更/游戏开始），
  用于前端展示简单的提示文案，不是完整的事件日志。

**没有放进 `rooms` 的东西**：任何私密信息（手牌、德州底牌、阿瓦隆身份）。
这些以后会在独立的 `private_states` 集合里，见
[docs/security.md](./security.md) 的"未来：私密状态"一节。

## `players` 集合

uid -> playerId 的映射表，**只有云函数能访问**，客户端完全看不到。

- 文档 ID 固定为 `${roomId}_${uid}`，这样查找只需要一次精确 `get()`，
  不需要 `where()` 查询。
- `leftAt` 字段：WAITING 阶段真正离开房间时会设置这个字段
  （而不是删除文档），用来区分"从未加入过"和"加入过又离开了"——
  后者如果再次 `joinRoom`，会被当成新玩家重新加入（而不是 `rejoinRoom`），
  这是故意的：离开了的玩家原来的座位/playerId 已经让给别人了。

## `game_events` 集合（预留，Milestone 1 不写入）

Schema 已经在 `shared/types.ts` 里定义好了（`GameEvent`），但云函数目前
不会真的往这个集合写数据——Milestone 1 用 `rooms.lastEvent` 这个轻量字段
就够了，没必要为了一个"xx 加入了房间"的提示去多写一次数据库。

等到 Milestone 2+ 真正有游戏规则需要完整的事件回放/审计时，再开始写入这个集合。

## 房间码唯一性

`createRoom` 用"生成随机 6 位码 -> 查询是否已被占用 -> 冲突则重试（最多 5 次）"
的方式。这不是数据库层面的唯一约束，理论上存在极小概率的竞态窗口。
见 [docs/next-remote-steps.md](./next-remote-steps.md) 里的记录和后续建议。

## 房间过期

`WAITING` 或 `CLOSED` 状态的房间，如果 `updatedAt` 超过 24 小时没有更新，
视为"过期"：

- `joinRoom` 时会拒绝加入过期房间（返回 `ROOM_STALE`）。
- `createRoom` 生成房间码时，过期房间不算作"活跃冲突"，房间码可以被复用。

Milestone 1 只做"判定"，不做真正的清理/删除——过期房间的文档还留在数据库里，
只是不会再被正常流程使用。定时清理是以后的事。

## 并发控制

所有对 `rooms` 的修改都基于乐观锁：

```
where({ _id: roomId, version: expectedVersion })
  .update({ ...patch, version: expectedVersion + 1 })
```

如果 `updated` 返回 0，说明有并发写入抢先一步，调用方重新读取最新状态、
重新应用业务规则（比如座位分配要用最新的 players 数组）、再重试一次。
重试上限是 3 次（`functions/room/src/lib/retry.ts` 里的 `retryOnConflict`），
耗尽后返回 `CONFLICT`。

`createRoom`/`joinRoom` 因为要同时写 `rooms` 和 `players` 两个集合，
用了 `runTransaction`（见 `functions/room/src/lib/db.ts` 的注释，
这个方法存在类型声明缺口，详见
[docs/next-remote-steps.md](./next-remote-steps.md)）。
