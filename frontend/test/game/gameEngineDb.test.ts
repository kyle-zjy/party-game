import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameRoom, GameRoomPlayer } from '../../../shared/gameRoomTypes'
import type { GameState } from '../../../shared/game/types'

/**
 * 伪造一个最小化的 CloudBase 文档数据库，只实现 gameEngineDb.ts /
 * gameRoomDb.ts 实际用到的那几个方法（doc().get() / where().limit().get() /
 * where().update() / add()），用内存 Map 存文档，`update()` 真实模拟乐观锁
 * 语义（`where` 条件里的 `version` 必须和当前文档一致才会写入成功）。
 *
 * 这样可以在不连真实 CloudBase 环境的前提下，验证 gameEngineDb.ts 的乐观锁
 * 重试逻辑、"重复点击开局不重新发牌"等并发安全属性是否真的生效，而不是
 * 只靠纯函数引擎测试（那些测试不覆盖"版本冲突时重新读取重试"这条路径）。
 */
interface FakeDoc {
  _id: string
  version: number
  [key: string]: unknown
}

/**
 * 深拷贝进/出存储——模拟真实网络请求的序列化边界：真实 CloudBase 的
 * `get()`/`update()` 返回的是从网络反序列化出来的新对象，调用方拿到的
 * `room` 和数据库里实际存的文档不是同一个 JS 对象引用。如果这里偷懒直接
 * 返回 store 里的对象引用，`update()` 原地 `Object.assign` 修改文档时，
 * 会连带"污染"调用方已经读到手、以为是不可变快照的旧 `room` 对象，
 * 制造出真实环境不会出现的假象（这正是本文件最初几版测试失败的原因）。
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createFakeDb() {
  const store = new Map<string, FakeDoc>()
  let autoId = 0

  // 只有 game_rooms 一个集合，名字不用区分
  function collection(name: string) {
    void name
    return {
      doc(id: string) {
        return {
          async get() {
            const doc = store.get(id)
            return { data: doc ? [clone(doc)] : [] }
          },
        }
      },
      where(query: Record<string, unknown>) {
        function matches(doc: FakeDoc): boolean {
          return Object.entries(query).every(([k, v]) => doc[k] === v)
        }
        return {
          limit() {
            return {
              async get() {
                const data = [...store.values()].filter(matches).map(clone)
                return { data }
              },
            }
          },
          async update(patch: Record<string, unknown>) {
            const matched = [...store.values()].filter(matches)
            if (matched.length === 0) return { updated: 0 }
            for (const doc of matched) {
              Object.assign(doc, clone(patch))
            }
            return { updated: matched.length }
          },
        }
      },
      async add(doc: Record<string, unknown>) {
        autoId += 1
        const id = `fake-id-${autoId}`
        store.set(id, clone({ ...doc, _id: id }) as FakeDoc)
        return { id }
      },
    }
  }

  // `gameEngineDb.ts`/`gameRoomDb.ts` 的 `wrapPatchFieldsAsSet()` 会调用
  // `db().command.set(value)` 包一层每个顶层字段再提交更新（修复
  // DATABASE_REQUEST_FAILED 的点路径展开 bug，见两个文件里的详细注释）。
  // 真实 SDK 的 `.set()` 返回一个 Command 实例，让服务端把这个字段当整体
  // 原子替换；这个内存版假数据库的 `update()` 本来就是对每个顶层 key 做
  // `Object.assign`（浅层替换，不会递归展开成点路径），语义上已经等价于
  // "整字段替换"，所以这里 `.set()` 用恒等函数模拟即可——不需要真的构造
  // 一个 Command 包装对象，调用方代码不关心 `.set()` 返回值的具体类型，
  // 只会把它原样放进 `update()` 的 patch 对象里。
  const command = { set: (value: unknown) => value }

  return { collection, command, _store: store }
}

const fakeDb = createFakeDb()

vi.mock('../../src/lib/cloudbase', () => ({
  app: { database: () => fakeDb },
}))

function makeRoomPlayer(overrides: Partial<GameRoomPlayer> = {}): GameRoomPlayer {
  return { uid: 'uid-1', nickname: 'Alice', seat: 0, isHost: false, joinedAt: Date.now(), ...overrides }
}

async function seedWaitingRoom(players: GameRoomPlayer[]): Promise<GameRoom> {
  const db = fakeDb
  const room: Omit<GameRoom, '_id'> = {
    roomCode: '123456',
    status: 'WAITING',
    players,
    playerCount: players.length,
    minPlayers: 3,
    maxPlayers: 10,
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
  }
  const res = await db.collection('game_rooms').add(room)
  return { ...room, _id: res.id }
}


/**
 * 推进当前回合所有待处理的决定（任何种类），给只关心"掷骰持久化"的测试使用。
 * 房主 uid 固定为 u1（seedWaitingRoom 里的房主）。
 */
