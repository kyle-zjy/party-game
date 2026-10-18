import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameRoom, GameRoomPlayer } from '../../../shared/gameRoomTypes'

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

  function collection() {
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

  return { collection, _store: store }
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
    const started = await startGameWithEngine(room._id, 'u1')

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
    const started = await startGameWithEngine(room._id, 'u1')
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
    const started = await startGameWithEngine(room._id, 'u1')

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
    const started = await startGameWithEngine(room._id, 'u1')

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
