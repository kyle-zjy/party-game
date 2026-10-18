import { randomUUID } from 'node:crypto'

/** 生成一个展示用的随机 playerId（和 CloudBase uid 无关，可以安全地出现在公开 Room 文档里） */
export function generatePlayerId(): string {
  return `p_${randomUUID().replace(/-/g, '')}`
}

/** 生成房间文档的 _id */
export function generateRoomId(): string {
  return `room_${randomUUID().replace(/-/g, '')}`
}
