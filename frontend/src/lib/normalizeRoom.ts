import type { GameRoom } from '../../../shared/gameRoomTypes'
import { normalizeGameState } from '../../../shared/game/engine/normalize'

/** 读取房间文档后统一补齐旧存档缺失的游戏字段（见 shared/game/engine/normalize.ts） */
export function normalizeRoom(room: GameRoom): GameRoom {
  return room.game ? { ...room, game: normalizeGameState(room.game) } : room
}