async function settleDecisions(state: GameRoom, uid: string): Promise<GameRoom> {
  const db = await import('../../src/lib/gameEngineDb')
  for (let i = 0; i < 6 && state.game!.turn.pendingDecision; i += 1) {
    const d = state.game!.turn.pendingDecision
    if (d.kind === 'BUY_PROPERTY') state = await db.buyPropertyAction(state._id, uid, false)
    else if (d.kind === 'CHOOSE_DRINK_TARGET') state = await db.chooseDrinkTargetAction(state._id, uid, state.game!.turnOrder.find((u) => u !== uid)!)
    else if (d.kind === 'TRUTH_OR_DARE') {
      state = d.choice === null ? await db.truthOrDareChoiceAction(state._id, uid, 'DARE') : await db.truthOrDareResultAction(state._id, uid, true)
    } else if (d.kind === 'CHOOSE_LOVERS') state = await db.chooseLoversAction(state._id, uid, state.game!.turnOrder[0]!, state.game!.turnOrder[1]!)
    else if (d.kind === 'TAROT_JUSTICE') state = await db.justiceSwapAction(state._id, 'u1', null, null)
    else state = await db.hostRulingAckAction(state._id, 'u1')
  }
  // K 国王传承（正式规则）：翻到 K 时完成任务并留下新任务
  const ev = state.game!.ladyEvent
  if (ev && ev.status === 'ACTIVE' && ev.rank === 'K') {
    if (ev.step === 'KING_PERFORM') state = await db.kingTaskResolveAction(state._id, 'u1', ev.eventId, true)
    state = await db.kingWriteTaskAction(state._id, ev.actingUid, ev.eventId, '模仿一种动物叫三声')
  }
  return state
}

describe('gameEngineDb: startGameWithEngine', () => {
  beforeEach(() => {
    fakeDb._store.clear()
  })

  it('initializes the game and flips status to PLAYING', async () => {
    const { startGameWithEngine } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', nickname: 'Alice', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', nickname: 'Bob', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', nickname: 'Carol', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const result = await startGameWithEngine(room._id, 'u1')
    expect(result.status).toBe('PLAYING')
    expect(result.game).toBeTruthy()
    expect(Object.keys(result.game!.players)).toHaveLength(3)
  })

  it('does not re-deal when called twice (repeated click / refresh safe)', async () => {
    const { startGameWithEngine } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const first = await startGameWithEngine(room._id, 'u1')
    const firstHoleCards = first.game!.players['u1']!.texasHoleCards
    const second = await startGameWithEngine(room._id, 'u1')
    expect(second.game!.players['u1']!.texasHoleCards).toEqual(firstHoleCards)
    expect(second.version).toBe(first.version) // 第二次调用没有真的再写一次
  })

  it('rejects starting when a non-host calls it', async () => {
    const { startGameWithEngine } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    await expect(startGameWithEngine(room._id, 'u2')).rejects.toThrow()
  })

  it('rejects starting below minimum players', async () => {
    const { startGameWithEngine } = await import('../../src/lib/gameEngineDb')
    const players = [makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }), makeRoomPlayer({ uid: 'u2', seat: 1 })]
    const room = await seedWaitingRoom(players)
    await expect(startGameWithEngine(room._id, 'u1')).rejects.toThrow()
  })
})

