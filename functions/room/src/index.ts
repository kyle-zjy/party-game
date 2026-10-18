/**
 * room 云函数入口：一个函数 + action 分发，而不是每个动作一个云函数。
 *
 * 所有 handler 的第一个参数都是从可信上下文解析出来的 uid——
 * 绝对不接受 event 里客户端可能传入的 uid/playerId 作为身份依据。
 */
import type { RoomRequest } from '../../../shared/api'
import { RoomError } from '../../../shared/errors'
import { getTrustedUid, type SCFContext } from './lib/auth-context'
import { getRoomByCode } from './lib/db'
import { err, ok, type ErrResponse, type OkResponse } from './lib/response'
import { createRoom } from './handlers/createRoom'
import { devDbHealthCheck } from './handlers/devDbHealthCheck'
import { getRoomState } from './handlers/getRoomState'
import { joinRoom } from './handlers/joinRoom'
import { leaveRoom } from './handlers/leaveRoom'
import { rejoinRoom } from './handlers/rejoinRoom'
import { setOnline } from './handlers/setOnline'
import { startGame } from './handlers/startGame'

export const main = async (
  event: RoomRequest,
  context: SCFContext,
): Promise<OkResponse<unknown> | ErrResponse> => {
  try {
    const uid = getTrustedUid(context)
    const data = await dispatch(uid, event)
    return ok(data)
  } catch (error) {
    return err(error)
  }
}

async function dispatch(uid: string, event: RoomRequest): Promise<unknown> {
  switch (event.action) {
    case 'createRoom':
      return createRoom(uid, event.nickname)
    case 'joinRoom':
      return joinRoom(uid, event.roomCode, event.nickname)
    case 'rejoinRoom': {
      // rejoinRoom 的请求体里只有 roomCode（客户端刷新后未必记得 roomId），
      // 先查出房间再转发给内部实现。
      const room = await getRoomByCode(event.roomCode)
      if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在')
      return rejoinRoom(uid, room._id)
    }
    case 'leaveRoom':
      return leaveRoom(uid, event.roomId)
    case 'setOnline':
      return setOnline(uid, event.roomId, event.online)
    case 'startGame':
      return startGame(uid, event.roomId)
    case 'getRoomState':
      return getRoomState(uid, event.roomId)
    case 'devDbHealthCheck':
      // 不需要 uid 参与业务逻辑，但身份校验本身已经在 dispatch 之前
      // 由 getTrustedUid(context) 完成——没有通过身份校验的调用根本到不了这里。
      return devDbHealthCheck()
    default: {
      // 穷举校验：如果 RoomRequest 新增了 action 却忘记在这里处理，这里会编译报错。
      const _exhaustive: never = event
      throw new Error(`未知的 action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
