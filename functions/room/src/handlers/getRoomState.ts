/**
 * getRoomState：返回房间的公共状态快照，仅限房间成员调用。
 *
 * 背景：`rooms`/`players` 两个集合都配置成 ADMINONLY，客户端不能直接
 * `db.collection('rooms').doc(roomId).watch()`（也不能 `.get()`）——
 * ADMINONLY 意味着只有云函数的环境身份能读写，这是在数据库创建时就定好的、
 * 本次任务不会去改的安全设置。所以等待大厅的状态同步必须整个经过这个 action，
 * 不能依赖前端直接对数据库建立任何形式的连接。
 *
 * 和 rejoinRoom 的区别：rejoinRoom 还会把 online 标记为 true、更新
 * PlayerRecord，是一次"动作"；getRoomState 只读，不修改任何数据，
 * 用于前端低频轮询时反复调用，不应该每次都触发写入。
 */
import { RoomError } from '../../../../shared/errors'
import type { GetRoomStateResult } from '../../../../shared/api'
import { getPlayerByUidAndRoom, getRoomById } from '../lib/db'
import { toRoom } from '../lib/mappers'

export async function getRoomState(uid: string, roomId: string): Promise<GetRoomStateResult> {
  // 用可信服务端 uid 判断成员身份，不接受客户端传来的 playerId 作为依据。
  const playerRecord = await getPlayerByUidAndRoom(roomId, uid)
  if (!playerRecord || playerRecord.leftAt) {
    throw new RoomError('NOT_MEMBER', '你还不是这个房间的成员')
  }

  const room = await getRoomById(roomId)
  if (!room) {
    throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
  }

  // toRoom 只映射 Room 类型里已经定义好的公开字段（players 数组本身就不含
  // uid，见 shared/types.ts 的 PublicPlayer），这里不需要、也不会额外过滤
  // 别的字段——"不返回其他玩家 uid/身份牌/底牌"这件事从数据模型设计阶段
  // 就已经保证了，不是在这个 handler 里临时拼凑出来的。
  return {
    room: toRoom(room),
    playerId: playerRecord.playerId,
  }
}