describe('gameEngineDb: version-conflict retry', () => {
  beforeEach(() => {
    fakeDb._store.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries rollDiceAction when a concurrent write changes the version first', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')

    // 模拟并发：在 rollDiceAction 第一次读取之后、写入之前，"另一个玩家的操作"
    // 先一步把 version 改掉，让 rollDiceAction 的第一次 update 乐观锁条件不匹配，
    // 验证它会重新读取最新 version 后重试一次，而不是直接报错放弃。
    const doc = fakeDb._store.get(started._id)!
    let interferenceDone = false
    const originalCollection = fakeDb.collection.bind(fakeDb)
    const spy = vi.spyOn(fakeDb, 'collection').mockImplementation((name: string) => {
      const real = originalCollection(name)
      return {
        ...real,
        where: (query: Record<string, unknown>) => {
          if (!interferenceDone && 'version' in query) {
            interferenceDone = true
            doc.version += 1 // 抢先一步修改底层存储，模拟别人先完成了一次写入
          }
          return real.where(query)
        },
      }
    })

    const result = await rollDiceAction(started._id, 'u1')
    expect(result.game!.turn.lastRoll).not.toBeNull()
    expect(interferenceDone).toBe(true) // 确认这次干扰真的发生过，不是测试本身没生效
    spy.mockRestore()
  })
})

describe('gameEngineDb: idempotent landing resolution through the db layer', () => {
  beforeEach(() => {
    fakeDb._store.clear()
  })

  it('rejects resolving the same landing twice via resolveLandingAction', async () => {
    const { startGameWithEngine, rollDiceAction, resolveLandingAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')
    await rollDiceAction(started._id, 'u1')
    await resolveLandingAction(started._id, 'u1')
    await expect(resolveLandingAction(started._id, 'u1')).rejects.toThrow()
  })
})

describe('gameEngineDb: raw CloudBase-style rejections never leak as "[object Object]"', () => {
  beforeEach(() => {
    fakeDb._store.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * 这组测试直接对应用户报告的真实 bug：确认数据库调用本身被拒绝
   * （不是 resolve 一个带 code 字段的失败结果，而是 `await ...get()`
   * 这一行本身 throw）时，即使拒绝的值是一个像 CloudBase SDK 可能产生的
   * 裸 `{code, message}` 对象（不是 `Error` 实例），调用方（gameRoomDb.ts /
   * gameEngineDb.ts 的 wrapDbCallError）捕获后也会转换成一个带可读中文
   * message 的 `RoomError`，而不是让原始对象一路冒泡到 UI 层被
   * `String()` 成 `"[object Object]"`。
   */
  it('wraps a plain-object rejection from doc().get() into a readable RoomError', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')

    const originalCollection = fakeDb.collection.bind(fakeDb)
    const spy = vi.spyOn(fakeDb, 'collection').mockImplementation((name: string) => {
      const real = originalCollection(name)
      return {
        ...real,
        doc: () => ({
          get: () => Promise.reject({ code: 'DATABASE_PERMISSION_DENIED', message: '当前用户没有权限执行此数据库操作' }),
        }),
      }
    })

    let caught: unknown
    try {
      await rollDiceAction(started._id, 'u1')
    } catch (err) {
      caught = err
    }
    spy.mockRestore()

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).not.toContain('[object Object]')
    expect(message).toContain('当前用户没有权限执行此数据库操作')
  })

  it('wraps a plain-object rejection from where().update() into a readable RoomError', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')

    const originalCollection = fakeDb.collection.bind(fakeDb)
    const spy = vi.spyOn(fakeDb, 'collection').mockImplementation((name: string) => {
      const real = originalCollection(name)
      return {
        ...real,
        where: (query: Record<string, unknown>) => ({
          ...real.where(query),
          update: () => Promise.reject({ code: 'DATABASE_REQUEST_FAILED', message: '数据库请求失败' }),
        }),
      }
    })

    let caught: unknown
    try {
      await rollDiceAction(started._id, 'u1')
    } catch (err) {
      caught = err
    }
    spy.mockRestore()

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).not.toContain('[object Object]')
    expect(message).toContain('数据库请求失败')
  })
})

