/**
 * 数据访问层：把所有 `rooms` / `players` 集合的读写集中在这里，
 * handler 里不直接碰 `app.database()`。
 *
 * 身份/权限说明：这个云函数在真实环境下是 Event 类型云函数，运行时会自动
 * 注入 `TENCENTCLOUD_SECRETID`/`TENCENTCLOUD_SECRETKEY`（+ 可选
 * `SESSIONTOKEN`）这组管理员临时凭证——这是 CloudBase 官方文档明确的设计：
 * 数据库安全规则只限制前端（Web/小程序）SDK 的直接访问，云函数内的 SDK
 * 调用天然拥有最高权限，不受安全规则约束。`./cloudbase-app.ts` 会显式把
 * 这几个环境变量传给 `cloudbase.init()`（而不是只传 `{}`），原因和踩过的坑
 * 记录在那个文件里——简单说就是运行时里如果同时存在
 * `CLOUDBASE_APIKEY`，SDK 会优先用它构造请求，而那是权限不足的
 * accessKey/Publishable Key 风格鉴权，会导致 `INVALID_CREDENTIALS`。
 * 这里用到的 `TENCENTCLOUD_SECRETID`/`SECRETKEY` 本来就是运行时自动注入的
 * 临时凭证，不是我们自己生成/存储的密钥，也绝不会进 Git。
 * 这里**不使用**前端的 Publishable Key（`accessKey`），也不使用任何
 * 硬编码或 Git 里存储的密钥。
 *
 * 并发策略：Room 的每次修改都带 `version` 乐观锁——
 * `where({ _id, version }).update(...)`，`updated` 为 0 时表示版本冲突，
 * 由调用方决定是否重新读取、重试。
 *
 * createRoom / joinRoom 需要同时写 `rooms` 和 `players` 两个集合，
 * 理想情况下应该用事务保证原子性。这里用 `runTransaction` 实现，
 * 但要注意：js-sdk 3.10.2 的类型声明里没有这个方法（见
 * docs/next-remote-steps.md 的记录），所以用了本地补充的类型
 * （见 ./transaction-types.ts）。事务的真实原子语义尚未经过远端验证，
 * 不得对外声称"已验证"。
 *
 * 异常处理：所有"按 ID 查文档"的读操作都通过 `./db-errors.ts` 的
 * `getDocOrNull` 包装——该文件详细记录了"文档不存在"在当前 SDK 版本下
 * 到底是 resolve 空结果还是 reject 异常这件事本身无法确认，
 * 以及这里选择的保守处理策略。
 */
import { RoomError } from '../../../../shared/errors'
import type { PlayerRecord, Room } from '../../../../shared/types'
import { getApp, getCredentialEnvPresence, getResolvedCredentialSource } from './cloudbase-app'
import { getDocOrNull, wrapDbError } from './db-errors'
import { logDbDiagnostic } from './db-diagnostics'
import type { DbWithTransaction } from './transaction-types'

const ROOMS_COLLECTION = 'rooms'
const PLAYERS_COLLECTION = 'players'

/** 懒加载，原因见 ./cloudbase-app.ts 的注释 */
function getDb(): ReturnType<ReturnType<typeof getApp>['database']> {
  return getApp().database()
}

export interface RoomDoc extends Room {
  _id: string
}

export interface PlayerDoc extends PlayerRecord {
  _id: string
}

/** players 集合的文档 id 固定为 `${roomId}_${uid}`，查找只需一次精确 get，不需要 where 查询 */
export function playerDocId(roomId: string, uid: string): string {
  return `${roomId}_${uid}`
}

export async function getRoomById(roomId: string): Promise<RoomDoc | null> {
  return getDocOrNull(
    () => getDb().collection(ROOMS_COLLECTION).doc(roomId).get(),
    (res) => res.data[0] as RoomDoc | undefined,
    `getRoomById(${roomId})`,
  )
}

export async function getRoomByCode(roomCode: string): Promise<RoomDoc | null> {
  try {
    const res = await getDb().collection(ROOMS_COLLECTION).where({ roomCode }).limit(1).get()
    const doc = (res.data as RoomDoc[])[0]
    return doc ?? null
  } catch (error) {
    // where().get() 查不到匹配项时是官方文档明确的"resolve 空数组"行为
    // （这是集合查询，和按 ID 查单文档的 404 语义不是一回事），
    // 所以这里任何异常都当作真实的数据库错误，不做"文档不存在"的启发式判断。
    throw wrapDbError(error, `getRoomByCode(${roomCode})`)
  }
}

export async function getPlayerByUidAndRoom(
  roomId: string,
  uid: string,
): Promise<PlayerDoc | null> {
  return getDocOrNull(
    () =>
      getDb()
        .collection(PLAYERS_COLLECTION)
        .doc(playerDocId(roomId, uid))
        .get(),
    (res) => res.data[0] as PlayerDoc | undefined,
    `getPlayerByUidAndRoom(${roomId}, ${uid})`,
  )
}

/**
 * 乐观锁更新：只有当文档的 version 仍是 `expectedVersion` 时才会写入成功。
 * 返回 true 表示写入成功，false 表示版本冲突（需要重新读取后重试）。
 * 真实的数据库异常（权限/网络/配额等）会被包装成 RoomError 向上抛出，
 * 不会被误判成版本冲突。
 */
