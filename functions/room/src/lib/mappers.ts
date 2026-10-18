/** Room/PlayerDoc <-> PublicPlayer 之间的转换，集中在这里避免字段遗漏/错写 */
import type { PlayerDoc, RoomDoc } from './db'
import type { PublicPlayer, Room } from '../../../../shared/types'

export function toPublicPlayer(p: PlayerDoc): PublicPlayer {
  return {
    playerId: p.playerId,
    nickname: p.nickname,
    seat: p.seat,
    isHost: p.isHost,
    online: p.online,
    joinedAt: p.joinedAt,
  }
}

export function toRoom(doc: RoomDoc): Room {
  const { _id, ...rest } = doc
  return { ...rest, roomId: _id }
}