describe('gameEngineDb: dice roll persistence end to end (regression for DATABASE_REQUEST_FAILED)', () => {
  beforeEach(() => {
    fakeDb._store.clear()
  })

  it('a fresh 3-player game starts with lastRoll === null', async () => {
    const { startGameWithEngine } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')
    expect(started.game!.turn.lastRoll).toBeNull()
  })

  it('the first roll of the game (transitioning lastRoll from null to an object) persists without throwing', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')
    expect(started.game!.turn.lastRoll).toBeNull()

    // 这一步正是用户报告的真实 bug 会炸的地方：lastRoll 从 null 第一次变成
    // 一个真正的对象。修复前这里会抛出包装过的 DATABASE_REQUEST_FAILED。
    const afterRoll = await rollDiceAction(started._id, 'u1')
    expect(afterRoll.game!.turn.lastRoll).not.toBeNull()
    expect(afterRoll.game!.turn.lastRoll!.natural).toBeGreaterThanOrEqual(1)
    expect(afterRoll.game!.turn.lastRoll!.natural).toBeLessThanOrEqual(6)
    expect(afterRoll.game!.turn.phase).toBe('LANDING')
  })

  it('a second roll later in the game (lastRoll transitioning from a real value back through null) also persists', async () => {
    const { startGameWithEngine, rollDiceAction, resolveLandingAction, advanceAfterLandingAction, revealLadyCardAction, skipTacticAction, endTurnAction } =
      await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    let state = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')

    // 走完 u1 的第一个回合（用一个很可能不触发需要处理的 pendingDecision 的小步数；
    // 如果真的触发了也直接按"放弃/确认"处理，不影响这里要验证的持久化行为）。
    state = await rollDiceAction(state._id, 'u1')
    state = await resolveLandingAction(state._id, 'u1')
    state = await settleDecisions(state, 'u1')
    state = await advanceAfterLandingAction(state._id, 'u1')
    if (state.game!.turn.phase === 'ROLLING') {
      // 自然 6 额外掷骰：再推进一次
      state = await rollDiceAction(state._id, 'u1')
      state = await resolveLandingAction(state._id, 'u1')
      state = await settleDecisions(state, 'u1')
      state = await advanceAfterLandingAction(state._id, 'u1')
    }
    state = await revealLadyCardAction(state._id, 'u1')
    state = await settleDecisions(state, 'u1')
    state = await skipTacticAction(state._id, 'u1')
    state = await endTurnAction(state._id, 'u1')

    expect(state.game!.turn.currentPlayerUid).toBe('u2')
    expect(state.game!.turn.lastRoll).toBeNull() // 新回合开始，lastRoll 被重置回 null

    // 第二位玩家掷骰——这一次是 lastRoll 从 null 再次变成对象，必须和第一次一样安全。
    const afterSecondRoll = await rollDiceAction(state._id, 'u2')
    expect(afterSecondRoll.game!.turn.lastRoll).not.toBeNull()
    expect(afterSecondRoll.game!.turn.currentPlayerUid).toBe('u2')
  })

  it('natural six grants an extra roll and both rolls persist correctly through the db layer', async () => {
    const { startGameWithEngine, rollDiceAction, resolveLandingAction, advanceAfterLandingAction } =
      await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    let state = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')
    // 开局塔罗是随机的；愚者下自然 6 不给额外掷骰（这是正确的规则），会让本测试偶发失败。
    // 直接把数据库里的世界塔罗固定为星星（不影响掷骰），只验证普通情况下的额外掷骰。
    const stored = fakeDb._store.get(state._id)! as unknown as { game: { currentTarotId: string } }
    stored.game.currentTarotId = 'tarot-17'

    // 固定随机数，强制第一次掷骰摇出自然 6，验证额外掷骰链路在真实 DB 层下
    // 也能正常持久化两次 lastRoll 写入（null -> 6 -> null -> 第二次数值）。
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    try {
      state = await rollDiceAction(state._id, 'u1')
    } finally {
      randomSpy.mockRestore()
    }
    expect(state.game!.turn.lastRoll!.natural).toBe(6)
    expect(state.game!.turn.lastRoll!.isNaturalSix).toBe(true)

    state = await resolveLandingAction(state._id, 'u1')
    state = await settleDecisions(state, 'u1')
    state = await advanceAfterLandingAction(state._id, 'u1')
    expect(state.game!.turn.phase).toBe('ROLLING')
    expect(state.game!.turn.extraRollPending).toBe(true)
    expect(state.game!.turn.lastRoll).toBeNull() // 额外掷骰前先被重置回 null——这也是 null->object 的路径

    // 额外掷骰：又一次从 null 变成真实对象，必须正常持久化。
    state = await rollDiceAction(state._id, 'u1')
    expect(state.game!.turn.lastRoll).not.toBeNull()
    expect(state.game!.turn.phase).toBe('LANDING')
  })

  it('a non-current player cannot roll the dice through the db-wired action', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')
    await expect(rollDiceAction(started._id, 'u2')).rejects.toThrow()
    // 确认失败没有意外地把 lastRoll 写进数据库。
    const stillNull = fakeDb._store.get(started._id)
    expect((stillNull as unknown as { game: { turn: { lastRoll: unknown } } }).game.turn.lastRoll).toBeNull()
  })

  it('repeated clicks on the dice button do not double-roll (second call fails, first result stands)', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')
    const first = await rollDiceAction(started._id, 'u1')
    const firstRoll = first.game!.turn.lastRoll
    // 第二次点击骰子：此时阶段已经是 LANDING，不再是 ROLLING，引擎会拒绝。
    await expect(rollDiceAction(started._id, 'u1')).rejects.toThrow()
    // 重新读取数据库，确认第一次的骰子结果没有被覆盖或清空。
    const { getGameRoomState } = await import('../../src/lib/gameRoomDb')
    const reread = await getGameRoomState(started._id)
    expect(reread!.game!.turn.lastRoll).toEqual(firstRoll)
  })

  it('refreshing (re-reading the room from the db) returns the already-persisted dice roll', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const { getGameRoomState } = await import('../../src/lib/gameRoomDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')
    const afterRoll = await rollDiceAction(started._id, 'u1')

    // 模拟"刷新页面"：不使用 rollDiceAction 返回值，而是像轮询/首次加载那样
    // 独立地重新从数据库读一次房间状态。
    const reloaded = await getGameRoomState(started._id)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.game!.turn.lastRoll).toEqual(afterRoll.game!.turn.lastRoll)
    expect(reloaded!.game!.turn.phase).toBe('LANDING')
  })

  it('a version conflict during roll does not silently overwrite another player-triggered change', async () => {
    const { startGameWithEngine, rollDiceAction } = await import('../../src/lib/gameEngineDb')
    const players = [
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ]
    const room = await seedWaitingRoom(players)
    const started = await settleDecisions(await startGameWithEngine(room._id, 'u1'), 'u1')

    // 模拟并发：rollDiceAction 读取之后、写入之前，有"另一个玩家的操作"
    // 先一步把 history 改了（版本号也随之增加）——验证 rollDiceAction 重试后
    // 看到的是包含这次外部修改之后的最新状态，而不是用旧版本号强行覆盖。
    const doc = fakeDb._store.get(started._id)!
    let interferenceDone = false
    const originalCollection = fakeDb.collection.bind(fakeDb)
    const spy = vi.spyOn(fakeDb, 'collection').mockImplementation((name: string) => {
      const real = originalCollection(name)
      return {
        ...real,
        where: (query: Record<string, unknown>) => {
          if (!interferenceDone && 'version' in query) {
            interferenceDone = true
            const game = doc.game as { history: unknown[] }
            game.history = [...game.history, { id: 'external-h', at: 999, message: '外部并发修改' }]
            doc.version += 1
          }
          return real.where(query)
        },
      }
    })

    const result = await rollDiceAction(started._id, 'u1')
    spy.mockRestore()

    expect(interferenceDone).toBe(true)
    // 外部修改的那条历史记录必须还在，没有被这次掷骰的写入覆盖掉。
    const historyMessages = (result.game!.history as { message: string }[]).map((h) => h.message)
    expect(historyMessages).toContain('外部并发修改')
    expect(result.game!.turn.lastRoll).not.toBeNull()
  })
})

