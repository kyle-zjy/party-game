import { afterEach, describe, expect, it } from 'vitest'
import cloudbase from '@cloudbase/js-sdk'

/**
 * 这组测试直接对真实的 `@cloudbase/js-sdk@3.10.2` 发起 `collection.doc(id)
 * .update(data)` 调用，拦截它最终要发给网络层的请求体（不真的发网络请求），
 * 核对 SDK 实际生成的 `$set` payload 形状——不是靠阅读/模拟 SDK 源码推测，
 * 是真实调用公开 API 后观察到的行为。
 *
 * 这是用户报告的真实运行时 bug 的直接根因验证：
 * 第一次掷骰（开局后 `game.turn.lastRoll` 字段值是 `null`）时，
 * `collection.where({_id, version}).update({ game: nextGame })`
 * 如果直接传一个普通嵌套对象，SDK 会把它递归展开成 MongoDB 点路径更新
 * （`"game.turn.lastRoll.natural"`、`"game.turn.lastRoll.effective"` ……），
 * 而 MongoDB 不允许在值为 `null` 的父字段下创建点路径子字段，
 * 云端返回 `DATABASE_REQUEST_FAILED: Cannot create field 'effective' in
 * element {lastRoll: null}`，对应真实的 HTTP 500。
 *
 * 用 `db.command.set(value)` 包一层顶层字段值，可以让 SDK 把该字段作为一个
 * 不可再分的整体一次性 `$set`，不会被递归展开——这是
 * `frontend/src/lib/gameEngineDb.ts` / `gameRoomDb.ts` 里
 * `wrapPatchFieldsAsSet()` 的修复依据，这里直接验证它在真实 SDK 下确实
 * 按预期工作。
 */

function createTestApp() {
  // 每个测试用例独立 init 一个 app 实例，不复用 frontend/src/lib/cloudbase.ts
  // 的模块级单例——避免互相污染，也不需要真实的 envId（这里只测试请求体的
  // 编码逻辑，不会真的发出网络请求，拦截 request.send 之后 envId 是什么
  // 完全不影响被测的编码行为）。
  return cloudbase.init({ env: 'unit-test-env' })
}

interface CapturedRequest {
  method: string
  data: unknown
}

/**
 * 拦截 Document/Query 实例的 request.send，返回捕获到的请求体，不发真实
 * 网络请求。`Document` 实例把这个属性公开为 `request`，`Query`（`where()`
 * 的返回值）则是私有的 `_request`——两者都要拦截，所以这里兼容两种属性名。
 */
function interceptSend(target: Record<string, unknown>): CapturedRequest[] {
  const captured: CapturedRequest[] = []
  const holder = (target.request ?? target._request) as { send: (...args: unknown[]) => unknown } | undefined
  if (!holder) throw new Error('找不到 request/_request 属性，SDK 内部结构可能已变化')
  holder.send = ((method: string, data: unknown) => {
    captured.push({ method, data })
    return Promise.resolve({ data: { updated: 1 }, requestId: 'test-request-id' })
  }) as typeof holder.send
  return captured
}

function parsedSetPayload(captured: CapturedRequest[]): Record<string, unknown> {
  expect(captured).toHaveLength(1)
  const data = captured[0]!.data as { data: string }
  const parsed = JSON.parse(data.data) as { $set: Record<string, unknown> }
  return parsed.$set
}