export async function updateRoomWithVersion(
  roomId: string,
  expectedVersion: number,
  patch: Partial<Omit<Room, 'roomId' | 'version'>>,
): Promise<boolean> {
  try {
    const res = await getDb()
      .collection(ROOMS_COLLECTION)
      .where({ _id: roomId, version: expectedVersion })
      .update({ ...patch, version: expectedVersion + 1, updatedAt: Date.now() })
    return (res.updated ?? 0) > 0
  } catch (error) {
    throw wrapDbError(error, `updateRoomWithVersion(${roomId}, v${expectedVersion})`)
  }
}

/**
 * 在事务中创建房间 + 创建者的 player 记录。
 *
 * 注意：`runTransaction` 不在 js-sdk 3.10.2 的类型声明中（见文件头注释），
 * 这里通过 `as unknown as DbWithTransaction` 做最小范围的类型补充，
 * 而不是把整个 db 对象标记为 any。
 *
 * ⚠️ 待联调风险（未验证，不是已确认行为）：`runTransaction` 的存在和签名是靠
 * 反编译运行时产物确认的，不在官方类型声明里；它的原子性/隔离语义
 * （跨集合写入失败时是否真的整体回滚、并发事务之间如何互相隔离）
 * 没有在真实 CloudBase 环境下测试过，本地也无法起一个真实环境来验证。
 * 部署后必须按 docs/next-remote-steps.md 的验证项实测，在验证通过前，
 * 不要把这里的实现当作"已证明可靠"。
 */
export async function createRoomWithHost(room: RoomDoc, hostPlayer: PlayerDoc): Promise<void> {
  const dbWithTxn = getDb() as unknown as DbWithTransaction
  try {
    await dbWithTxn.runTransaction(async (transaction) => {
      await transaction.collection(ROOMS_COLLECTION).doc(room._id).set(room)
      await transaction
        .collection(PLAYERS_COLLECTION)
        .doc(hostPlayer._id)
        .set(hostPlayer)
    })
  } catch (error) {
    if (error instanceof RoomError) throw error
    throw wrapDbError(error, `createRoomWithHost(${room._id})`)
  }
}

/**
 * 在事务中把一个新玩家加入已存在的房间：写入 players 记录，
 * 同时更新 room 的 players 数组 + playerCount + version（乐观锁）。
 * 调用方必须保证 `updatedRoom.version === expectedVersion + 1`。
 */
export async function joinRoomWithPlayer(
  roomId: string,
  expectedVersion: number,
  updatedRoom: Partial<Omit<Room, 'roomId' | 'version'>>,
  playerDoc: PlayerDoc,
): Promise<boolean> {
  const dbWithTxn = getDb() as unknown as DbWithTransaction
  let success = false
  try {
    await dbWithTxn.runTransaction(async (transaction) => {
      const roomRef = transaction.collection(ROOMS_COLLECTION).doc(roomId)
      const current = await roomRef.get()
      const currentDoc = current.data[0] as RoomDoc | undefined
      if (!currentDoc || currentDoc.version !== expectedVersion) {
        // 版本已变化，放弃这次写入，调用方会重新读取、重试。
        return
      }
      await roomRef.update({
        ...updatedRoom,
        version: expectedVersion + 1,
        updatedAt: Date.now(),
      })
      await transaction.collection(PLAYERS_COLLECTION).doc(playerDoc._id).set(playerDoc)
      success = true
    })
  } catch (error) {
    if (error instanceof RoomError) throw error
    throw wrapDbError(error, `joinRoomWithPlayer(${roomId}, v${expectedVersion})`)
  }
  return success
}

export async function updatePlayerRecord(
  roomId: string,
  uid: string,
  patch: Partial<PlayerRecord>,
): Promise<void> {
  try {
    await getDb()
      .collection(PLAYERS_COLLECTION)
      .doc(playerDocId(roomId, uid))
      .update(patch)
  } catch (error) {
    throw wrapDbError(error, `updatePlayerRecord(${roomId}, ${uid})`)
  }
}

/**
 * 仅供开发诊断使用：确认云函数能否用当前凭证成功对 `rooms` 集合发起一次
 * 只读请求。用 `.count()` 而不是 `.get()`——不读取、不返回任何文档内容，
 * 只需要请求本身成功或失败就能判断凭证/连通性是否正常，不会意外泄漏
 * 任何真实房间数据。不创建、不修改、不删除任何数据。
 *
 * 失败时会记录一条结构化、已脱敏的诊断日志（见 db-diagnostics.ts 和
 * cloudbase-app.ts 的 getCredentialEnvPresence/getResolvedCredentialSource），
 * 包含：具体是哪一步失败、错误名称/错误码/错误信息、截断的调用堆栈、
 * 四个凭证环境变量是否存在（布尔值）、当前实际采用的凭证来源名称。
 * 绝不记录任何凭证的实际值。
 */
export async function checkDbConnectivity(): Promise<{ ok: true } | { ok: false; reason: string }> {
  // 调用 getApp() 之前先拿到凭证诊断信息，确保即使 getApp() 本身抛错
  // （理论上不会，但防御性处理），这些诊断信息依然能被记录。
  const envPresence = getCredentialEnvPresence()

  try {
    await getDb().collection(ROOMS_COLLECTION).count()
    return { ok: true }
  } catch (error) {
    const entry = logDbDiagnostic('checkDbConnectivity:rooms.count()', error)
    console.error(
      '[db-health-check] credential-env-presence',
      JSON.stringify(envPresence),
      'resolved-credential-source',
      getResolvedCredentialSource(),
    )
    // 诊断接口本身也不把原始错误文本回传给调用方，只回传一个粗粒度分类，
    // 具体原因仍然只在服务端日志里。
    return { ok: false, reason: entry.classification }
  }
}