describe('gameEngineDb: lady deck persistence through game_rooms (Q10)', () => {
  beforeEach(() => {
    fakeDb._store.clear()
  })

  it('reveal draws from the persisted deck; re-reading the room shows the same card, window and smaller deck', async () => {
    const db = await import('../../src/lib/gameEngineDb')
    const { getGameRoomState } = await import('../../src/lib/gameRoomDb')
    const room = await seedWaitingRoom([
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ])
    const started = await settleDecisions(await db.startGameWithEngine(room._id, 'u1'), 'u1')
    expect(started.game!.ladyDeck).toHaveLength(52)

    // 直接把阶段推到翻主牌，只验证牌堆持久化
    const stored = fakeDb._store.get(started._id)! as unknown as { game: GameState }
    stored.game.turn.phase = 'LADY_CARD'
    const topCard = stored.game.ladyDeck[0]!

    const revealed = await db.revealLadyCardAction(started._id, 'u1')
    expect(revealed.game!.turn.revealedLadyCardId).toBe(topCard)

    const reloaded = await getGameRoomState(started._id)
    expect(reloaded!.game!.turn.revealedLadyCardId).toBe(topCard)
    expect(reloaded!.game!.recentLadyCards).toEqual([topCard])
    expect(reloaded!.game!.ladyDeck).toHaveLength(51)
    expect(reloaded!.game!.ladyDeck).not.toContain(topCard)

    // 重复点击/重试：被拒绝，不会再抽一张
    await expect(db.revealLadyCardAction(started._id, 'u1')).rejects.toThrow()
    const again = await getGameRoomState(started._id)
    expect(again!.game!.ladyDeck).toHaveLength(51)
  })
})