describe('CloudBase SDK update payload encoding (real SDK, no network)', () => {
  afterEach(() => {
    // 每个用例各自 init 独立 app，不需要清理模块级状态。
  })

  it('BUG REPRODUCTION: a raw nested object update expands into dotted paths', async () => {
    const app = createTestApp()
    const doc = app.database().collection('game_rooms').doc('room-1')
    const captured = interceptSend(doc as unknown as Record<string, unknown>)

    await doc.update({
      game: { turn: { lastRoll: { natural: 3, effective: 3, isNaturalSix: false } } },
    })

    const set = parsedSetPayload(captured)
    const keys = Object.keys(set)
    // 这正是会在 lastRoll 当前为 null 时触发 DATABASE_REQUEST_FAILED 的危险形状。
    expect(keys).toContain('game.turn.lastRoll.natural')
    expect(keys).toContain('game.turn.lastRoll.effective')
    expect(keys).toContain('game.turn.lastRoll.isNaturalSix')
    expect(keys).not.toContain('game')
  })

  it('FIX VERIFICATION: db.command.set() keeps the field as one atomic value, no dotted paths', async () => {
    const app = createTestApp()
    const doc = app.database().collection('game_rooms').doc('room-1')
    const captured = interceptSend(doc as unknown as Record<string, unknown>)

    const nextGame = { turn: { lastRoll: { natural: 3, effective: 3, isNaturalSix: false } } }
    await doc.update({ game: app.database().command.set(nextGame) })

    const set = parsedSetPayload(captured)
    const keys = Object.keys(set)
    expect(keys).toEqual(['game'])
    expect(keys.some((k) => k.includes('.'))).toBe(false)
    // 整个嵌套对象必须原样出现在 "game" 这一个键下面，没有被拆散成点路径。
    // SDK 会把数字额外编码成 EJSON 的 {$numberInt: "3"} 形式，这里只核对
    // 结构（嵌套层级、字段名）没有被拆散，不比较数字的具体 EJSON 包装形状。
    const game = set.game as { turn: { lastRoll: Record<string, unknown> } }
    expect(Object.keys(game.turn.lastRoll).sort()).toEqual(['effective', 'isNaturalSix', 'natural'])
    expect(game.turn.lastRoll.isNaturalSix).toBe(false)
  })

  it('FIX VERIFICATION: wrapping every top-level patch field produces zero dotted keys, even with multiple fields', async () => {
    const app = createTestApp()
    const doc = app.database().collection('game_rooms').doc('room-1')
    const captured = interceptSend(doc as unknown as Record<string, unknown>)

    const command = app.database().command
    const patch = {
      game: { turn: { lastRoll: null, pendingDecision: { kind: 'BUY_PROPERTY' } }, history: [{ id: 'h1' }] },
      version: 2,
      updatedAt: 123,
    }
    const wrapped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      wrapped[key] = command.set(value)
    }
    await doc.update(wrapped)

    const set = parsedSetPayload(captured)
    expect(Object.keys(set).sort()).toEqual(['game', 'updatedAt', 'version'])
    expect(Object.keys(set).some((k) => k.includes('.'))).toBe(false)
  })

  it('works the same way through collection.where(...).update(...) (the optimistic-lock path actually used in production)', async () => {
    const app = createTestApp()
    const query = app.database().collection('game_rooms').where({ _id: 'room-1', version: 1 })
    const captured = interceptSend(query as unknown as Record<string, unknown>)

    const command = app.database().command
    await query.update({ game: command.set({ turn: { lastRoll: { natural: 6, effective: 6, isNaturalSix: true } } }) })

    const set = parsedSetPayload(captured)
    expect(Object.keys(set)).toEqual(['game'])
  })
})

describe('CloudBase SDK update payload: Phase D.2 lady fields (real SDK, no network)', () => {
  it('a game with a king task, lady event and nested status is written as one atomic "game" field', async () => {
    const { initGameState } = await import('../../../shared/game/engine/initGame')
    const { applyRevealLadyCard } = await import('../../../shared/game/engine/turnEngine')
    const { applyKingWriteTask } = await import('../../../shared/game/engine/ladyEvents')
    const players = [0, 1, 2].map((i) => ({ uid: `u${i + 1}`, nickname: `P${i + 1}`, seat: i, isHost: i === 0, joinedAt: 1 }))
    let game = initGameState(players, 1000, 'tarot-17', () => 0)
    // 上一次写库时 ladyEvent / kingTask 都是 null：正是会触发点路径 bug 的形状
    expect(game.ladyEvent).toBeNull()
    expect(game.kingTask).toBeNull()
    game = { ...game, ladyDeck: ['H-K', ...game.ladyDeck.filter((c) => c !== 'H-K')], turn: { ...game.turn, phase: 'LADY_CARD' } }
    game = applyRevealLadyCard(game, 'u1', 2000).state
    game = applyKingWriteTask(game, 'u1', 'u1', game.ladyEvent!.eventId, '模仿一种动物叫三声', 2000)

    const app = createTestApp()
    const query = app.database().collection('game_rooms').where({ _id: 'room-1', version: 3 })
    const captured = interceptSend(query as unknown as Record<string, unknown>)
    const command = app.database().command
    await query.update({ game: command.set(game), version: command.set(4), updatedAt: command.set(5) })

    const set = parsedSetPayload(captured)
    expect(Object.keys(set).sort()).toEqual(['game', 'updatedAt', 'version'])
    expect(Object.keys(set).some((k) => k.includes('.'))).toBe(false)
    const written = set.game as Record<string, unknown> & {
      kingTask: Record<string, unknown>
      ladyEvent: Record<string, unknown>
      ladyStatus: Record<string, unknown>
    }
    expect(Object.keys(written.kingTask).sort()).toEqual(['content', 'createdAtTurn', 'creatorUid', 'receiverUid', 'resolvedAtTurn', 'status', 'taskId'])
    expect(written.kingTask.content).toBe('模仿一种动物叫三声')
    expect(written.kingTask.receiverUid).toBeNull()
    expect(written.ladyEvent.step).toBe('DONE')
    expect(Object.keys(written.ladyStatus).sort()).toEqual(['away', 'awayPassUids', 'crazyUid', 'kingUid', 'mistressUid', 'substitutePassUids'])
    expect(written.ladyRuleset).toBe('official')
  })
})