describe('gameEngineDb: lady card events through game_rooms (Phase D.2)', () => {
  beforeEach(() => {
    fakeDb._store.clear()
  })

  async function startedRoom(ruleset: 'official' | 'candidate-preview' = 'official') {
    const db = await import('../../src/lib/gameEngineDb')
    const room = await seedWaitingRoom([
      makeRoomPlayer({ uid: 'u1', seat: 0, isHost: true }),
      makeRoomPlayer({ uid: 'u2', seat: 1 }),
      makeRoomPlayer({ uid: 'u3', seat: 2 }),
    ])
    const started = await settleDecisions(await db.startGameWithEngine(room._id, 'u1', ruleset), 'u1')
    return { db, started }
  }

  /** 直接改存储里的文档：把 uid 设为当前玩家、阶段推到翻牌，指定牌放在牌堆顶 */
  function stageReveal(roomId: string, uid: string, cardId: string) {
    const stored = fakeDb._store.get(roomId)! as unknown as { game: GameState }
    const g = stored.game
    g.currentPlayerIndex = g.turnOrder.indexOf(uid)
    g.turn = { ...g.turn, currentPlayerUid: uid, phase: 'LADY_CARD', revealedLadyCardId: null, pendingDecision: null }
    g.ladyDeck = [cardId, ...g.ladyDeck.filter((c) => c !== cardId)]
    g.recentLadyCards = []
    g.ladyEvent = null
  }

  it('K king succession across three browsers: write → refresh → next king performs → new task; all synced', async () => {
    const { db, started } = await startedRoom('official')
    const { getGameRoomState } = await import('../../src/lib/gameRoomDb')
    stageReveal(started._id, 'u1', 'H-K')

    let room = await db.revealLadyCardAction(started._id, 'u1')
    const ev1 = room.game!.ladyEvent!
    expect(ev1).toMatchObject({ rank: 'K', step: 'KING_WRITE', actingUid: 'u1' })

    // 另外两个浏览器读到同一个事件
    for (const viewer of ['u2', 'u3']) {
      void viewer
      const seen = await getGameRoomState(started._id)
      expect(seen!.game!.ladyEvent).toEqual(ev1)
    }

    await db.kingWriteTaskAction(started._id, 'u1', ev1.eventId, '模仿一种动物叫三声')
    // 重复点击：被拒绝，任务不变
    await expect(db.kingWriteTaskAction(started._id, 'u1', ev1.eventId, '另一条')).rejects.toThrow()
    const refreshed = await getGameRoomState(started._id)
    expect(refreshed!.game!.kingTask).toMatchObject({ content: '模仿一种动物叫三声', creatorUid: 'u1', status: 'PENDING' })
    expect(refreshed!.game!.turn.phase).toBe('TACTIC')

    await db.endTurnAction(started._id, 'u1')
    stageReveal(started._id, 'u2', 'S-K')
    room = await db.revealLadyCardAction(started._id, 'u2')
    const ev2 = room.game!.ladyEvent!
    expect(ev2).toMatchObject({ step: 'KING_PERFORM', text: '模仿一种动物叫三声' })
    expect(room.game!.kingTask).toMatchObject({ status: 'IN_PROGRESS', receiverUid: 'u2' })

    // 非房主不能确认完成
    await expect(db.kingTaskResolveAction(started._id, 'u3', ev2.eventId, true)).rejects.toThrow()
    await db.kingTaskResolveAction(started._id, 'u1', ev2.eventId, true)
    await expect(db.kingTaskResolveAction(started._id, 'u1', ev2.eventId, true)).rejects.toThrow()
    room = await db.kingWriteTaskAction(started._id, 'u2', ev2.eventId, '给大家讲一个冷笑话')

    const final = await getGameRoomState(started._id)
    expect(final!.game!.kingTask).toMatchObject({ content: '给大家讲一个冷笑话', creatorUid: 'u2', status: 'PENDING' })
    expect(final!.game!.kingTaskHistory).toHaveLength(1)
    expect(final!.game!.kingTaskHistory[0]).toMatchObject({ status: 'COMPLETED', receiverUid: 'u2' })
    expect(final!.version).toBe(room.version)
  })

  it('official room: candidate cards keep the host ruling even when the client asks for preview in production', async () => {
    const { started } = await startedRoom('official')
    expect(started.game!.ladyRuleset).toBe('official')
    const db = await import('../../src/lib/gameEngineDb')
    stageReveal(started._id, 'u1', 'S-6')
    const room = await db.revealLadyCardAction(started._id, 'u1')
    expect(room.game!.ladyEvent).toBeNull()
    expect(room.game!.turn.pendingDecision?.kind).toBe('HOST_RULING')
    expect(room.game!.pendingDrinkAcks).toEqual([])
    // 开发入口在正式房间被拒绝
    await expect(db.devStackLadyDeckAction(started._id, 'u1', '9')).rejects.toThrow()
  })

  it('candidate-preview room (dev only): 干杯 + 小姐 hook runs on the db write, and dev stacking is host-only', async () => {
    const { db, started } = await startedRoom('candidate-preview')
    expect(started.game!.ladyRuleset).toBe('candidate-preview')
    await expect(db.devStackLadyDeckAction(started._id, 'u2', '2')).rejects.toThrow()

    stageReveal(started._id, 'u1', 'S-2')
    await db.revealLadyCardAction(started._id, 'u1')
    await db.endTurnAction(started._id, 'u1')
    stageReveal(started._id, 'u2', 'S-J')
    const room = await db.revealLadyCardAction(started._id, 'u2')
    // J：u2 的上家 u1 喝；u1 正是小姐，所以不额外陪喝
    expect(room.game!.pendingDrinkAcks.map((a) => a.targetUid)).toEqual(['u1'])

    await db.endTurnAction(started._id, 'u2')
    stageReveal(started._id, 'u3', 'S-Q')
    const q = await db.revealLadyCardAction(started._id, 'u3')
    // Q：u3 的下家 u1 喝（小姐自己被罚，不陪）
    expect(q.game!.pendingDrinkAcks.filter((a) => a.accompany)).toHaveLength(0)
  })

  it('duel dice are rolled once per click and stored in shared state; stale event ids are rejected', async () => {
    const { db, started } = await startedRoom('candidate-preview')
    const { getGameRoomState } = await import('../../src/lib/gameRoomDb')
    stageReveal(started._id, 'u1', 'S-9')
    let room = await db.revealLadyCardAction(started._id, 'u1')
    const id = room.game!.ladyEvent!.eventId
    await db.duelChooseTargetAction(started._id, 'u1', id, 'u2')
    room = await db.duelRollAction(started._id, 'u1', id, 'actor')
    const actorRoll = room.game!.ladyEvent!.duelRounds[0]!.actorRoll
    expect(actorRoll).toBeGreaterThanOrEqual(1)
    await expect(db.duelRollAction(started._id, 'u1', id, 'actor')).rejects.toThrow()
    const seen = await getGameRoomState(started._id)
    expect(seen!.game!.ladyEvent!.duelRounds[0]!.actorRoll).toBe(actorRoll)
    await expect(db.duelRollAction(started._id, 'u2', 'lady-stale', 'target')).rejects.toThrow()
  })

  it('a legacy PLAYING room without lady fields keeps working: reads normalize, K still runs, write adds the fields', async () => {
    const { db, started } = await startedRoom('official')
    const { getGameRoomState } = await import('../../src/lib/gameRoomDb')
    const stored = fakeDb._store.get(started._id)! as unknown as { game: Record<string, unknown> }
    for (const k of ['ladyRuleset', 'ladyEvent', 'ladyStatus', 'kingTask', 'kingTaskHistory']) delete stored.game[k]
    const legacy = await getGameRoomState(started._id)
    expect(legacy!.game!.ladyRuleset).toBe('official')
    stageReveal(started._id, 'u1', 'D-K')
    const room = await db.revealLadyCardAction(started._id, 'u1')
    expect(room.game!.ladyEvent?.step).toBe('KING_WRITE')
    const raw = fakeDb._store.get(started._id)! as unknown as { game: GameState }
    expect(raw.game.ladyStatus.kingUid).toBe('u1')
    expect(raw.game.ladyRuleset).toBe('official')
  })
})
